//! Claude Code statusline entry point: read one payload from stdin, print one line. See
//! [`claude_home::statusline`] for the format and every rule behind it.
//!
//! The CLI wires this in as its `statusLine` command, so a crash here would blank the status bar:
//! the whole tick is wrapped, failures go to the log, and the exit code is always 0.

use chrono::Local;
use claude_home::log;
use claude_home::statusline::{Environment, Samples, StatusInput, columns, persist_window, render, sh};
use serde_json::Value;
use std::io::Read;

/// One render tick: the line, plus a window-clock failure worth a log line. `Err` carries the
/// message that lands in the log.
fn tick(raw: &str) -> Result<(String, Option<String>), String> {
    let input: StatusInput = serde_json::from_str(raw).map_err(|e| format!("SyntaxError: {e}"))?;
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
    // The debug log holds the last tick only: its payload (plus any window-clock failure) on
    // success, its error on failure.
    let (line, body) =
        match std::io::stdin().read_to_string(&mut raw).map_err(|e| format!("Error: {e}")).and_then(|_| tick(&raw)) {
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
