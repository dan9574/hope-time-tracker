mod commands;
mod db;

use tauri::Manager;
use tauri_specta::{collect_commands, Builder};

const BINDINGS_PATH: &str = "../src/lib/bindings.ts";

fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![
        commands::app::app_info,
        commands::setting::setting_get,
        commands::setting::setting_set,
    ])
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
        .setup(move |app| {
            builder.mount_events(app);

            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(db::Db::open(&dir.join("hope.db"))?);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Hope");
}

#[cfg(test)]
mod tests {
    /// `cargo test` keeps `src/lib/bindings.ts` in sync without launching the app.
    #[test]
    fn export_bindings() {
        super::export_bindings(&super::specta_builder());
    }
}
