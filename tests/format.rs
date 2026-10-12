//! End-to-end tests for the `format` binary.
//!
//! Each test gets a throwaway `$HOME` so `~/.claude/logs/format.log` lands inside the temp tree,
//! and fake `node_modules/.bin/oxfmt` / `oxlint` shell scripts that append their cwd and argv to a
//! `calls` file instead of doing any real work. PATH is pinned to `<home>/bin` plus the system
//! dirs, so the real `mise` is never consulted; [`fake_mise`] installs a stand-in there.

use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const UNFORMATTED: &str = "{\"a\":1,\n\"b\":[1,2]}";

/// A throwaway `$HOME` with a `project/` subdirectory; dropped by [`cleanup`].
struct Home {
    dir: PathBuf,
}

impl Home {
    fn new(tag: &str) -> Self {
        static N: AtomicU32 = AtomicU32::new(0);
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let n = N.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir()
            .join(format!("claude-format-it-{tag}-{}-{nanos}-{n}", std::process::id()));
        fs::create_dir_all(dir.join("project")).unwrap();
        // The hook walks real paths; a symlinked temp dir (/tmp → /private/tmp) would skew asserts.
        Self { dir: fs::canonicalize(dir).unwrap() }
    }

    /// The project root the fake edits happen in.
    fn project(&self) -> PathBuf {
        self.dir.join("project")
    }

    /// Where the fake binaries record their invocations.
    fn calls(&self) -> PathBuf {
        self.dir.join("calls")
    }

    /// Lines recorded by the fake binaries, in call order.
    fn call_lines(&self) -> Vec<String> {
        read_lines(&self.calls())
    }

    /// Lines of `~/.claude/logs/format.log`.
    fn log_lines(&self) -> Vec<String> {
        read_lines(&self.dir.join(".claude/logs/format.log"))
    }

    fn log_path(&self) -> PathBuf {
        self.dir.join(".claude/logs/format.log")
    }

    /// Run the hook binary with this `$HOME` and the given stdin payload.
    fn run(&self, stdin: &str) -> Output {
        let mut child = Command::new(env!("CARGO_BIN_EXE_format"))
            .env("HOME", &self.dir)
            .env("PATH", format!("{}:/usr/bin:/bin", self.dir.join("bin").display()))
            .current_dir(&self.dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(stdin.as_bytes()).unwrap();
        child.wait_with_output().unwrap()
    }
}

fn cleanup(home: Home) {
    fs::remove_dir_all(&home.dir).unwrap();
}

fn read_lines(path: &Path) -> Vec<String> {
    fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect()
}

fn write(path: &Path, body: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, body).unwrap();
}

/// Install a fake `node_modules/.bin/<tool>` under `at` that records `cwd` and argv to `calls`,
/// writes noise to both streams, and exits with `code`.
fn fake_bin(at: &Path, tool: &str, calls: &Path, code: i32) {
    let bin = at.join("node_modules/.bin").join(tool);
    let script = format!(
        "#!/bin/sh\nprintf '%s cwd=%s args=%s\\n' {tool} \"$(pwd -P)\" \"$*\" >> '{calls}'\n\
         echo '{tool} noise'\necho '{tool} noise' >&2\nexit {code}\n",
        calls = calls.display(),
    );
    write(&bin, &script);
    fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
}

/// Install a fake `mise` at `<home>/bin/mise` that answers `which <tool>` with
/// `<home>/mise-bins/<tool>` when that file exists (recording the cwd it was asked from), and
/// exits 1 otherwise — the shape of a per-project `mise.toml` pin.
fn fake_mise(home: &Home) {
    let bins = home.dir.join("mise-bins");
    let script = format!(
        "#!/bin/sh\n[ \"$1\" = which ] || exit 2\nprintf 'mise which %s cwd=%s\\n' \"$2\" \"$(pwd -P)\" >> '{calls}'\n\
         bin='{bins}/'\"$2\"\n[ -x \"$bin\" ] || exit 1\necho \"$bin\"\n",
        calls = home.calls().display(),
        bins = bins.display(),
    );
    let mise = home.dir.join("bin/mise");
    write(&mise, &script);
    fs::set_permissions(&mise, fs::Permissions::from_mode(0o755)).unwrap();
}

