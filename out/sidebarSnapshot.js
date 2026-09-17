"use strict";
/**
 * sidebarSnapshot.ts — Pure projection of DashboardData + raw scan + live
 * OTel into a slim, serializable DTO consumed by the sidebar webview.
 *
 * Zero new computation: every number here is already produced by the existing
 * pipeline (dashboardData.ts, otelReceiver.ts, scanner.ts). This module only
 * picks, slices, and shapes for narrow-column display.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSidebarSnapshot = buildSidebarSnapshot;
const cache_1 = require("./cache");
const ttlState_1 = require("./ttlState");
// ─── Helpers ─────────────────────────────────────────────────
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function todayKey() {
    return new Date().toISOString().slice(0, 10);
}
function weekStartKey() {
    // ISO week starts Monday; we use a 7-day rolling window ending today for
    // sidebar simplicity. Matches Tokenyst's "THIS WEEK (since Monday)" spirit
    // while avoiding TZ edge cases at month boundaries.
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d.toISOString().slice(0, 10);
}
function safePct(part, whole) {
    return whole > 0 ? (part / whole) * 100 : 0;
}
function buildSidebarSnapshot(input) {
    const { dashData, scanTurns, liveStats, lastRequestAIC, currentSessionAIC, currentSessionModel, currentSessionTurns, currentSessionDurationMin, activationTime, } = input;
    const aic = dashData.aicSummary;
    const dollarsPerCredit = aic.config.overageCostPerCredit ?? 0.01;
    const today = todayKey();
    const weekStart = weekStartKey();
    // ── Status row ──
    const liveState = liveStats && liveStats.requests > 0
        ? "live"
        : scanTurns.length > 0
            ? "scan"
            : "idle";
    // ── Last request + sparkline ──
    // Use per-turn debugLastRequestAic when present (true per-event values),
    // else fall back to the turn's total debugAicCredits. Scope to instance
    // (timestamps after activationTime) so other windows don't bleed in.
    const recentTurns = scanTurns
        .filter(t => t.timestamp && t.timestamp >= activationTime)
        .sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
    const sparkline = recentTurns
        .map(t => (t.debugLastRequestAic > 0 ? t.debugLastRequestAic : t.debugAicCredits))
        .filter(v => v > 0)
        .slice(-20);
    let lastRequest = null;
    if (lastRequestAIC > 0 || (liveStats && liveStats.lastRequest)) {
        const lr = liveStats?.lastRequest ?? null;
        const lastTs = lr?.timestamp ??
            recentTurns[recentTurns.length - 1]?.debugLastRequestTs ??
            recentTurns[recentTurns.length - 1]?.timestamp ??
            "";
        const agoMs = lastTs ? Math.max(0, Date.now() - new Date(lastTs).getTime()) : 0;
        lastRequest = {
            model: lr?.modelName ?? currentSessionModel ?? "unknown",
            aic: lastRequestAIC,
            agoMs,
            promptTokens: lr?.promptTokens ?? 0,
            completionTokens: lr?.completionTokens ?? 0,
            cachedTokens: lr?.cachedTokens ?? 0,
            sparkline,
        };
    }
    // ── Today / Week from aicSummary.byDay ──
    const todayRow = aic.byDay.find(d => d.day === today);
    const todayAic = todayRow?.credits ?? 0;
    const weekAic = aic.byDay
        .filter(d => d.day >= weekStart && d.day <= today)
        .reduce((s, d) => s + d.credits, 0);
    // Top model today + request count from live OTel byModel (live + accurate).
    let topModel = "—";
    let topTokens = 0;
    if (liveStats) {
        for (const m of liveStats.byModel.values()) {
            const tk = m.prompt + m.completion;
            if (tk > topTokens) {
                topTokens = tk;
                topModel = m.model;
            }
        }
    }
    if (topModel === "—" && aic.byModel.length > 0) {
        topModel = aic.byModel[0].model;
    }
    const todayRequests = liveStats?.requests ?? 0;
    const todayWeek = {
        todayAic,
        todayUsd: todayAic * dollarsPerCredit,
        weekAic,
        weekUsd: weekAic * dollarsPerCredit,
        todayRequests,
        topModel,
    };
    // ── Session (this window) ──
    const session = currentSessionAIC > 0 || currentSessionTurns > 0
        ? {
            aic: currentSessionAIC,
            turns: currentSessionTurns,
            durationMin: currentSessionDurationMin,
            model: currentSessionModel ?? "—",
        }
        : null;
    const promoActive = aic.promo.isPromoActive && aic.promo.promoBudget > 0;
    const effectiveOverageUsd = typeof aic.estimatedOverageCost === "number"
        ? aic.estimatedOverageCost
        : Math.max(0, aic.totalCredits - aic.monthlyBudget) * dollarsPerCredit;
    // ── Pace (projected cycle spend) ──
    const projectedCredits = aic.projectedTotal;
    const projectedUsd = Math.max(0, projectedCredits - aic.monthlyBudget) * dollarsPerCredit;
    const projectedPct = safePct(projectedCredits, aic.monthlyBudget);
    const pace = {
        projectedUsd,
        projectedCredits,
        overagePct: projectedPct,
        cycleEnd: aic.billingCycleEnd,
        promoActive,
        promoEndDate: aic.promo.promoEndDate,
        overBudget: projectedCredits > aic.monthlyBudget,
        budget: aic.monthlyBudget,
    };
    // ── Breakdown: cycle totals (default), already in aicSummary ──
    // Daily sparkline = last 14 days from byDay, oldest → newest, filling gaps with 0.
    const dailyMap = new Map(aic.byDay.map(d => [d.day, d.credits]));
    const days14 = [];
    let peakDay = "";
    let peakValue = 0;
    for (let i = 13; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const k = d.toISOString().slice(0, 10);
        const v = dailyMap.get(k) ?? 0;
        days14.push(v);
        if (v > peakValue) {
            peakValue = v;
            peakDay = k;
        }
    }
    // By Model — show all models in the sidebar (no slicing). The dashboard
    // also lists them, but mirroring the full list here avoids the "+N more"
    // dead-end when users are scanning burn directly from the sidebar.
    const sortedModels = [...aic.byModel].sort((a, b) => b.totalCredits - a.totalCredits);
    const maxModelCredits = sortedModels[0]?.totalCredits ?? 0;
    const byModel = sortedModels.map(m => ({
        model: m.model,
        credits: m.totalCredits,
        pct: safePct(m.totalCredits, maxModelCredits),
        tier: m.tier,
    }));
    const modelsMore = 0;
    // By Day of Week — sum credits per dow across all aic.byDay entries (cycle).
    const dowTotals = [0, 0, 0, 0, 0, 0, 0];
    for (const d of aic.byDay) {
        const idx = new Date(d.day + "T00:00:00").getDay();
        dowTotals[idx] += d.credits;
    }
    const maxDow = Math.max(...dowTotals, 0);
    const byDow = dowTotals.map((credits, i) => ({
        dow: DOW[i],
        credits,
        pct: safePct(credits, maxDow),
    }));
    // Tokens — cycle-scoped aggregation. Sum per-SESSION (not per-turn) so
    // the sidebar matches the dashboard's Cache Hit hero card and the
    // tooltip's "Cache hit (cycle)" row exactly. The per-turn aggregation
    // used before this fix drifted by ~0.3% when a session started before
    // the cycle boundary but had turns inside — sessions were counted whole
    // by dashboard/tooltip but only partially by the sidebar. Now identical.
    const cycleStart = dashData.aicSummary.billingCycleStart;
    const cycleEnd = dashData.aicSummary.billingCycleEnd;
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedTokens = 0;
    for (const s of dashData.sessionsAll) {
        if (!s.lastDate || s.lastDate < cycleStart || s.lastDate > cycleEnd) {
            continue;
        }
        inputTokens += s.actualPrompt || s.prompt || 0;
        outputTokens += s.actualOutput || s.output || 0;
        cachedTokens += s.actualCached || 0;
    }
    // Live OTel cache is more reliable for "now" — overlay max so cache count
    // never drops below what the live receiver reports for today.
    if (liveStats) {
        cachedTokens = Math.max(cachedTokens, liveStats.cached);
    }
    const breakdown = {
        totalAic: aic.totalCredits,
        totalUsd: effectiveOverageUsd,
        creditValueUsd: aic.totalCredits * dollarsPerCredit,
        budget: aic.monthlyBudget,
        promoActive,
        dailySparkline: days14,
        peakDay,
        peakValue,
        byModel,
        modelsMore,
        byDow,
        tokens: { input: inputTokens, output: outputTokens, cached: cachedTokens },
        cacheHitPct: (0, cache_1.computeCacheHit)(inputTokens, cachedTokens).pct,
    };
    // ── Sessions: top 30 by credits within cycle ──
    // Active session = the one matching currentSessionModel + most recent activity
    // since activationTime. Best-effort match — sidebar just shows a glyph.
    const activeShort = pickActiveSessionShort(dashData.sessionsAll, activationTime);
    // Credits are clipped to the cycle via the session's per-request-day split,
    // not by testing lastDate — otherwise a session that started in the previous
    // cycle contributes its whole lifetime spend here while the headline total
    // counts only the in-cycle part.
    const sessionsSorted = dashData.sessionsAll
        .map(s => ({ s, credits: creditsInCycle(s, cycleStart, cycleEnd) }))
        .filter(e => e.credits > 0)
        .sort((a, b) => b.credits - a.credits);
    const rows = sessionsSorted.slice(0, 30).map(({ s, credits }) => ({
        sessionId: s.sessionId,
        sessionShort: s.sessionShort,
        date: s.lastDate || s.last.slice(0, 10),
        source: classifySource(s),
        title: s.title || s.project || s.sessionShort,
        credits: Math.round(credits * 100) / 100,
        active: s.sessionShort === activeShort,
    }));
    return {
        status: {
            liveState,
            planName: aic.planName,
            promoActive,
            promoEndDate: aic.promo.promoEndDate,
            generatedAt: dashData.generatedAt,
        },
        lastRequest,
        todayWeek,
        session,
        pace,
        breakdown,
        sessions: { rows, total: sessionsSorted.length },
        ttl: buildTtlBlock(input.ttlSessions ?? [], breakdown.cacheHitPct),
    };
}
/** Project TTL sessions into the sidebar DTO. Pure reshaping — no new math. */
function buildTtlBlock(sessions, cacheHitPct) {
    if (sessions.length === 0) {
        return null;
    }
    const rows = sessions.slice(0, 8).map(s => ({
        title: s.title,
        state: s.state,
        display: (0, ttlState_1.stateDisplay)(s.state, s.remaining),
        fraction: s.state === "hot"
            ? 1
            : Math.max(0, Math.min(1, s.timerValue > 0 ? s.remaining / s.timerValue : 0)),
        provider: s.provider,
        source: s.source,
        costUsd: s.costUsd,
    }));
    return {
        lead: rows[0],
        rows,
        warmCount: sessions.filter(s => s.state !== "cold").length,
        cacheHitPct,
    };
}
/**
 * Credits this session spent inside `[start, end]`, using the per-request-day
 * split built in dashboardData.ts. Pre-AIC sessions have no split, so their
 * whole rate-estimated total stays pinned to `lastDate`.
 */
