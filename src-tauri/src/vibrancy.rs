//! Two native materials behind the transparent webview (rebuild-plan 4.4):
//! `sidebar` under the navigation column, `under-window` under the content.
//! Tauri's `windowEffects` only supports one material per window, hence this.

use tauri::WebviewWindow;

/// Must match the sidebar column width in `src/app/App.css`.
pub const SIDEBAR_WIDTH: f64 = 200.0;

#[cfg(target_os = "macos")]
pub fn install(window: &WebviewWindow) -> tauri::Result<()> {
    let ns_window = window.ns_window()? as usize;
    window.run_on_main_thread(move || {
        use objc2::MainThreadMarker;
        use objc2_app_kit::{
            NSAutoresizingMaskOptions, NSVisualEffectBlendingMode, NSVisualEffectMaterial,
            NSVisualEffectState, NSVisualEffectView, NSWindow, NSWindowOrderingMode,
        };
        use objc2_foundation::{NSPoint, NSRect, NSSize};

        let Some(mtm) = MainThreadMarker::new() else { return };
        // SAFETY: Tauri hands out a valid NSWindow pointer for the window's lifetime,
        // and we are on the main thread.
        let ns_window: &NSWindow = unsafe { &*(ns_window as *const NSWindow) };
        let Some(content) = ns_window.contentView() else { return };
        let bounds = content.bounds();
        let sidebar_w = SIDEBAR_WIDTH.min(bounds.size.width);

        let add = |frame: NSRect, material: NSVisualEffectMaterial, mask: NSAutoresizingMaskOptions| {
            let view = NSVisualEffectView::initWithFrame(mtm.alloc(), frame);
            view.setMaterial(material);
            view.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
            // Stay translucent when the window loses focus instead of turning flat gray.
            view.setState(NSVisualEffectState::Active);
            view.setAutoresizingMask(mask);
            // Bottom of the stack, behind the webview.
            content.addSubview_positioned_relativeTo(&view, NSWindowOrderingMode::Below, None);
        };

        add(
            NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(sidebar_w, bounds.size.height)),
            NSVisualEffectMaterial::Sidebar,
            NSAutoresizingMaskOptions::ViewHeightSizable | NSAutoresizingMaskOptions::ViewMaxXMargin,
        );
        add(
            NSRect::new(
                NSPoint::new(sidebar_w, 0.0),
                NSSize::new(bounds.size.width - sidebar_w, bounds.size.height),
            ),
            NSVisualEffectMaterial::UnderWindowBackground,
            NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
    })
}

/// Windows gets Mica from `tauri.windows.conf.json`; other platforms stay opaque.
#[cfg(not(target_os = "macos"))]
pub fn install(_window: &WebviewWindow) -> tauri::Result<()> {
    Ok(())
}
