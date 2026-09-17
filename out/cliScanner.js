"use strict";
/**
 * cliScanner.ts — Scan standalone GitHub Copilot CLI (`@github/copilot`) sessions.
 *
 * Background (empirically validated against ~/.copilot/ on 2026-06-23, see
 * [tests/diagnose-copilot-cli.mjs](../tests/diagnose-copilot-cli.mjs)):
 *
 *   Session layout (per `COPILOT_HOME ?? ~/.copilot/session-state/`):
 *     • New format (CLI ≥ v0.0.342, Oct 2025): `<uuid>/events.jsonl`
 *     • Legacy flat:                            `<uuid>.jsonl`
 *
 *   Each `events.jsonl` is a chronological log of typed events. The ones we
 *   care about for billing:
 *
 *     • session.start / session.resume       → data.selectedModel (UI hint)
 *     • session.model_change                 → data.newModel       (UI hint)
 *     • user.message                         → data.content        (skip slash commands)
 *     • assistant.message                    → data.model + data.outputTokens   (TRUTH for attribution)
 *     • session.shutdown                     → data.modelMetrics.{model}.totalNanoAiu    (TRUTH for AIC)
 *                                            → data.totalNanoAiu as session-level fallback
 *                                            → data.modelMetrics.{model}.requests.cost as legacy fallback
 *                                            + data.modelMetrics.{model}.usage.{inputTokens, outputTokens,
 *                                                  cacheReadTokens, cacheWriteTokens, reasoningTokens}
 *
 *   Three findings from the diagnostic drive the design here:
 *
 *     1. session.shutdown alone is INSUFFICIENT. In a sampled 8-session run,
 *        4 sessions had no shutdown event at all (crash, Ctrl-C, still-open).
 *        Ledger-only would have lost 41% of true AIC. We always compute a
 *        LIVE estimate (prompts × multiplier) and only override with the
 *        ledger value when present.
 *        When shutdown is present, `totalNanoAiu` is the actual API-billed
 *        amount; `requests.cost` is a coarse request/premium-request counter
 *        and is only kept as a compatibility fallback for older CLI logs.
 *
 *     2. `selectedModel` ≠ actual billed model. Two sampled sessions
 *        displayed `claude-haiku-4-5` to the user but the ledger shows
 *        `claude-sonnet-4.6` was actually billed (silent fallback / routing).
 *        We attribute via the most-recent `assistant.message.data.model`
 *        when available, and fall back to `selectedModel` only before the
 *        first response of a turn lands.
 *
 *     3. Slash commands (`/usage`, `/chronicle`, …) emit `user.message`
 *        events but are NOT billable. We filter on a strict regex that
 *        rejects filesystem paths (`/usr/...`) and matches only single-
 *        token commands.
 *
 *   What we deliberately do NOT do:
 *
 *     • Read `~/.copilot/usage.db`. The diagnostic confirmed it is the
 *       `/chronicle` aggregation DB and indexes VS Code Copilot Chat
 *       session files (workspaceStorage/chatSessions/*.jsonl) — NOT CLI
 *       sessions (0/14 overlap in the sampled vault). Reading it would
 *       double-count against `scanner.ts` which already reads the same
 *       source data.
 *
 *     • Read `~/.copilot/session-store.db`. It is populated lazily by
 *       `/chronicle reindex` and is mostly empty in normal use; it carries
 *       no AIC field that isn't already in `events.jsonl`.
 *
 *   Token-vs-prompt billing model:
 *     GHC CLI bills per *prompt* with a model multiplier, not per token.
 *     `session.shutdown.data.modelMetrics.{m}.totalNanoAiu` is the
 *     authoritative API-billed AIC value. For live segments that have not
 *     emitted shutdown yet, we use the request multiplier estimate:
 *
 *       AIC_live(model) = count(billable user.message attributed to model)
 *                         × multiplier(model)
 *
 *     We pass this through `dashboardData.ts` as `actualCredits` so it
 *     bypasses the token-rate calculator — the same path OMP/Pi take when
 *     they have a known credit value.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.__test = void 0;
exports.getCopilotHome = getCopilotHome;
exports.scanCliSessions = scanCliSessions;
const fsp = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const util_1 = require("./util");
const modelCatalog_1 = require("./modelCatalog");
// ─── Directory Resolution ─────────────────────────────────────
/**
 * Resolve the CLI's home directory. Order:
 *   1. Explicit `copilotHomeOverride` argument (from settings).
 *   2. `COPILOT_HOME` env var (official CLI override).
 *   3. `~/.copilot` (CLI default — verified against published docs and
 *      against this user's filesystem layout).
 */
