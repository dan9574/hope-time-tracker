//! Menu bar / system tray: start, pause, resume and stop without opening the window.
//! The same menu also pops up from the timer button in the main window.

use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;
use specta::Type;
use tauri::image::Image;
use tauri::menu::{IconMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Wry};

use crate::db::activity::{self, Activity, ActivityColor};
use crate::db::{day, now_ms, session, Db};
use crate::error::Result;
use crate::events;

const TRAY_ID: &str = "main";

const ID_PAUSE: &str = "pause";
const ID_RESUME: &str = "resume";
const ID_STOP: &str = "stop";
const ID_OPEN: &str = "open";
const ID_QUIT: &str = "quit";
const ID_WAKE: &str = "day_wake";
const ID_SLEEP: &str = "day_sleep";
const START_PREFIX: &str = "start:";

/// Menu labels, supplied by the frontend so every string stays in the i18next locale files.
/// `resume` may contain `{name}`, replaced with the paused activity's name.
#[derive(Debug, Clone, Deserialize, Type)]
pub struct TrayStrings {
    pub pause: String,
    pub resume: String,
    pub stop: String,
    pub no_activities: String,
    pub unknown_activity: String,
    pub open: String,
    pub quit: String,
    pub wake: String,
    pub sleep: String,
}

impl Default for TrayStrings {
    // Shown only until the frontend has loaded and sent the localized set.
    fn default() -> Self {
        Self {
            pause: "Pause".into(),
            resume: "Resume {name}".into(),
            stop: "Stop".into(),
            no_activities: "No activities".into(),
            unknown_activity: "Unknown activity".into(),
            open: "Open Hope".into(),
            quit: "Quit Hope".into(),
            wake: "Wake Up".into(),
            sleep: "Go to Sleep".into(),
        }
    }
}

/// Which wake/sleep item the tray offers right now. The page computes it, because the time windows
/// depend on the local clock and Rust has no time zone database.
#[derive(Debug, Clone, Deserialize, Type)]
pub struct DayAction {
    pub kind: DayActionKind,
    /// Local date of the day being woken into or slept out of.
    pub date: String,
    pub utc_offset_min: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum DayActionKind {
    Wake,
    Sleep,
}

#[derive(Default)]
struct TrayState {
    strings: Mutex<TrayStrings>,
    day_action: Mutex<Option<DayAction>>,
    running_since: Mutex<Option<i64>>,
    title: Mutex<String>,
}

pub fn init(app: &AppHandle) -> Result<()> {
    app.manage(TrayState::default());
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(tray_icon())
        .icon_as_template(true)
        .tooltip("Hope")
        .menu(&build_menu(app, true)?)
        .show_menu_on_left_click(true)
        .build(app)?;
    refresh(app);

    // Keep the elapsed time in the menu bar current; only touches the tray when the text changes.
    let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        update_title(&handle);
    });
    Ok(())
}

pub fn set_day_action(app: &AppHandle, action: Option<DayAction>) {
    *app.state::<TrayState>().day_action.lock().unwrap() = action;
    refresh(app);
}

pub fn set_strings(app: &AppHandle, strings: TrayStrings) {
    *app.state::<TrayState>().strings.lock().unwrap() = strings;
    refresh(app);
}

/// Rebuild the menu from the database. Cheap enough to call after every change.
pub fn refresh(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    match build_menu(app, true) {
        Ok(menu) => {
            if let Err(e) = tray.set_menu(Some(menu)) {
                eprintln!("failed to set tray menu: {e}");
            }
        }
        Err(e) => eprintln!("failed to build tray menu: {e}"),
    }
    let running_since = session::current(&app.state::<Db>().conn())
        .ok()
        .and_then(|s| s.running)
        .map(|s| s.start_ms);
    *app.state::<TrayState>().running_since.lock().unwrap() = running_since;
    update_title(app);
}

fn update_title(app: &AppHandle) {
    let state = app.state::<TrayState>();
    let text = match *state.running_since.lock().unwrap() {
        Some(start) => format_elapsed(now_ms() - start),
        None => String::new(),
    };
    let mut last = state.title.lock().unwrap();
    if *last == text {
        return;
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let title = (!text.is_empty()).then_some(text.as_str());
        let _ = tray.set_title(title);
    }
    *last = text;
}

/// `H:MM`, the same format the main window uses for durations.
fn format_elapsed(ms: i64) -> String {
    let minutes = ms.max(0) / 60_000;
    format!("{}:{:02}", minutes / 60, minutes % 60)
}

