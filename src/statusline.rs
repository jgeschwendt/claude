//! Claude Code statusline. Each render tick the CLI pipes one [`StatusInput`] JSON payload to the
//! `statusline` binary's stdin and prints whatever comes back on stdout as the statusline:
//!
//! ```text
//! Fable 5 (fast · low) ██████████▎░░░░░░░░░░░ 52% ≈46m · $1.20 · 5h 31%† ↻ 10:50pm
//! ├─────┘ ├──────────┘ ├────────────────────────┘ ├────┘ ├──────────────────────┘
//! │ model │ mode flags │ context usage            │ cost │ 5h rate limit
//! ```
//!
//! Every segment is conditional — absent data leaves no residue:
//!
//! - Mode flags (dim): only when non-default — fast mode on, or effort ≠ high.
//! - Bar + %: `total_input_tokens` against the AUTO-COMPACT THRESHOLD, not the raw context
//!   window — see [`auto_compact_threshold`] for how that is resolved. ⅛-block cells; tone
//!   shifts green → yellow (50) → orange (75) → red (90) on both bar and digits.
//! - ≈ETA: projected time until auto-compact from recent token velocity — see [`Samples`].
//!   Appears from 50% usage when a ≥60s trend exists and the projection is <6h.
//! - $cost (dim): session spend so far (`cost.total_cost_usd`), shown once it rounds to ≥ $0.01.
//! - 5h limit: rate-limit usage (own tone), † when requests exceed 200k tokens (the 2×
//!   long-context pricing/rate-limit tier), ↻ reset as local wall-clock time.
//!
//! Layout: stdout is a pipe, so the real PTY width comes from walking parent PIDs to the shell
//! that owns the tty ([`columns`]). Each segment is styled once; head and tail are measured with
//! their ANSI escapes stripped, so escapes never count toward width. The bar absorbs whatever
//! columns remain.
//!
//! Window clock: each tick whose payload carries `rate_limits` also persists the five-hour window
//! to [`Environment::window_file`] for out-of-process readers — see [`persist_window`].
//!
//! Debugging: [`crate::log::path`]`("statusline")` receives each tick's payload (overwritten, last
//! tick wins); an error lands there too and the line simply goes blank for that tick.
//!
//! Fidelity note: this is a port of the former `statusline.js`, so JavaScript semantics are
//! reproduced deliberately — `Math.round` halves go toward +∞ ([`js_round`]), `Number(…)` parses
//! loosely (trimmed, `""` and garbage rejected), `x || default` treats `0`/`NaN`/`""` as absent,
//! and string widths are counted in characters.