/// Install a fake mise-pinned `<tool>` under `<home>/mise-bins/`, recording like [`fake_bin`].
fn fake_mise_bin(home: &Home, tool: &str, code: i32) {
    let bin = home.dir.join("mise-bins").join(tool);
    let script = format!(
        "#!/bin/sh\nprintf '%s cwd=%s args=%s\\n' {tool} \"$(pwd -P)\" \"$*\" >> '{calls}'\nexit {code}\n",
        calls = home.calls().display(),
    );
    write(&bin, &script);
    fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
}

fn edit(file: &Path) -> String {
    format!("{{\"tool_input\":{{\"file_path\":{:?}}}}}", file.display().to_string())
}

#[test]
fn runs_oxlint_with_fix_then_oxfmt() {
    let home = Home::new("order");
    let project = home.project();
    let probe = project.join("probe.json");
    write(&project.join(".oxfmtrc.json"), "{}");
    write(&project.join(".oxlintrc.json"), "{}");
    write(&probe, UNFORMATTED);
    fake_bin(&project, "oxfmt", &home.calls(), 0);
    fake_bin(&project, "oxlint", &home.calls(), 0);

    let out = home.run(&edit(&probe));

    assert!(out.status.success());
    assert!(out.stdout.is_empty(), "hook leaked tool stdout: {:?}", out.stdout);
    assert!(out.stderr.is_empty(), "hook leaked tool stderr: {:?}", out.stderr);

    let cwd = fs::canonicalize(&project).unwrap();
    assert_eq!(
        home.call_lines(),
        vec![
            format!("oxlint cwd={} args=--fix {}", cwd.display(), probe.display()),
            format!("oxfmt cwd={} args={}", cwd.display(), probe.display()),
        ]
    );

    let log = home.log_lines();
    assert_eq!(log.len(), 2, "{log:?}");
    assert!(log[0].ends_with(&format!("oxlint exit=0 {}", probe.display())), "{log:?}");
    assert!(log[1].ends_with(&format!("oxfmt exit=0 {}", probe.display())), "{log:?}");
    cleanup(home);
}

#[test]
fn runs_oxfmt_alone_when_only_its_config_is_present() {
    let home = Home::new("oxfmt-only");
    let project = home.project();
    let probe = project.join("probe.json");
    write(&project.join(".oxfmtrc.json"), "{}");
    write(&probe, UNFORMATTED);
    fake_bin(&project, "oxfmt", &home.calls(), 0);
    fake_bin(&project, "oxlint", &home.calls(), 0);

    assert!(home.run(&edit(&probe)).status.success());

    let cwd = fs::canonicalize(&project).unwrap();
    assert_eq!(
        home.call_lines(),
        vec![format!("oxfmt cwd={} args={}", cwd.display(), probe.display())]
    );
    cleanup(home);
}

#[test]
fn falls_back_to_tool_response_file_path() {
    let home = Home::new("fallback");
    let project = home.project();
    let probe = project.join("probe.json");
    write(&project.join(".oxfmtrc.json"), "{}");
    write(&probe, UNFORMATTED);
    fake_bin(&project, "oxfmt", &home.calls(), 0);

    let stdin = format!("{{\"tool_response\":{{\"filePath\":{:?}}}}}", probe.display().to_string());
    assert!(home.run(&stdin).status.success());

    assert_eq!(home.call_lines().len(), 1, "{:?}", home.call_lines());
    assert!(home.log_lines()[0].ends_with(&format!("oxfmt exit=0 {}", probe.display())));
    cleanup(home);
}

