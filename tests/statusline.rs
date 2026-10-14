//! End-to-end checks on the `statusline` binary: the CLI must always get a line and a zero exit,
//! whatever the payload.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Run the binary with `HOME`/`TMPDIR` pointed at `dir`, so the sample store, the debug log and the
/// window clock (via the `HOME` fallback) land there and no real settings feed the threshold.
/// Returns `(exit code, stdout)`.
fn run(dir: &Path, payload: impl AsRef<[u8]>) -> (i32, String) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_statusline"))
        .env("HOME", dir)
        .env("TMPDIR", dir)
        .env_remove("CLAUDE_CODE_AUTO_COMPACT_WINDOW")
        .env_remove("CLAUDE_CODE_ENTRYPOINT")
        .env_remove("CLAUDE_CODE_MAX_OUTPUT_TOKENS")
        .env_remove("CLAUDE_WINDOW_FILE")
        .env_remove("DISABLE_AUTO_COMPACT")
        .env_remove("DISABLE_COMPACT")
        .env_remove("XDG_STATE_HOME")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(payload.as_ref()).unwrap();
    let out = child.wait_with_output().unwrap();
    (out.status.code().unwrap(), String::from_utf8(out.stdout).unwrap())
}

/// A per-test scratch dir under cargo's target tmpdir, emptied first so reruns start clean.
fn scratch(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn logs_the_error_and_prints_a_blank_line_for_malformed_stdin() {
    let dir = scratch("malformed");

    for (payload, error) in [(&b"not json"[..], "SyntaxError"), (b"\xff", "valid UTF-8")] {
        assert_eq!(run(&dir, payload), (0, "\n".into()));
        let log = std::fs::read_to_string(dir.join(".claude/logs/statusline.log")).unwrap();
        assert!(log.contains(error), "{log}");
    }
}

#[test]
fn renders_a_line_and_persists_the_window_clock() {
    let dir = scratch("window");
    let resets_at = chrono::Utc::now().timestamp() + 3600;
    let payload = serde_json::json!({
        "context_window": { "context_window_size": 200000, "total_input_tokens": 50000 },
        "model": { "display_name": "Fable 5.1", "id": "claude-fable-5-1" },
        "rate_limits": { "five_hour": { "resets_at": resets_at, "used_percentage": 31.4 } },
        "session_id": "it-2"
    })
    .to_string();
    let file = dir.join(".local/state/claude/window.json");

    // A directory in the file's place fails the rename: the tick still exits 0, logs the warning
    // and leaves no temp file behind.
    std::fs::create_dir_all(&file).unwrap();
    assert_eq!(run(&dir, &payload).0, 0);
    let log = std::fs::read_to_string(dir.join(".claude/logs/statusline.log")).unwrap();
    assert!(log.contains("window: "), "{log}");
    assert_eq!(std::fs::read_dir(file.parent().unwrap()).unwrap().count(), 1, "temp file left behind");
    std::fs::remove_dir(&file).unwrap();

    let (code, out) = run(&dir, &payload);
    assert_eq!(code, 0);
    assert_eq!(out.lines().count(), 1, "{out:?}");
    assert!(out.contains("Fable 5.1") && out.contains("30%"), "{out:?}");
    // The samples file and the payload log both landed in the scratch dir.
    assert!(dir.join("claude-statusline-it-2.json").is_file());
    let log = std::fs::read_to_string(dir.join(".claude/logs/statusline.log")).unwrap();
    assert!(log.contains("\"total_input_tokens\": 50000"), "{log}");
    let window: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    assert_eq!(window["five_hour"], serde_json::json!({ "resets_at": resets_at, "used_percentage": 31.4 }));
    assert_eq!(window["session_id"], "it-2");
    assert!(chrono::DateTime::parse_from_rfc3339(window["at"].as_str().unwrap()).is_ok(), "{window}");
}
