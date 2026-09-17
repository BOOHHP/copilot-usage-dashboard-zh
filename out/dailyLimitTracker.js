"use strict";
/**
 * dailyLimitTracker.ts — Tracks AI Credits (AIC) spent today against a
 * user-configured daily cap and emits stage-change events.
 *
 * Stages:
 *   none   → below warn%
 *   warn   → warn% ≤ used < brace%
 *   brace  → brace% ≤ used < 100%
 *   limit  → used ≥ 100%
 *
 * Sources of "today's AIC":
 *   1. Scanner turns whose timestamp falls inside the current local "day"
 *      (day = window from resetHour to resetHour+24h).
 *   2. Live OTel byModel — overlays the scanner for the most recent
 *      activity that may not yet be flushed to disk.
 *
 * Snooze: stores an ISO timestamp in globalState. While "now < snoozeUntil"
 * the overlay is suppressed but the status bar and enforcement still apply.
 *
 * Manual resume: stores the day-key the user resumed on. Re-enables Copilot
 * (if enforcement disabled it) and suppresses re-enforcement for that day.
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
exports.DailyLimitTracker = void 0;
exports.getDailyLimitConfig = getDailyLimitConfig;
const vscode = __importStar(require("vscode"));
const SNOOZE_KEY = "copilotUsage.dailyLimit.snoozeUntil";
const RESUME_KEY = "copilotUsage.dailyLimit.resumedDay";
function getDailyLimitConfig() {
    const cfg = vscode.workspace.getConfiguration("copilotUsage.dailyLimit");
    return {
        enabled: cfg.get("enabled") ?? true,
        credits: cfg.get("credits") ?? 100,
        dollars: cfg.get("dollars") ?? 0,
        warnAtPercent: cfg.get("warnAtPercent") ?? 75,
        braceAtPercent: cfg.get("braceAtPercent") ?? 90,
        resetHour: cfg.get("resetHour") ?? 0,
        enforcement: cfg.get("enforcement") ?? "pause",
        snoozeMinutes: cfg.get("snoozeMinutes") ?? 10,
        playSound: cfg.get("playSound") ?? false,
        installAgentHooks: cfg.get("installAgentHooks") ?? true,
    };
}
/**
 * Compute the start of the current "day window" based on resetHour.
 * Returns Date at local resetHour:00:00 on or before `now`.
 */