/// "Parent · Child" for sub-activities, the plain name otherwise.
pub fn activity_label(conn: &rusqlite::Connection, a: &Activity) -> Result<String> {
    Ok(match a.parent_id.as_deref().map(|p| activity::get(conn, p)).transpose()?.flatten() {
        Some(parent) => format!("{} · {}", parent.name, a.name),
        None => a.name.clone(),
    })
}

/// `for_tray` adds the window/quit items, which make no sense in the in-window popup.
/// Activities with sub-activities become native submenus: the parent itself first, then its children.
pub fn build_menu(app: &AppHandle, for_tray: bool) -> Result<Menu<Wry>> {
    let (state, activities, running_label, paused_label) = {
        let db = app.state::<Db>();
        let conn = db.conn();
        let state = session::current(&conn)?;
        let activities = activity::list(&conn, false)?;
        let label_of = |id: &str| -> Result<Option<(String, ActivityColor)>> {
            Ok(match activity::get(&conn, id)? {
                Some(a) => Some((activity_label(&conn, &a)?, a.color)),
                None => None,
            })
        };
        let running_label = match &state.running {
            Some(s) => Some(label_of(&s.activity_id)?),
            None => None,
        };
        let paused_label = match &state.paused {
            Some(s) => label_of(&s.activity_id)?.map(|(name, _)| name),
            None => None,
        };
        (state, activities, running_label, paused_label)
    };
    let strings = app.state::<TrayState>().strings.lock().unwrap().clone();
    let running_id = state.running.as_ref().map(|s| s.activity_id.as_str());
    let menu = Menu::new(app)?;

    // A running activity that is archived or unknown (no foreign keys) still needs a way to stop it.
    if let (Some(id), Some(found)) = (running_id, &running_label) {
        if !activities.iter().any(|a| a.id == id) {
            let (name, color) = found.clone().unwrap_or((strings.unknown_activity.clone(), ActivityColor::Gray));
            menu.append(&IconMenuItem::with_id(app, ID_STOP, name, true, Some(dot_icon(color, true)), None::<&str>)?)?;
        }
    }

    if activities.is_empty() && running_id.is_none() {
        menu.append(&MenuItem::new(app, &strings.no_activities, false, None::<&str>)?)?;
    }
    let is_root = |a: &Activity| a.parent_id.as_deref().map_or(true, |p| !activities.iter().any(|x| x.id == p));
    let item = |a: &Activity| -> Result<IconMenuItem<Wry>> {
        let running = Some(a.id.as_str()) == running_id;
        let id = format!("{START_PREFIX}{}", a.id);
        Ok(IconMenuItem::with_id(app, id, &a.name, true, Some(dot_icon(a.color, running)), None::<&str>)?)
    };
    for root in activities.iter().filter(|a| is_root(a)) {
        let children: Vec<&Activity> = activities.iter().filter(|a| a.parent_id.as_deref() == Some(&root.id)).collect();
        if children.is_empty() {
            menu.append(&item(root)?)?;
            continue;
        }
        let group_running = running_id == Some(&root.id) || children.iter().any(|c| running_id == Some(&c.id));
        let sub = Submenu::new_with_icon(app, &root.name, true, Some(dot_icon(root.color, group_running)))?;
        sub.append(&item(root)?)?;
        sub.append(&PredefinedMenuItem::separator(app)?)?;
        for child in children {
            sub.append(&item(child)?)?;
        }
        menu.append(&sub)?;
    }

    if state.running.is_some() {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        menu.append(&MenuItem::with_id(app, ID_PAUSE, &strings.pause, true, None::<&str>)?)?;
        menu.append(&MenuItem::with_id(app, ID_STOP, &strings.stop, true, None::<&str>)?)?;
    } else if state.paused.is_some() {
        let name = paused_label.unwrap_or_else(|| strings.unknown_activity.clone());
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        menu.append(&MenuItem::with_id(app, ID_RESUME, strings.resume.replace("{name}", &name), true, None::<&str>)?)?;
        menu.append(&MenuItem::with_id(app, ID_STOP, &strings.stop, true, None::<&str>)?)?;
    }

    let day_action = app.state::<TrayState>().day_action.lock().unwrap().clone();
    if let Some(action) = day_action {
        let (id, label) = match action.kind {
            DayActionKind::Wake => (ID_WAKE, &strings.wake),
            DayActionKind::Sleep => (ID_SLEEP, &strings.sleep),
        };
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        menu.append(&MenuItem::with_id(app, id, label, true, None::<&str>)?)?;
    }

    if for_tray {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        menu.append(&MenuItem::with_id(app, ID_OPEN, &strings.open, true, None::<&str>)?)?;
        menu.append(&MenuItem::with_id(app, ID_QUIT, &strings.quit, true, None::<&str>)?)?;
    }
    Ok(menu)
}

