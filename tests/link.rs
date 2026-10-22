//! End-to-end checks on `mise run link --check` against a temp `CLAUDE_HOME`.

use std::path::Path;
use std::process::Command;

/// The perpetual line is `ok` only while the user-scope copy is the trunk's version, whatever a
/// project-scope copy holds; a stale or missing install fails the check and names its fix.
#[test]
fn reports_a_perpetual_install_behind_the_trunk() {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR"));
    let manifest = std::fs::read_to_string(repo.join("plugins/perpetual/.claude-plugin/plugin.json")).unwrap();
    let want = serde_json::from_str::<serde_json::Value>(&manifest).unwrap()["version"].as_str().unwrap().to_owned();
    let home = Path::new(env!("CARGO_TARGET_TMPDIR")).join("link");
    let _ = std::fs::remove_dir_all(&home);
    std::fs::create_dir_all(home.join("plugins")).unwrap();
    for entry in ["rules", "skills", "CLAUDE.md", "settings.json", "settings.local.json"] {
        std::os::unix::fs::symlink(repo.join(entry), home.join(entry)).unwrap();
    }
    for (installed, code, line) in [
        (Some(want.as_str()), 0, format!("ok: perpetual {want}")),
        (Some("0.0.1"), 1, format!("behind: perpetual 0.0.1 → {want} (claude plugin update perpetual@jgeschwendt)")),
        (None, 1, "missing: perpetual (claude plugin install perpetual@jgeschwendt)".into()),
    ] {
        let path = home.join("plugins/installed_plugins.json");
        let _ = std::fs::remove_file(&path);
        if let Some(version) = installed {
            let entry = |scope, version| serde_json::json!({ "scope": scope, "version": version });
            let json = serde_json::json!({ "plugins": { "perpetual@jgeschwendt": [entry("project", "0.0.0"), entry("user", version)] } });
            std::fs::write(&path, serde_json::to_string_pretty(&json).unwrap()).unwrap();
        }
        let out = Command::new(repo.join(".mise/tasks/link")).arg("--check").env("CLAUDE_HOME", &home).output().unwrap();
        let stdout = String::from_utf8(out.stdout).unwrap();
        assert_eq!(out.status.code(), Some(code), "{stdout}");
        assert!(stdout.lines().any(|l| l == line), "{stdout}");
    }
}
