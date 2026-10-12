//! PostToolUse format hook: runs the edited file's own project formatters over it.
//!
//! Three rules shape the behaviour, and each one is a deliberate departure from "just format it":
//!
//! 1. **Prettier opts out entirely.** A Prettier config anywhere between the edited file's
//!    directory and `/` — one of [`PRETTIER`], or a `package.json` whose top-level object has a
//!    `prettier` key — means the hook does nothing but log the skip. Such a project is assumed to
//!    run Prettier through its own tooling. This wins even over an [`OXFMT`] config found closer
//!    to the file.
//! 2. **Project-pinned binaries only.** `oxfmt` and `oxlint` resolve to the nearest
//!    `node_modules/.bin/<tool>` on the same walk-up, else to what `mise which <tool>` answers from
//!    the file's directory — a project's `mise.toml` pin (`"npm:oxfmt" = "…"`). There is no PATH,
//!    `bunx`, or global-install fallback: a config with no project binary is skipped and logged.
//! 3. **oxlint first, then oxfmt.** Linting with `--fix` can rewrite the file, so formatting runs
//!    after it. Each tool runs only when both its config and its local binary are present.
//!
//! Every path exits quietly: the hook must never fail the tool call that triggered it.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// oxfmt config filenames.
pub const OXFMT: &[&str] = &[".oxfmtrc", ".oxfmtrc.json", ".oxfmtrc.jsonc"];

/// oxlint config filenames.
pub const OXLINT: &[&str] = &[".oxlintrc.json", ".oxlintrc.jsonc"];

/// Prettier config filenames (alpha-sorted; detection is any-match, so order carries no meaning),
/// minus the `package.json` `prettier` key — that one is checked separately by `has_prettier_key`.
pub const PRETTIER: &[&str] = &[
    ".prettierrc",
    ".prettierrc.cjs",
    ".prettierrc.cts",
    ".prettierrc.js",
    ".prettierrc.json",
    ".prettierrc.json5",
    ".prettierrc.mjs",
    ".prettierrc.mts",
    ".prettierrc.toml",
    ".prettierrc.ts",
    ".prettierrc.yaml",
    ".prettierrc.yml",
    "prettier.config.cjs",
    "prettier.config.cts",
    "prettier.config.js",
    "prettier.config.mjs",
    "prettier.config.mts",
    "prettier.config.ts",
];

/// Log file name under `~/.claude/logs/`, and the number of lines kept there.
const LOG: (&str, usize) = ("format", 50);

/// What the walk-up from an edited file found.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Decision {
    /// Nothing on the path opts into a formatter.
    None,
    /// oxlint and/or oxfmt configs were found; the flags say which.
    Ox {
        /// An [`OXFMT`] config exists on the path.
        oxfmt: bool,
        /// An [`OXLINT`] config exists on the path.
        oxlint: bool,
    },
    /// A Prettier config was found in this directory; the hook stands down.
    Prettier(PathBuf),
}

/// True when `dir` holds any of `names`.
fn any(dir: &Path, names: &[&str]) -> bool {
    names.iter().any(|name| dir.join(name).exists())
}

/// True when `dir/package.json` parses as an object with a top-level `prettier` key.
fn has_prettier_key(dir: &Path) -> bool {
    let Ok(text) = fs::read_to_string(dir.join("package.json")) else {
        return false;
    };
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| v.as_object().map(|o| o.contains_key("prettier")))
        .unwrap_or(false)
}

/// Walk up from `from` to `/`, reporting which formatters the project opts into.
///
/// Prettier is searched over the whole path before any oxc config is considered, so a Prettier
/// config far above the file still beats an `.oxfmtrc` sitting next to it.
pub fn detect(from: &Path) -> Decision {
    let ancestors: Vec<&Path> = from.ancestors().filter(|dir| !dir.as_os_str().is_empty()).collect();

    if let Some(dir) = ancestors.iter().find(|dir| any(dir, PRETTIER) || has_prettier_key(dir)) {
        return Decision::Prettier(dir.to_path_buf());
    }

    let oxfmt = ancestors.iter().any(|dir| any(dir, OXFMT));
    let oxlint = ancestors.iter().any(|dir| any(dir, OXLINT));
    if oxfmt || oxlint { Decision::Ox { oxfmt, oxlint } } else { Decision::None }
}

