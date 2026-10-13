//! Wallpaper-layer overlay window (rebuild-plan 5): transparent, click-through,
//! below the desktop icons on macOS. Content lives in `overlay.html`.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Monitor, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_specta::Event;

use crate::db::{setting, Db};
use crate::error::Result;
use crate::events::SettingChanged;

pub const LABEL: &str = "overlay";
const WIDTH: f64 = 320.0;
/// Tall enough for all three cards; the content is vertically centered inside.
const HEIGHT: f64 = 600.0;
const MARGIN_RIGHT: f64 = 48.0;

pub const KEY_ENABLED: &str = "overlay.enabled";
const KEY_X: &str = "overlay.x";
const KEY_Y: &str = "overlay.y";
/// "Size" in Settings: a factor on the 320px design width (1 = as designed).
const KEY_SCALE: &str = "overlay.scale";
const SCALE_MIN: f64 = 1.0;
const SCALE_MAX: f64 = 2.0;

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
    /// Corner radius as drawn (the page has applied its scale). Windows rounds with DWM instead.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub radius: f64,
}

/// The frames the page last reported, so the backdrops can be re-placed when the window moves
/// or is shown again.
pub struct OverlayLayout(Mutex<Vec<CardFrame>>);

fn layout(app: &AppHandle) -> Vec<CardFrame> {
    app.state::<OverlayLayout>().0.lock().unwrap().clone()
}

pub fn init(app: &AppHandle) -> Result<()> {
    app.manage(OverlayLayout(Mutex::new(Vec::new())));
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
        platform::set_card_backdrops(&w, layout(app))?;
        return Ok(());
    }
    let s = scale(app);
    let w = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("overlay.html".into()))
        .title("Hope Overlay")
        .inner_size(WIDTH * s, HEIGHT * s)
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
    let pos = saved_position(app, &w).unwrap_or_else(|| default_position(app, &w));
    w.set_position(pos)?;
    w.set_ignore_cursor_events(true)?;
    platform::sink_to_desktop(&w)?;
    w.show()?;
    Ok(())
}

/// The "size" setting, clamped; 1 when unset or unparsable.
pub fn scale(app: &AppHandle) -> f64 {
    let db = app.state::<Db>();
    let value = setting::get(&db.conn(), KEY_SCALE).ok().flatten();
    match value.and_then(|v| v.parse::<f64>().ok()) {
        Some(s) if s.is_finite() => s.clamp(SCALE_MIN, SCALE_MAX),
        _ => 1.0,
    }
}

/// Saves the size and resizes the window; a default-docked overlay is re-docked for the new width.
pub fn set_scale(app: &AppHandle, scale: f64) -> Result<()> {
    let scale = if scale.is_finite() { scale.clamp(SCALE_MIN, SCALE_MAX) } else { 1.0 };
    {
        let db = app.state::<Db>();
        setting::set(&db.conn(), KEY_SCALE, &scale.to_string())?;
    }
    let _ = SettingChanged { key: KEY_SCALE.into() }.emit(app);
    if let Some(w) = app.get_webview_window(LABEL) {
        w.set_size(LogicalSize::new(WIDTH * scale, HEIGHT * scale))?;
        if saved_position(app, &w).is_none() {
            w.set_position(default_position(app, &w))?;
        }
    }
    Ok(())
}

/// The overlay window moved (dragging while editing): the backdrops follow.
pub fn on_moved(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = platform::follow_window(&w, layout(app));
    }
}

pub fn hide(app: &AppHandle) -> Result<()> {
    let db = app.state::<Db>();
    setting::set(&db.conn(), KEY_ENABLED, "0")?;
    if let Some(w) = app.get_webview_window(LABEL) {
        w.hide()?;
        platform::hide_backdrops(&w)?;
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
        w.set_position(default_position(app, &w))?;
    }
    Ok(())
}