function getCopilotHome(copilotHomeOverride) {
    const ov = (copilotHomeOverride ?? "").trim();
    if (ov) {
        return ov;
    }
    const env = (process.env["COPILOT_HOME"] ?? "").trim();
    if (env) {
        return env;
    }
    return path.join(os.homedir(), ".copilot");
}
// ─── Multiplier Resolution ────────────────────────────────────
/**
 * Baseline: gpt-4o's input rate (250 credits per 1M tokens) is the historical
 * "1×" premium-request cost. Divide any model's input rate by this to derive
 * a legacy per-prompt multiplier when the catalog doesn't publish one.
 */
const MULTIPLIER_BASELINE_INPUT_RATE = 250;
function normalizeModelKey(model) {
    return model.toLowerCase().trim();
}
/**
 * Resolve the AIC multiplier for `model`. Live catalog multiplier wins,
 * then derived from live per-1M rates, then a conservative 1.
 */
function multiplierFor(model) {
    if (!model || model === "unknown") {
        return 1;
    }
    const cat = (0, modelCatalog_1.classifyByCatalog)(model);
    if (cat && typeof cat.multiplier === "number" && cat.multiplier > 0) {
        // GitHub Copilot CLI traffic is GitHub-routed by construction. Use a
        // positive CAPI/catalog multiplier when available, but never let a
        // user-config/BYOK non-billable alias demote CLI prompts to 0 AIC.
        return cat.multiplier;
    }
    const rates = (0, modelCatalog_1.getRatesFor)(model);
    if (rates) {
        return Math.max(0.25, rates.inputCreditsPerMillion / MULTIPLIER_BASELINE_INPUT_RATE);
    }
    if (cat && typeof cat.multiplier === "number") {
        return cat.multiplier;
    }
    return 1;
}
// ─── Slash-Command Filter ─────────────────────────────────────
/**
 * Return true if `content` looks like a CLI slash command.
 *
 * Real CLI commands are a single word after the leading slash, terminated
 * by whitespace or end-of-string: `/usage`, `/chronicle tips`, `/help`.
 * Filesystem paths the user pastes for context (`/usr/local/bin/node`,
 * `/home/me/proj`) are NOT commands and must be counted as billable
 * prompts — the trailing `/` after the first token is the giveaway.
 */
function isSlashCommand(content) {
    if (typeof content !== "string") {
        return false;
    }
    const trimmed = content.trimStart();
    if (!trimmed.startsWith("/")) {
        return false;
    }
    // Require the first token to end at whitespace OR end-of-string.
    // `/usage` and `/usage ` both pass; `/usr/local` fails (next char is `/`).
    return /^\/[A-Za-z][\w-]*(?:\s|$)/.test(trimmed);
}
// ─── Per-Session Parser ───────────────────────────────────────
function ensureModelEntry(byModel, model) {
    const key = normalizeModelKey(model);
    let entry = byModel[key];
    if (!entry) {
        entry = {
            livePrompts: 0,
            liveAic: 0,
            liveOutputTokens: 0,
            multiplier: multiplierFor(key),
        };
        byModel[key] = entry;
    }
    return entry;
}
function parseTimestamp(raw) {
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
        return raw > 1e12 ? raw : raw * 1000;
    }
    if (typeof raw === "string") {
        const n = Date.parse(raw);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}