/// The project's `tool`: [`resolve_local`], else [`resolve_mise`]. Never falls back to PATH.
pub fn resolve(from: &Path, tool: &str) -> Option<PathBuf> {
    resolve_local(from, tool).or_else(|| resolve_mise(from, tool))
}

/// The nearest `node_modules/.bin/<tool>` walking up from `from`.
pub fn resolve_local(from: &Path, tool: &str) -> Option<PathBuf> {
    from.ancestors()
        .filter(|dir| !dir.as_os_str().is_empty())
        .map(|dir| dir.join("node_modules").join(".bin").join(tool))
        .find(|bin| bin.exists())
}

/// What `mise which <tool>` answers with `cwd = from`, i.e. the nearest `mise.toml` pin. `None`
/// when mise is absent, exits non-zero (no pin on this path), or names a path that does not
/// exist. `mise` is taken from PATH, else `$HOME/.local/bin/mise`.
pub fn resolve_mise(from: &Path, tool: &str) -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    let candidates = [PathBuf::from("mise"), home.join(".local/bin/mise")];
    let output = candidates.iter().find_map(|mise| {
        Command::new(mise)
            .args(["which", tool])
            .current_dir(from)
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .ok()
    })?;
    if !output.status.success() {
        return None;
    }
    let path = PathBuf::from(String::from_utf8(output.stdout).ok()?.trim());
    path.exists().then_some(path)
}

/// The edited file from the hook's stdin JSON: `tool_input.file_path`, else
/// `tool_response.filePath`. `None` for malformed, empty, or path-less input.
pub fn file_path(input: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(input).ok()?;
    ["/tool_input/file_path", "/tool_response/filePath"]
        .iter()
        .find_map(|ptr| value.pointer(ptr).and_then(serde_json::Value::as_str))
        .filter(|path| !path.is_empty())
        .map(str::to_owned)
}

/// Run one tool over `file` with `cwd = dir`, discarding its output.
///
/// Logs `<tool> exit=<code> <file>`, using `exit=-1` when the process is killed by a signal or
/// fails to launch at all. A missing local binary logs `no local <tool> for <file>` and runs
/// nothing.
fn step(dir: &Path, file: &Path, tool: &str, args: &[&str]) {
    let shown = file.display();
    let Some(bin) = resolve(dir, tool) else {
        crate::log::append(LOG.0, &format!("no local {tool} for {shown}"), Some(LOG.1));
        return;
    };
    let code = Command::new(bin)
        .args(args)
        .arg(file)
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()
        .and_then(|status| status.code())
        .unwrap_or(-1);
    crate::log::append(LOG.0, &format!("{tool} exit={code} {shown}"), Some(LOG.1));
}

