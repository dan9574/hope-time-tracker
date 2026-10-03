//! Sync settings (rebuild-plan 12.4). Every network call happens in Rust; the page only sees status.

use tauri::State;

use crate::sync::{SignInOutcome, SyncError, SyncService, SyncStatus};

#[tauri::command]
#[specta::specta]
pub fn sync_status(sync: State<'_, SyncService>) -> SyncStatus {
    sync.status()
}

/// Email + password sign-in. If this device last synced another account the answer is
/// `confirm_switch`; ask the user, then call again with `confirm_switch: true`.
#[tauri::command]
#[specta::specta]
pub async fn sync_sign_in(
    sync: State<'_, SyncService>,
    email: String,
    password: String,
    confirm_switch: bool,
) -> Result<SignInOutcome, SyncError> {
    let sync = sync.inner().clone();
    sync.sign_in(&email, &password, confirm_switch).await
}

/// Creates an account. Answers `check_email` when the project requires email confirmation.
#[tauri::command]
#[specta::specta]
pub async fn sync_sign_up(
    sync: State<'_, SyncService>,
    email: String,
    password: String,
    confirm_switch: bool,
) -> Result<SignInOutcome, SyncError> {
    let sync = sync.inner().clone();
    sync.sign_up(&email, &password, confirm_switch).await
}

/// Signs out on this device. Local data is kept.
#[tauri::command]
#[specta::specta]
pub async fn sync_sign_out(sync: State<'_, SyncService>) -> Result<(), SyncError> {
    let sync = sync.inner().clone();
    sync.sign_out().await
}

/// Push and pull now instead of waiting for the next round.
#[tauri::command]
#[specta::specta]
pub fn sync_now(sync: State<'_, SyncService>) {
    sync.sync_now();
}
