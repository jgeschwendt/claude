//! End-to-end checks on the `statusline` binary: the CLI must always get a line and a zero exit,
//! whatever the payload.

use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};

/// Run the binary with `HOME`/`TMPDIR` pointed at a fresh scratch dir, so the sample store and the
/// debug log land there and no real settings feed the threshold. Returns `(exit code, stdout)`.
fn run(dir: &std::path::Path, payload: &str) -> (i32, String) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_statusline"))
        .env("HOME", dir)
        .env("TMPDIR", dir)
        .env("CLAUDE_WINDOW_FILE", dir.join("state/window.json"))
        .env_remove("CLAUDE_CODE_AUTO_COMPACT_WINDOW")
        .env_remove("CLAUDE_CODE_ENTRYPOINT")
        .env_remove("CLAUDE_CODE_MAX_OUTPUT_TOKENS")
        .env_remove("DISABLE_AUTO_COMPACT")
        .env_remove("DISABLE_COMPACT")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(payload.as_bytes()).unwrap();
    let out = child.wait_with_output().unwrap();
    (out.status.code().unwrap(), String::from_utf8(out.stdout).unwrap())
}

/// A fresh scratch dir, removed by the OS rather than the suite.
fn scratch() -> std::path::PathBuf {
    static COUNTER: AtomicUsize = AtomicUsize::new(0);
    let dir = std::env::temp_dir().join(format!(
        "claude-statusline-it-{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn logs_the_error_and_prints_a_blank_line_for_malformed_stdin() {
    let dir = scratch();

    let (code, out) = run(&dir, "not json");

    assert_eq!(code, 0);
    assert_eq!(out, "\n");
    let log = std::fs::read_to_string(dir.join(".claude/logs/statusline.log")).unwrap();
    assert!(log.contains("SyntaxError"), "{log}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn renders_one_line_and_exits_zero() {
    let dir = scratch();
    let payload = r#"{
        "context_window": { "context_window_size": 200000, "total_input_tokens": 50000 },
        "model": { "display_name": "Fable 5.1", "id": "claude-fable-5-1" },
        "session_id": "it-1"
    }"#;

    let (code, out) = run(&dir, payload);

    assert_eq!(code, 0);
    assert_eq!(out.lines().count(), 1, "{out:?}");
    assert!(out.contains("Fable 5.1"), "{out:?}");
    assert!(out.contains("30%"), "{out:?}");
    // The samples file and the payload log both landed in the scratch dir.
    assert!(dir.join("claude-statusline-it-1.json").is_file());
    let log = std::fs::read_to_string(dir.join(".claude/logs/statusline.log")).unwrap();
    assert!(log.contains("\"total_input_tokens\": 50000"), "{log}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn persists_the_window_clock_when_the_payload_carries_rate_limits() {
    let dir = scratch();
    let resets_at = chrono::Utc::now().timestamp() + 3600;
    let payload = serde_json::json!({
        "model": { "display_name": "Fable 5.1" },
        "rate_limits": { "five_hour": { "resets_at": resets_at, "used_percentage": 31.4 } },
        "session_id": "it-2"
    });

    let (code, _) = run(&dir, &payload.to_string());

    assert_eq!(code, 0);
    let window: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("state/window.json")).unwrap()).unwrap();
    assert_eq!(window["five_hour"], serde_json::json!({ "resets_at": resets_at, "used_percentage": 31.4 }));
    assert_eq!(window["session_id"], "it-2");
    assert!(chrono::DateTime::parse_from_rfc3339(window["at"].as_str().unwrap()).is_ok(), "{window}");
    let _ = std::fs::remove_dir_all(&dir);
}