use chrono::{DateTime, Local, SecondsFormat, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

// ─── payload ─────────────────────────────────────────────────────────────────

/// One render tick's payload, as piped in by the CLI. Unknown fields are ignored; everything the
/// renderer treats as optional is optional here too.
#[derive(Debug, Deserialize)]
pub struct StatusInput {
    pub context_window: Option<ContextWindow>,
    pub cost: Option<Cost>,
    pub effort: Option<Effort>,
    /// Whether requests crossed into the 2× long-context tier.
    pub exceeds_200k_tokens: Option<bool>,
    pub fast_mode: Option<bool>,
    pub model: Model,
    pub rate_limits: Option<RateLimits>,
    pub session_id: Option<String>,
    pub workspace: Option<Workspace>,
}

#[derive(Debug, Deserialize)]
pub struct ContextWindow {
    pub context_window_size: Option<f64>,
    /// The app's own numerator: input + cache read + cache creation.
    pub total_input_tokens: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct Cost {
    pub total_cost_usd: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct Effort {
    /// `"high"` (the default, never shown), `"medium"`, `"low"`, …
    pub level: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct FiveHour {
    /// Unix seconds.
    pub resets_at: Option<f64>,
    pub used_percentage: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct Model {
    pub display_name: String,
    /// Keyed on to resolve the auto-compact window.
    pub id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RateLimits {
    pub five_hour: Option<FiveHour>,
}

#[derive(Debug, Deserialize)]
pub struct Workspace {
    /// Project root, whose `.claude/settings*.json` can override the auto-compact window.
    pub project_dir: Option<String>,
}

// ─── environment ─────────────────────────────────────────────────────────────

/// The process environment the renderer reads. Captured up front so [`render`] can be driven from
/// tests against a scratch `HOME`/`TMPDIR` without mutating the real process environment.
#[derive(Default)]
pub struct Environment {
    pub auto_compact_window: Option<String>,
    pub disable_auto_compact: Option<String>,
    pub disable_compact: Option<String>,
    /// `CLAUDE_CODE_ENTRYPOINT`, the surface key in the window tables.
    pub entrypoint: Option<String>,
    pub home: String,
    pub max_output_tokens: Option<String>,
    pub tmp: String,
    /// Where [`persist_window`] writes: `CLAUDE_WINDOW_FILE`, else
    /// `$XDG_STATE_HOME/claude/window.json`, else `~/.local/state/claude/window.json`. `None`
    /// disables the write.
    pub window_file: Option<PathBuf>,
}

impl Environment {
    /// Snapshot the real process environment.
    pub fn from_env() -> Self {
        let var = |k: &str| std::env::var(k).ok();
        let tmp = var("TMPDIR").unwrap_or("/tmp".into());
        let set = |k: &str| var(k).filter(|v| !v.is_empty());
        let window_file = set("CLAUDE_WINDOW_FILE").map(PathBuf::from).or_else(|| {
            let state = set("XDG_STATE_HOME")
                .map(PathBuf::from)
                .or_else(|| set("HOME").map(|home| Path::new(&home).join(".local/state")))?;
            Some(state.join("claude/window.json"))
        });
        Self {
            auto_compact_window: var("CLAUDE_CODE_AUTO_COMPACT_WINDOW"),
            disable_auto_compact: var("DISABLE_AUTO_COMPACT"),
            disable_compact: var("DISABLE_COMPACT"),
            entrypoint: var("CLAUDE_CODE_ENTRYPOINT"),
            home: var("HOME").unwrap_or_default(),
            max_output_tokens: var("CLAUDE_CODE_MAX_OUTPUT_TOKENS"),
            tmp: tmp.strip_suffix('/').unwrap_or(&tmp).to_string(),
            window_file,
        }
    }

    /// Rolling sample file for `session_id`; `None` when the payload carries no session.
    pub fn samples_path(&self, session_id: Option<&str>) -> Option<PathBuf> {
        let id = session_id.filter(|s| !s.is_empty())?;
        Some(PathBuf::from(format!("{}/claude-statusline-{id}.json", self.tmp)))
    }
}

// ─── window clock ────────────────────────────────────────────────────────────

/// Persist the five-hour window to [`Environment::window_file`] as
/// `{"at":…,"five_hour":{"resets_at":…,"used_percentage":…},"session_id":…}` (keys sorted, `at`
/// RFC 3339 UTC, `resets_at` unix seconds). Writes nothing when `five_hour` is absent or partial,
/// when the window does not reset within 6h, or when it is behind the file's live window (an
/// earlier `resets_at`, or less used of the same one) — so readers (`sandman shift clock`, which
/// faults on a null `resets_at`) never see a null `five_hour` field, and an idle session re-rendering stale limits
/// never rolls the clock back. Atomic: a sibling temp file renamed into place. `Err` carries a
/// one-line reason; the caller logs it and the tick carries on.
pub fn persist_window(input: &StatusInput, now: DateTime<Utc>, env: &Environment) -> Result<(), String> {
    let five = input.rate_limits.as_ref().and_then(|l| l.five_hour.as_ref());
    let (Some(path), Some((resets_at, used))) =
        (&env.window_file, five.and_then(|f| Some((f.resets_at? as i64, f.used_percentage?))))
    else {
        return Ok(());
    };
    // The reader's bound: a live window resets within 6h. Outside it a payload is never written and
    // a stored window never blocks one, so a corrupt file heals on the next good tick.
    let live = |resets_at: i64| (1..=6 * 3600).contains(&resets_at.saturating_sub(now.timestamp()));
    let prior = read_json(path)
        .and_then(|v| Some((v["five_hour"]["resets_at"].as_i64()?, v["five_hour"]["used_percentage"].as_f64()?)));
    if !live(resets_at) || prior.is_some_and(|prior| live(prior.0) && prior > (resets_at, used)) {
        return Ok(());
    }
    let body = json!({
        "at": now.to_rfc3339_opts(SecondsFormat::Secs, true),
        "five_hour": { "resets_at": resets_at, "used_percentage": used },
        "session_id": input.session_id,
    });
    let fail = |e: std::io::Error| format!("window: {}: {e}", path.display());
    std::fs::create_dir_all(path.parent().unwrap_or(Path::new(""))).map_err(fail)?;
    let tmp = path.with_file_name(format!(".{}.{}.tmp", path.file_name().unwrap_or_default().display(), std::process::id()));
    std::fs::write(&tmp, body.to_string() + "\n")
        .and_then(|()| std::fs::rename(&tmp, path))
        .inspect_err(|_| drop(std::fs::remove_file(&tmp)))
        .map_err(fail)
}

// ─── JavaScript semantics ────────────────────────────────────────────────────

/// `Number(value)` where only a finite positive result counts: trimmed; `""`, garbage and `0` → `None`.
fn positive(value: Option<&str>) -> Option<f64> {
    value?.trim().parse().ok().filter(|v: &f64| v.is_finite() && *v > 0.0)
}

/// `Math.round`: halves go toward +∞, unlike Rust's round-half-away-from-zero.
pub fn js_round(v: f64) -> f64 {
    (v + 0.5).floor()
}

/// JS truthiness over a number: `0` and `NaN` are absent, so `value || d` is `truthy(value).unwrap_or(d)`.
fn truthy(value: Option<f64>) -> Option<f64> {
    value.filter(|v| *v != 0.0 && !v.is_nan())
}

/// `JSON.parse(readFileSync(path))`, `None` on any failure.
fn read_json(path: impl AsRef<Path>) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

// ─── auto-compact threshold ──────────────────────────────────────────────────
//
// Claude Code auto-compacts when total_input_tokens crosses:
//   autoWindow − min(maxOutputTokens, 20_000) − 13_000   (output reserve + compaction reserve)
// so "% until auto-compact" must use that threshold — NOT context_window_size, and NOT a
// hardcoded window (the old 500k guess was ~2× off on models whose auto window is the full 1M).
// The payload exposes neither the auto window nor the threshold, so mirror the CLI's resolution
// precedence (v2.1.198, fn `G3`) from its observable inputs. Every branch is exact except a
// statsig experiment (currently scoped to claude-opus-4-8, unreadable externally) — if the bar
// drifts from the app on that model only, that's why.

/// The CLI keys its window tables by base model id — strip Bedrock/Vertex region and vendor
/// prefixes and version/date suffixes (`us.anthropic.claude-sonnet-5-20250929-v1:0` →
/// `claude-sonnet-5`).
pub fn base_model_id(id: &str) -> String {
    let digits = |d: &str| !d.is_empty() && d.bytes().all(|b| b.is_ascii_digit());
    let lower = id.to_lowercase();
    let s = ["apac.", "eu.", "global.", "us."].into_iter().find_map(|p| lower.strip_prefix(p)).unwrap_or(&lower);
    let mut s = s.strip_prefix("anthropic.").unwrap_or(s);
    // /-v\d+(:\d+)?$/
    if let Some((head, v)) =
        s.rsplit_once(':').filter(|(_, d)| digits(d)).map_or(s, |(rest, _)| rest).rsplit_once("-v")
        && digits(v)
    {
        s = head;
    }
    // /[@-]\d{8}$/ — an 8-digit tail holds neither separator, so the last one is the match.
    if let Some((head, d)) = s.rsplit_once(['@', '-'])
        && d.len() == 8
        && digits(d)
    {
        s = head;
    }
    s.strip_suffix("[1m]").unwrap_or(s).to_string()
}

/// Window-table values are a number or `{surfaces?: {<entrypoint>: entry}, default?}`.
fn surface_value(value: &Value, entrypoint: &str) -> Option<f64> {
    let entry = Some(&value["surfaces"][entrypoint]).filter(|e| !e.is_null()).unwrap_or(value);
    entry.as_f64().or(entry["default"].as_f64())
}

/// The CLI accepts configured windows only as integers within [100k, 1M].
fn valid_window(value: Option<f64>) -> Option<f64> {
    value.filter(|v| v.fract() == 0.0 && *v >= 100_000.0 && *v <= 1_000_000.0)
}

/// Resolve the auto-compact window for `model`, mirroring the CLI's precedence chain.
fn auto_compact_window(
    model: &str,
    window_size: f64,
    project_dir: Option<&str>,
    global_state: &Value,
    env: &Environment,
) -> f64 {
    let entrypoint = env.entrypoint.as_deref().unwrap_or("");
    let settings = [
        Some("/Library/Application Support/ClaudeCode/managed-settings.json".into()),
        project_dir.map(|dir| format!("{dir}/.claude/settings.local.json")),
        project_dir.map(|dir| format!("{dir}/.claude/settings.json")),
        Some(format!("{}/.claude/settings.json", env.home)),
    ];
    let mut slots: Vec<&Value> =
        global_state["clientDataCacheSlots"].as_object().into_iter().flat_map(|slots| slots.values()).collect();
    slots.sort_by(|a, b| b["at"].as_f64().unwrap_or(0.0).total_cmp(&a["at"].as_f64().unwrap_or(0.0)));
    let cache = &global_state["autoCompactWindowsCache"];
    // 1. Env override, inherited from the CLI process; clamped to [100k, 1M].
    positive(env.auto_compact_window.as_deref())
        .map(|configured| js_round(configured).clamp(100_000.0, 1_000_000.0))
        // 2. `autoCompactWindow` in settings (written by /autocompact); highest-precedence file wins.
        .or_else(|| {
            settings.iter().flatten().find_map(|path| valid_window(read_json(path)?["autoCompactWindow"].as_f64()))
        })
        // 3. Server-pushed per-model windows cached in ~/.claude.json (clientdata `rowan_thicket`,
        //    newest slot first, then the bootstrap `auto_compact_windows` → `autoCompactWindowsCache`).
        //    Null for this account today, but this is where new-model windows land without a CLI update.
        .or_else(|| {
            slots
                .into_iter()
                .map(|slot| &slot["data"])
                .chain([&global_state["clientDataCache"]])
                .map(|data| &data["rowan_thicket"][model])
                .chain([&cache[model]])
                .find_map(|table| valid_window(surface_value(table, entrypoint)))
        })
        // (The unobservable statsig experiment slots in here; claude-opus-4-8 only as of v2.1.198.)
        // 4. Per-model defaults baked into the CLI binary (`gfa` / `rTp` in v2.1.198): the 4-6 models
        //    stay at the legacy 200k. A model key present-but-invalid in the bootstrap cache
        //    suppresses the static default (`replacesDefault` in the CLI).
        .or((window_size < 1_000_000.0 && matches!(model, "claude-opus-4-6" | "claude-sonnet-4-6")).then_some(200_000.0))
        .or((model == "claude-sonnet-5" && cache.get(model).is_none())
            .then_some(if matches!(entrypoint, "local-agent" | "remote_cowork") { 500_000.0 } else { 967_000.0 }))
        // 5. No override anywhere → the full context window is the auto window (source "auto").
        .unwrap_or(window_size)
}

/// Tokens at which auto-compact fires: window − output reserve − 13k compaction reserve.
pub fn auto_compact_threshold(data: &StatusInput, env: &Environment) -> f64 {
    let window_size = truthy(data.context_window.as_ref().and_then(|c| c.context_window_size)).unwrap_or(200_000.0);
    let global_state = read_json(format!("{}/.claude.json", env.home)).unwrap_or_default();

    // Auto-compact off (env kill switches or `claude config set autoCompactEnabled false`) → the
    // app shows usage against the full window instead.
    let off = |v: &Option<String>| matches!(v.as_deref(), Some("1" | "true"));
    if off(&env.disable_auto_compact) || off(&env.disable_compact) || global_state["autoCompactEnabled"] == false {
        return window_size;
    }

    let window = window_size.min(auto_compact_window(
        &base_model_id(data.model.id.as_deref().unwrap_or("")),
        window_size,
        data.workspace.as_ref().and_then(|w| w.project_dir.as_deref()).filter(|d| !d.is_empty()),
        &global_state,
        env,
    ));
    let output_reserve = positive(env.max_output_tokens.as_deref()).map_or(20_000.0, |max| max.min(20_000.0));
    (window - output_reserve - 13_000.0).max(1.0)
}

// ─── burn rate ───────────────────────────────────────────────────────────────

/// One `(timestamp, tokens)` observation.
#[derive(Clone, Copy, Debug)]
pub struct Sample {
    /// Milliseconds since the Unix epoch.
    pub at: i64,
    /// `total_input_tokens` at that moment.
    pub tokens: f64,
}

/// Cross-tick token velocity. Each tick is a fresh process, so the samples live in a rolling file
/// per session in tmpdir (`$TMPDIR/claude-statusline-<session_id>.json`; the OS cleans it up, no
/// pruning logic). Samples land at most every 15s, 40 retained ≈ a 10-minute window — long enough
/// to smooth tool-call bursts into a usable rate. The on-disk shape is
/// `{"samples":[{"at":…,"tokens":…}]}`, unchanged from the JavaScript original so an in-flight
/// session's samples carry over.
#[derive(Clone, Debug, Default)]
pub struct Samples {
    /// Whether [`render`] recorded a new sample worth writing back.
    pub dirty: bool,
    /// Oldest first.
    pub samples: Vec<Sample>,
}

impl Samples {
    /// Read `path`, keeping entries whose `at` and `tokens` are both numbers; any failure → empty.
    pub fn load(path: &Path) -> Self {
        let json = read_json(path).unwrap_or_default();
        let entries = json["samples"].as_array().into_iter().flatten();
        let samples = entries.filter_map(|e| Some(Sample { at: e["at"].as_f64()? as i64, tokens: e["tokens"].as_f64()? }));
        Self { dirty: false, samples: samples.collect() }
    }

    /// Best-effort write in the shared on-disk shape, integral values in integer notation; a
    /// failing write never breaks a tick.
    pub fn write(&self, path: &Path) {
        let number = |v: f64| if v.fract() == 0.0 && v.abs() < 9e15 { json!(v as i64) } else { json!(v) };
        let samples: Vec<Value> = self.samples.iter().map(|s| json!({ "at": s.at, "tokens": number(s.tokens) })).collect();
        let _ = std::fs::write(path, json!({ "samples": samples }).to_string());
    }
}

/// Seconds → compact duration (`2h13m`, `40m`).
fn dur(seconds: f64) -> String {
    let hours = (seconds / 3600.0).floor();
    if hours != 0.0 {
        format!("{}h{}m", hours as i64, ((seconds % 3600.0) / 60.0).floor() as i64)
    } else {
        format!("{}m", js_round(seconds / 60.0).max(1.0) as i64)
    }
}

/// Record the current token count and project time-to-auto-compact from the retained trend:
/// `≈40m` once a ≥60s trend exists and the projection lands under 6h.
fn eta_to_compact(tokens: f64, threshold: f64, now_ms: i64, samples: &mut Samples) -> Option<String> {
    if tokens == 0.0 {
        return None;
    }
    // A token drop means /compact or /clear rewound the context — the old trend describes nothing.
    if samples.samples.last().is_some_and(|last| tokens < last.tokens) {
        samples.samples.clear();
    }
    if samples.samples.last().is_none_or(|last| now_ms - last.at >= 15_000) {
        let excess = samples.samples.len().saturating_sub(39);
        samples.samples.drain(..excess);
        samples.samples.push(Sample { at: now_ms, tokens });
        samples.dirty = true;
    }

    let (first, last) = (samples.samples[0], samples.samples[samples.samples.len() - 1]);
    let span = (last.at - first.at) as f64 / 1000.0;
    let rate = (last.tokens - first.tokens) / span;
    let eta = (threshold - tokens) / rate;
    // Under a minute the trend is noise; past the threshold there is nothing to project; an idle
    // session's rate decays toward 0 and the ETA toward nonsense — hide beyond 6h.
    (span >= 60.0 && rate > 0.0 && eta > 0.0 && eta < 6.0 * 3600.0).then(|| format!("≈{}", dur(eta)))
}

// ─── terminal ────────────────────────────────────────────────────────────────

/// Columns of the controlling PTY. Claude Code pipes our stdout, so there is no tty on this
/// process — walk up to the shell that owns the real one and ask `stty` through `sh` ([`sh`] for
/// real, a fake in tests), mirroring ccstatusline. `None` on any failure along the way.
pub fn columns(sh: impl Fn(&[&str]) -> Option<String>) -> Option<usize> {
    let mut pid = std::process::id().to_string();
    for _ in 0..8 {
        let tty = sh(&["ps", "-o", "tty=", "-p", &pid])?;
        if !tty.is_empty() && tty != "??" {
            let flag = if cfg!(target_os = "macos") { "-f" } else { "-F" };
            return sh(&["stty", flag, &format!("/dev/{tty}"), "size"])?.split(' ').nth(1)?.parse().ok().filter(|c| *c != 0);
        }
        pid = sh(&["ps", "-o", "ppid=", "-p", &pid])?;
        if pid.parse::<i64>().unwrap_or(0) <= 1 {
            return None;
        }
    }
    None
}

/// Run `argv`, stderr silenced: its trimmed stdout on success.
pub fn sh(argv: &[&str]) -> Option<String> {
    let output = std::process::Command::new(argv[0]).args(&argv[1..]).stderr(std::process::Stdio::null()).output().ok()?;
    output.status.success().then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

// ─── rendering ───────────────────────────────────────────────────────────────

const BOLD: &str = "\x1b[1m";
const DIM: &str = "\x1b[2m";
const RESET: &str = "\x1b[0m";

/// Claude Code indents the statusline ~2 cols and keeps a right margin, so the printable region is
/// narrower than the PTY width — reserve `MARGIN` or it clips with `…`.
const MARGIN: usize = 4;

/// Muted green → yellow → orange → red as usage climbs (256-color, calm at rest, loud near
/// compact).
fn tone(p: i64) -> String {
    format!("\x1b[38;5;{}m", if p >= 90 { 203 } else if p >= 75 { 208 } else if p >= 50 { 179 } else { 108 })
}

/// ⅛-block resolution (`██▋░░░`) — the partial cell makes slow growth visible between whole cells.
fn bar(p: i64, width: usize) -> String {
    const EIGHTHS: [char; 7] = ['▏', '▎', '▍', '▌', '▋', '▊', '▉'];
    let eighths = js_round(p as f64 / 100.0 * width as f64 * 8.0) as i64;
    let mut filled = "█".repeat((eighths / 8) as usize);
    if let Some(partial) = usize::try_from(eighths % 8 - 1).ok().and_then(|i| EIGHTHS.get(i)) {
        filled.push(*partial);
    }
    let empty = "░".repeat(width.saturating_sub(filled.chars().count()));
    format!("{}{filled}\x1b[38;5;238m{empty}{RESET}", tone(p))
}

/// Unix timestamp → local wall-clock `10:50pm`.
fn clock(epoch: f64) -> String {
    DateTime::from_timestamp_millis((epoch * 1000.0) as i64)
        .map(|at| at.with_timezone(&Local).format("%-I:%M%P").to_string())
        .unwrap_or_default()
}

/// `s` with its ANSI SGR escapes (`ESC … m`) removed: the printed text.
fn plain(s: &str) -> String {
    let mut parts = s.split('\x1b');
    let head = parts.next().unwrap_or_default();
    parts.fold(head.to_string(), |text, part| text + part.split_once('m').map_or("", |(_, rest)| rest))
}

/// Render one tick. Pure but for the settings/global-state files [`auto_compact_threshold`] reads,
/// which `env` redirects: the clock, the terminal width and the sample store are all injected.
pub fn render(
    input: &StatusInput,
    now: DateTime<Local>,
    columns: usize,
    samples: &mut Samples,
    env: &Environment,
) -> String {
    let model = &input.model.display_name;
    // Missing early in session / after /compact → 0.
    let tokens = truthy(input.context_window.as_ref().and_then(|c| c.total_input_tokens)).unwrap_or(0.0);
    let threshold = auto_compact_threshold(input, env);
    let pct = js_round(tokens / threshold * 100.0).clamp(0.0, 100.0) as i64;
    // Each segment is styled once and absent as `""`. Record velocity every tick, but only surface
    // the ETA once the bar is half full.
    let eta = eta_to_compact(tokens, threshold, now.timestamp_millis(), samples)
        .filter(|_| pct >= 50)
        .map_or_else(String::new, |eta| format!("{DIM} {eta}{RESET}"));
    // Session spend so far; hidden until it rounds to a cent.
    let usd = truthy(input.cost.as_ref().and_then(|c| c.total_cost_usd))
        .filter(|cost| *cost >= 0.005)
        // `toFixed(2)`: `{:.2}` also rounds the exact binary value, but ties to even — and an exact
        // tie is an odd multiple of ⅛, which toFixed rounds up. Exact below 2^46 (≈ $7e13), where one
        // ulp stays under a cent (measured 2026-10-14 · node toFixed sweep, 709k values).
        .map(|cost| if (cost * 8.0) % 2.0 == 1.0 { cost.next_up() } else { cost })
        .map_or_else(String::new, |cost| format!("{DIM} · ${cost:.2}{RESET}"));
    let limit = input.rate_limits.as_ref().and_then(|r| r.five_hour.as_ref()).map_or_else(String::new, |five| {
        let used = five.used_percentage.unwrap_or(0.0).floor() as i64;
        let tier = if input.exceeds_200k_tokens == Some(true) { format!("{DIM}†{RESET}") } else { String::new() };
        let reset = truthy(five.resets_at).map_or_else(String::new, |at| format!("{DIM} ↻ {}{RESET}", clock(at)));
        format!("{DIM} · 5h {RESET}{}{used}%{RESET}{tier}{reset}", tone(used))
    });
    // Non-default mode markers next to the model — silent when running plain high-effort.
    let effort = input.effort.as_ref().and_then(|e| e.level.as_deref()).filter(|l| !l.is_empty() && *l != "high");
    let flags: Vec<&str> = input.fast_mode.unwrap_or(false).then_some("fast").into_iter().chain(effort).collect();
    let flags = if flags.is_empty() { String::new() } else { format!(" {DIM}({}){RESET}", flags.join(" · ")) };
    let head = format!("{BOLD}{model}{RESET}{flags} ");
    let tail = format!("{} {pct}%{RESET}{eta}{usd}{limit}", tone(pct));
    // ANSI escapes have zero printed width — the bar gets what the plain head/tail leave.
    let width = columns.saturating_sub(MARGIN + plain(&head).chars().count() + plain(&tail).chars().count());
    format!("{head}{}{tail}", bar(pct, width))
}

// ─── tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// A fixed instant, so nothing in the suite depends on the wall clock.
    fn now() -> DateTime<Local> {
        DateTime::from_timestamp(1_757_000_000, 0).unwrap().with_timezone(&Local)
    }

    /// Base payload: unknown model, half-full-ish 200k window, no cost or rate limits.
    fn payload(extra: Value) -> StatusInput {
        let mut json = json!({
            "context_window": { "context_window_size": 200_000, "total_input_tokens": 50_000 },
            "model": { "display_name": "Fable 5.1", "id": "claude-fable-5-1" },
            "session_id": "s1",
        });
        let (Value::Object(base), Value::Object(extra)) = (&mut json, extra) else { unreachable!() };
        base.extend(extra);
        serde_json::from_value(json).unwrap()
    }

    /// An [`Environment`] rooted at a scratch dir unique to `name`: no settings, no `~/.claude.json`, and
    /// every auto-compact/entrypoint variable cleared, so only the payload drives the render.
    fn scratch(name: &str) -> (PathBuf, Environment) {
        let dir = std::env::temp_dir().join(format!("claude-test-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let env = Environment {
            home: dir.to_string_lossy().into_owned(),
            tmp: dir.to_string_lossy().into_owned(),
            ..Environment::default()
        };
        (dir, env)
    }

    #[test]
    fn base_model_id_strips_vendor_and_version_decoration() {
        assert_eq!(base_model_id("us.anthropic.claude-sonnet-5-20250929-v1:0"), "claude-sonnet-5");
        assert_eq!(base_model_id("claude-opus-4-6@20260514"), "claude-opus-4-6");
        assert_eq!(base_model_id("claude-opus-5[1m]"), "claude-opus-5");
        assert_eq!(base_model_id("Claude-Fable-5-1"), "claude-fable-5-1");
        assert_eq!(base_model_id("claude-sonnet-4-5-v"), "claude-sonnet-4-5-v");
        assert_eq!(base_model_id("o:b-v1"), "o:b");
    }

    #[test]
    fn draws_an_eighth_block_bar_that_fits_its_width() {
        assert_eq!(plain(&bar(50, 8)), "████░░░░");
        assert_eq!(plain(&bar(52, 8)), "████▏░░░");
        assert_eq!(plain(&bar(0, 4)), "░░░░");
        assert_eq!(plain(&bar(100, 4)), "████");
        assert_eq!(plain(&bar(75, 0)), "");
    }

    #[test]
    fn formats_durations_and_wall_clock_times() {
        assert_eq!(dur(2_400.0), "40m");
        assert_eq!(dur(10.0), "1m");
        assert_eq!(dur(7_980.0), "2h13m");
        assert_eq!(clock(1_757_000_000.0), now().format("%-I:%M%P").to_string());
        assert_eq!(clock(f64::MAX), "");
    }

    #[test]
    fn renders_each_segment_only_with_its_data() {
        let (_dir, env) = scratch("segments");
        let line = |extra| plain(&render(&payload(extra), now(), 80, &mut Samples::default(), &env));

        assert!(!line(json!({ "cost": { "total_cost_usd": 0.001 }, "effort": { "level": "high" } })).contains(['$', '(']));
        let out = line(json!({
            "cost": { "total_cost_usd": 1.2 },
            "effort": { "level": "low" },
            "exceeds_200k_tokens": true,
            "fast_mode": true,
            "rate_limits": { "five_hour": { "resets_at": 1_757_018_000, "used_percentage": 31.4 } },
        }));
        assert!(out.starts_with("Fable 5.1 (fast · low) "), "{out}");
        assert!(out.ends_with(&format!(" 30% · $1.20 · 5h 31%† ↻ {}", clock(1_757_018_000.0))), "{out}");
        assert_eq!(out.chars().count(), 80 - MARGIN, "{out}");
        for (cost, usd) in [(0.015, " · $0.01"), (1.125, " · $1.13")] {
            assert!(line(json!({ "cost": { "total_cost_usd": cost } })).ends_with(usd), "{cost}");
        }
    }

    #[test]
    fn projects_the_eta_only_from_a_live_forward_trend() {
        let (_dir, env) = scratch("eta");
        for (prior, tokens, eta) in [
            (10_000.0, 120_000, Some("1m")),
            (150_000.0, 170_000, None),
            (130_000.0, 120_000, None),
            (119_999.0, 120_000, None),
            (10_000.0, 0, None),
            (10_000.0, 60_000, None),
        ] {
            let mut samples =
                Samples { dirty: false, samples: vec![Sample { at: now().timestamp_millis() - 120_000, tokens: prior }] };
            let input = payload(json!({ "context_window": { "context_window_size": 200_000, "total_input_tokens": tokens } }));

            let out = plain(&render(&input, now(), 80, &mut samples, &env));

            assert_eq!(out.split_once('≈').map(|(_, rest)| rest.split(' ').next().unwrap()), eta, "{out}");
            assert_eq!(samples.dirty, tokens != 0, "{out}");
        }
    }

    #[test]
    fn persists_the_five_hour_window() {
        let (dir, env) = scratch("persist");
        let file = dir.join("state/claude/window.json");
        let env = Environment { window_file: Some(file.clone()), ..env };
        let input =
            payload(json!({ "rate_limits": { "five_hour": { "resets_at": 1_757_018_000, "used_percentage": 31.4 } } }));

        persist_window(&input, now().with_timezone(&Utc), &env).unwrap();

        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            concat!(
                r#"{"at":"2025-09-04T15:33:20Z","#,
                r#""five_hour":{"resets_at":1757018000,"used_percentage":31.4},"session_id":"s1"}"#,
                "\n",
            ),
        );
        assert_eq!(std::fs::read_dir(file.parent().unwrap()).unwrap().count(), 1, "temp file left behind");
    }

    #[test]
    fn never_rolls_the_window_back() {
        let (dir, env) = scratch("rollback");
        let file = dir.join("window.json");
        let env = Environment { window_file: Some(file.clone()), ..env };
        let at = now().with_timezone(&Utc);
        let write_five = |five: Value| {
            persist_window(&payload(json!({ "rate_limits": { "five_hour": five } })), at, &env).unwrap();
            std::fs::read_to_string(&file).ok().map(|text| serde_json::from_str::<Value>(&text).unwrap()["five_hour"].clone())
        };
        let write = |resets_at: i64, used: f64| write_five(json!({ "resets_at": resets_at, "used_percentage": used }));

        assert_eq!(write_five(Value::Null), None, "a payload without a window was written");
        assert_eq!(write_five(json!({ "resets_at": null, "used_percentage": null })), None, "a null window was written");
        assert_eq!(write(1_757_000_000, 10.0), None, "a window resetting now was written");
        assert_eq!(write(1_791_773_097_000, 10.0), None, "a millisecond resets_at was written");
        std::fs::write(&file, r#"{"five_hour":{"resets_at":4102444800,"used_percentage":99.0}}"#).unwrap();
        assert_eq!(write(1_757_018_000, 92.0), Some(json!({ "resets_at": 1_757_018_000, "used_percentage": 92.0 })));
        for (resets_at, used) in [(1_757_018_000, 40.0), (1_757_010_000, 99.0)] {
            assert_eq!(write(resets_at, used).unwrap()["used_percentage"], 92.0, "rolled back by {resets_at}/{used}");
        }
        assert_eq!(write(1_757_020_000, 3.0).unwrap()["used_percentage"], 3.0);
    }

    #[test]
    fn keeps_one_sample_per_15s_and_the_newest_40() {
        let (_dir, env) = scratch("samples");
        let mut samples = Samples::default();
        let at = |s: i64| now() + chrono::TimeDelta::seconds(s);

        (0..630).for_each(|s| drop(render(&payload(json!({})), at(s), 80, &mut samples, &env)));

        let kept: Vec<i64> = samples.samples.iter().map(|s| s.at).collect();
        assert_eq!(kept, (2..42).map(|i| at(15 * i).timestamp_millis()).collect::<Vec<_>>());
        // The store round-trips through the shared on-disk shape, integer notation pinned.
        assert_eq!(env.samples_path(Some("")), None);
        let path = env.samples_path(Some("s1")).unwrap();
        samples.write(&path);
        let bytes = std::fs::read_to_string(&path).unwrap();
        Samples::load(&path).write(&path);
        assert!(samples.dirty && bytes == std::fs::read_to_string(&path).unwrap(), "{bytes}");
        assert!(bytes.starts_with(&format!(r#"{{"samples":[{{"at":{},"tokens":50000}}"#, kept[0])), "{bytes}");
    }

    #[test]
    fn resolves_the_auto_compact_threshold() {
        let slot = |at: i64, window: i64| json!({ "at": at, "data": { "rowan_thicket": { "claude-fable-5-1": window } } });
        let fable = "claude-fable-5-1";
        let (dir, env) = scratch("threshold");
        std::fs::create_dir_all(dir.join(".claude")).unwrap();
        for (state, settings, model, size, window, expected) in [
            (json!({}), json!({}), fable, 200_000, " 50000 ", 79_000.0),
            (json!({ "autoCompactEnabled": false }), json!({}), fable, 200_000, "", 200_000.0),
            (json!({}), json!({ "autoCompactWindow": 150_000 }), fable, 200_000, "", 129_000.0),
            (json!({ "clientDataCacheSlots": { "a": slot(1, 120_000), "b": slot(2, 140_000) } }), json!({}), fable, 200_000, "", 119_000.0),
            (
                json!({ "autoCompactWindowsCache": { fable: { "surfaces": { "local-agent": { "default": 130_000 } } } } }),
                json!({}),
                fable,
                200_000,
                "",
                109_000.0,
            ),
            (json!({ "clientDataCache": { "rowan_thicket": { "claude-opus-4-6": 150_000.5 } } }), json!({}), "claude-opus-4-6", 500_000, "", 179_000.0),
            (json!({ "clientDataCache": { "rowan_thicket": { "claude-sonnet-5": 1_000_001 } } }), json!({}), "claude-sonnet-5", 1_000_000, "", 479_000.0),
            (json!({ "autoCompactWindowsCache": { "claude-sonnet-5": 0 } }), json!({}), "claude-sonnet-5", 1_000_000, "", 979_000.0),
        ] {
            std::fs::write(dir.join(".claude.json"), state.to_string()).unwrap();
            std::fs::write(dir.join(".claude/settings.local.json"), settings.to_string()).unwrap();
            let env = Environment {
                auto_compact_window: Some(window.into()),
                entrypoint: Some("local-agent".into()),
                home: env.home.clone(),
                max_output_tokens: Some("8000".into()),
                ..Environment::default()
            };
            let input = payload(json!({
                "context_window": { "context_window_size": size },
                "model": { "display_name": model, "id": model },
                "workspace": { "project_dir": dir },
            }));

            assert_eq!(auto_compact_threshold(&input, &env), expected, "{model} {state}");
        }
    }

    #[test]
    fn tones_shift_at_the_usage_thresholds() {
        assert_eq!(tone(49), "\x1b[38;5;108m");
        assert_eq!(tone(50), "\x1b[38;5;179m");
        assert_eq!(tone(75), "\x1b[38;5;208m");
        assert_eq!(tone(90), "\x1b[38;5;203m");
    }

    #[test]
    fn walks_parent_pids_to_the_tty_width() {
        let walk = |tty: &'static str, ppid: &'static str, size: &'static str| {
            move |argv: &[&str]| match argv {
                ["ps", _, "tty=", _, pid] => Some(if *pid == "7" { tty } else { "??" }.into()),
                ["ps", _, "ppid=", ..] => Some(ppid.into()),
                _ => (argv[2] == "/dev/ttys001").then(|| size.into()),
            }
        };
        assert_eq!(columns(walk("ttys001", "7", "50 120")), Some(120));
        assert_eq!(columns(walk("ttys001", "7", "50 0")), None);
        assert_eq!(columns(walk("??", "1", "")), None);
        assert_eq!(columns(walk("??", "7", "")), None);
        assert_eq!(sh(&["echo", " hi "]).as_deref(), Some("hi"));
        assert_eq!(sh(&["false"]), None);
    }
}
