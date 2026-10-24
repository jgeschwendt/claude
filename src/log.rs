//! Run logs under `~/.claude/logs/`, one file per binary.

use std::fs;
use std::path::PathBuf;

/// `~/.claude/logs/<name>.log`, creating the directory on first use; an unset or empty `HOME` is `/`.
pub fn path(name: &str) -> PathBuf {
    let home = std::env::var_os("HOME").filter(|h| !h.is_empty()).map(PathBuf::from).unwrap_or("/".into());
    let dir = home.join(".claude").join("logs");
    let _ = fs::create_dir_all(&dir);
    dir.join(format!("{name}.log"))
}
