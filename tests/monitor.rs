//! Runs monitor-github's own hermetic suite (stub `gh` and `ps`, temp state) so `cargo test` gates it.

use std::process::Command;

#[test]
fn monitor_github_selftest_passes() {
    let script = concat!(env!("CARGO_MANIFEST_DIR"), "/skills/monitor-github/scripts/selftest.sh");
    let out = Command::new("bash").arg(script).output().unwrap();
    assert!(out.status.success(), "{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
}
