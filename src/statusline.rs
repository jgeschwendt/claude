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
//!   Appears past 50% usage when a ≥60s trend exists and the projection is <6h.
//! - $cost (dim): session spend so far (`cost.total_cost_usd`), shown once it rounds to ≥ $0.01.
//! - 5h limit: rate-limit usage (own tone), † when requests exceed 200k tokens (the 2×
//!   long-context pricing/rate-limit tier), ↻ reset as local wall-clock time.
//!
//! Layout: stdout is a pipe, so the real PTY width comes from walking parent PIDs to the shell
//! that owns the tty ([`columns`]). Head/tail are measured as plain strings and only then styled —
//! ANSI escapes never count toward width. The bar absorbs whatever columns remain.
//!
//! Window clock: each tick whose payload carries `rate_limits` also persists the five-hour window
//! to [`Environment::window_file`] for out-of-process readers — see [`persist_window`].
//!
//! Debugging: [`crate::log::path`]`("statusline")` receives each tick's payload (overwritten, last
//! tick wins); an error lands there too and the line simply goes blank for that tick.
//!
//! Fidelity note: this is a port of the former `statusline.js`, so JavaScript semantics are
//! reproduced deliberately — `Math.round` halves go toward +∞ ([`js_round`]), `Number(…)` parses
//! loosely ([`js_number`]), `x || default` treats `0`/`NaN`/`""` as absent, and string widths are
//! counted in characters.

use chrono::{DateTime, Local, SecondsFormat, Timelike, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

// ─── payload ─────────────────────────────────────────────────────────────────

/// One render tick's payload, as piped in by the CLI. Unknown fields are ignored; everything the
/// renderer treats as optional is optional here too.
#[derive(Debug, Deserialize)]
pub struct StatusInput {
    /// Context accounting for the session.
    pub context_window: Option<ContextWindow>,
    /// Session spend.
    pub cost: Option<Cost>,
    /// Reasoning-effort selection.
    pub effort: Option<Effort>,
    /// Whether requests crossed into the 2× long-context tier.
    pub exceeds_200k_tokens: Option<bool>,
    /// Whether fast mode is on.
    pub fast_mode: Option<bool>,
    /// The active model. The only required member of the payload.
    pub model: Model,
    /// Rate-limit windows.
    pub rate_limits: Option<RateLimits>,
    /// Session id, used to key the burn-rate sample file.
    pub session_id: Option<String>,
    /// Workspace paths, used to find project settings.
    pub workspace: Option<Workspace>,
}

/// `context_window` member of [`StatusInput`].
#[derive(Debug, Deserialize)]
pub struct ContextWindow {
    /// Hard context-window cap for the model.
    pub context_window_size: Option<f64>,
    /// The app's own numerator: input + cache read + cache creation.
    pub total_input_tokens: Option<f64>,
    /// The app's own percentage; unused here, the bar measures against the auto-compact threshold.
    pub used_percentage: Option<f64>,
}

/// `cost` member of [`StatusInput`].
#[derive(Debug, Deserialize)]
pub struct Cost {
    /// Session spend so far, input and output priced together by the app.
    pub total_cost_usd: Option<f64>,
}

/// `effort` member of [`StatusInput`].
#[derive(Debug, Deserialize)]
pub struct Effort {
    /// `"high"` (the default, never shown), `"medium"`, `"low"`, …
    pub level: Option<String>,
}

/// `five_hour` member of [`RateLimits`].
#[derive(Debug, Deserialize)]
pub struct FiveHour {
    /// Unix timestamp (seconds) at which the window resets.
    pub resets_at: Option<f64>,
    /// Percentage of the window consumed.
    pub used_percentage: Option<f64>,
}

/// `model` member of [`StatusInput`].
#[derive(Debug, Deserialize)]
pub struct Model {
    /// Human-facing name, rendered bold at the head of the line.
    pub display_name: String,
    /// Model id, keyed on to resolve the auto-compact window.
    pub id: Option<String>,
}

/// `rate_limits` member of [`StatusInput`].
#[derive(Debug, Deserialize)]
pub struct RateLimits {
    /// The rolling 5-hour window.
    pub five_hour: Option<FiveHour>,
}

/// `workspace` member of [`StatusInput`].
#[derive(Debug, Deserialize)]
pub struct Workspace {
    /// Project root, whose `.claude/settings*.json` can override the auto-compact window.
    pub project_dir: Option<String>,
}

// ─── environment ─────────────────────────────────────────────────────────────

/// The process environment the renderer reads. Captured up front so [`render`] can be driven from
/// tests against a scratch `HOME`/`TMPDIR` without mutating the real process environment.
#[derive(Clone, Debug, Default)]
pub struct Environment {
    /// `CLAUDE_CODE_AUTO_COMPACT_WINDOW`.
    pub auto_compact_window: Option<String>,
    /// `DISABLE_AUTO_COMPACT`.
    pub disable_auto_compact: Option<String>,
    /// `DISABLE_COMPACT`.
    pub disable_compact: Option<String>,
    /// `CLAUDE_CODE_ENTRYPOINT`, the surface key in the window tables.
    pub entrypoint: Option<String>,
    /// `HOME`, or `""`.
    pub home: String,
    /// `CLAUDE_CODE_MAX_OUTPUT_TOKENS`.
    pub max_output_tokens: Option<String>,
    /// `TMPDIR` without its trailing slash, or `/tmp`.
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
        let tmp = var("TMPDIR").unwrap_or_else(|| "/tmp".into());
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
/// RFC 3339 UTC, `resets_at` unix seconds). A payload without `rate_limits`, or whose
/// `five_hour` fields are null or absent, writes nothing, so a stale file is never clobbered
/// with nulls — readers (`sandman shift clock`) fault on a null `resets_at`. Monotone: a window
/// already past, or one behind the file's (an earlier `resets_at`, or less used of the same one),
/// writes nothing, so an idle session re-rendering stale limits never rolls the clock back. Atomic: a sibling temp file renamed into place.
/// `Err` carries a one-line reason; the caller logs it and the tick carries on.
pub fn persist_window(input: &StatusInput, now: DateTime<Utc>, env: &Environment) -> Result<(), String> {
    let (Some(path), Some(limits)) = (&env.window_file, &input.rate_limits) else {
        return Ok(());
    };
    let five = limits.five_hour.as_ref();
    let (Some(resets_at), Some(used)) = (
        five.and_then(|f| f.resets_at).filter(|v| v.is_finite()).map(|v| v as i64),
        five.and_then(|f| f.used_percentage).filter(|v| v.is_finite()),
    ) else {
        return Ok(());
    };
    let prior = std::fs::read_to_string(path).ok().and_then(|text| serde_json::from_str::<Value>(&text).ok());
    let prior = prior.as_ref().and_then(|v| {
        Some((v.pointer("/five_hour/resets_at")?.as_i64()?, v.pointer("/five_hour/used_percentage")?.as_f64()?))
    });
    if resets_at <= now.timestamp() || prior.is_some_and(|prior| prior > (resets_at, used)) {
        return Ok(());
    }
    let body = json!({
        "at": now.to_rfc3339_opts(SecondsFormat::Secs, true),
        "five_hour": { "resets_at": resets_at, "used_percentage": used },
        "session_id": input.session_id,
    });
    let fail = |e: std::io::Error| format!("window: {}: {e}", path.display());
    let dir = path.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir).map_err(fail)?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = dir.join(format!(".{name}.{}.tmp", std::process::id()));
    std::fs::write(&tmp, body.to_string() + "\n").and_then(|()| std::fs::rename(&tmp, path)).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        fail(e)
    })
}

