//! Wallpaper-layer overlay window (rebuild-plan 5): transparent, click-through,
//! below the desktop icons on macOS. Content lives in `overlay.html`.

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, LogicalPosition, Manager, Monitor, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_specta::Event;

use crate::db::{setting, Db};
use crate::error::Result;

pub const LABEL: &str = "overlay";
const WIDTH: f64 = 320.0;
/// Tall enough for all three cards; the content is vertically centered inside.
const HEIGHT: f64 = 600.0;
const MARGIN_RIGHT: f64 = 48.0;

pub const KEY_ENABLED: &str = "overlay.enabled";
const KEY_X: &str = "overlay.x";
const KEY_Y: &str = "overlay.y";

/// The overlay entered or left position-editing mode.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct OverlayEditing(pub bool);

/// A card's frame inside the overlay window, in logical px from the top-left.
#[derive(Debug, Clone, Copy, Deserialize, Type)]
pub struct CardFrame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub fn init(app: &AppHandle) -> Result<()> {
    let db = app.state::<Db>();
    let enabled = setting::get(&db.conn(), KEY_ENABLED)?;
    if enabled.as_deref() != Some("0") {
        show(app)?;
    }
    Ok(())
}

pub fn show(app: &AppHandle) -> Result<()> {
    let db = app.state::<Db>();
    setting::set(&db.conn(), KEY_ENABLED, "1")?;
    if let Some(w) = app.get_webview_window(LABEL) {
        w.show()?;
        return Ok(());
    }
    let w = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("overlay.html".into()))
        .title("Hope Overlay")
        .inner_size(WIDTH, HEIGHT)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_bottom(true)
        .skip_taskbar(true)
        .focusable(false)
        .visible_on_all_workspaces(true)
        .visible(false)
        .build()?;
    let pos = saved_position(app, &w).unwrap_or_else(|| default_position(&w));
    w.set_position(pos)?;
    w.set_ignore_cursor_events(true)?;
    platform::sink_to_desktop(&w)?;
    w.show()?;
    Ok(())
}

pub fn hide(app: &AppHandle) -> Result<()> {
    let db = app.state::<Db>();
    setting::set(&db.conn(), KEY_ENABLED, "0")?;
    if let Some(w) = app.get_webview_window(LABEL) {
        w.hide()?;
    }
    Ok(())
}

/// Editing lifts the overlay to a normal level and makes it draggable; finishing saves the position.
pub fn set_editing(app: &AppHandle, editing: bool) -> Result<()> {
    let Some(w) = app.get_webview_window(LABEL) else { return Ok(()) };
    w.set_ignore_cursor_events(!editing)?;
    if editing {
        platform::raise_for_editing(&w)?;
    } else {
        let pos = w.outer_position()?.to_logical::<f64>(w.scale_factor()?);
        let db = app.state::<Db>();
        let conn = db.conn();
        setting::set(&conn, KEY_X, &pos.x.to_string())?;
        setting::set(&conn, KEY_Y, &pos.y.to_string())?;
        drop(conn);
        platform::sink_to_desktop(&w)?;
    }
    let _ = OverlayEditing(editing).emit(app);
    Ok(())
}

pub fn reset_position(app: &AppHandle) -> Result<()> {
    {
        let db = app.state::<Db>();
        let conn = db.conn();
        setting::remove(&conn, KEY_X)?;
        setting::remove(&conn, KEY_Y)?;
    }
    if let Some(w) = app.get_webview_window(LABEL) {
        w.set_position(default_position(&w))?;
    }
    Ok(())
}

/// The blurred backdrops stay fully opaque: fading them lets the sharp wallpaper back through
/// and the cards stop reading as glass. The page applies the opacity setting to fills and text.
pub fn set_layout(app: &AppHandle, cards: Vec<CardFrame>) -> Result<()> {
    if let Some(w) = app.get_webview_window(LABEL) {
        platform::set_card_backdrops(&w, cards)?;
    }
    Ok(())
}

/// Docked to the right edge of the primary screen, vertically centered.
fn default_position(w: &WebviewWindow) -> LogicalPosition<f64> {
    let monitor = w.primary_monitor().ok().flatten().or_else(|| w.current_monitor().ok().flatten());
    let Some(m) = monitor else { return LogicalPosition::new(0.0, 0.0) };
    let (origin, size) = logical_bounds(&m);
    LogicalPosition::new(
        origin.0 + size.0 - WIDTH - MARGIN_RIGHT,
        origin.1 + ((size.1 - HEIGHT) / 2.0).max(0.0),
    )
}

/// The saved position, if its center still lies on a connected screen.
fn saved_position(app: &AppHandle, w: &WebviewWindow) -> Option<LogicalPosition<f64>> {
    let (x, y) = {
        let db = app.state::<Db>();
        let conn = db.conn();
        let x = setting::get(&conn, KEY_X).ok()??.parse::<f64>().ok()?;
        let y = setting::get(&conn, KEY_Y).ok()??.parse::<f64>().ok()?;
        (x, y)
    };
    let (cx, cy) = (x + WIDTH / 2.0, y + HEIGHT / 2.0);
    let on_screen = w.available_monitors().ok()?.iter().any(|m| {
        let (o, s) = logical_bounds(m);
        cx >= o.0 && cx <= o.0 + s.0 && cy >= o.1 && cy <= o.1 + s.1
    });
    on_screen.then(|| LogicalPosition::new(x, y))
}

