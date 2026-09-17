"use strict";
/**
 * ttlState.ts — Pure prompt-cache TTL state machine. Zero `vscode` and zero
 * `fs` imports so it is trivially unit-testable.
 *
 * Derived from the MIT-licensed `cache-timer` extension
 * (https://github.com/sukumarp2022/cache-timer, © 2026 sukumarp2022) — the
 * `parse` state helpers, `format`, `urgency`, and `alert` modules are merged
 * here. See LICENSE for the full attribution notice.
 *
 * WHY A SEPARATE STATE MACHINE
 * ----------------------------
 * Providers keep a prompt cache alive for a short window after the last API
 * call (Anthropic documents ~5 min; OpenAI and Google are undocumented). Send
 * the next turn inside that window and the cached prefix is re-read at a
 * fraction of the input rate; miss it and the whole prefix is re-billed at the
 * full rate. `src/cache.ts` tells you how much reuse you GOT. This file tells
 * you how long you have LEFT to keep getting it.
 *
 * All thresholds are user-configurable and presented as approximate — none of
 * this is a documented billing guarantee.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.URGENCY = void 0;
exports.computeRemaining = computeRemaining;
exports.computeWorking = computeWorking;
exports.computeState = computeState;
exports.isWithinActiveWindow = isWithinActiveWindow;
exports.urgencyCompare = urgencyCompare;
exports.stateEmoji = stateEmoji;
exports.stateColor = stateColor;
exports.formatTtl = formatTtl;
exports.stateDisplay = stateDisplay;
exports.aggregateText = aggregateText;
exports.shortTitle = shortTitle;
exports.alertDecision = alertDecision;
// ─── State computation ────────────────────────────────────────
/** `remaining = timerValue - elapsedSeconds`. May go negative. */
function computeRemaining(timerValue, nowMs, lastRequestMs) {
    return timerValue - (nowMs - lastRequestMs) / 1000;
}
/**
 * A session is "working" (HOT) when a turn is open — the last `turn_start`
 * came after the last `turn_end`. When neither marker exists (CLI sessions,
 * or debug-logs from older Copilot builds) fall back to a short grace window
 * after the last request.
 */
function computeWorking(marks, nowMs, workingGraceSeconds) {
    const { lastTurnStartMs: start, lastTurnEndMs: end, lastRequestMs } = marks;
    if (start > 0 && start > end) {
        return true;
    }
    if (start === 0 && end === 0 && lastRequestMs > 0) {
        return nowMs - lastRequestMs <= workingGraceSeconds * 1000;
    }
    return false;
}
function computeState(working, remaining, warnAt, alertAt) {
    if (working) {
        return "hot";
    }
    if (remaining <= 0) {
        return "cold";
    }
    if (remaining <= alertAt) {
        return "red";
    }
    if (remaining <= warnAt) {
        return "yellow";
    }
    return "green";
}
/** Still worth showing: within `timerValue + grace` of the last request. */
function isWithinActiveWindow(lastRequestMs, nowMs, timerValue, expiredGraceSeconds) {
    if (lastRequestMs <= 0) {
        return false;
    }
    return (nowMs - lastRequestMs) / 1000 <= timerValue + expiredGraceSeconds;
}
// ─── Ordering ─────────────────────────────────────────────────
/** Lower number = more urgent. Drives which session leads the status bar. */
exports.URGENCY = {
    red: 0,
    yellow: 1,
    green: 2,
    hot: 3,
    cold: 4,
};
function urgencyCompare(a, b) {
    const ua = exports.URGENCY[a.state] ?? exports.URGENCY.green;
    const ub = exports.URGENCY[b.state] ?? exports.URGENCY.green;
    if (ua !== ub) {
        return ua - ub;
    }
    return a.remaining - b.remaining;
}
// ─── Formatting ───────────────────────────────────────────────
function stateEmoji(state) {
    switch (state) {
        case "hot":
            return "\u{1F525}";
        case "green":
            return "\u{1F7E2}";
        case "yellow":
            return "\u{1F7E1}";
        case "red":
            return "\u{1F534}";
        case "cold":
            return "\u2744\uFE0F";
    }
}
/** Theme-color token for the state, used by the sidebar/dashboard webviews. */
function stateColor(state) {
    switch (state) {
        case "hot":
            return "var(--vscode-charts-blue)";
        case "green":
            return "var(--vscode-charts-green)";
        case "yellow":
            return "var(--vscode-charts-yellow)";
        case "red":
            return "var(--vscode-charts-red)";
        case "cold":
            return "var(--vscode-descriptionForeground)";
    }
}
function pad2(n) {
    return n < 10 ? `0${n}` : `${n}`;
}
/** `M:SS`, or `H:MM:SS` at or above one hour. Negative clamps to `0:00`. */
function formatTtl(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;
    if (hours >= 1) {
        return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
    }
    return `${minutes}:${pad2(seconds)}`;
}
/** `HOT` / `COLD` label, or the live countdown. */
function stateDisplay(state, remaining) {
    if (state === "hot") {
        return "HOT";
    }
    if (state === "cold") {
        return "COLD";
    }
    return formatTtl(remaining);
}
/** Compact `<emoji> <display>` for the most urgent session, plus a count. */
function aggregateText(sessions) {
    if (sessions.length === 0) {
        return "";
    }
    const top = sessions[0];
    const display = stateDisplay(top.state, top.remaining);
    const count = sessions.length > 1 ? ` (${sessions.length})` : "";
    return `${stateEmoji(top.state)} ${display}${count}`;
}
/** Truncate a session title for narrow surfaces. */
function shortTitle(title, maxLen = 34) {
    const t = (title || "").trim().replace(/\s+/g, " ");
    if (!t) {
        return "untitled";
    }
    return t.length > maxLen ? `${t.slice(0, maxLen - 1)}\u2026` : t;
}
/**
 * Fire only on the transition INTO red, so a session sitting at red does not
 * re-alert on every one-second tick.
 */
function alertDecision(prev, next, opts) {
    const enteredRed = next === "red" && prev !== "red";
    return {
        playSound: enteredRed && opts.soundEnabled,
        notify: enteredRed && opts.notifyOnRed,
    };
}
//# sourceMappingURL=ttlState.js.map