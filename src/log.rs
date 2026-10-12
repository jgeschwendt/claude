//! Append-only run logs under `~/.claude/logs/`, one file per binary.

use std::fs;
use std::io::{Read, Seek, Write};
use std::path::PathBuf;

/// `~/.claude/logs/<name>.log`, creating the directory on first use.
pub fn path(name: &str) -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"));
    let dir = home.join(".claude").join("logs");
    let _ = fs::create_dir_all(&dir);
    dir.join(format!("{name}.log"))
}

/// Append `[<ISO-8601 UTC>] <line>`; when `keep` is set, retain only the last `keep` lines. The
/// rewrite holds an exclusive lock on the log, so concurrent hooks neither drop lines nor read a
/// half-truncated file; a lock not had within a second drops the line rather than stall the hook.
pub fn append(name: &str, line: &str, keep: Option<usize>) {
    let stamp = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let entry = format!("[{stamp}] {line}");
    let _ = (|| -> std::io::Result<()> {
        let mut file = fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).open(path(name))?;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(1);
        while file.try_lock().is_err() {
            if std::time::Instant::now() > deadline {
                return Ok(());
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let mut prev = Vec::new();
        file.read_to_end(&mut prev)?;
        let prev = String::from_utf8_lossy(&prev);
        let mut lines: Vec<&str> = prev.lines().filter(|l| !l.is_empty()).collect();
        lines.push(&entry);
        let start = lines.len().saturating_sub(keep.unwrap_or(usize::MAX));
        file.set_len(0)?;
        file.rewind()?;
        file.write_all((lines[start..].join("\n") + "\n").as_bytes())
    })();
}
