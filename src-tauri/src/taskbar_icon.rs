//! Windows taskbar / Alt-Tab icon for the main window.
//!
//! Tauri only sets the window's *small* icon (title bar); the taskbar and Alt-Tab use the *big*
//! one and, with none set, fall back to Explorer's extraction from the exe, which left Hope with a
//! blank button. Setting the big icon from the exe's own embedded icon group fixes that directly.

use tauri::WebviewWindow;

#[cfg(windows)]
pub fn install(window: &WebviewWindow) -> tauri::Result<()> {
    const WM_SETICON: u32 = 0x0080;
    const ICON_BIG: usize = 1;
    const GCLP_HICON: i32 = -14;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetModuleHandleW(name: *const u16) -> isize;
        fn GetModuleFileNameW(module: isize, out: *mut u16, len: u32) -> u32;
    }
    #[link(name = "shell32")]
    extern "system" {
        fn ExtractIconW(instance: isize, path: *const u16, index: u32) -> isize;
    }
    #[link(name = "user32")]
    extern "system" {
        fn SendMessageW(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> isize;
        fn SetClassLongPtrW(hwnd: isize, index: i32, value: isize) -> usize;
    }

    let hwnd = window.hwnd()?.0 as isize;
    // SAFETY: plain Win32 calls with valid handles and a NUL-terminated buffer; every failure leaves
    // the window as it was (no icon handle is ever dereferenced here).
    unsafe {
        let instance = GetModuleHandleW(std::ptr::null());
        let mut path = [0u16; 32768];
        let len = GetModuleFileNameW(instance, path.as_mut_ptr(), path.len() as u32) as usize;
        if len == 0 || len >= path.len() - 1 {
            return Ok(());
        }
        // The first icon group in the exe is the app icon tauri-build embeds.
        let icon = ExtractIconW(instance, path.as_ptr(), 0);
        if icon <= 1 {
            return Ok(());
        }
        SendMessageW(hwnd, WM_SETICON, ICON_BIG, icon);
        SetClassLongPtrW(hwnd, GCLP_HICON, icon);
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn install(_window: &WebviewWindow) -> tauri::Result<()> {
    Ok(())
}
