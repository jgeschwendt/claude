# Finish line

Run before any `result:` that follows a change; every item is a miss that reached the owner during the typescript cleanup (2026-10-10 → 14). A checklist, not a judgment: skip none, report any that fails.

- **Reference sweep with `rg --hidden`** for every name renamed, moved or deleted. `.changeset/`, `.stele/`, `.github/` are hidden and rg skips them by default (the `@jlg/lint` revert left three files behind).
- **Order in config.** Every key or list touched in JSON, TOML, Pkl, YAML is alphabetical unless order encodes meaning; no linter checks those files, so read the diff for it (`glob` above `check` in hk.pkl).
- **Pinned runtime only.** Probe and gate under `mise x -C <repo>`; a global bun called a real Bun 1.3 failure "non-reproducible", a global oxfmt reformatted commits. Hooks and CI call `bunx <tool>` or `mise x`, never a bare binary name.
- **Scripts and their callers agree.** After editing package.json scripts, grep hk.pkl, the workflows and AGENTS `commands:` for the old names (`fmt:check` vanished under a live gate).
- **Publish surface.** After a rename or move, `files` and `exports` resolve; links in a shipped README are absolute when the target is not published.
- **Types.** `tsc -p` the package whenever the repo carries tsconfigs; a Buffer into `JSON.parse` passes the tests and fails tsc.
- **Pointer moves.** After `update-ref`, rebase or merge: `git log -1`, `git status --short`, one gate. A moved ref over stale worktree files read as 24 modified files.
- **Landing rules before planning the landing.** `git fetch` and `git rev-list --left-right --count`, then `gh api repos/<r>/rulesets` (merge method, linear history, required checks, sign-off labels); a merge commit was built for a rebase-only main.
- **Owner-only steps named up front.** A sign-off label or a release decision is his; say so in the plan, not after CI goes red.
- **A changeset rides its PR.** The release workflow keeps the Version Packages PR a draft; the owner's ready-and-merge is the only step that tags and publishes, so a changeset lands with the change it describes and the draft accumulates the batch (draft since 2026-10-29 · "why don't we add changesets along the way? … keep this release pr in draft until i'm ready"; before that, a patch-only Version Packages PR auto-merged and 0.1.4 shipped a single rule change mid-pass, 2026-10-20). In the typescript repo the bump is patch whenever possible, pre-1.0 a peer bump included; a minor or verax bump also needs the owner's release:signed-off label (since 2026-10-28 · "we always patch in this repo when possible").
- **Every check green, not just the workflow.** A job-level `continue-on-error` keeps the run green and still posts a red check on the commit, which reads as "ci failed". Make the job pass (shape the config so both tools agree) or do not ship it; never tolerate a known failure with the flag. (since 2026-10-28 · typescript lint (bun) sort-keys)

(since 2026-10-14 · "you are not as ocd as i am, how do we fix that?")