function dayWindowStart(now, resetHour) {
    const start = new Date(now);
    start.setHours(resetHour, 0, 0, 0);
    if (start.getTime() > now.getTime()) {
        // Reset hour hasn't happened yet today — window started yesterday.
        start.setDate(start.getDate() - 1);
    }
    return start;
}
function dayKeyOf(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}
/** Compute today's AIC by summing scanner turns + live OTel deltas. */
function computeTodayAIC(scan, otel, calculator, windowStart) {
    let total = 0;
    const windowStartIso = windowStart.toISOString();
    if (scan && scan.turns.length > 0) {
        for (const t of scan.turns) {
            if (!t.timestamp || t.timestamp < windowStartIso) {
                continue;
            }
            if (t.debugAicCredits > 0) {
                total += t.debugAicCredits;
            }
            else {
                const usage = calculator.calculateCredits(t.modelFamily || "unknown", t.debugPromptTokens || t.promptTokens, t.debugOutputTokens || t.outputTokens, 0, 0);
                total += usage.totalCredits;
            }
        }
    }
    // OTel: aggregate per-model totals (in-memory, this instance, since startup).
    // These will mostly overlap with scanner once flushed; we treat them as
    // authoritative for the *delta* not yet in scanner — but to keep math
    // simple and avoid double-counting we just use scanner+OTel-since-last-scan.
    // Here we add OTel byModel because the scanner has its own debounce and
    // a fresh request can take seconds to land in chatSession files.
    // Trade-off documented in implementation-notes.html.
    if (otel && otel.requests > 0 && (!scan || scan.turns.length === 0)) {
        for (const m of otel.byModel.values()) {
            const usage = calculator.calculateCredits(m.model, m.prompt, m.completion, m.cached, m.cacheWrite);
            total += usage.totalCredits;
        }
    }
    return Math.round(total * 100) / 100;
}
function classify(percent, warnPct, bracePct) {
    if (percent >= 100) {
        return "limit";
    }
    if (percent >= bracePct) {
        return "brace";
    }
    if (percent >= warnPct) {
        return "warn";
    }
    return "none";
}
class DailyLimitTracker {
    context;
    listeners = [];
    lastStage = "none";
    lastSnapshot = null;
    constructor(context) {
        this.context = context;
    }
    onStageChange(fn) {
        this.listeners.push(fn);
        return {
            dispose: () => {
                this.listeners = this.listeners.filter(l => l !== fn);
            },
        };
    }
    /** Snapshot of current state — call any time. */
    snapshot(scan, otel, calculator, dollarsPerCredit = 0.01) {
        const cfg = getDailyLimitConfig();
        const now = new Date();
        const start = dayWindowStart(now, cfg.resetHour);
        const used = computeTodayAIC(scan, otel, calculator, start);
        // Dollar mode wins if dollars > 0 — convert to AIC for unified math.
        const dpc = dollarsPerCredit > 0 ? dollarsPerCredit : 0.01;
        const dollarMode = cfg.dollars > 0;
        const limit = dollarMode
            ? Math.max(1, Math.round(cfg.dollars / dpc))
            : Math.max(1, cfg.credits);
        const percent = (used / limit) * 100;
        const nextReset = new Date(start.getTime() + 24 * 60 * 60 * 1000);
        const msUntilReset = Math.max(0, nextReset.getTime() - now.getTime());
        const dayKey = dayKeyOf(start);
        const snoozeUntil = this.context.globalState.get(SNOOZE_KEY);
        const resumedDay = this.context.globalState.get(RESUME_KEY);
        const snoozed = !!snoozeUntil && new Date(snoozeUntil).getTime() > now.getTime();
        const resumed = resumedDay === dayKey;
        // Request count for re-nag trigger: sum scanner turns in current window + live OTel requests.
        const windowStartIso = start.toISOString();
        let reqCount = otel?.requests ?? 0;
        if (scan && scan.turns.length > 0) {
            for (const t of scan.turns) {
                if (t.timestamp && t.timestamp >= windowStartIso) {
                    reqCount++;
                }
            }
        }
        const snap = {
            stage: cfg.enabled ? classify(percent, cfg.warnAtPercent, cfg.braceAtPercent) : "none",
            used,
            limit,
            percent: Math.round(percent * 10) / 10,
            usedDollars: Math.round(used * dpc * 100) / 100,
            limitDollars: Math.round(limit * dpc * 100) / 100,
            dollarsPerCredit: dpc,
            dollarMode,
            msUntilReset,
            dayKey,
            snoozed,
            resumed,
            enforcement: cfg.enforcement,
            enabled: cfg.enabled,
            playSound: cfg.playSound,
            dollarsSetting: cfg.dollars,
            installAgentHooks: cfg.installAgentHooks,
            requestCount: reqCount,
        };
        this.lastSnapshot = snap;
        return snap;
    }
    /** Push a snapshot and fire listeners if the stage changed. */
    push(snap) {
        const prev = this.lastStage;
        if (snap.stage !== prev) {
            this.lastStage = snap.stage;
            for (const l of this.listeners) {
                try {
                    l(snap, prev);
                }
                catch {
                    /* ignore listener errors */
                }
            }
        }
    }
    /** Last snapshot if available (may be null before first computation). */
    last() {
        return this.lastSnapshot;
    }
    lastStageValue() {
        return this.lastStage;
    }
    /** Snooze the overlay for `minutes`. */
    async snooze(minutes) {
        const until = new Date(Date.now() + minutes * 60 * 1000).toISOString();
        await this.context.globalState.update(SNOOZE_KEY, until);
    }
    async clearSnooze() {
        await this.context.globalState.update(SNOOZE_KEY, undefined);
    }
    /** Mark the current day as user-resumed (skip enforcement until next reset). */
    async markResumed(dayKey) {
        await this.context.globalState.update(RESUME_KEY, dayKey);
    }
    async clearResume() {
        await this.context.globalState.update(RESUME_KEY, undefined);
    }
}
exports.DailyLimitTracker = DailyLimitTracker;
//# sourceMappingURL=dailyLimitTracker.js.map