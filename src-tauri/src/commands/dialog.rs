//! Native confirmation dialogs (rebuild-plan 10 D: anything that loses data must be confirmed).
//! Labels come from the page so they stay in the locale files.

use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

/// Shows a warning sheet on the window; `true` if the user chose `confirm_label`.
#[tauri::command]
#[specta::specta]
pub async fn dialog_confirm(
    app: AppHandle,
    window: WebviewWindow,
    title: String,
    message: String,
    confirm_label: String,
    cancel_label: String,
) -> bool {
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(confirm_label, cancel_label))
        .parent(&window)
        .blocking_show()
}

/// Shows an informational sheet with a single button.
#[tauri::command]
#[specta::specta]
pub async fn dialog_alert(app: AppHandle, window: WebviewWindow, title: String, message: String, ok_label: String) {
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCustom(ok_label))
        .parent(&window)
        .blocking_show();
}