#[test]
fn a_prettier_config_skips_even_a_nearer_oxfmt_config() {
    let home = Home::new("prettier-file");
    let project = home.project();
    let nested = project.join("packages/app");
    let probe = nested.join("probe.json");
    write(&project.join(".prettierrc"), "{}");
    write(&nested.join(".oxfmtrc.json"), "{}");
    write(&probe, UNFORMATTED);
    fake_bin(&nested, "oxfmt", &home.calls(), 0);
    fake_bin(&nested, "oxlint", &home.calls(), 0);

    assert!(home.run(&edit(&probe)).status.success());

    assert!(!home.calls().exists(), "a formatter ran: {:?}", home.call_lines());
    assert_eq!(fs::read_to_string(&probe).unwrap(), UNFORMATTED);
    let log = home.log_lines();
    assert_eq!(log.len(), 1, "{log:?}");
    assert!(
        log[0].ends_with(&format!("prettier {} — skipped {}", project.display(), probe.display())),
        "{log:?}"
    );
    cleanup(home);
}

#[test]
fn a_package_json_prettier_key_skips() {
    let home = Home::new("prettier-key");
    let project = home.project();
    let probe = project.join("probe.json");
    write(&project.join("package.json"), "{\"name\":\"probe\",\"prettier\":{}}");
    write(&project.join(".oxfmtrc.json"), "{}");
    write(&probe, UNFORMATTED);
    fake_bin(&project, "oxfmt", &home.calls(), 0);

    assert!(home.run(&edit(&probe)).status.success());

    assert!(!home.calls().exists(), "a formatter ran: {:?}", home.call_lines());
    let log = home.log_lines();
    assert_eq!(log.len(), 1, "{log:?}");
    assert!(log[0].contains(&format!("prettier {} — skipped", project.display())), "{log:?}");
    cleanup(home);
}

#[test]
fn a_config_without_a_local_binary_is_skipped() {
    let home = Home::new("no-bin");
    let project = home.project();
    let probe = project.join("probe.json");
    write(&project.join(".oxfmtrc.json"), "{}");
    write(&project.join(".oxlintrc.json"), "{}");
    write(&probe, UNFORMATTED);

    assert!(home.run(&edit(&probe)).status.success());

    assert_eq!(fs::read_to_string(&probe).unwrap(), UNFORMATTED);
    let log = home.log_lines();
    assert_eq!(log.len(), 2, "{log:?}");
    assert!(log[0].ends_with(&format!("no local oxlint for {}", probe.display())), "{log:?}");
    assert!(log[1].ends_with(&format!("no local oxfmt for {}", probe.display())), "{log:?}");
    cleanup(home);
}

#[test]
fn no_config_leaves_the_file_and_the_log_alone() {
    let home = Home::new("no-config");
    let project = home.project();
    let probe = project.join("probe.json");
    write(&probe, UNFORMATTED);
    fake_bin(&project, "oxfmt", &home.calls(), 0);

    assert!(home.run(&edit(&probe)).status.success());

    assert_eq!(fs::read_to_string(&probe).unwrap(), UNFORMATTED);
    assert!(!home.log_path().exists());
    cleanup(home);
}

#[test]
fn ignores_empty_and_malformed_stdin() {
    for (tag, stdin) in [("empty", ""), ("malformed", "not json"), ("pathless", "{}")] {
        let home = Home::new(tag);
        assert!(home.run(stdin).status.success(), "{tag}");
        assert!(!home.log_path().exists(), "{tag}");
        cleanup(home);
    }
}

#[test]
fn records_a_nonzero_exit_code() {
    let home = Home::new("exit-code");
    let project = home.project();
    let probe = project.join("probe.json");
    write(&project.join(".oxlintrc.json"), "{}");
    write(&probe, UNFORMATTED);
    fake_bin(&project, "oxlint", &home.calls(), 3);

    assert!(home.run(&edit(&probe)).status.success());

    let log = home.log_lines();
    assert_eq!(log.len(), 1, "{log:?}");
    assert!(log[0].ends_with(&format!("oxlint exit=3 {}", probe.display())), "{log:?}");
    cleanup(home);
}

