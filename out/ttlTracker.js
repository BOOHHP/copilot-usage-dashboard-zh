"use strict";
/**
 * ttlTracker.ts — Prompt-cache TTL tracker.
 *
 * This is the glue between the existing scan pipeline and the pure state
 * machine in `ttlState.ts`. It performs **no file I/O of its own**:
 *
 *   • `ingest()` is called from `runScan()` with the ScanResult that was
 *     already produced for the dashboard. The recursive `fs.watch` in
 *     extension.ts fires within ~10 ms of any `main.jsonl` write, so the
 *     countdown anchor is fresh without any polling loop of its own.
 *   • `tick()` runs once per second and is pure arithmetic over cached
 *     epoch-ms values — it never touches the disk, and it only runs while a
 *     UI surface is actually visible.
 *
 * The countdown itself is derived from the MIT-licensed `cache-timer`
 * extension (© 2026 sukumarp2022); its own detector/poll layer is deliberately
 * NOT ported because `src/scanner.ts` already produces strictly better data
 * (async, mtime-cached, and carrying exact `copilotUsageNanoAiu` billing).
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
exports.TtlTracker = exports.DEFAULT_TTL_CONFIG = void 0;
exports.getTtlConfig = getTtlConfig;
const vscode = __importStar(require("vscode"));
const cache_1 = require("./cache");
const ttlProviders_1 = require("./ttlProviders");
const ttlState_1 = require("./ttlState");
const ttlSound_1 = require("./ttlSound");
exports.DEFAULT_TTL_CONFIG = {
    enabled: false,
    ttlMap: {},
    soundEnabled: false,
    soundPath: "",
    alertRepeat: 1,
    notifyOnRed: false,
    workingGraceSeconds: 5,
    expiredGraceSeconds: 30,
    maxSessions: 20,
    showInStatusBar: true,
};
function getTtlConfig() {
    const cfg = vscode.workspace.getConfiguration("copilotUsage.cacheTtl");
    return {
        enabled: cfg.get("enabled") ?? exports.DEFAULT_TTL_CONFIG.enabled,
        ttlMap: cfg.get("ttl") ?? exports.DEFAULT_TTL_CONFIG.ttlMap,
        soundEnabled: cfg.get("soundEnabled") ?? exports.DEFAULT_TTL_CONFIG.soundEnabled,
        soundPath: cfg.get("soundPath") ?? exports.DEFAULT_TTL_CONFIG.soundPath,
        alertRepeat: cfg.get("alertRepeat") ?? exports.DEFAULT_TTL_CONFIG.alertRepeat,
        notifyOnRed: cfg.get("notifyOnRed") ?? exports.DEFAULT_TTL_CONFIG.notifyOnRed,
        workingGraceSeconds: cfg.get("workingGraceSeconds") ?? exports.DEFAULT_TTL_CONFIG.workingGraceSeconds,
        expiredGraceSeconds: cfg.get("expiredGraceSeconds") ?? exports.DEFAULT_TTL_CONFIG.expiredGraceSeconds,
        maxSessions: cfg.get("maxSessions") ?? exports.DEFAULT_TTL_CONFIG.maxSessions,
        showInStatusBar: cfg.get("showInStatusBar") ?? exports.DEFAULT_TTL_CONFIG.showInStatusBar,
    };
}
/** Hard cap so a pathological workspaceStorage cannot cause unbounded work. */
const MAX_TRACKED = 200;
class TtlTracker {
    bundledSoundPath;
    dollarPerCredit;
    tracked = [];
    rendered = [];
    tickHandle;
    prevState = new Map();
    lastRequestSeen = new Map();
    queue = (0, ttlSound_1.createAlertQueue)();
    emitter = new vscode.EventEmitter();
    uiVisible = true;
    config = exports.DEFAULT_TTL_CONFIG;
    /** Fires whenever the rendered session list changes. */
    onChange = this.emitter.event;
    constructor(bundledSoundPath, dollarPerCredit) {
        this.bundledSoundPath = bundledSoundPath;
        this.dollarPerCredit = dollarPerCredit;
        this.config = getTtlConfig();
    }
    getSessions() {
        return this.rendered;
    }
    /** The most urgent session, or null when nothing is tracked. */
    getLead() {
        return this.rendered.length > 0 ? this.rendered[0] : null;
    }
    isEnabled() {
        return this.config.enabled;
    }
    /**
     * Pause the one-second tick while every TTL surface is hidden. The countdown
     * has no meaning nobody can see, and this keeps an idle window at zero cost.
     */
    setUiVisible(visible) {
        if (this.uiVisible === visible) {
            return;
        }
        this.uiVisible = visible;
        this.syncTimer();
    }
    onConfigChanged() {
        const wasEnabled = this.config.enabled;
        this.config = getTtlConfig();
        if (wasEnabled && !this.config.enabled) {
            this.tracked = [];
            this.rendered = [];
            this.prevState.clear();
            this.lastRequestSeen.clear();
            this.emitter.fire(this.rendered);
        }
        this.syncTimer();
    }
    /**
     * Refresh tracked sessions from an already-completed scan. Data-only — the
     * scan did the I/O, this just reshapes what is already in memory.
     */
    ingest(scan, cli) {
        if (!this.config.enabled) {
            return;
        }
        const now = Date.now();
        const windowMs = ((0, ttlProviders_1.maxTimerValue)(this.config.ttlMap) + this.config.expiredGraceSeconds) * 1000;
        const next = [];
        // Cache-read tokens live on turns, not sessions — roll them up once.
        const cachedBySession = new Map();
        for (const t of scan?.turns ?? []) {
            if (t.debugCachedTokens > 0) {
                cachedBySession.set(t.sessionId, (cachedBySession.get(t.sessionId) ?? 0) + t.debugCachedTokens);
            }
        }
        for (const s of scan?.sessions ?? []) {
            const t = this.trackVsCode(s, now, windowMs, cachedBySession.get(s.sessionId) ?? 0);
            if (t) {
                next.push(t);
            }
        }
        for (const c of cli?.sessions ?? []) {
            if (!c.lastTs || now - c.lastTs > windowMs) {
                continue;
            }
            const provider = (0, ttlProviders_1.mapTtlProvider)(c.primaryModel);
            next.push({
                sessionId: `cli:${c.sessionId}`,
                title: (0, ttlState_1.shortTitle)(cliTitle(c.cwd, c.sessionId)),
                source: "cli",
                lastRequestMs: c.lastTs,
                // The CLI event log has no turn_start/turn_end markers, so HOT falls
                // back to the post-request grace window in computeWorking().
                lastTurnStartMs: 0,
                lastTurnEndMs: 0,
                model: c.primaryModel || "",
                provider,
                costUsd: c.totalAic * this.dollarPerCredit(),
                cacheHitPct: cliCacheHitPct(c),
            });
        }
        this.tracked = next.slice(0, MAX_TRACKED);
        this.syncTimer();
        this.tick();
    }
    trackVsCode(s, now, windowMs, cachedTokens) {
        // Anchor on the newest llm_request; a session with no debug-log has no
        // per-request timing and therefore no meaningful cache countdown.
        const lastRequestMs = s.lastRequestMs;
        if (!lastRequestMs || now - lastRequestMs > windowMs) {
            return undefined;
        }
        const model = s.lastRequestModel || s.modelFamily || s.modelName || "";
        const cacheHit = (0, cache_1.computeCacheHit)(s.debugTotalPrompt, cachedTokens);
        return {
            sessionId: s.sessionId,
            title: (0, ttlState_1.shortTitle)(s.sessionTitle || s.promptPreview || s.projectName || s.sessionId),
            source: "vscode",
            lastRequestMs,
            lastTurnStartMs: s.lastTurnStartMs,
            lastTurnEndMs: s.lastTurnEndMs,
            model,
            provider: (0, ttlProviders_1.mapTtlProvider)(model),
            costUsd: s.debugTotalAicCredits * this.dollarPerCredit(),
            cacheHitPct: cacheHit.pct,
        };
    }
    /** Start or stop the one-second tick to match enabled + visibility. */
    syncTimer() {
        const shouldRun = this.config.enabled && this.uiVisible && this.tracked.length > 0;
        if (shouldRun && !this.tickHandle) {
            this.tickHandle = setInterval(() => this.tick(), 1000);
        }
        else if (!shouldRun && this.tickHandle) {
            clearInterval(this.tickHandle);
            this.tickHandle = undefined;
        }
    }
    /** Pure arithmetic over cached timestamps. No I/O. */
    tick() {
        if (!this.config.enabled) {
            return;
        }
        const now = Date.now();
        const out = [];
        for (const t of this.tracked) {
            const th = (0, ttlProviders_1.getTtlThresholds)(t.provider, this.config.ttlMap);
            if (!(0, ttlState_1.isWithinActiveWindow)(t.lastRequestMs, now, th.timerValue, this.config.expiredGraceSeconds)) {
                continue;
            }
            const working = (0, ttlState_1.computeWorking)({
                lastTurnStartMs: t.lastTurnStartMs,
                lastTurnEndMs: t.lastTurnEndMs,
                lastRequestMs: t.lastRequestMs,
            }, now, this.config.workingGraceSeconds);
            const remaining = (0, ttlState_1.computeRemaining)(th.timerValue, now, t.lastRequestMs);
            const state = (0, ttlState_1.computeState)(working, remaining, th.warnAt, th.alertAt);
            out.push({
                sessionId: t.sessionId,
                title: t.title,
                source: t.source,
                lastRequestMs: t.lastRequestMs,
                working,
                model: t.model,
                provider: t.provider,
                timerValue: th.timerValue,
                warnAt: th.warnAt,
                alertAt: th.alertAt,
                costUsd: t.costUsd,
                cacheHitPct: t.cacheHitPct,
                remaining,
                state,
            });
        }
        out.sort(ttlState_1.urgencyCompare);
        for (const s of out) {
            this.maybeAlert(s);
        }
        this.prune(out);
        this.rendered = out;
        this.syncTimer();
        this.emitter.fire(this.rendered);
    }
    maybeAlert(session) {
        // A brand-new request re-arms the alert so the next expiry chimes again.
        const seen = this.lastRequestSeen.get(session.sessionId);
        if (seen !== undefined && session.lastRequestMs > seen) {
            this.prevState.delete(session.sessionId);
        }
        this.lastRequestSeen.set(session.sessionId, session.lastRequestMs);
        const decision = (0, ttlState_1.alertDecision)(this.prevState.get(session.sessionId), session.state, {
            soundEnabled: this.config.soundEnabled,
            notifyOnRed: this.config.notifyOnRed,
        });
        if (decision.playSound) {
            const sound = (0, ttlSound_1.resolveSoundPath)(this.config.soundPath, this.bundledSoundPath);
            this.queue.enqueue(sound, process.platform, this.config.alertRepeat);
        }
        if (decision.notify) {
            void vscode.window.showWarningMessage(`Prompt cache expiring — "${session.title}" (${session.provider}) has ${(0, ttlState_1.formatTtl)(session.remaining)} left.`);
        }
        this.prevState.set(session.sessionId, session.state);
    }
    prune(live) {
        const ids = new Set(live.map(s => s.sessionId));
        for (const id of Array.from(this.prevState.keys())) {
            if (!ids.has(id)) {
                this.prevState.delete(id);
            }
        }
        for (const id of Array.from(this.lastRequestSeen.keys())) {
            if (!ids.has(id)) {
                this.lastRequestSeen.delete(id);
            }
        }
    }
    dispose() {
        if (this.tickHandle) {
            clearInterval(this.tickHandle);
            this.tickHandle = undefined;
        }
        this.emitter.dispose();
    }
}
exports.TtlTracker = TtlTracker;
/** CLI sessions have no chat title — use the working directory's leaf name. */
function cliTitle(cwd, sessionId) {
    const leaf = (cwd || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop();
    return leaf ? `CLI · ${leaf}` : `CLI · ${sessionId.slice(0, 8)}`;
}
function cliCacheHitPct(c) {
    let input = 0;
    let cached = 0;
    for (const m of Object.values(c.byModel ?? {})) {
        input += m.ledgerInputTokens ?? 0;
        cached += m.ledgerCacheReadTokens ?? 0;
    }
    return (0, cache_1.computeCacheHit)(input, cached).pct;
}
//# sourceMappingURL=ttlTracker.js.map