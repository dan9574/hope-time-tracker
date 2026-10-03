mod commands;
mod db;
mod error;
mod events;
mod tray;
mod vibrancy;

use tauri::{Manager, RunEvent, WindowEvent};
use tauri_specta::{collect_commands, collect_events, Builder};

const BINDINGS_PATH: &str = "../src/lib/bindings.ts";

fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            commands::app::app_info,
            commands::setting::setting_get,
            commands::setting::setting_set,
            commands::activity::activity_list,
            commands::activity::activity_upsert,
            commands::activity::activity_archive,
            commands::session::session_start,
            commands::session::session_pause,
            commands::session::session_resume,
            commands::session::session_stop,
            commands::session::session_current,
            commands::session::session_list,
            commands::session::session_upsert,
            commands::session::session_delete,
            commands::tray::tray_set_strings,
            commands::tray::timer_menu_popup,
        ])
        .events(collect_events![events::DataChanged])
}

fn export_bindings(builder: &Builder<tauri::Wry>) {
    builder
        .export(specta_typescript::Typescript::default(), BINDINGS_PATH)
        .expect("failed to export TypeScript bindings");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = specta_builder();

    #[cfg(debug_assertions)]
    export_bindings(&builder);

    tauri::Builder::default()
        .invoke_handler(builder.invoke_handler())
        .on_menu_event(|app, event| tray::handle_menu_event(app, event.id().as_ref()))
        .on_window_event(|window, event| {
            // Closing the main window keeps Hope running in the menu bar / tray.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(move |app| {
            builder.mount_events(app);

            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let database = db::Db::open(&dir.join("hope.db"))?;
            #[cfg(debug_assertions)]
            db::activity::seed_samples_if_empty(&database.conn(), database.device_id(), db::now_ms())?;
            app.manage(database);

            if let Some(main) = app.get_webview_window("main") {
                vibrancy::install(&main)?;
            }
            tray::init(app.handle())?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Hope")
        .run(|app, event| {
            // Clicking the Dock icon brings the hidden window back.
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = event {
                tray::show_main_window(app);
            }
            let _ = (app, event);
        });
}

#[cfg(test)]
mod tests {
    /// `cargo test` keeps `src/lib/bindings.ts` in sync without launching the app.
    #[test]
    fn export_bindings() {
        super::export_bindings(&super::specta_builder());
    }
}