// ─── JavaScript semantics ────────────────────────────────────────────────────

/// `Math.min(hi, Math.max(lo, v))`.
fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    hi.min(lo.max(v))
}

/// `Number(value)` for the subset that matters: trims, empty is `0`, garbage is `NaN`.
pub fn js_number(value: Option<&str>) -> f64 {
    match value {
        None => f64::NAN,
        Some(s) => {
            let s = s.trim();
            if s.is_empty() {
                0.0
            } else {
                s.parse::<f64>().unwrap_or(f64::NAN)
            }
        }
    }
}

/// `Math.round`: halves go toward +∞, unlike Rust's round-half-away-from-zero.
pub fn js_round(v: f64) -> f64 {
    (v + 0.5).floor()
}

/// `Number.prototype.toFixed(2)` for the non-negative values a cost can take.
fn js_to_fixed_2(v: f64) -> String {
    let cents = js_round(v * 100.0) as i64;
    format!("{}.{:02}", cents / 100, cents % 100)
}

/// `value || fallback` over a number: `0` and `NaN` are absent.
fn or_default(value: Option<f64>, fallback: f64) -> f64 {
    match value {
        Some(v) if v != 0.0 && !v.is_nan() => v,
        _ => fallback,
    }
}

/// `JSON.parse(readFileSync(path))`, `None` on any failure.
fn read_json(path: &str) -> Option<Value> {
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

/// Models whose baked-in window stays at the legacy 200k.
const LEGACY_200K_MODELS: [&str; 2] = ["claude-opus-4-6", "claude-sonnet-4-6"];

/// Per-model defaults baked into the CLI binary (`gfa` / `rTp` in v2.1.198).
fn default_windows() -> Value {
    json!({
        "claude-sonnet-5": {
            "default": 967_000,
            "surfaces": { "local-agent": 500_000, "remote_cowork": 500_000 },
        },
    })
}

/// The CLI keys its window tables by base model id — strip Bedrock/Vertex region and vendor
/// prefixes and version/date suffixes (`us.anthropic.claude-sonnet-5-20250929-v1:0` →
/// `claude-sonnet-5`).
pub fn base_model_id(id: &str) -> String {
    let lower = id.to_lowercase();
    let mut s = lower.as_str();
    for prefix in ["apac.", "eu.", "global.", "us."] {
        if let Some(rest) = s.strip_prefix(prefix) {
            s = rest;
            break;
        }
    }
    s = s.strip_prefix("anthropic.").unwrap_or(s);
    s = strip_version_suffix(s);
    s = strip_date_suffix(s);
    s = s.strip_suffix("[1m]").unwrap_or(s);
    s.to_string()
}

/// `/[@-]\d{8}$/`
fn strip_date_suffix(s: &str) -> &str {
    let cut = match s.len().checked_sub(9) {
        Some(cut) if s.is_char_boundary(cut) => cut,
        _ => return s,
    };
    let tail = &s[cut..];
    let lead = tail.as_bytes()[0];
    if (lead == b'@' || lead == b'-') && tail[1..].bytes().all(|b| b.is_ascii_digit()) {
        &s[..cut]
    } else {
        s
    }
}

/// `/-v\d+(:\d+)?$/`
fn strip_version_suffix(s: &str) -> &str {
    let mut rest = s;
    if let Some(colon) = rest.rfind(':') {
        let digits = &rest[colon + 1..];
        if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
            return s;
        }
        rest = &rest[..colon];
    }
    match rest.rfind("-v") {
        Some(cut) if !rest[cut + 2..].is_empty() && rest[cut + 2..].bytes().all(|b| b.is_ascii_digit()) => &s[..cut],
        _ => s,
    }
}

