//! End-to-end checks on the /delete and /dissolve session scripts against a temp HOME: stub `ps`, `claude` and
//! `sandman` on its `.local/bin`, and a `sleep` standing in for this session's CLI. macOS only, like the scripts
//! (`stat -f`).
#![cfg(target_os = "macos")]

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::{Duration, Instant};

const SID: &str = "aaaaaaaa-1111-2222-3333-444444444444";

/// The stub `ps` names only the stand-in's pid `claude`, makes it every pid's parent, gives it argv `$ARGS` and no
/// TTY; the stub `claude` and `sandman` append their argv to `$HOME/calls`.
fn rig(name: &str) -> (PathBuf, Child) {
    let home = Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    let _ = std::fs::remove_dir_all(&home);
    std::fs::create_dir_all(home.join(".local/bin")).unwrap();
    let log = r#"echo "${0##*/} $*" >>"$HOME/calls""#;
    let ps = r#"case $2 in comm=) [ "$4" = "$CLI" ] && echo /x/claude || echo zsh ;; args=) echo "$ARGS" ;; ppid=) echo " $CLI" ;; tty=) echo '??' ;; esac"#;
    for (stub, body) in [("claude", log), ("ps", ps), ("sandman", log)] {
        let path = home.join(".local/bin").join(stub);
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    (home, Command::new("sleep").arg("60").spawn().unwrap())
}

/// `<script>-session.sh --watch-only` under the rig's CLI, whose argv is `args`: its exit code and stdout.
fn arm(home: &Path, cli: &Child, script: &str, args: &str) -> (Option<i32>, String) {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("skills/{script}/scripts/{script}-session.sh"));
    let out = Command::new(path).arg("--watch-only").env_clear()
        .envs([("ARGS", args), ("CLAUDE_SESSION_ID", SID), ("CLI", &cli.id().to_string()), ("HOME", home.to_str().unwrap())])
        .env("PATH", format!("{}/.local/bin:/usr/bin:/bin", home.display()))
        .output().unwrap();
    (out.status.code(), String::from_utf8(out.stdout).unwrap())
}

fn read(path: PathBuf) -> String { std::fs::read_to_string(path).unwrap_or_default() }

/// Only the argv word after the executable marks the daemon or its pty host — the same word inside an initial prompt
/// is the session — and a refusal exits non-zero, so the skill never reports an ending nothing armed.
#[test]
fn refuses_only_a_daemon_subcommand() {
    let (home, mut cli) = rig("sessions-argv");
    for script in ["delete", "dissolve"] {
        for (args, code) in [("claude why does the daemon crash", 0), ("/opt/claude daemon", 1), ("claude bg-pty-host 7", 1)] {
            let (got, stdout) = arm(&home, &cli, script, args);
            assert_eq!((got, stdout.contains("Could not identify")), (Some(code), code == 1), "{script} {args}: {stdout}");
        }
    }
    cli.kill().unwrap();
    cli.wait().unwrap();
}

/// Once the CLI is gone both scripts retire a live job before anything else, delete then erases what regrew, and
/// dissolve counts a pointer as the hook's take iff it changed after arming — within the same second too.
#[test]
fn endings_after_the_cli_exits() {
    let journal = &format!(".sandman/.trace/{}", chrono::Utc::now().format("dissolve-%Y-%m-%d.log"));
    let cases = [
        ("delete", "job", "calls", "sandman forget", format!("claude rm aaaaaaaa\nsandman forget {SID}\n")),
        ("dissolve", "job", journal, " took ", format!("claude rm aaaaaaaa\nsandman take {SID} --force\n")),
        ("dissolve", "stale", journal, " took ", format!("sandman take {SID} --force\n")),
        ("dissolve", "fresh", journal, " hook-took ", String::new()),
    ];
    let mut rigs: Vec<_> = cases.iter().map(|(script, setup, ..)| {
        let (home, cli) = rig(&format!("sessions-{script}-{setup}"));
        let put = |path: &str| {
            let path = home.join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "{}").unwrap();
        };
        let pointer = format!(".sandman/memories/.recent/{SID}.json");
        match *setup {
            "job" => ["jobs/aaaaaaaa/state.json", &format!("projects/-p/{SID}.jsonl"), &format!("projects/-p/{SID}/x")]
                .iter().for_each(|p| put(&format!(".claude/{p}"))),
            "stale" => put(&pointer),
            _ => {}
        }
        assert_eq!(arm(&home, &cli, script, "claude").0, Some(0));
        if *setup == "fresh" { put(&pointer) }
        (home, cli)
    }).collect();
    rigs.iter_mut().for_each(|(_, cli)| { cli.kill().unwrap(); cli.wait().unwrap(); });
    let deadline = Instant::now() + Duration::from_secs(10);
    for ((home, _), (script, setup, file, needle, calls)) in rigs.iter().zip(&cases) {
        let text = loop {
            let text = read(home.join(file));
            if text.contains(needle) || Instant::now() > deadline { break text }
            std::thread::sleep(Duration::from_millis(100));
        };
        assert!(text.contains(needle), "{script} {setup}: {text}");
        assert_eq!(&read(home.join("calls")), calls, "{script} {setup}");
        if *script == "delete" { assert_eq!(std::fs::read_dir(home.join(".claude/projects/-p")).unwrap().count(), 0) }
    }
}