#[test]
fn finds_the_config_through_a_symlinked_directory() {
    let home = Home::new("symlink");
    let project = home.project();
    write(&project.join(".oxfmtrc.json"), "{}");
    write(&project.join("skills/probe.json"), UNFORMATTED);
    fake_bin(&project, "oxfmt", &home.calls(), 0);
    let link = home.dir.join("link");
    std::os::unix::fs::symlink(project.join("skills"), &link).unwrap();

    assert!(home.run(&edit(&link.join("probe.json"))).status.success());

    assert_eq!(home.call_lines().len(), 1, "{:?}", home.log_lines());
    cleanup(home);
}

#[test]
fn concurrent_hooks_keep_every_log_line() {
    let home = Home::new("concurrent");
    let project = home.project();
    let probe = project.join("probe.json");
    write(&project.join(".prettierrc"), "{}");
    write(&probe, UNFORMATTED);

    std::thread::scope(|scope| {
        for _ in 0..16 {
            scope.spawn(|| assert!(home.run(&edit(&probe)).status.success()));
        }
    });

    assert_eq!(home.log_lines().len(), 16, "{:?}", home.log_lines());
    cleanup(home);
}

#[test]
fn caps_the_log_at_50_lines() {
    let home = Home::new("cap");
    let project = home.project();
    let probe = project.join("probe.json");
    write(&project.join(".oxfmtrc.json"), "{}");
    write(&probe, UNFORMATTED);
    fake_bin(&project, "oxfmt", &home.calls(), 0);

    let seed: Vec<String> = (0..60).map(|i| format!("[old] entry {i}")).collect();
    write(&home.log_path(), &(seed.join("\n") + "\n"));

    assert!(home.run(&edit(&probe)).status.success());

    let log = home.log_lines();
    assert_eq!(log.len(), 50);
    assert_eq!(log[0], "[old] entry 11");
    assert!(log[49].ends_with(&format!("oxfmt exit=0 {}", probe.display())), "{log:?}");
    cleanup(home);
}

#[test]
fn falls_back_to_the_mise_pin_when_node_modules_has_no_binary() {
    let home = Home::new("mise");
    let project = home.project();
    let probe = project.join("probe.json");
    write(&project.join(".oxfmtrc.json"), "{}");
    write(&probe, UNFORMATTED);
    fake_mise(&home);
    fake_mise_bin(&home, "oxfmt", 0);

    let out = home.run(&edit(&probe));

    assert!(out.status.success());
    let cwd = fs::canonicalize(&project).unwrap();
    assert_eq!(
        home.call_lines(),
        vec![
            format!("mise which oxfmt cwd={}", cwd.display()),
            format!("oxfmt cwd={} args={}", cwd.display(), probe.display()),
        ]
    );
    assert!(home.log_lines().last().unwrap().ends_with(&format!("oxfmt exit=0 {}", probe.display())));
    cleanup(home);
}

#[test]
fn node_modules_wins_over_the_mise_pin() {
    let home = Home::new("mise-local");
    let project = home.project();
    let probe = project.join("probe.json");
    write(&project.join(".oxfmtrc.json"), "{}");
    write(&probe, UNFORMATTED);
    fake_mise(&home);
    fake_mise_bin(&home, "oxfmt", 0);
    fake_bin(&project, "oxfmt", &home.calls(), 0);

    let out = home.run(&edit(&probe));

    assert!(out.status.success());
    let cwd = fs::canonicalize(&project).unwrap();
    assert_eq!(home.call_lines(), vec![format!("oxfmt cwd={} args={}", cwd.display(), probe.display())]);
    cleanup(home);
}

#[test]
fn mise_without_a_pin_means_skip() {
    let home = Home::new("mise-none");
    let project = home.project();
    let probe = project.join("probe.json");
    write(&project.join(".oxfmtrc.json"), "{}");
    write(&probe, UNFORMATTED);
    fake_mise(&home);

    let out = home.run(&edit(&probe));

    assert!(out.status.success());
    assert_eq!(fs::read_to_string(&probe).unwrap(), UNFORMATTED);
    assert!(home.log_lines().last().unwrap().ends_with(&format!("no local oxfmt for {}", probe.display())));
    cleanup(home);
}