/// Window-table values are a number or `{surfaces?: {<entrypoint>: entry}, default?}`.
fn surface_value(value: Option<&Value>, entrypoint: &str) -> Option<f64> {
    let value = value?;
    if value.is_number() {
        return value.as_f64();
    }
    let object = value.as_object()?;
    let entry = object
        .get("surfaces")
        .and_then(Value::as_object)
        .and_then(|surfaces| surfaces.get(entrypoint))
        .filter(|entry| !entry.is_null())
        .unwrap_or(value);
    if entry.is_number() {
        return entry.as_f64();
    }
    entry.get("default").filter(|v| v.is_number()).and_then(Value::as_f64)
}

/// The CLI accepts configured windows only within [100k, 1M].
fn valid_window(value: Option<f64>) -> Option<f64> {
    value.filter(|v| v.is_finite() && v.fract() == 0.0 && *v >= 100_000.0 && *v <= 1_000_000.0)
}

/// Resolve the auto-compact window for `model`, mirroring the CLI's precedence chain.
fn auto_compact_window(
    model: &str,
    window_size: f64,
    project_dir: Option<&str>,
    global_state: &Value,
    env: &Environment,
) -> f64 {
    // 1. Env override, inherited from the CLI process; clamped to [100k, 1M].
    let configured = js_number(env.auto_compact_window.as_deref());
    if configured.is_finite() && configured > 0.0 {
        return clamp(js_round(configured), 100_000.0, 1_000_000.0);
    }

    // 2. `autoCompactWindow` in settings (written by /autocompact); highest-precedence file wins.
    let mut paths = vec!["/Library/Application Support/ClaudeCode/managed-settings.json".to_string()];
    if let Some(dir) = project_dir {
        paths.push(format!("{dir}/.claude/settings.local.json"));
        paths.push(format!("{dir}/.claude/settings.json"));
    }
    paths.push(format!("{}/.claude/settings.json", env.home));
    for path in &paths {
        let window = valid_window(
            read_json(path)
                .as_ref()
                .and_then(|json| json.get("autoCompactWindow"))
                .filter(|v| v.is_number())
                .and_then(Value::as_f64),
        );
        if let Some(window) = window {
            return window;
        }
    }

    // 3. Server-pushed per-model windows cached in ~/.claude.json (clientdata `rowan_thicket`,
    //    then the bootstrap `auto_compact_windows` → `autoCompactWindowsCache`). Null for this
    //    account today, but this is where new-model windows land without a CLI update.
    let entrypoint = env.entrypoint.as_deref().unwrap_or("");
    let mut slots: Vec<&Value> = global_state
        .get("clientDataCacheSlots")
        .and_then(Value::as_object)
        .map(|slots| slots.values().collect())
        .unwrap_or_default();
    slots.sort_by(|a, b| {
        let at = |v: &Value| v.get("at").and_then(Value::as_f64).unwrap_or(0.0);
        at(b).total_cmp(&at(a))
    });
    let sources = slots
        .into_iter()
        .map(|slot| slot.get("data"))
        .chain(std::iter::once(global_state.get("clientDataCache")));
    for data in sources {
        let window = valid_window(surface_value(
            data.and_then(|data| data.get("rowan_thicket")).and_then(|table| table.get(model)),
            entrypoint,
        ));
        if let Some(window) = window {
            return window;
        }
    }
    let empty = Value::Object(serde_json::Map::new());
    let cache = global_state.get("autoCompactWindowsCache").unwrap_or(&empty);
    if let Some(cached) = valid_window(surface_value(cache.get(model), entrypoint)) {
        return cached;
    }

    // (The unobservable statsig experiment slots in here; claude-opus-4-8 only as of v2.1.198.)

    // 4. Baked-in model defaults. A model key present-but-invalid in the bootstrap cache
    //    suppresses the static default (`replacesDefault` in the CLI).
    if window_size < 1_000_000.0 && LEGACY_200K_MODELS.contains(&model) {
        return 200_000.0;
    }
    if cache.get(model).is_none()
        && let Some(fallback) = valid_window(surface_value(default_windows().get(model), entrypoint))
    {
        return fallback;
    }

    // 5. No override anywhere → the full context window is the auto window (source "auto").
    window_size
}

