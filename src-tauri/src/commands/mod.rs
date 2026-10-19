use crate::domain::{
    AppError, DetectedSkill, ImportPreview, Project, Result, Revision, Skill, SkillDocument,
    SkillSource,
};
use crate::services::{deployments, library, projects};
use crate::sources::github;
use crate::storage::{
    Appearance, LibraryMigrationPlan, LibraryMigrationResult, Locale, Store, ThemeMode,
};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

mod bootstrap;
pub use bootstrap::initialize_runtime;

#[cfg(test)]
mod tests;

const SELECTION_LIMIT: usize = 256;
const IMPORT_LIMIT: usize = 8;
const CATALOG_LIMIT: usize = 4;
const TOKEN_TTL: Duration = Duration::from_secs(30 * 60);

struct Selection {
    path: PathBuf,
    purpose: String,
    created: Instant,
}
struct PendingImport {
    path: PathBuf,
    source: Option<SkillSource>,
    preview: ImportPreview,
    created: Instant,
    _download: Option<tempfile::TempDir>,
}
struct SavedCatalog {
    catalog: github::Catalog,
    git: Option<github::git::GitCatalog>,
    created: Instant,
}
pub struct Workspace {
    store: Store,
    selections: HashMap<String, Selection>,
    imports: HashMap<String, PendingImport>,
    catalogs: HashMap<String, SavedCatalog>,
    recovery: Vec<String>,
}

