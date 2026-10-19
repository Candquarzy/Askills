pub mod adapters;
mod commands;
pub mod domain;
pub mod platform;
pub mod services;
pub mod sources;
pub mod storage;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    name: &'static str,
    version: &'static str,
}

// Retain the read-only bootstrap API while desktop features are connected.
#[tauri::command]
fn get_app_info() -> AppInfo {
    AppInfo {
        name: "Askills",
        version: env!("CARGO_PKG_VERSION"),
    }
}

#[tauri::command]
fn open_repository(app: tauri::AppHandle) -> domain::Result<()> {
    app.opener()
        .open_url(env!("CARGO_PKG_REPOSITORY"), None::<&str>)
        .map_err(|error| domain::AppError::new("OpenRepositoryFailed", error.to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .setup(|app| {
            let data = commands::data_directory(app.handle())?;
            let runtime = commands::Runtime::new(data);
            runtime.apply_initial_preferences(app.handle());
            app.manage(runtime);
            // Always start at the configured logical size. Apply this before
            // showing the window so an old maximized/restore rectangle cannot
            // briefly appear or influence the next launch.
            if let Some(window) = app.get_webview_window("main") {
                if let Some(icon) = app.default_window_icon() {
                    window.set_icon(icon.clone())?;
                }
                #[cfg(windows)]
                platform::window::set_taskbar_icon(&window)?;
                let config = app
                    .config()
                    .app
                    .windows
                    .iter()
                    .find(|window| window.label == "main")
                    .ok_or("main window configuration is missing")?;
                window.set_fullscreen(false)?;
                window.unmaximize()?;
                window.set_size(tauri::LogicalSize::new(config.width, config.height))?;
                window.center()?;
                window.show()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            open_repository,
            commands::get_snapshot,
            commands::set_locale,
            commands::set_appearance,
            commands::remember_repository,
            commands::set_skill_display_name,
            commands::set_project_display_name,
            commands::remove_library_skills,
            commands::remove_projects,
            commands::pick_directory,
            commands::prepare_import,
            commands::finish_import,
            commands::discard_import,
            commands::register_project,
            commands::discover_projects,
            commands::scan_project,
            commands::get_document,
            commands::get_revisions,
            commands::preview_deployment,
            commands::apply_deployment,
            commands::remove_deployment,
            commands::rollback_deployment,
            commands::resolve_github,
            commands::resolve_git,
            commands::get_git_version,
            commands::prepare_github,
            commands::get_download_progress,
            commands::set_library_root,
            commands::preview_library_migration,
            commands::discard_selections,
            commands::cancel_operation,
            commands::get_revision_diff,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Askills");
}
