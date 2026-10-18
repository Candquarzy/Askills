use crate::domain::{
    AppError, DetectedSkill, ImportPreview, Project, Result, Revision, Skill, SkillDocument,
    SkillSource,
};
use crate::services::{deployments, library, projects};
use crate::sources::github;
use crate::storage::Store;
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
        let display = path.to_string_lossy().into_owned();
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
}
impl Runtime {
    pub fn new(path: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            workspace: Mutex::new(Workspace::open(path)),
            busy: AtomicBool::new(false),
            cancel: AtomicBool::new(false),
        })
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
            library_root: w.store.library_root.to_string_lossy().into_owned(),
            recovery: w.recovery.clone(),
        })
    })
    .await
}
#[tauri::command]
pub async fn pick_directory(
    app: AppHandle,
    state: State<'_, Arc<Runtime>>,
    purpose: String,
) -> Result<Option<DirectorySelection>> {
    let title = match purpose.as_str() {
        "import" => "选择包含 SKILL.md 的技能文件夹",
        "project" => "选择项目文件夹",
        "discover" => "选择项目扫描根目录",
        "library" => "选择空的技能库目录",
        _ => return Err(AppError::new("InvalidSelection", "不支持的目录用途")),
    };
    work(state.inner().clone(), move |w, _| {
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
) -> Result<PreparedImport> {
    work(state.inner().clone(), move |w, c| {
        let catalog = &w
            .catalogs
            .get(&catalog_id)
            .ok_or_else(|| AppError::new("CatalogExpired", "来源列表已过期，请重新查找"))?
            .catalog;
        let download = github::download(catalog, &skill_path, c)?;
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
pub async fn set_library_root(state: State<'_, Arc<Runtime>>, selection_id: String) -> Result<()> {
    work(state.inner().clone(), move |w, _| {
        let path = w.selection(&selection_id, "library")?;
        w.store.set_library_root(&path)?;
        w.selections.remove(&selection_id);
        Ok(())
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
                "只能比较同一技能的不同版本",
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

pub fn data_directory(app: &AppHandle) -> Result<PathBuf> {
    // Development smoke tests use an isolated directory, never the real personal library.
    #[cfg(debug_assertions)]
    if let Some(path) = std::env::var_os("ASKILLS_TEST_DATA_DIR") {
        return Ok(PathBuf::from(path));
    }
    app.path()
        .app_local_data_dir()
        .map_err(|e| AppError::new("DataDirectory", e.to_string()))
}