function nanoAiuToCredits(raw) {
    return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw / 1_000_000_000 : 0;
}
function parseSessionContent(content, filePath, format, sessionId) {
    const lines = content.split("\n");
    if (lines.length === 0) {
        return null;
    }
    let cwd = "";
    let lastAssistantModel = "";
    let uiSelectedModel = "";
    let firstTs = 0;
    let lastTs = 0;
    let slashSkipped = 0;
    let resumeCount = 0;
    let shutdownCount = 0;
    let hasLedger = false;
    let totalLivePrompts = 0;
    const byModel = {};
    let anyEvent = false;
    for (const line of lines) {
        if (!line) {
            continue;
        }
        let evt;
        try {
            evt = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (!(0, util_1.isObj)(evt)) {
            continue;
        }
        const type = typeof evt["type"] === "string" ? evt["type"] : "";
        const data = (0, util_1.isObj)(evt["data"]) ? evt["data"] : {};
        anyEvent = true;
        const ts = parseTimestamp(evt["timestamp"]);
        if (ts > 0) {
            if (firstTs === 0 || ts < firstTs) {
                firstTs = ts;
            }
            if (ts > lastTs) {
                lastTs = ts;
            }
        }
        switch (type) {
            case "session.start":
            case "session.resume": {
                if (type === "session.resume") {
                    resumeCount++;
                }
                const sel = data["selectedModel"];
                if (typeof sel === "string" && sel) {
                    uiSelectedModel = sel;
                }
                const ctx = (0, util_1.isObj)(data["context"]) ? data["context"] : null;
                if (!cwd && ctx && typeof ctx["cwd"] === "string") {
                    cwd = ctx["cwd"];
                }
                break;
            }
            case "session.model_change": {
                const nm = data["newModel"];
                if (typeof nm === "string" && nm) {
                    // An explicit user switch is the new ground truth for attribution.
                    // Update lastAssistantModel too — otherwise the previous response's
                    // model would keep winning until the next assistant.message lands,
                    // which silently mis-attributes the very next prompt (audit finding).
                    uiSelectedModel = nm;
                    lastAssistantModel = nm;
                }
                break;
            }
            case "user.message": {
                if (isSlashCommand(data["content"])) {
                    slashSkipped++;
                    break;
                }
                // Attribute to the model that actually answered the previous turn
                // (assistant.message.data.model) when known — that field reflects
                // what GitHub will bill. Fall back to the UI-selected model only
                // before the first response of the conversation has landed.
                const m = lastAssistantModel || uiSelectedModel || "unknown";
                const entry = ensureModelEntry(byModel, m);
                entry.livePrompts++;
                entry.liveAic += entry.multiplier;
                totalLivePrompts++;
                break;
            }
            case "assistant.message": {
                const actual = typeof data["model"] === "string" && data["model"]
                    ? data["model"]
                    : lastAssistantModel || uiSelectedModel || "unknown";
                lastAssistantModel = actual;
                const entry = ensureModelEntry(byModel, actual);
                const out = typeof data["outputTokens"] === "number" ? data["outputTokens"] : 0;
                if (out > 0) {
                    entry.liveOutputTokens += out;
                }
                break;
            }
            case "session.shutdown": {
                shutdownCount++;
                hasLedger = true;
                const sessionNanoAic = nanoAiuToCredits(data["totalNanoAiu"]);
                const metrics = (0, util_1.isObj)(data["modelMetrics"])
                    ? data["modelMetrics"]
                    : {};
                let modelLedgerAicTotal = 0;
                for (const [modelId, raw] of Object.entries(metrics)) {
                    if (!(0, util_1.isObj)(raw)) {
                        continue;
                    }
                    const entry = ensureModelEntry(byModel, modelId);
                    const reqs = (0, util_1.isObj)(raw["requests"]) ? raw["requests"] : {};
                    const usage = (0, util_1.isObj)(raw["usage"]) ? raw["usage"] : {};
                    const nanoAic = nanoAiuToCredits(raw["totalNanoAiu"]);
                    const legacyCost = typeof reqs["cost"] === "number" ? reqs["cost"] : 0;
                    const aic = nanoAic > 0 ? nanoAic : legacyCost;
                    const cnt = typeof reqs["count"] === "number" ? reqs["count"] : 0;
                    entry.ledgerAic = (entry.ledgerAic ?? 0) + aic;
                    modelLedgerAicTotal += aic;
                    entry.apiCallCount = (entry.apiCallCount ?? 0) + cnt;
                    const inT = typeof usage["inputTokens"] === "number" ? usage["inputTokens"] : 0;
                    const outT = typeof usage["outputTokens"] === "number" ? usage["outputTokens"] : 0;
                    const crT = typeof usage["cacheReadTokens"] === "number" ? usage["cacheReadTokens"] : 0;
                    const cwT = typeof usage["cacheWriteTokens"] === "number" ? usage["cacheWriteTokens"] : 0;
                    const rsT = typeof usage["reasoningTokens"] === "number" ? usage["reasoningTokens"] : 0;
                    entry.ledgerInputTokens = (entry.ledgerInputTokens ?? 0) + inT;
                    entry.ledgerOutputTokens = (entry.ledgerOutputTokens ?? 0) + outT;
                    entry.ledgerCacheReadTokens = (entry.ledgerCacheReadTokens ?? 0) + crT;
                    entry.ledgerCacheWriteTokens = (entry.ledgerCacheWriteTokens ?? 0) + cwT;
                    entry.ledgerReasoningTokens = (entry.ledgerReasoningTokens ?? 0) + rsT;
                }
                if (sessionNanoAic > 0 && modelLedgerAicTotal === 0) {
                    const currentModel = typeof data["currentModel"] === "string" && data["currentModel"]
                        ? data["currentModel"]
                        : lastAssistantModel || uiSelectedModel || "unknown";
                    const entry = ensureModelEntry(byModel, currentModel);
                    entry.ledgerAic = (entry.ledgerAic ?? 0) + sessionNanoAic;
                }
                break;
            }
            default:
                // Ignore everything else — tool calls, hooks, permissions, etc.
                // carry no billing-relevant fields (see diagnose-copilot-cli.mjs §3).
                break;
        }
    }
    if (!anyEvent) {
        return null;
    }
    // Pick primary model = most live prompts (deterministic tiebreak by key).
    let primaryModel = "";
    let maxPrompts = -1;
    for (const [m, stats] of Object.entries(byModel)) {
        if (stats.livePrompts > maxPrompts || (stats.livePrompts === maxPrompts && m < primaryModel)) {
            maxPrompts = stats.livePrompts;
            primaryModel = m;
        }
    }
    if (!primaryModel) {
        // No user.message events (slash-only session, or assistant-only resume).
        primaryModel = lastAssistantModel || uiSelectedModel || "unknown";
    }
    // Per-model totalAic: shutdown totalNanoAiu ledger when present
    // (authoritative), live otherwise.
    //
    // Semantics: when a session has a session.shutdown ledger, the per-model
    // `totalNanoAiu` field is treated as authoritative for THAT model only.
    // A model that shows live prompts but does NOT appear in the ledger
    // (e.g. user selected haiku, CLI silently re-routed to sonnet —
    // observed in 2/8 audited sessions) keeps its live estimate. This is
    // intentional: the dashboard's `driftAic` metric (Σ live − Σ ledger
    // over models that have BOTH) surfaces the silent-routing delta to the
    // user so they can spot the over-count if it happens; the totalAic
    // here is the conservative sum (it may slightly over-count when GitHub
    // routes a 0.33-mult model to a 1.0-mult model). A future enhancement
    // could drop live-only models when hasLedger is true, but we keep them
    // for now so users don't lose visibility into routing decisions.
    let totalAic = 0;
    for (const stats of Object.values(byModel)) {
        totalAic += stats.ledgerAic !== undefined ? stats.ledgerAic : stats.liveAic;
    }
    return {
        sessionId,
        filePath,
        format,
        cwd,
        primaryModel,
        modelCount: Object.keys(byModel).length,
        totalLivePrompts,
        totalAic,
        hasLedger,
        slashSkipped,
        resumeCount,
        shutdownCount,
        byModel,
        firstTs,
        lastTs,
    };
}
// ─── Directory Scanner ────────────────────────────────────────
const fileCache = new Map();
async function statSafe(p) {
    try {
        const st = await fsp.stat(p);
        return { mtimeMs: st.mtimeMs, size: st.size };
    }
    catch {
        return null;
    }
}
async function readdirSafe(p) {
    try {
        return await fsp.readdir(p);
    }
    catch {
        return [];
    }
}
async function enumerateSessionFiles(copilotHome) {
    const ssRoot = path.join(copilotHome, "session-state");
    const entries = await readdirSafe(ssRoot);
    const bySession = new Map();
    for (const name of entries) {
        const full = path.join(ssRoot, name);
        const st = await statSafe(full);
        if (!st) {
            continue;
        }
        let cand = null;
        if (name.endsWith(".jsonl")) {
            // Skip zero-byte legacy files — they parse to no events anyway and
            // would otherwise win the mtime race against a populated new-format
            // sibling that happens to have an older mtime.
            if (st.size === 0) {
                continue;
            }
            const id = name.slice(0, -".jsonl".length);
            cand = { sessionId: id, filePath: full, format: "legacy", mtimeMs: st.mtimeMs };
        }
        else {
            const evFile = path.join(full, "events.jsonl");
            const evSt = await statSafe(evFile);
            if (evSt && evSt.size > 0) {
                cand = { sessionId: name, filePath: evFile, format: "new", mtimeMs: evSt.mtimeMs };
            }
        }
        if (!cand) {
            continue;
        }
        const prev = bySession.get(cand.sessionId);
        if (!prev || cand.mtimeMs > prev.mtimeMs) {
            bySession.set(cand.sessionId, cand);
        }
    }
    return Array.from(bySession.values()).map(c => ({
        sessionId: c.sessionId,
        filePath: c.filePath,
        format: c.format,
    }));
}
async function parseSessionFile(sf) {
    const st = await statSafe(sf.filePath);
    if (!st) {
        return null;
    }
    const cached = fileCache.get(sf.filePath);
    if (cached && cached.mtime === st.mtimeMs) {
        return cached.data;
    }
    let content;
    try {
        content = await fsp.readFile(sf.filePath, "utf-8");
    }
    catch {
        return null;
    }
    const data = parseSessionContent(content, sf.filePath, sf.format, sf.sessionId);
    if (data) {
        fileCache.set(sf.filePath, { mtime: st.mtimeMs, data });
    }
    return data;
}
// ─── Public API ───────────────────────────────────────────────
/**
 * Scan CLI sessions under `${COPILOT_HOME ?? ~/.copilot}/session-state/`.
 *
 * Results are mtime-cached per file; unchanged sessions skip re-parsing.
 * `billable` sessions are those whose `lastTs` (or `firstTs`) falls inside
 * the current billing period (1st of current month UTC) — matching the
 * window used by `agentScanner.ts` so all three sources stay aligned.
 *
 * Safe to call when `~/.copilot` does not exist — returns an empty result.
 */
async function scanCliSessions(copilotHomeOverride) {
    const t0 = Date.now();
    const home = getCopilotHome(copilotHomeOverride);
    const homeSt = await statSafe(home);
    if (!homeSt) {
        return emptyResult(home, Date.now() - t0);
    }
    const files = await enumerateSessionFiles(home);
    // 16-way concurrency mirrors agentScanner.ts.
    const parsed = await (0, util_1.mapConcurrent)(files, 16, parseSessionFile);
    const all = parsed.filter((s) => s !== null);
    const now = new Date();
    const billingStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const billable = [];
    let allTimeLivePrompts = 0;
    let allTimeOutputTokens = 0;
    for (const s of all) {
        allTimeLivePrompts += s.totalLivePrompts;
        for (const m of Object.values(s.byModel)) {
            allTimeOutputTokens += m.liveOutputTokens;
        }
        const t = s.lastTs || s.firstTs;
        if (t >= billingStart) {
            billable.push(s);
        }
    }
    billable.sort((a, b) => b.lastTs - a.lastTs);
    let totalLivePrompts = 0;
    let totalAic = 0;
    let totalOutputTokens = 0;
    let driftAic = 0;
    let reconciledSessions = 0;
    let liveOnlySessions = 0;
    for (const s of billable) {
        totalLivePrompts += s.totalLivePrompts;
        totalAic += s.totalAic;
        for (const m of Object.values(s.byModel)) {
            totalOutputTokens += m.liveOutputTokens;
        }
        if (s.hasLedger) {
            reconciledSessions++;
            // Per-session drift = Σ liveAic − Σ ledgerAic over models with ledger.
            let live = 0;
            let ledger = 0;
            for (const m of Object.values(s.byModel)) {
                if (m.ledgerAic !== undefined) {
                    live += m.liveAic;
                    ledger += m.ledgerAic;
                }
            }
            driftAic += live - ledger;
        }
        else {
            liveOnlySessions++;
        }
    }
    // Evict cache entries for files that disappeared.
    const seen = new Set(all.map(s => s.filePath));
    for (const k of fileCache.keys()) {
        if (!seen.has(k)) {
            fileCache.delete(k);
        }
    }
    return {
        sessions: billable,
        allTimeSessions: all.length,
        totalLivePrompts,
        totalAic: Math.round(totalAic * 100) / 100,
        totalOutputTokens,
        allTimeLivePrompts,
        allTimeOutputTokens,
        driftAic: Math.round(driftAic * 100) / 100,
        reconciledSessions,
        liveOnlySessions,
        copilotHome: home,
        scanMs: Date.now() - t0,
    };
}
function emptyResult(home, scanMs) {
    return {
        sessions: [],
        allTimeSessions: 0,
        totalLivePrompts: 0,
        totalAic: 0,
        totalOutputTokens: 0,
        allTimeLivePrompts: 0,
        allTimeOutputTokens: 0,
        driftAic: 0,
        reconciledSessions: 0,
        liveOnlySessions: 0,
        copilotHome: home,
        scanMs,
    };
}
// ─── Test Hooks ───────────────────────────────────────────────
/**
 * Exposed for unit / diagnostic scripts so they don't need to spin up the
 * full extension just to validate the parser. Not exported in the
 * Activation surface — extension code should always go through
 * `scanCliSessions()`.
 */
exports.__test = {
    parseSessionContent,
    isSlashCommand,
    multiplierFor,
    enumerateSessionFiles,
};
//# sourceMappingURL=cliScanner.js.map