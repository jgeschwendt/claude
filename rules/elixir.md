---
paths:
  - "**/*.{ex,exs}"
---

# Elixir

Comment syntax: see `rules/comments.md`.

## Module layout

- **Interleave publics and privates — a helper lives near the function-family it serves; never blanket-segregate every `defp` to the file bottom.** Place a helper after its caller's whole clause group (splitting a multi-clause group draws the grouped-clauses compiler warning); helpers shared across families cluster wherever that family reads best. (since 2026-07-19 · orrery lib/orrery/routines.ex parse_cron call-tree; grove apps/grove/lib/grove/roots/watcher.ex)
- **A wrap-only function delegates to a same-named `do_<name>` private.** When a function only adds setup/teardown — tmp-file lifecycle, telemetry span, `after` cleanup — around the real logic, the logic lives in `do_<name>`. (since 2026-07-19 · orrery lib/orrery/claude.ex run/do_run; grove apps/grove/lib/grove/roots/watcher.ex adopt/do_adopt)

## Runtime

- **Scheduled BEAM work on a laptop host runs off a wall-clock heartbeat, never one long `Process.send_after`.** macOS sleep stalls the ERTS monotonic clock: the VM survives, the timer never advances, and on wake one overdue tick fires — a 13-minute cadence ran once a day for two weeks while looking healthy. Compare UTC now against a persisted next-run time on a short heartbeat; `caffeinate -i` blocks idle sleep only, a closed lid still sleeps; work that must tick belongs on an always-on host. (observed 2026-06-19 · retired trading app)
- **Swoosh SMTP with `verify_peer` needs `customize_hostname_check` or the handshake fails silently.** `tls_options: [verify: :verify_peer, customize_hostname_check: [match_fun: :public_key.pkix_verify_hostname_match_fun(:https)]]` — without it the send returns in ~100 ms with no mail while the provider's HTTP API works; a real round trip is ~0.5 s, so latency is the tell. Port 465 is implicit SSL, else STARTTLS; disabling verification is an escape hatch, not the fix. (observed 2026-06-01)
- **`mix hex.publish` is always interactive.** Hex auth is an OAuth device flow (`mix hex.user auth`; the dashboard Keys page stays empty), `api:write` is refused without account 2FA (the token is silently issued read-only — enable 2FA, re-auth), and every write prompts for a TOTP — run it in a real terminal, never a background shell. (verified 2026-08-02 · pty publish)
