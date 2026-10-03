//! Bakes the Supabase project (rebuild-plan 12.4) into the binary.
//!
//! Sources, first non-empty wins: the environment (`SUPABASE_URL`, `SUPABASE_ANON_KEY`; CI secrets),
//! then the repository's root `.env`. Neither present = a local-only build; nothing fails.

use std::path::Path;

const KEYS: [&str; 2] = ["SUPABASE_URL", "SUPABASE_ANON_KEY"];

fn read_dotenv(path: &Path) -> Vec<(String, String)> {
    let Ok(text) = std::fs::read_to_string(path) else { return Vec::new() };
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter_map(|l| l.strip_prefix("export ").unwrap_or(l).split_once('='))
        .map(|(k, v)| (k.trim().to_owned(), v.trim().trim_matches(|c| c == '"' || c == '\'').to_owned()))
        .collect()
}

fn main() {
    let dotenv_path = Path::new("../.env");
    // Watching a missing file would make Cargo rebuild the app on every build, so only watch it once it
    // exists. After creating `.env` for the first time, `touch src-tauri/build.rs` (see supabase/README.md).
    if dotenv_path.exists() {
        println!("cargo:rerun-if-changed=../.env");
    }
    println!("cargo:rerun-if-changed=build.rs");
    let dotenv = read_dotenv(dotenv_path);
    for key in KEYS {
        println!("cargo:rerun-if-env-changed={key}");
        let value = std::env::var(key)
            .ok()
            .filter(|v| !v.trim().is_empty())
            .or_else(|| dotenv.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone()))
            .unwrap_or_default();
        println!("cargo:rustc-env=HOPE_{key}={value}");
    }
    tauri_build::build()
}
