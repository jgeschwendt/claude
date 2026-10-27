//! End-to-end checks on the `statusline` binary: the CLI must always get a line and a zero exit,
//! whatever the payload.

use std::ffi::OsStr;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Run the binary in `dir` with `TMPDIR` there and `HOME` at `home` (`dir` itself, or `""`), so the sample store, the
/// debug log and the window clock (via the `HOME` fallback) land there and no real settings feed the threshold.
/// Returns `(exit code, stdout)`.
fn run(dir: &Path, home: impl AsRef<OsStr>, payload: impl AsRef<[u8]>) -> (i32, String) {
    run_with(&[], dir, home, payload)
}

/// [`run`] with `args`; stderr is appended to stdout.
fn run_with(args: &[&str], dir: &Path, home: impl AsRef<OsStr>, payload: impl AsRef<[u8]>) -> (i32, String) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_statusline"))
        .args(args)
        .current_dir(dir)
        .env("HOME", home)
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
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(payload.as_ref()).unwrap();
    let out = child.wait_with_output().unwrap();
    (out.status.code().unwrap(), String::from_utf8([out.stdout, out.stderr].concat()).unwrap())
}

/// A per-test scratch dir under cargo's target tmpdir, emptied first so reruns start clean.
fn scratch(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn blanks_the_line_only_for_malformed_stdin_or_model() {
    let dir = scratch("malformed");

    for (payload, error) in [(&b"not json"[..], "SyntaxError"), (b"\xff", "valid UTF-8"), (br#"{"model":0}"#, "SyntaxError")] {
        assert_eq!(run(&dir, &dir, payload), (0, "\n".into()));
        let log = std::fs::read_to_string(dir.join(".claude/logs/statusline.log")).unwrap();
        assert!(log.contains(error), "{log}");
    }
    // Any other field of the wrong type reads as absent; a five-hour window without its percentage draws no 5h.
    for odd in [
        r#""effort":"low""#,
        r#""session_id":42"#,
        r#""rate_limits":{"five_hour":{"resets_at":"1","used_percentage":7}}"#,
        r#""rate_limits":{"five_hour":{}}"#,
        r#""rate_limits":{"five_hour":{"resets_at":1}}"#,
    ] {
        let out = run(&dir, &dir, format!(r#"{{"model":{{"display_name":"F","id":"x"}},{odd}}}"#)).1;
        assert!(out.starts_with("\x1b[1mF") && out.contains("5h") == odd.contains("used_percentage"), "{odd}: {out:?}");
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
    assert_eq!(run(&dir, &dir, &payload).0, 0);
    let log = std::fs::read_to_string(dir.join(".claude/logs/statusline.log")).unwrap();
    assert!(log.contains("window: "), "{log}");
    assert_eq!(std::fs::read_dir(file.parent().unwrap()).unwrap().count(), 1, "temp file left behind");
    std::fs::remove_dir(&file).unwrap();
    // A sample stamped in the future is dropped rather than freezing the store until the clock passes it.
    let samples = dir.join("claude-statusline-it-2.json");
    std::fs::write(&samples, r#"{"samples":[{"at":9e15,"tokens":1}]}"#).unwrap();

    let (code, out) = run(&dir, &dir, &payload);
    assert_eq!(code, 0);
    assert_eq!(out.lines().count(), 1, "{out:?}");
    assert!(out.contains("Fable 5.1") && out.contains("30%"), "{out:?}");
    // The samples file and the payload log both landed in the scratch dir.
    assert!(!std::fs::read_to_string(&samples).unwrap().contains("9e15"));
    let log = std::fs::read_to_string(dir.join(".claude/logs/statusline.log")).unwrap();
    assert!(log.contains("\"total_input_tokens\": 50000"), "{log}");
    let window: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    assert_eq!(window["five_hour"], serde_json::json!({ "resets_at": resets_at, "used_percentage": 31.4 }));
    assert_eq!(window["session_id"], "it-2");
    assert!(chrono::DateTime::parse_from_rfc3339(window["at"].as_str().unwrap()).is_ok(), "{window}");
    // An empty HOME disables the clock and the log rather than writing them under the working directory.
    let logs = dir.join(".claude");
    std::fs::remove_file(&file).unwrap();
    std::fs::remove_dir_all(&logs).unwrap();
    assert_eq!(run(&dir, "", &payload).0, 0);
    assert!(!file.exists() && !logs.exists());
    // Concurrent ticks serialize read-to-rename: the most-used window wins, never a stale reader's. A
    // padded prior file slows every read, so unserialized ticks reliably overlap.
    std::fs::write(&file, format!(r#"{{"pad":"{}"}}"#, " ".repeat(8 << 20))).unwrap();
    let dir = &dir;
    std::thread::scope(|s| {
        for used in 1..=40 {
            let payload = payload.replace("31.4", &used.to_string());
            s.spawn(move || run(dir, dir, payload));
        }
    });
    let window: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    assert_eq!(window["five_hour"]["used_percentage"], 40.0);
}

#[test]
fn window_mode_persists_only_and_fails_loudly() {
    let dir = scratch("window-mode");
    let file = dir.join(".local/state/claude/window.json");
    let payload = |resets_at: i64, used: f64| {
        let five_hour = serde_json::json!({ "resets_at": resets_at as f64 + 0.999, "used_percentage": used });
        serde_json::json!({ "model": { "display_name": "" }, "rate_limits": { "five_hour": five_hour }, "session_id": "s" })
            .to_string()
    };
    let now = chrono::Utc::now().timestamp();
    // A window that already reset is never written — perpetual's own copy of the rule wrote it.
    assert_eq!(run_with(&["--window"], &dir, &dir, payload(now - 1, 5.0)), (0, String::new()));
    assert!(!file.exists());
    assert_eq!(run_with(&["--window"], &dir, &dir, payload(now + 3600, 31.4)), (0, String::new()));
    assert_eq!(serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(&file).unwrap()).unwrap()["five_hour"],
        serde_json::json!({ "resets_at": now + 3600, "used_percentage": 31.4 }));
    // No line, samples or log; a refusal or bad stdin is stderr and exit 1, the file untouched.
    assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
    assert_eq!(run_with(&["--window"], &dir, &dir, payload(now + 3600, 100.1)), (1, "window: used_percentage 100.1 is outside 0–100\n".into()));
    let (code, out) = run_with(&["--window"], &dir, &dir, "{");
    assert!(code == 1 && out.starts_with("SyntaxError"), "{out}");
    assert!(std::fs::read_to_string(&file).unwrap().contains("31.4"));
}
