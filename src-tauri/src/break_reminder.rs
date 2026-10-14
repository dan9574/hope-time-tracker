//! The desktop's "take a break" reminder (rebuild-plan 15.4): a thread polls the running chain every few
//! seconds and, once a step has been due for the desktop's offset, shows a system notification. The rules
//! live in `db::break_reminder`; this module only keeps the strings, remembers what it has shown, and talks
//! to the notification plugin.

use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;
use specta::Type;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::db::break_reminder::{desktop_due, INTERVAL_MS};
use crate::db::{activity, now_ms, setting, Db};
use crate::error::Result;
use crate::tray;

/// Local setting: unset or `"1"` = on (the default), `"0"` = off.
pub const ENABLED: &str = "break.enabled";
/// Local setting: `"<chain id>:<step>"` of the last reminder shown here, so a restart does not repeat it.
const NOTIFIED: &str = "break.notified";
const POLL: Duration = Duration::from_secs(15);

/// Notification text, supplied by the frontend so every string stays in the i18next locale files.
/// `body` may contain `{name}` and `{duration}`.
#[derive(Debug, Clone, Deserialize, Type)]
pub struct BreakStrings {
    pub title: String,
    pub body: String,
    /// Duration units, as in `2 h 15 min`.
    pub hours: String,
    pub minutes: String,
    pub unknown_activity: String,
}

impl Default for BreakStrings {
    // Shown only if a reminder falls due before the frontend has sent the localized set.
    fn default() -> Self {
        Self {
            title: "Take a break".into(),
            body: "{name} has been running for {duration} without a break".into(),
            hours: "h".into(),
            minutes: "min".into(),
            unknown_activity: "Unknown activity".into(),
        }
    }
}

#[derive(Default)]
struct BreakState {
    strings: Mutex<BreakStrings>,
}

pub fn init(app: &AppHandle) -> Result<()> {
    app.manage(BreakState::default());
    let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(POLL);
        if let Err(e) = tick(&handle) {
            eprintln!("break reminder: {e}");
        }
    });
    Ok(())
}

pub fn set_strings(app: &AppHandle, strings: BreakStrings) {
    *app.state::<BreakState>().strings.lock().unwrap() = strings;
}

/// One poll: show the running chain's next reminder if it is due and has not been shown here.
fn tick(app: &AppHandle) -> Result<()> {
    let (title, body) = {
        let db = app.state::<Db>();
        let conn = db.conn();
        if setting::get(&conn, ENABLED)?.as_deref() == Some("0") {
            return Ok(());
        }
        let Some((running, chain, due)) = desktop_due(&conn, now_ms())? else { return Ok(()) };
        let marker = format!("{chain}:{}", due.step);
        if setting::get(&conn, NOTIFIED)?.as_deref() == Some(marker.as_str()) {
            return Ok(());
        }
        setting::set(&conn, NOTIFIED, &marker)?;

        let strings = app.state::<BreakState>().strings.lock().unwrap().clone();
        let name = match activity::get(&conn, &running.activity_id)? {
            Some(a) => tray::activity_label(&conn, &a)?,
            None => strings.unknown_activity.clone(),
        };
        let ran = format_duration(due.step * INTERVAL_MS, &strings);
        (strings.title.clone(), strings.body.replace("{name}", &name).replace("{duration}", &ran))
    };
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        eprintln!("break reminder: could not show the notification: {e}");
    }
    Ok(())
}

/// `2 h 15 min`, `3 h`, `45 min` — the same shape as `DurationFormat` in HopeCore and `formatDuration`
/// in the frontend, with a narrow no-break space before each unit.
fn format_duration(ms: i64, strings: &BreakStrings) -> String {
    let minutes = ms.max(0) / 60_000;
    let (h, m) = (minutes / 60, minutes % 60);
    let mut parts = Vec::new();
    if h > 0 {
        parts.push(format!("{h}\u{202F}{}", strings.hours));
    }
    if m > 0 || h == 0 {
        parts.push(format!("{m}\u{202F}{}", strings.minutes));
    }
    parts.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_like_the_other_platforms() {
        let s = BreakStrings::default();
        assert_eq!(format_duration(90 * 60_000, &s), "1\u{202F}h 30\u{202F}min");
        assert_eq!(format_duration(180 * 60_000, &s), "3\u{202F}h");
        assert_eq!(format_duration(45 * 60_000, &s), "45\u{202F}min");
        assert_eq!(format_duration(0, &s), "0\u{202F}min");
    }
}