/// App-wide menu event handler; covers the tray menu and the in-window popup.
pub fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        ID_OPEN => return show_main_window(app),
        ID_QUIT => return app.exit(0),
        _ => {}
    }
    let result = {
        let db = app.state::<Db>();
        let mut conn = db.conn();
        let (device, now) = (db.device_id(), now_ms());
        match id {
            ID_PAUSE => session::pause(&mut conn, device, now).map(drop),
            ID_RESUME => session::resume(&mut conn, device, now).map(drop),
            ID_STOP => session::stop(&mut conn, device, now).map(drop),
            ID_WAKE | ID_SLEEP => {
                let action = app.state::<TrayState>().day_action.lock().unwrap().clone();
                match action {
                    Some(a) if id == ID_WAKE => day::wake_now(&conn, device, now, &a.date, a.utc_offset_min).map(drop),
                    Some(a) => day::sleep_now(&mut conn, device, now, &a.date, a.utc_offset_min).map(drop),
                    None => return,
                }
            }
            _ => match id.strip_prefix(START_PREFIX) {
                // Clicking the running activity again stops it.
                Some(activity_id) => match session::current(&conn) {
                    Ok(s) if s.running.as_ref().is_some_and(|r| r.activity_id == activity_id) => {
                        session::stop(&mut conn, device, now).map(drop)
                    }
                    _ => session::start(&mut conn, device, now, activity_id).map(drop),
                },
                None => return,
            },
        }
    };
    match result {
        Ok(()) => events::data_changed(app),
        Err(e) => eprintln!("menu action {id:?} failed: {e}"),
    }
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

// --- Icons, drawn in code so no image assets or decoders are needed. ---

const ICON_PX: u32 = 36; // shown at 18pt on Retina

/// Draws `ICON_PX`² RGBA pixels; `coverage(x, y)` returns 0.0–1.0 alpha for a pixel center.
fn draw(rgb: [u8; 3], coverage: impl Fn(f64, f64) -> f64) -> Image<'static> {
    let mut rgba = Vec::with_capacity((ICON_PX * ICON_PX * 4) as usize);
    for y in 0..ICON_PX {
        for x in 0..ICON_PX {
            let a = coverage(x as f64 + 0.5, y as f64 + 0.5).clamp(0.0, 1.0);
            rgba.extend_from_slice(&[rgb[0], rgb[1], rgb[2], (a * 255.0).round() as u8]);
        }
    }
    Image::new_owned(rgba, ICON_PX, ICON_PX)
}

/// Antialiased edge: 1 inside, 0 outside, linear across one pixel.
fn edge(signed_distance: f64) -> f64 {
    0.5 - signed_distance
}

/// Activity color dot; the running activity gets a stop square punched out of it.
fn dot_icon(color: ActivityColor, running: bool) -> Image<'static> {
    let c = ICON_PX as f64 / 2.0;
    draw(color.rgb(), move |x, y| {
        let (dx, dy) = (x - c, y - c);
        let circle = edge((dx * dx + dy * dy).sqrt() - 10.0);
        if !running {
            return circle;
        }
        let square = edge(dx.abs().max(dy.abs()) - 3.5);
        circle * (1.0 - square.clamp(0.0, 1.0))
    })
}

/// Template ring for the menu bar.
fn tray_icon() -> Image<'static> {
    let c = ICON_PX as f64 / 2.0;
    draw([0, 0, 0], move |x, y| {
        let (dx, dy) = (x - c, y - c);
        let r = (dx * dx + dy * dy).sqrt();
        edge((r - 12.5).abs() - 2.5)
    })
}

#[cfg(test)]
mod tests {
    use super::format_elapsed;

    #[test]
    fn formats_elapsed_as_hours_minutes() {
        assert_eq!(format_elapsed(0), "0:00");
        assert_eq!(format_elapsed(59_999), "0:00");
        assert_eq!(format_elapsed(61 * 60_000), "1:01");
        assert_eq!(format_elapsed(-5), "0:00");
    }
}