/// The blurred backdrops stay fully opaque: fading them lets the sharp wallpaper back through
/// and the cards stop reading as glass. The page applies the opacity setting to fills and text.
pub fn set_layout(app: &AppHandle, cards: Vec<CardFrame>) -> Result<()> {
    *app.state::<OverlayLayout>().0.lock().unwrap() = cards.clone();
    if let Some(w) = app.get_webview_window(LABEL) {
        platform::set_card_backdrops(&w, cards)?;
    }
    Ok(())
}

/// Docked to the right edge of the primary screen, vertically centered.
fn default_position(app: &AppHandle, w: &WebviewWindow) -> LogicalPosition<f64> {
    let monitor = w.primary_monitor().ok().flatten().or_else(|| w.current_monitor().ok().flatten());
    let Some(m) = monitor else { return LogicalPosition::new(0.0, 0.0) };
    let (origin, size) = logical_bounds(&m);
    let s = scale(app);
    LogicalPosition::new(
        origin.0 + size.0 - WIDTH * s - MARGIN_RIGHT,
        origin.1 + ((size.1 - HEIGHT * s) / 2.0).max(0.0),
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
    let s = scale(app);
    let (cx, cy) = (x + WIDTH * s / 2.0, y + HEIGHT * s / 2.0);
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
                        let _: () = msg_send![layer, setCornerRadius: card.radius];
                        let _: () = msg_send![layer, setMasksToBounds: true];
                    }
                }
                content.addSubview_positioned_relativeTo(&view, NSWindowOrderingMode::Below, None);
            }
        })
    }

    /// Subviews move with the window; nothing to do.
    pub fn follow_window(_w: &WebviewWindow, _cards: Vec<CardFrame>) -> Result<()> {
        Ok(())
    }

    /// Subviews hide with the window; nothing to do.
    pub fn hide_backdrops(_w: &WebviewWindow) -> Result<()> {
        Ok(())
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    //! Windows: the overlay relies on `always_on_bottom` for its level. The blur is one small
    //! acrylic window per card (no webview), placed under the overlay window at the card's frame and
    //! re-placed whenever the cards or the window move. CSS `backdrop-filter` cannot see the
    //! wallpaper through a transparent window, and one acrylic slab under the whole overlay would
    //! also frost the gaps between the cards.
    //!
    //! The material is the Windows 10 accent-policy acrylic (`SetWindowCompositionAttribute`), not
    //! Tauri's `Effect::Acrylic`: on Windows 11 that one is the DWM system backdrop, which falls back
    //! to a solid fill on inactive windows, and these never activate.
    use tauri::window::{Window, WindowBuilder};
    use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewWindow, Wry};

    use super::CardFrame;
    use crate::error::Result;

    const LABEL_PREFIX: &str = "overlay-backdrop-";
    /// DWM rounds the backdrop at a fixed 8px (`--r-sm`); Overlay.css uses the same radius on Windows.
    const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
    const DWMWCP_ROUND: u32 = 2;
    const WCA_ACCENT_POLICY: u32 = 19;
    const ACCENT_ENABLE_ACRYLICBLURBEHIND: u32 = 4;
    /// Tint over the blur as 0xAABBGGRR: black at ~18%, enough for white text on light wallpapers
    /// without hiding them (the macOS HUD look). Zero alpha would switch the effect off.
    const TINT_ABGR: u32 = 0x2E00_0000;

    #[repr(C)]
    struct AccentPolicy {
        state: u32,
        flags: u32,
        gradient_color: u32,
        animation_id: u32,
    }

    #[repr(C)]
    struct WindowCompositionAttribData {
        attribute: u32,
        data: *mut core::ffi::c_void,
        size: usize,
    }

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(hwnd: isize, attribute: u32, value: *const core::ffi::c_void, size: u32) -> i32;
    }

    // Undocumented and not in user32.lib, so it is looked up at run time.
    type SetWindowCompositionAttribute = unsafe extern "system" fn(isize, *mut WindowCompositionAttribData) -> i32;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetModuleHandleW(name: *const u16) -> isize;
        fn GetProcAddress(module: isize, name: *const u8) -> Option<unsafe extern "system" fn()>;
    }

    fn set_window_composition_attribute() -> Option<SetWindowCompositionAttribute> {
        let user32: Vec<u16> = "user32.dll\0".encode_utf16().collect();
        // SAFETY: NUL-terminated names; user32 is always loaded in a GUI process. The transmute
        // gives the function its documented-by-use signature.
        unsafe {
            let module = GetModuleHandleW(user32.as_ptr());
            if module == 0 {
                return None;
            }
            let f = GetProcAddress(module, b"SetWindowCompositionAttribute\0".as_ptr())?;
            Some(std::mem::transmute::<unsafe extern "system" fn(), SetWindowCompositionAttribute>(f))
        }
    }

    pub fn sink_to_desktop(_w: &WebviewWindow) -> Result<()> {
        Ok(())
    }

    pub fn raise_for_editing(_w: &WebviewWindow) -> Result<()> {
        Ok(())
    }

    fn label(i: usize) -> String {
        format!("{LABEL_PREFIX}{i}")
    }

    fn backdrop(app: &AppHandle, i: usize) -> Result<Window<Wry>> {
        if let Some(w) = app.get_window(&label(i)) {
            return Ok(w);
        }
        let w = WindowBuilder::new(app, label(i))
            .title("Hope Overlay")
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .always_on_bottom(true)
            .skip_taskbar(true)
            .focusable(false)
            .visible(false)
            .build()?;
        w.set_ignore_cursor_events(true)?;
        let hwnd = w.hwnd()?.0 as isize;
        let mut policy = AccentPolicy { state: ACCENT_ENABLE_ACRYLICBLURBEHIND, flags: 0, gradient_color: TINT_ABGR, animation_id: 0 };
        let mut data = WindowCompositionAttribData {
            attribute: WCA_ACCENT_POLICY,
            data: &mut policy as *mut AccentPolicy as *mut _,
            size: std::mem::size_of::<AccentPolicy>(),
        };
        // SAFETY: a valid HWND and correctly sized, properly aligned arguments that outlive the calls.
        // A failure only leaves a plain transparent window or square corners.
        unsafe {
            if let Some(f) = set_window_composition_attribute() {
                f(hwnd, &mut data);
            }
            DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, &DWMWCP_ROUND as *const u32 as *const _, 4);
        }
        Ok(w)
    }

    /// Places one Acrylic window under each card (screen coordinates = overlay origin + frame) and
    /// hides the ones no card uses any more.
    pub fn set_card_backdrops(w: &WebviewWindow, cards: Vec<CardFrame>) -> Result<()> {
        let app = w.app_handle();
        let origin = w.outer_position()?.to_logical::<f64>(w.scale_factor()?);
        let visible = w.is_visible()?;
        for (i, card) in cards.iter().enumerate() {
            let b = backdrop(app, i)?;
            b.set_position(LogicalPosition::new(origin.x + card.x, origin.y + card.y))?;
            b.set_size(LogicalSize::new(card.width, card.height))?;
            if visible {
                b.show()?;
            }
            // Pushed to the very bottom again, so the overlay window stays above its backdrops.
            b.set_always_on_bottom(true)?;
        }
        let mut i = cards.len();
        while let Some(extra) = app.get_window(&label(i)) {
            extra.hide()?;
            i += 1;
        }
        Ok(())
    }

    pub fn follow_window(w: &WebviewWindow, cards: Vec<CardFrame>) -> Result<()> {
        set_card_backdrops(w, cards)
    }

    pub fn hide_backdrops(w: &WebviewWindow) -> Result<()> {
        let app = w.app_handle();
        let mut i = 0;
        while let Some(b) = app.get_window(&label(i)) {
            b.hide()?;
            i += 1;
        }
        Ok(())
    }
}