/// Drive the hook from its raw stdin payload. Silent and side-effect-free on unusable input.
pub fn run(input: &str) {
    let Some(path) = file_path(input) else { return };
    let file = Path::new(&path);
    let dir = match file.parent() {
        Some(dir) if !dir.as_os_str().is_empty() => dir,
        _ => Path::new("."),
    };
    // Walk the real directory: an edit through a symlink (`~/.claude/skills`) still finds the
    // configs and binaries of the tree it lands in.
    let real = fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
    let dir = real.as_path();

    match detect(dir) {
        Decision::None => {}
        Decision::Ox { oxfmt, oxlint } => {
            if oxlint {
                step(dir, file, "oxlint", &["--fix"]);
            }
            if oxfmt {
                step(dir, file, "oxfmt", &[]);
            }
        }
        Decision::Prettier(at) => {
            let line = format!("prettier {} — skipped {}", at.display(), file.display());
            crate::log::append(LOG.0, &line, Some(LOG.1));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    /// A fresh empty directory under the system temp dir; the caller removes it.
    fn tmpdir(tag: &str) -> PathBuf {
        static N: AtomicU32 = AtomicU32::new(0);
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let n = N.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir()
            .join(format!("claude-format-{tag}-{}-{nanos}-{n}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: &Path, body: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, body).unwrap();
    }

    #[test]
    fn detects_nothing_without_config() {
        let dir = tmpdir("none");
        assert_eq!(detect(&dir), Decision::None);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn detects_oxfmt_and_oxlint_separately() {
        let dir = tmpdir("ox");
        write(&dir.join(".oxfmtrc.json"), "{}");
        assert_eq!(detect(&dir), Decision::Ox { oxfmt: true, oxlint: false });

        write(&dir.join(".oxlintrc.json"), "{}");
        assert_eq!(detect(&dir), Decision::Ox { oxfmt: true, oxlint: true });

        fs::remove_file(dir.join(".oxfmtrc.json")).unwrap();
        assert_eq!(detect(&dir), Decision::Ox { oxfmt: false, oxlint: true });
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn detects_oxlint_jsonc_variant() {
        let dir = tmpdir("oxlint-jsonc");
        write(&dir.join(".oxlintrc.jsonc"), "{}");
        assert_eq!(detect(&dir), Decision::Ox { oxfmt: false, oxlint: true });
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn detects_ox_config_above_the_file() {
        let dir = tmpdir("ox-above");
        write(&dir.join(".oxfmtrc"), "");
        let nested = dir.join("src/deep");
        fs::create_dir_all(&nested).unwrap();
        assert_eq!(detect(&nested), Decision::Ox { oxfmt: true, oxlint: false });
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn prettier_config_beats_a_nearer_oxfmt_config() {
        let dir = tmpdir("prettier-wins");
        let nested = dir.join("packages/app");
        write(&dir.join(".prettierrc"), "{}");
        write(&nested.join(".oxfmtrc.json"), "{}");
        assert_eq!(detect(&nested), Decision::Prettier(dir.clone()));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn prettier_key_in_package_json_wins() {
        let dir = tmpdir("prettier-key");
        write(&dir.join("package.json"), r#"{"name":"probe","prettier":{}}"#);
        write(&dir.join(".oxfmtrc.json"), "{}");
        assert_eq!(detect(&dir), Decision::Prettier(dir.clone()));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn package_json_without_the_key_is_not_prettier() {
        let dir = tmpdir("pkg-plain");
        write(&dir.join("package.json"), r#"{"name":"probe"}"#);
        assert_eq!(detect(&dir), Decision::None);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn malformed_package_json_is_ignored() {
        let dir = tmpdir("pkg-broken");
        write(&dir.join("package.json"), "not json");
        write(&dir.join(".oxfmtrc.json"), "{}");
        assert_eq!(detect(&dir), Decision::Ox { oxfmt: true, oxlint: false });
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn resolve_local_picks_the_nearest_node_modules_bin() {
        let dir = tmpdir("resolve");
        let nested = dir.join("packages/app");
        fs::create_dir_all(&nested).unwrap();
        assert_eq!(resolve_local(&nested, "oxfmt"), None);

        let outer = dir.join("node_modules/.bin/oxfmt");
        write(&outer, "");
        assert_eq!(resolve_local(&nested, "oxfmt"), Some(outer));

        let inner = nested.join("node_modules/.bin/oxfmt");
        write(&inner, "");
        assert_eq!(resolve_local(&nested, "oxfmt"), Some(inner));
        assert_eq!(resolve_local(&nested, "oxlint"), None);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn reads_file_path_from_tool_input() {
        let input = r#"{"tool_input":{"file_path":"/tmp/probe.json"}}"#;
        assert_eq!(file_path(input).as_deref(), Some("/tmp/probe.json"));
    }

    #[test]
    fn falls_back_to_tool_response_file_path() {
        let input = r#"{"tool_response":{"filePath":"/tmp/probe.json"}}"#;
        assert_eq!(file_path(input).as_deref(), Some("/tmp/probe.json"));
    }

    #[test]
    fn prefers_tool_input_over_tool_response() {
        let input = r#"{"tool_input":{"file_path":"/a"},"tool_response":{"filePath":"/b"}}"#;
        assert_eq!(file_path(input).as_deref(), Some("/a"));
    }

    #[test]
    fn rejects_unusable_input() {
        for input in ["", "not json", "{}", r#"{"tool_input":{}}"#, r#"{"tool_input":{"file_path":""}}"#]
        {
            assert_eq!(file_path(input), None, "expected no path from {input:?}");
        }
    }
}