function creditsInCycle(s, start, end) {
    if (s.aicByDay && s.aicByDay.length > 0) {
        return s.aicByDay.reduce((sum, d) => (d.day >= start && d.day <= end ? sum + d.credits : sum), 0);
    }
    return s.lastDate && s.lastDate >= start && s.lastDate <= end ? s.aicCredits : 0;
}
function classifySource(s) {
    // is typically `"copilot"` / `"github.copilot-chat"` / `"copilot/workspaceAgent"`,
    // all of which contain the substring "pi" (positions 2–3 of "copilot") —
    // a naive `includes("pi")` would mislabel every Chat row as Pi.
    //
    // Today `sessionsAll` only carries VS Code chatSessions (OMP/Pi agent
    // sessions live in `agentSummary`, not here), so in practice this returns
    // "Chat" — but the token-aware checks are kept for forward-compat if the
    // dashboard ever merges agent sessions into `sessionsAll`.
    const id = (s.agentId || "").toLowerCase();
    const tokens = new Set(id.split(/[\s/.,_\-]+/).filter(Boolean));
    if (tokens.has("omp")) {
        return "OMP";
    }
    if (tokens.has("pi")) {
        return "Pi";
    }
    return "Chat";
}
function pickActiveSessionShort(sessions, activationTime) {
    let best;
    for (const s of sessions) {
        if (!s.last || s.last < activationTime) {
            continue;
        }
        if (!best || s.last > best.last) {
            best = s;
        }
    }
    return best?.sessionShort ?? "";
}
//# sourceMappingURL=sidebarSnapshot.js.map