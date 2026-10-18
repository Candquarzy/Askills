pub mod adapters;
mod commands;
pub mod domain;
pub mod platform;
pub mod services;
pub mod sources;
pub mod storage;
use tauri::Manager;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data = commands::data_directory(app.handle())?;
            app.manage(commands::Runtime::new(data));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            commands::get_snapshot,
            commands::set_skill_display_name,
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
            commands::translate_preview,
            commands::set_library_root,
            commands::cancel_operation,
            commands::get_revision_diff,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Askills");
}