/// Tokens at which auto-compact fires: window − output reserve − 13k compaction reserve.
pub fn auto_compact_threshold(data: &StatusInput, env: &Environment) -> f64 {
    let window_size = or_default(
        data.context_window.as_ref().and_then(|c| c.context_window_size),
        200_000.0,
    );
    let global_state = read_json(&format!("{}/.claude.json", env.home)).unwrap_or_else(|| json!({}));

    // Auto-compact off (env kill switches or `claude config set autoCompactEnabled false`) → the
    // app shows usage against the full window instead.
    let off = |v: &Option<String>| matches!(v.as_deref(), Some("1") | Some("true"));
    if off(&env.disable_auto_compact)
        || off(&env.disable_compact)
        || global_state.get("autoCompactEnabled") == Some(&Value::Bool(false))
    {
        return window_size;
    }

    let window = window_size.min(auto_compact_window(
        &base_model_id(data.model.id.as_deref().unwrap_or("")),
        window_size,
        data.workspace.as_ref().and_then(|w| w.project_dir.as_deref()),
        &global_state,
        env,
    ));
    let max_out = js_number(env.max_output_tokens.as_deref());
    let output_reserve = if max_out.is_finite() && max_out > 0.0 { max_out.min(20_000.0) } else { 20_000.0 };
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
    /// Whether [`render`] touched the samples and they are worth writing back.
    pub dirty: bool,
    /// Oldest first.
    pub samples: Vec<Sample>,
}