fn logical_bounds(m: &Monitor) -> ((f64, f64), (f64, f64)) {
    let scale = m.scale_factor();
    let pos = m.position().to_logical::<f64>(scale);
    let size = m.size().to_logical::<f64>(scale);
    ((pos.x, pos.y), (size.width, size.height))
}

#[cfg(target_os = "macos")]
mod platform {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{msg_send, ClassType, MainThreadMarker};
    use objc2_app_kit::{
        NSAppearance, NSAppearanceCustomization, NSAppearanceNameVibrantDark, NSVisualEffectBlendingMode, NSVisualEffectMaterial,
        NSVisualEffectState, NSVisualEffectView, NSWindow, NSWindowCollectionBehavior, NSWindowOrderingMode,
    };
    use objc2_foundation::{NSObjectProtocol, NSPoint, NSRect, NSSize};
    use tauri::WebviewWindow;

    use super::CardFrame;
    use crate::error::Result;

    const CARD_RADIUS: f64 = 20.0; // --r-lg
    const KCG_DESKTOP_ICON_WINDOW_LEVEL_KEY: i32 = 18;
    const NS_FLOATING_WINDOW_LEVEL: isize = 3;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGWindowLevelForKey(key: i32) -> i32;
    }

    /// Runs `f` with the window's NSWindow on the main thread.
    fn with_ns_window(w: &WebviewWindow, f: impl FnOnce(&NSWindow, MainThreadMarker) + Send + 'static) -> Result<()> {
        let ptr = w.ns_window()? as usize;
        w.run_on_main_thread(move || {
            let Some(mtm) = MainThreadMarker::new() else { return };
            // SAFETY: Tauri keeps the NSWindow alive while the window exists; we are on the main thread.
            let ns_window = unsafe { &*(ptr as *const NSWindow) };
            f(ns_window, mtm);
        })?;
        Ok(())
    }

    /// Just under the desktop icons, above the wallpaper, on every Space, untouched by Mission Control.
    pub fn sink_to_desktop(w: &WebviewWindow) -> Result<()> {
        with_ns_window(w, |win, _| {
            let level = unsafe { CGWindowLevelForKey(KCG_DESKTOP_ICON_WINDOW_LEVEL_KEY) } - 1;
            win.setLevel(level as isize);
            win.setCollectionBehavior(
                NSWindowCollectionBehavior::CanJoinAllSpaces
                    | NSWindowCollectionBehavior::Stationary
                    | NSWindowCollectionBehavior::IgnoresCycle,
            );
        })
    }

    pub fn raise_for_editing(w: &WebviewWindow) -> Result<()> {
        with_ns_window(w, |win, _| win.setLevel(NS_FLOATING_WINDOW_LEVEL))
    }

    /// One blurred native backdrop per card: CSS `backdrop-filter` can't see the wallpaper
    /// through a transparent window.
    pub fn set_card_backdrops(w: &WebviewWindow, cards: Vec<CardFrame>) -> Result<()> {
        with_ns_window(w, move |win, mtm| {
            let Some(content) = win.contentView() else { return };
            for view in content.subviews().iter() {
                if view.isKindOfClass(NSVisualEffectView::class()) {
                    view.removeFromSuperview();
                }
            }
            let height = content.bounds().size.height;
            let appearance: Option<Retained<NSAppearance>> =
                NSAppearance::appearanceNamed(unsafe { NSAppearanceNameVibrantDark });
            for card in cards {
                // NSView coordinates start at the bottom-left.
                let frame = NSRect::new(
                    NSPoint::new(card.x, height - card.y - card.height),
                    NSSize::new(card.width, card.height),
                );
                let view = NSVisualEffectView::initWithFrame(mtm.alloc(), frame);
                view.setMaterial(NSVisualEffectMaterial::HUDWindow);
                view.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
                view.setState(NSVisualEffectState::Active);
                view.setAppearance(appearance.as_deref());
                view.setWantsLayer(true);
                unsafe {
                    let layer: *mut AnyObject = msg_send![&*view, layer];
                    if !layer.is_null() {
                        let _: () = msg_send![layer, setCornerRadius: CARD_RADIUS];
                        let _: () = msg_send![layer, setMasksToBounds: true];
                    }
                }
                content.addSubview_positioned_relativeTo(&view, NSWindowOrderingMode::Below, None);
            }
        })
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    //! Windows relies on `always_on_bottom`; cards use their CSS fill without a blurred backdrop.
    use tauri::WebviewWindow;

    use super::CardFrame;
    use crate::error::Result;

    pub fn sink_to_desktop(_w: &WebviewWindow) -> Result<()> {
        Ok(())
    }

    pub fn raise_for_editing(_w: &WebviewWindow) -> Result<()> {
        Ok(())
    }

    pub fn set_card_backdrops(_w: &WebviewWindow, _cards: Vec<CardFrame>) -> Result<()> {
        Ok(())
    }
}
