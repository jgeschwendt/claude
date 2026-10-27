//! Claude Code statusline entry point: read one payload from stdin, print one line. See
//! [`claude_home::statusline`] for the format and every rule behind it.
//!
//! The CLI wires this in as its `statusLine` command, so a crash here would blank the status bar:
//! the whole tick is wrapped, failures go to the log, and the exit code is always 0 — except under
//! `--window`, the window clock alone (see `main`).

use chrono::Local;
use claude_home::log;
use claude_home::statusline::{Environment, Samples, StatusInput, columns, persist_window, render, sh};
use serde_json::Value;
use std::io::Read;

fn parse(raw: &str) -> Result<StatusInput, String> {
    serde_json::from_str(raw).map_err(|e| format!("SyntaxError: {e}"))
}

/// One render tick: the line, plus a window-clock failure worth a log line. `Err` carries the
/// message that lands in the log.
fn tick(raw: &str) -> Result<(String, Option<String>), String> {
    let input = parse(raw)?;
    let env = Environment::from_env();
    let path = env.samples_path(input.session_id.as_deref());
    let mut samples = path.as_deref().map(Samples::load).unwrap_or_default();
    let line = render(&input, Local::now(), columns(sh).unwrap_or(80), &mut samples, &env);
    if samples.dirty && let Some(path) = &path {
        samples.write(path);
    }
    let warning = persist_window(&input, chrono::Utc::now(), &env).err();
    Ok((line, warning))
}

fn main() {
    let mut raw = String::new();
    let read = std::io::stdin().read_to_string(&mut raw).map_err(|e| format!("Error: {e}"));
    // `--window` is the perpetual mod's window clock: persist only — no line, samples or log — and a
    // failure goes to stderr with exit 1, which the mod logs.
    if std::env::args().nth(1).as_deref() == Some("--window") {
        let now = chrono::Utc::now();
        if let Err(e) = read.and_then(|_| parse(&raw)).and_then(|input| persist_window(&input, now, &Environment::from_env())) {
            eprintln!("{e}");
            std::process::exit(1);
        }
        return;
    }
    // The debug log holds the last tick only: its payload (plus any window-clock failure) on
    // success, its error on failure.
    let (line, body) = match read.and_then(|_| tick(&raw)) {
        Ok((line, warning)) => {
            let pretty = serde_json::from_str::<Value>(&raw).and_then(|json| serde_json::to_string_pretty(&json));
            (line, pretty.unwrap_or(raw) + &warning.map(|w| format!("\n{w}")).unwrap_or_default())
        }
        Err(error) => (String::new(), error),
    };
    println!("{line}");
    let stamp = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let _ = std::fs::write(log::path("statusline"), format!("[{stamp}] {body}\n"));
}