impl Samples {
    /// Read `path`, keeping entries whose `at` and `tokens` are both numbers. Any failure — no
    /// file, malformed JSON, wrong shape — yields an empty set.
    pub fn load(path: &Path) -> Self {
        let samples = read_json(&path.to_string_lossy())
            .as_ref()
            .and_then(|json| json.get("samples"))
            .and_then(Value::as_array)
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(|entry| {
                        let number = |key| entry.get(key).filter(|v: &&Value| v.is_number()).and_then(Value::as_f64);
                        Some(Sample { at: number("at")? as i64, tokens: number("tokens")? })
                    })
                    .collect()
            })
            .unwrap_or_default();
        Self { dirty: false, samples }
    }

    /// Serialize to the shared on-disk shape. Integral values keep integer notation.
    pub fn to_json(&self) -> String {
        let number = |v: f64| {
            if v.is_finite() && v.fract() == 0.0 && v.abs() < 9e15 { json!(v as i64) } else { json!(v) }
        };
        let samples: Vec<Value> =
            self.samples.iter().map(|s| json!({ "at": s.at, "tokens": number(s.tokens) })).collect();
        json!({ "samples": samples }).to_string()
    }

    /// Best-effort write; a failing write never breaks a tick.
    pub fn write(&self, path: &Path) {
        let _ = std::fs::write(path, self.to_json());
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
/// `≈40m` once a ≥60s trend exists and the projection lands under 6h, else `""`.
fn eta_to_compact(
    session_id: Option<&str>,
    tokens: f64,
    threshold: f64,
    now_ms: i64,
    samples: &mut Samples,
) -> String {
    if session_id.is_none_or(str::is_empty) || tokens == 0.0 {
        return String::new();
    }
    // A token drop means /compact or /clear rewound the context — the old trend describes nothing.
    if samples.samples.last().is_some_and(|last| tokens < last.tokens) {
        samples.samples.clear();
    }
    if samples.samples.last().is_none_or(|last| now_ms - last.at >= 15_000) {
        let excess = samples.samples.len().saturating_sub(39);
        samples.samples.drain(..excess);
        samples.samples.push(Sample { at: now_ms, tokens });
    }
    samples.dirty = true;

    let (first, last) = (samples.samples[0], samples.samples[samples.samples.len() - 1]);
    let span = (last.at - first.at) as f64 / 1000.0;
    if span < 60.0 {
        return String::new();
    }
    let rate = (last.tokens - first.tokens) / span;
    if rate <= 0.0 {
        return String::new();
    }
    let eta = (threshold - tokens) / rate;
    // Past the threshold there is nothing to project; an idle session's rate decays toward 0 and
    // the ETA toward nonsense — hide beyond 6h.
    if eta > 0.0 && eta < 6.0 * 3600.0 { format!("≈{}", dur(eta)) } else { String::new() }
}

// ─── terminal ────────────────────────────────────────────────────────────────

/// Columns of the controlling PTY. Claude Code pipes our stdout, so there is no tty on this
/// process — walk up to the shell that owns the real one and ask `stty`, mirroring ccstatusline.
/// Any failure along the way falls back.
pub fn columns(fallback: usize) -> usize {
    fn sh(argv: &[&str]) -> Option<String> {
        let output = std::process::Command::new(argv[0])
            .args(&argv[1..])
            .stderr(std::process::Stdio::null())
            .output()
            .ok()?;
        output.status.success().then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
    let flag = if cfg!(target_os = "macos") { "-f" } else { "-F" };
    let mut pid = std::process::id() as i64;
    for _ in 0..8 {
        if pid <= 1 {
            break;
        }
        let Some(tty) = sh(&["ps", "-o", "tty=", "-p", &pid.to_string()]) else { return fallback };
        if !tty.is_empty() && tty != "??" {
            let Some(size) = sh(&["stty", flag, &format!("/dev/{tty}"), "size"]) else { return fallback };
            return size
                .split(' ')
                .nth(1)
                .and_then(|cols| cols.parse::<usize>().ok())
                .filter(|cols| *cols != 0)
                .unwrap_or(fallback);
        }
        let Some(ppid) = sh(&["ps", "-o", "ppid=", "-p", &pid.to_string()]) else { return fallback };
        pid = ppid.parse().unwrap_or(0);
    }
    fallback
}

// ─── rendering ───────────────────────────────────────────────────────────────

const BOLD: &str = "\x1b[1m";
const DIM: &str = "\x1b[2m";
const RESET: &str = "\x1b[0m";

/// Claude Code indents the statusline ~2 cols and keeps a right margin, so the printable region is
/// narrower than the PTY width — reserve `MARGIN` or it clips with `…`.
const MARGIN: usize = 4;

fn fg(n: u8) -> String {
    format!("\x1b[38;5;{n}m")
}

/// Muted green → yellow → orange → red as usage climbs (256-color, calm at rest, loud near
/// compact).
fn tone(p: i64) -> String {
    fg(if p >= 90 { 203 } else if p >= 75 { 208 } else if p >= 50 { 179 } else { 108 })
}

/// ⅛-block resolution (`██▋░░░`) — the partial cell makes slow growth visible between whole cells.
fn bar(p: i64, width: usize) -> String {
    const EIGHTHS: [char; 7] = ['▏', '▎', '▍', '▌', '▋', '▊', '▉'];
    let eighths = js_round(p as f64 / 100.0 * width as f64 * 8.0) as i64;
    let mut filled = "█".repeat((eighths / 8).max(0) as usize);
    if let Some(partial) = usize::try_from(eighths % 8 - 1).ok().and_then(|i| EIGHTHS.get(i)) {
        filled.push(*partial);
    }
    let empty = "░".repeat(width.saturating_sub(filled.chars().count()));
    format!("{}{filled}{}{empty}{RESET}", tone(p), fg(238))
}

/// Unix timestamp → local wall-clock `10:50pm`.
fn clock(epoch: f64, now: &DateTime<Local>) -> String {
    let Some(at) = DateTime::from_timestamp_millis((epoch * 1000.0) as i64) else {
        return String::new();
    };
    let at = at.with_timezone(&now.timezone());
    let hour = at.hour();
    let hour12 = if hour % 12 == 0 { 12 } else { hour % 12 };
    format!("{hour12}:{:02}{}", at.minute(), if hour < 12 { "am" } else { "pm" })
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
    // total_input_tokens is the app's own numerator (input + cache_read + cache_creation).
    // Missing early in session / after /compact → 0.
    let tokens = or_default(input.context_window.as_ref().and_then(|c| c.total_input_tokens), 0.0);
    let threshold = auto_compact_threshold(input, env);
    let pct = clamp(js_round(tokens / threshold * 100.0), 0.0, 100.0) as i64;
    // Record velocity every tick, but only surface the ETA once the bar is half full.
    let trend = eta_to_compact(input.session_id.as_deref(), tokens, threshold, now.timestamp_millis(), samples);
    let eta = if pct >= 50 { trend } else { String::new() };
    // Session spend so far; hidden until it rounds to a cent.
    let cost = or_default(input.cost.as_ref().and_then(|c| c.total_cost_usd), 0.0);
    let usd = if cost >= 0.005 { format!("${}", js_to_fixed_2(cost)) } else { String::new() };
    let five = input.rate_limits.as_ref().and_then(|r| r.five_hour.as_ref());
    let five_pct = five.and_then(|f| f.used_percentage).unwrap_or(0.0).floor() as i64;
    let resets_at = five.and_then(|f| f.resets_at).filter(|v| *v != 0.0 && !v.is_nan());
    // `exceeds_200k_tokens` flips when requests cross into the 2× long-context pricing tier —
    // the dagger explains sudden rate-limit burn.
    let tier = if input.exceeds_200k_tokens.unwrap_or(false) { "†" } else { "" };

    // Non-default mode markers next to the model — silent when running plain high-effort.
    let effort = input.effort.as_ref().and_then(|e| e.level.as_deref()).filter(|l| !l.is_empty());
    let flags: Vec<&str> = input
        .fast_mode
        .unwrap_or(false)
        .then_some("fast")
        .into_iter()
        .chain(effort.filter(|level| *level != "high"))
        .collect();
    let flags = flags.join(" · ");

    // Plain (unstyled) head/tail measure the layout — ANSI escapes have zero printed width, so
    // sizing must run on the bare strings, styling on the assembled output.
    let head = format!("{model}{} ", if flags.is_empty() { String::new() } else { format!(" ({flags})") });
    let tail = format!(
        " {pct}%{}{}{}{}",
        if eta.is_empty() { String::new() } else { format!(" {eta}") },
        if usd.is_empty() { String::new() } else { format!(" · {usd}") },
        if five.is_some() { format!(" · 5h {five_pct}%{tier}") } else { String::new() },
        match resets_at {
            Some(at) => format!(" ↻ {}", clock(at, &now)),
            None => String::new(),
        },
    );
    let width = columns
        .saturating_sub(MARGIN)
        .saturating_sub(head.chars().count())
        .saturating_sub(tail.chars().count());

    let flags = if flags.is_empty() { String::new() } else { format!(" {DIM}({flags}){RESET}") };
    let eta = if eta.is_empty() { String::new() } else { format!("{DIM} {eta}{RESET}") };
    let usd = if usd.is_empty() { String::new() } else { format!("{DIM} · {usd}{RESET}") };
    let limit = match five {
        Some(_) => format!(
            "{DIM} · 5h {RESET}{}{five_pct}%{RESET}{}",
            tone(five_pct),
            if tier.is_empty() { String::new() } else { format!("{DIM}†{RESET}") },
        ),
        None => String::new(),
    };
    let reset = match resets_at {
        Some(at) => format!("{DIM} ↻ {}{RESET}", clock(at, &now)),
        None => String::new(),
    };
    let (bar, tone) = (bar(pct, width), tone(pct));
    format!("{BOLD}{model}{RESET}{flags} {bar}{tone} {pct}%{RESET}{eta}{usd}{limit}{reset}")
}

// ─── tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Unknown model + a 200k window resolves to the "auto" branch of [`auto_compact_window`], so
    /// the threshold is 200_000 − 20_000 output reserve − 13_000 compaction reserve.
    const THRESHOLD: f64 = 167_000.0;

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

    /// An [`Environment`] rooted at a fresh scratch dir: no settings, no `~/.claude.json`, and
    /// every auto-compact/entrypoint variable cleared, so only the payload drives the render.
    fn scratch() -> (PathBuf, Environment) {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "claude-test-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let env = Environment {
            home: dir.to_string_lossy().into_owned(),
            tmp: dir.to_string_lossy().into_owned(),
            ..Environment::default()
        };
        (dir, env)
    }

    /// ANSI escapes carry no printed width — strip them before asserting on text.
    fn strip_ansi(out: &str) -> String {
        let mut plain = String::new();
        let mut chars = out.chars();
        while let Some(c) = chars.next() {
            if c == '\x1b' {
                for c in chars.by_ref() {
                    if c == 'm' {
                        break;
                    }
                }
            } else {
                plain.push(c);
            }
        }
        plain
    }

    /// The rendered percentage.
    fn pct(out: &str) -> i64 {
        let plain = strip_ansi(out);
        let (head, _) = plain.split_once('%').unwrap();
        head.rsplit(' ').next().unwrap().parse().unwrap()
    }

    #[test]
    fn base_model_id_strips_vendor_and_version_decoration() {
        assert_eq!(base_model_id("us.anthropic.claude-sonnet-5-20250929-v1:0"), "claude-sonnet-5");
        assert_eq!(base_model_id("claude-opus-4-6@20260514"), "claude-opus-4-6");
        assert_eq!(base_model_id("claude-opus-5[1m]"), "claude-opus-5");
        assert_eq!(base_model_id("Claude-Fable-5-1"), "claude-fable-5-1");
        assert_eq!(base_model_id("claude-sonnet-4-5-v"), "claude-sonnet-4-5-v");
    }

    #[test]
    fn draws_an_eighth_block_bar_that_fits_its_width() {
        assert_eq!(strip_ansi(&bar(50, 8)), "████░░░░");
        assert_eq!(strip_ansi(&bar(52, 8)), "████▏░░░");
        assert_eq!(strip_ansi(&bar(0, 4)), "░░░░");
        assert_eq!(strip_ansi(&bar(100, 4)), "████");
        assert_eq!(strip_ansi(&bar(75, 0)), "");
    }

    #[test]
    fn formats_durations_and_wall_clock_times() {
        assert_eq!(dur(2_400.0), "40m");
        assert_eq!(dur(10.0), "1m");
        assert_eq!(dur(7_980.0), "2h13m");
        let midnight = DateTime::from_timestamp(1_757_000_000, 0).unwrap().with_timezone(&Local);
        let stamp = clock(1_757_000_000.0, &midnight);
        assert!(stamp.ends_with("am") || stamp.ends_with("pm"), "{stamp}");
        assert_eq!(stamp, format!("{}:{:02}{}", {
            let h = midnight.hour() % 12;
            if h == 0 { 12 } else { h }
        }, midnight.minute(), if midnight.hour() < 12 { "am" } else { "pm" }));
    }

    #[test]
    fn hides_the_cost_segment_below_a_cent() {
        let (_dir, env) = scratch();

        let out = render(&payload(json!({ "cost": { "total_cost_usd": 0.001 } })), now(), 80, &mut Samples::default(), &env);

        assert!(!out.contains('$'), "{out}");
    }

    #[test]
    fn hides_the_eta_without_prior_samples() {
        let (_dir, env) = scratch();
        let input = payload(json!({
            "context_window": { "context_window_size": 200_000, "total_input_tokens": 120_000 },
            "session_id": "s2",
        }));

        let out = render(&input, now(), 80, &mut Samples::default(), &env);

        assert!(!out.contains('≈'), "{out}");
    }

    #[test]
    fn persists_the_five_hour_window() {
        let (dir, env) = scratch();
        let file = dir.join("state/claude/window.json");
        let env = Environment { window_file: Some(file.clone()), ..env };
        let input =
            payload(json!({ "rate_limits": { "five_hour": { "resets_at": 1_757_018_000, "used_percentage": 31.4 } } }));

        render(&input, now(), 80, &mut Samples::default(), &env);
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
        let (dir, env) = scratch();
        let file = dir.join("window.json");
        let env = Environment { window_file: Some(file.clone()), ..env };
        let at = now().with_timezone(&Utc);
        let write = |resets_at: i64, used: f64| {
            let input = payload(json!({ "rate_limits": { "five_hour": { "resets_at": resets_at, "used_percentage": used } } }));
            persist_window(&input, at, &env).unwrap();
            std::fs::read_to_string(&file).ok().map(|text| serde_json::from_str::<Value>(&text).unwrap()["five_hour"].clone())
        };

        assert_eq!(write(1_756_999_000, 10.0), None, "a window already past was written");
        assert_eq!(write(1_757_018_000, 92.0), Some(json!({ "resets_at": 1_757_018_000, "used_percentage": 92.0 })));
        for (resets_at, used) in [(1_757_018_000, 40.0), (1_757_010_000, 99.0)] {
            assert_eq!(write(resets_at, used).unwrap()["used_percentage"], 92.0, "rolled back by {resets_at}/{used}");
        }
        assert_eq!(write(1_757_036_000, 3.0).unwrap()["used_percentage"], 3.0);
    }

    #[test]
    fn hides_the_eta_past_the_threshold() {
        let (_dir, env) = scratch();
        let mut samples =
            Samples { dirty: false, samples: vec![Sample { at: now().timestamp_millis() - 120_000, tokens: 150_000.0 }] };
        let input = payload(json!({ "context_window": { "context_window_size": 200_000, "total_input_tokens": 170_000 } }));

        let out = render(&input, now(), 80, &mut samples, &env);

        assert!(!out.contains('≈'), "{out}");
    }

    #[test]
    fn rejects_malformed_input() {
        assert!(serde_json::from_str::<StatusInput>("not json").is_err());
        assert!(serde_json::from_str::<StatusInput>("{}").is_err());
    }

    #[test]
    fn renders_the_5h_rate_limit_segment() {
        let (_dir, env) = scratch();
        let input = payload(json!({ "rate_limits": { "five_hour": { "used_percentage": 31.4 } } }));

        let out = render(&input, now(), 80, &mut Samples::default(), &env);

        assert!(strip_ansi(&out).contains("· 5h 31%"), "{out}");
    }

    #[test]
    fn renders_the_cost_segment() {
        let (_dir, env) = scratch();

        let out = render(&payload(json!({ "cost": { "total_cost_usd": 1.2 } })), now(), 80, &mut Samples::default(), &env);

        assert!(strip_ansi(&out).contains("$1.20"), "{out}");
    }

    #[test]
    fn renders_the_eta_from_seeded_samples() {
        let (_dir, env) = scratch();
        // A 110k-token climb over the last 2 minutes projects well under the 6h cutoff.
        let mut samples = Samples {
            dirty: false,
            samples: vec![Sample { at: now().timestamp_millis() - 120_000, tokens: 10_000.0 }],
        };
        let input = payload(json!({
            "context_window": { "context_window_size": 200_000, "total_input_tokens": 120_000 },
            "session_id": "s2",
        }));

        let out = strip_ansi(&render(&input, now(), 80, &mut samples, &env));

        let eta = out.split('≈').nth(1).unwrap_or_default().split(' ').next().unwrap_or_default();
        assert!(eta.ends_with('m') && eta.chars().any(|c| c.is_ascii_digit()), "{out}");
    }

    #[test]
    fn renders_the_model_and_context_percentage() {
        let (dir, env) = scratch();
        let mut samples = Samples::default();

        let out = render(&payload(json!({})), now(), 80, &mut samples, &env);

        let plain = strip_ansi(&out);
        assert_eq!(plain.lines().count(), 1, "{plain}");
        assert!(plain.starts_with("Fable 5.1 "), "{plain}");
        assert_eq!(pct(&out), js_round(50_000.0 / THRESHOLD * 100.0) as i64);

        // The sample store round-trips through the shared on-disk shape.
        let path = env.samples_path(Some("s1")).unwrap();
        assert!(path.starts_with(&dir));
        samples.write(&path);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), r#"{"samples":[{"at":1757000000000,"tokens":50000}]}"#);
        let reloaded = Samples::load(&path);
        assert_eq!(reloaded.samples.len(), 1);
        assert_eq!(reloaded.samples[0].tokens, 50_000.0);
    }

    #[test]
    fn respects_claude_code_auto_compact_window() {
        let (_dir, env) = scratch();
        let narrowed = Environment { auto_compact_window: Some("100000".into()), ..env.clone() };

        let base = render(&payload(json!({})), now(), 80, &mut Samples::default(), &env);
        let out = render(&payload(json!({})), now(), 80, &mut Samples::default(), &narrowed);

        assert!(pct(&out) > pct(&base), "{out}");
        assert_eq!(pct(&out), js_round(50_000.0 / (100_000.0 - 20_000.0 - 13_000.0) * 100.0) as i64);
    }

    #[test]
    fn skips_the_window_write_without_a_whole_window() {
        let (dir, env) = scratch();
        let file = dir.join("window.json");
        std::fs::write(&file, "stale").unwrap();
        let env = Environment { window_file: Some(file.clone()), ..env };
        for input in [
            payload(json!({})),
            payload(json!({ "rate_limits": { "five_hour": null } })),
            payload(json!({ "rate_limits": { "five_hour": { "resets_at": null, "used_percentage": null } } })),
        ] {
            render(&input, now(), 80, &mut Samples::default(), &env);
            persist_window(&input, now().with_timezone(&Utc), &env).unwrap();
        }

        assert_eq!(std::fs::read_to_string(&file).unwrap(), "stale");
    }

    #[test]
    fn throttles_samples_within_the_same_second() {
        let (_dir, env) = scratch();
        let mut samples = Samples::default();

        render(&payload(json!({})), now(), 80, &mut samples, &env);
        render(&payload(json!({})), now(), 80, &mut samples, &env);

        assert_eq!(samples.samples.len(), 1);
    }

    #[test]
    fn tones_shift_at_the_usage_thresholds() {
        assert_eq!(tone(49), fg(108));
        assert_eq!(tone(50), fg(179));
        assert_eq!(tone(75), fg(208));
        assert_eq!(tone(90), fg(203));
    }
}