impl Workspace {
    fn open(path: PathBuf) -> Result<Self> {
        let mut store = Store::open(&path)?;
        deployments::initialize(&store)?;
        let recovery = deployments::recover(&mut store)?;
        Ok(Self {
            store,
            selections: HashMap::new(),
            imports: HashMap::new(),
            catalogs: HashMap::new(),
            recovery,
        })
    }
    fn expire(&mut self) {
        self.selections
            .retain(|_, s| s.created.elapsed() < TOKEN_TTL);
        self.imports.retain(|_, s| s.created.elapsed() < TOKEN_TTL);
        self.catalogs.retain(|_, s| s.created.elapsed() < TOKEN_TTL);
    }
    fn selection(&self, id: &str, purpose: &str) -> Result<PathBuf> {
        let selected = self
            .selections
            .get(id)
            .ok_or_else(|| AppError::new("SelectionExpired", "目录选择已失效，请重新选择"))?;
        if selected.purpose != purpose {
            return Err(AppError::new("InvalidSelection", "目录选择用途不匹配"));
        }
        Ok(selected.path.clone())
    }
    fn add_selection(&mut self, path: PathBuf, purpose: &str) -> Result<DirectorySelection> {
        if self.selections.len() >= SELECTION_LIMIT {
            return Err(AppError::new(
                "SelectionLimit",
                "暂存目录选择过多，请完成当前操作或稍后重试",
            ));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let display = crate::platform::fs::display_path(&path);
        self.selections.insert(
            id.clone(),
            Selection {
                path,
                purpose: purpose.into(),
                created: Instant::now(),
            },
        );
        Ok(DirectorySelection { id, path: display })
    }
    fn migrate_selection(
        &mut self,
        id: &str,
        cancel: &AtomicBool,
    ) -> Result<LibraryMigrationResult> {
        let path = self.selection(id, "library")?;
        let result = self.store.migrate_library(&path, cancel)?;
        self.selections.remove(id);
        self.imports.clear();
        Ok(result)
    }
    fn prepare(
        &mut self,
        path: PathBuf,
        source: Option<SkillSource>,
        download: Option<tempfile::TempDir>,
        cancel: &AtomicBool,
    ) -> Result<PreparedImport> {
        if self.imports.len() >= IMPORT_LIMIT {
            return Err(AppError::new("PreviewLimit", "请先完成或关闭其他导入预览"));
        }
        let preview = library::inspect_skill(&path, cancel)?;
        let id = uuid::Uuid::new_v4().to_string();
        self.imports.insert(
            id.clone(),
            PendingImport {
                path,
                source: source.clone(),
                preview: preview.clone(),
                created: Instant::now(),
                _download: download,
            },
        );
        Ok(PreparedImport {
            id,
            preview,
            source,
        })
    }
}

pub struct Runtime {
    workspace: Mutex<Result<Workspace>>,
    busy: AtomicBool,
    cancel: AtomicBool,
    download_progress: Mutex<Option<DownloadStatus>>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadStatus {
    request_id: String,
    #[serde(flatten)]
    progress: github::DownloadProgress,
    stage: String,
}
impl Runtime {
    pub fn apply_initial_preferences(&self, app: &AppHandle) {
        if let Ok(locked) = self.workspace.lock()
            && let Ok(workspace) = locked.as_ref()
            && let Ok(appearance) = workspace.store.appearance()
            && let Some(window) = app.get_webview_window("main")
        {
            let _ = window.set_theme(native_theme(appearance.mode));
            if let Ok(locale) = workspace.store.locale() {
                let _ = window.set_title(locale.window_title());
            }
        }
    }
    pub fn new(path: PathBuf) -> Arc<Self> {
        Self::from_workspace(Workspace::open(path))
    }
    fn from_workspace(workspace: Result<Workspace>) -> Arc<Self> {
        Arc::new(Self {
            workspace: Mutex::new(workspace),
            busy: AtomicBool::new(false),
            cancel: AtomicBool::new(false),
            download_progress: Mutex::new(None),
        })
    }
}
fn native_theme(mode: ThemeMode) -> Option<tauri::Theme> {
    match mode {
        ThemeMode::System => None,
        ThemeMode::Light => Some(tauri::Theme::Light),
        ThemeMode::Dark => Some(tauri::Theme::Dark),
    }
}
struct BusyGuard(Arc<Runtime>);
impl Drop for BusyGuard {
    fn drop(&mut self) {
        self.0.busy.store(false, Ordering::Release);
    }
}

async fn work<T: Send + 'static>(
    runtime: Arc<Runtime>,
    task: impl FnOnce(&mut Workspace, &AtomicBool) -> Result<T> + Send + 'static,
) -> Result<T> {
    runtime
        .busy
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| AppError::new("Busy", "另一个操作正在进行，请等待或取消后重试"))?;
    runtime.cancel.store(false, Ordering::Release);
    let guard = BusyGuard(runtime.clone());
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let mut locked = runtime
            .workspace
            .lock()
            .map_err(|_| AppError::new("StateUnavailable", "应用状态异常，请重新启动"))?;
        let workspace = locked.as_mut().map_err(|e| e.clone())?;
        // A switch that already rebound project entries must finish before another
        // command can add data to the old library or create an outdated plan.
        workspace.store.resume_library_migration()?;
        workspace.expire();
        task(workspace, &runtime.cancel)
    })
    .await
    .map_err(|e| AppError::new("TaskFailed", e.to_string()))?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    skills: Vec<Skill>,
    projects: Vec<Project>,
    deployments: Vec<deployments::Deployment>,
    library_root: String,
    recovery: Vec<String>,
    repository_history: Vec<String>,
    appearance: Appearance,
    locale: Locale,
}
#[derive(Serialize)]
pub struct DirectorySelection {
    id: String,
    path: String,
}
#[derive(Serialize)]
pub struct PreparedImport {
    id: String,
    preview: ImportPreview,
    source: Option<SkillSource>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredProject {
    selection_id: String,
    name: String,
    path: String,
    reason: String,
}
#[derive(Serialize)]
pub struct CatalogView {
    id: String,
    repository: String,
    reference: String,
    commit: String,
    candidates: Vec<github::Candidate>,
}
#[derive(Serialize)]
pub struct RevisionDiff {
    added: Vec<String>,
    removed: Vec<String>,
    changed: Vec<String>,
    before: String,
    after: String,
}

#[tauri::command]
pub async fn get_snapshot(state: State<'_, Arc<Runtime>>) -> Result<Snapshot> {
    work(state.inner().clone(), |w, c| {
        Ok(Snapshot {
            skills: w.store.list_skills()?,
            projects: w.store.list_projects()?,
            deployments: deployments::list_cancellable(&w.store, c)?,
            library_root: crate::platform::fs::display_path(&w.store.library_root),
            recovery: w.recovery.clone(),
            repository_history: w.store.repository_history()?,
            appearance: w.store.appearance()?,
            locale: w.store.locale()?,
        })
    })
    .await
}
#[tauri::command]
pub async fn remove_library_skills(
    state: State<'_, Arc<Runtime>>,
    skill_ids: Vec<String>,
) -> Result<()> {
    work(state.inner().clone(), move |w, c| {
        w.store.remove_library_skills(&skill_ids, c)
    })
    .await
}
#[tauri::command]
pub async fn remove_projects(
    state: State<'_, Arc<Runtime>>,
    project_ids: Vec<String>,
) -> Result<()> {
    work(state.inner().clone(), move |w, c| {
        w.store.remove_projects(&project_ids, c)
    })
    .await
}
#[tauri::command]
pub async fn set_project_display_name(
    state: State<'_, Arc<Runtime>>,
    project_id: String,
    display_name: String,
) -> Result<Project> {
    work(state.inner().clone(), move |w, _| {
        w.store.set_project_display_name(&project_id, &display_name)
    })
    .await
}
#[tauri::command]
pub async fn set_locale(
    app: AppHandle,
    state: State<'_, Arc<Runtime>>,
    locale: Locale,
) -> Result<Locale> {
    work(state.inner().clone(), move |w, _| {
        let saved = w.store.set_locale(locale)?;
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_title(saved.window_title());
        }
        Ok(saved)
    })
    .await
}
#[tauri::command]
pub async fn set_appearance(
    app: AppHandle,
    state: State<'_, Arc<Runtime>>,
    appearance: Appearance,
) -> Result<Appearance> {
    work(state.inner().clone(), move |w, _| {
        let saved = w.store.set_appearance(appearance)?;
        if let Some(window) = app.get_webview_window("main") {
            // Native decorations depend on platform support; content theming
            // and persistence must remain usable if decorations cannot change.
            let _ = window.set_theme(native_theme(saved.mode));
        }
        Ok(saved)
    })
    .await
}
#[tauri::command]
pub async fn remember_repository(
    state: State<'_, Arc<Runtime>>,
    repository: String,
) -> Result<Vec<String>> {
    work(state.inner().clone(), move |w, _| {
        w.store.remember_repository(&repository)
    })
    .await
}
#[tauri::command]
pub async fn pick_directory(
    app: AppHandle,
    state: State<'_, Arc<Runtime>>,
    purpose: String,
) -> Result<Option<DirectorySelection>> {
    let titles = match purpose.as_str() {
        "import" => (
            "选择包含 SKILL.md 的 skill 文件夹",
            "Choose a skill folder containing SKILL.md",
        ),
        "project" => ("选择项目文件夹", "Choose a project folder"),
        "discover" => ("选择项目扫描根目录", "Choose a folder to scan for projects"),
        "library" => ("选择空的 skills 库目录", "Choose an empty library folder"),
        _ => return Err(AppError::new("InvalidSelection", "不支持的目录用途")),
    };
    work(state.inner().clone(), move |w, _| {
        let title = if w.store.locale()? == Locale::English {
            titles.1
        } else {
            titles.0
        };
        let Some(selected) = app.dialog().file().set_title(title).blocking_pick_folder() else {
            return Ok(None);
        };
        let path = selected
            .into_path()
            .map_err(|e| AppError::new("InvalidPath", e.to_string()))?;
        // A fresh native choice replaces the previous UI flow and any abandoned
        // discovery batch, keeping directory grants bounded across repeated scans.
        w.selections.clear();
        w.add_selection(path, &purpose).map(Some)
    })
    .await
}
#[tauri::command]
pub async fn prepare_import(
    state: State<'_, Arc<Runtime>>,
    selection_id: String,
) -> Result<PreparedImport> {
    work(state.inner().clone(), move |w, c| {
        let path = w.selection(&selection_id, "import")?;
        let value = w.prepare(path, None, None, c)?;
        w.selections.remove(&selection_id);
        Ok(value)
    })
    .await
}
#[tauri::command]
pub async fn finish_import(state: State<'_, Arc<Runtime>>, import_id: String) -> Result<Skill> {
    work(state.inner().clone(), move |w, c| {
        let pending = w
            .imports
            .get(&import_id)
            .ok_or_else(|| AppError::new("PreviewExpired", "导入预览已过期，请重新预览"))?;
        let skill = w.store.import_local(
            &pending.path,
            pending.source.clone(),
            Some(&pending.preview.hash),
            c,
        )?;
        w.imports.remove(&import_id);
        Ok(skill)
    })
    .await
}
#[tauri::command]
pub async fn discard_import(state: State<'_, Arc<Runtime>>, import_id: String) -> Result<()> {
    work(state.inner().clone(), move |w, _| {
        w.imports.remove(&import_id);
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn register_project(
    state: State<'_, Arc<Runtime>>,
    selection_id: String,
) -> Result<Project> {
    work(state.inner().clone(), move |w, _| {
        let p = w.selection(&selection_id, "project")?;
        let result = w.store.add_project(&p)?;
        w.selections.remove(&selection_id);
        Ok(result)
    })
    .await
}
#[tauri::command]
pub async fn discover_projects(
    state: State<'_, Arc<Runtime>>,
    selection_id: String,
) -> Result<Vec<DiscoveredProject>> {
    work(state.inner().clone(), move |w, c| {
        let root = w.selection(&selection_id, "discover")?;
        let candidates = projects::discover_projects(&root, 4, c)?;
        if candidates.len() > SELECTION_LIMIT {
            return Err(AppError::new(
                "SelectionLimit",
                "发现的项目过多，请选择更小的扫描目录",
            ));
        }
        w.selections.clear();
        let mut found = Vec::new();
        for p in candidates {
            let selected = w.add_selection(PathBuf::from(&p.path), "project")?;
            found.push(DiscoveredProject {
                selection_id: selected.id,
                name: p.name,
                path: p.path,
                reason: p.reason,
            });
        }
        w.selections.remove(&selection_id);
        Ok(found)
    })
    .await
}
#[tauri::command]
pub async fn scan_project(
    state: State<'_, Arc<Runtime>>,
    project_id: String,
) -> Result<Vec<DetectedSkill>> {
    work(state.inner().clone(), move |w, c| {
        let p = w.store.project(&project_id)?;
        projects::scan_project(&PathBuf::from(p.path), c)
    })
    .await
}
#[tauri::command]
pub async fn get_document(
    state: State<'_, Arc<Runtime>>,
    revision_id: String,
) -> Result<SkillDocument> {
    work(state.inner().clone(), move |w, c| {
        w.store.read_revision_cancellable(&revision_id, c)
    })
    .await
}
#[tauri::command]
pub async fn get_revisions(
    state: State<'_, Arc<Runtime>>,
    skill_id: String,
) -> Result<Vec<Revision>> {
    work(state.inner().clone(), move |w, _| {
        w.store.list_revisions(&skill_id)
    })
    .await
}
#[tauri::command]
pub async fn preview_deployment(
    state: State<'_, Arc<Runtime>>,
    project_id: String,
    revision_id: String,
    agent: String,
    mode: String,
) -> Result<deployments::Plan> {
    work(state.inner().clone(), move |w, c| {
        deployments::plan_cancellable(&w.store, &project_id, &revision_id, &agent, &mode, c)
    })
    .await
}
#[tauri::command]
pub async fn apply_deployment(
    state: State<'_, Arc<Runtime>>,
    plan_id: String,
) -> Result<deployments::Deployment> {
    work(state.inner().clone(), move |w, c| {
        deployments::apply(&mut w.store, &plan_id, c)
    })
    .await
}
#[tauri::command]
pub async fn remove_deployment(
    state: State<'_, Arc<Runtime>>,
    deployment_id: String,
) -> Result<()> {
    work(state.inner().clone(), move |w, c| {
        deployments::uninstall(&mut w.store, &deployment_id, c)
    })
    .await
}
#[tauri::command]
pub async fn rollback_deployment(
    state: State<'_, Arc<Runtime>>,
    deployment_id: String,
) -> Result<deployments::Deployment> {
    work(state.inner().clone(), move |w, c| {
        deployments::rollback(&mut w.store, &deployment_id, c)
    })
    .await
}
#[tauri::command]
pub async fn resolve_github(
    state: State<'_, Arc<Runtime>>,
    repository: String,
    reference: String,
) -> Result<CatalogView> {
    work(state.inner().clone(), move |w, c| {
        if w.catalogs.len() >= CATALOG_LIMIT {
            w.catalogs.clear();
        }
        let catalog = github::resolve(&repository, &reference, c)?;
        let value = CatalogView {
            id: uuid::Uuid::new_v4().to_string(),
            repository: catalog.repository.clone(),
            reference: catalog.reference.clone(),
            commit: catalog.commit.clone(),
            candidates: catalog.candidates.clone(),
        };
        w.catalogs.insert(
            value.id.clone(),
            SavedCatalog {
                catalog,
                git: None,
                created: Instant::now(),
            },
        );
        Ok(value)
    })
    .await
}
#[tauri::command]
pub async fn prepare_github(
    state: State<'_, Arc<Runtime>>,
    catalog_id: String,
    skill_path: String,
    request_id: Option<String>,
) -> Result<PreparedImport> {
    let runtime = state.inner().clone();
    let request_id = request_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    if request_id.len() > 80 || request_id.is_empty() {
        return Err(AppError::new("InvalidRequest", "下载任务编号无效"));
    }
    work(state.inner().clone(), move |w, c| {
        let saved = w
            .catalogs
            .get(&catalog_id)
            .ok_or_else(|| AppError::new("CatalogExpired", "来源列表已过期，请重新查找"))?;
        let progress = |value: github::DownloadProgress| {
            if let Ok(mut current) = runtime.download_progress.lock() {
                *current = Some(DownloadStatus {
                    request_id: request_id.clone(),
                    progress: value,
                    stage: "download".into(),
                });
            }
        };
        let download = if let Some(git) = &saved.git {
            github::git::download_with_progress(git, &skill_path, c, &progress)?
        } else {
            github::download_with_progress(&saved.catalog, &skill_path, c, &progress)?
        };
        if let Ok(mut current) = runtime.download_progress.lock()
            && let Some(status) = current.as_mut()
        {
            status.stage = "validate".into();
        }
        w.prepare(
            download.skill_path,
            Some(download.source),
            Some(download.directory),
            c,
        )
    })
    .await
}
#[tauri::command]
pub fn get_download_progress(
    state: State<'_, Arc<Runtime>>,
    request_id: String,
) -> Option<DownloadStatus> {
    // Read-only progress does not take the workspace mutex or enter the job queue.
    state
        .download_progress
        .lock()
        .ok()?
        .as_ref()
        .filter(|value| value.request_id == request_id)
        .cloned()
}
#[tauri::command]
pub async fn get_git_version(state: State<'_, Arc<Runtime>>) -> Result<String> {
    work(state.inner().clone(), |_, c| github::git::version(c)).await
}
#[tauri::command]
pub async fn resolve_git(
    state: State<'_, Arc<Runtime>>,
    repository: String,
    reference: String,
) -> Result<CatalogView> {
    work(state.inner().clone(), move |w, c| {
        if w.catalogs.len() >= CATALOG_LIMIT {
            w.catalogs.clear();
        }
        let resolved = github::git::resolve(&repository, &reference, c)?;
        let catalog = resolved.catalog.clone();
        let value = CatalogView {
            id: uuid::Uuid::new_v4().to_string(),
            repository: catalog.repository.clone(),
            reference: catalog.reference.clone(),
            commit: catalog.commit.clone(),
            candidates: catalog.candidates.clone(),
        };
        w.catalogs.insert(
            value.id.clone(),
            SavedCatalog {
                catalog,
                git: Some(resolved),
                created: Instant::now(),
            },
        );
        Ok(value)
    })
    .await
}
#[tauri::command]
pub async fn preview_library_migration(
    state: State<'_, Arc<Runtime>>,
    selection_id: String,
) -> Result<LibraryMigrationPlan> {
    work(state.inner().clone(), move |w, cancel| {
        let path = w.selection(&selection_id, "library")?;
        w.store.preview_library_migration(&path, cancel)
    })
    .await
}
#[tauri::command]
pub async fn discard_selections(
    state: State<'_, Arc<Runtime>>,
    selection_ids: Vec<String>,
) -> Result<()> {
    work(state.inner().clone(), move |w, _| {
        if selection_ids.len() > SELECTION_LIMIT {
            return Err(AppError::new("SelectionLimit", "目录选择数量超过上限"));
        }
        for id in selection_ids {
            w.selections.remove(&id);
        }
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn set_library_root(
    state: State<'_, Arc<Runtime>>,
    selection_id: String,
) -> Result<LibraryMigrationResult> {
    work(state.inner().clone(), move |w, cancel| {
        w.migrate_selection(&selection_id, cancel)
    })
    .await
}
#[tauri::command]
pub fn cancel_operation(state: State<'_, Arc<Runtime>>) {
    state.cancel.store(true, Ordering::Release);
}
#[tauri::command]
pub async fn set_skill_display_name(
    state: State<'_, Arc<Runtime>>,
    skill_id: String,
    display_name: String,
) -> Result<Skill> {
    work(state.inner().clone(), move |w, _| {
        w.store.set_display_name(&skill_id, &display_name)
    })
    .await
}
#[tauri::command]
pub async fn get_revision_diff(
    state: State<'_, Arc<Runtime>>,
    before_id: String,
    after_id: String,
) -> Result<RevisionDiff> {
    work(state.inner().clone(), move |w, c| {
        let before = w.store.read_revision_cancellable(&before_id, c)?;
        let after = w.store.read_revision_cancellable(&after_id, c)?;
        if before.skill.id != after.skill.id {
            return Err(AppError::new(
                "InvalidComparison",
                "只能比较同一 skill 的不同版本",
            ));
        }
        let old =
            crate::platform::fs::inspect_tree(&PathBuf::from(before.revision.path), c)?.file_hashes;
        let new =
            crate::platform::fs::inspect_tree(&PathBuf::from(after.revision.path), c)?.file_hashes;
        Ok(RevisionDiff {
            added: new
                .keys()
                .filter(|p| !old.contains_key(*p))
                .cloned()
                .collect(),
            removed: old
                .keys()
                .filter(|p| !new.contains_key(*p))
                .cloned()
                .collect(),
            changed: new
                .keys()
                .filter(|p| old.get(*p).is_some_and(|h| Some(h) != new.get(*p)))
                .cloned()
                .collect(),
            before: before.markdown,
            after: after.markdown,
        })
    })
    .await
}
