"use strict";
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
exports.registerSyncKeys = registerSyncKeys;
exports.publishAndRead = publishAndRead;
exports.__resetThrottleForTesting = __resetThrottleForTesting;
exports.readMachines = readMachines;
exports.combinedCredits = combinedCredits;
/**
 * machineSync.ts — Cross-machine usage aggregation over Settings Sync.
 *
 * Usage itself is never synced as raw data: every figure on the dashboard is
 * derived by scanning local files (`workspaceStorage`, `~/.omp`, `~/.pi`,
 * Copilot debug logs) that only exist on the machine that produced them. What
 * this module syncs is a compact per-machine *rollup* — credits by day, by
 * model, and a few counters — so a second machine can show a combined total
 * without ever seeing the other machine's logs or prompts.
 *
 * Merge model. VS Code's extensions synchroniser applies incoming state per
 * declared key with `local[key] = remote[key]` — a replace, not a merge (see
 * `updateExtensionState` in the shared process). A single flat usage blob
 * would therefore let whichever machine synced last erase the others. The
 * payload is instead a map keyed by `vscode.env.machineId`, and a machine only
 * ever writes its own slot after re-reading the map. Each machine is the sole
 * author of its own slot, so a lost race costs at most one refresh interval.
 */
const vscode = __importStar(require("vscode"));
const os = __importStar(require("os"));
const modelCatalog_1 = require("./modelCatalog");
/** globalState key for the per-machine usage rollups. */
const MACHINES_KEY = "copilotUsage.usage.machines.v1";
/** Days of daily history retained per machine — bounds the synced payload. */
const RETAIN_DAYS = 120;
/** A machine with no update for this long is reported as dormant. */
const DORMANT_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Minimum gap between writes of our own slot.
 *
 * The dashboard rebuilds whenever a request lands, and every `globalState`
 * write schedules a sync attempt. Enough of them in a row and the sync service
 * raises `LocalTooManyRequests`, which sets `suspendUntilRestart` and kills
 * auto-sync for the rest of the session. Throttling costs nothing here — the
 * rollup is a slow-moving daily aggregate.
 */
const PUBLISH_MIN_INTERVAL_MS = 5 * 60 * 1000;
let lastPublishAt = 0;
let lastPublishFingerprint = "";
/**
 * Declares every synced key in one call.
 *
 * `setKeysForSync` replaces the extension's whole declared-key list rather
 * than appending, so it must have exactly one caller — otherwise the last
 * module to run silently drops the other's key.
 */
function registerSyncKeys(ctx) {
    try {
        ctx.globalState.setKeysForSync([modelCatalog_1.CATALOG_SYNC_KEY, MACHINES_KEY]);
    }
    catch {
        // Restricted host / older API — sync is a bonus, never required.
    }
}
function trimDays(byDay) {
    const days = Object.keys(byDay).sort();
    if (days.length <= RETAIN_DAYS)
        return byDay;
    const keep = days.slice(days.length - RETAIN_DAYS);
    const out = {};
    for (const d of keep)
        out[d] = byDay[d];
    return out;
}
/**
 * Writes this machine's slot and returns every known machine, ordered and
 * labelled. Read-modify-write so a synced update from another machine is
 * preserved rather than overwritten.
 */
function publishAndRead(ctx, local) {
    const id = vscode.env.machineId;
    const now = Date.now();
    const map = { ...(ctx.globalState.get(MACHINES_KEY) ?? {}) };
    const prior = map[id];
    // Nothing meaningful changed, or we wrote very recently — read only. The
    // returned view still reflects whatever other machines have synced in.
    const fingerprint = `${local.cycleStart}|${local.cycleCredits}|${local.sessions}|${local.turns}`;
    const skip = !!prior &&
        (fingerprint === lastPublishFingerprint || now - lastPublishAt < PUBLISH_MIN_INTERVAL_MS);
    if (skip)
        return decorate(map, id, now);
    map[id] = {
        host: os.hostname(),
        platform: process.platform,
        firstSeen: prior?.firstSeen ?? now,
        lastSeen: now,
        cycleStart: local.cycleStart,
        cycleCredits: local.cycleCredits,
        sessions: local.sessions,
        turns: local.turns,
        totalTokens: local.totalTokens,
        byDay: trimDays(local.byDay),
        byModel: local.byModel,
    };
    lastPublishAt = now;
    lastPublishFingerprint = fingerprint;
    void ctx.globalState.update(MACHINES_KEY, map);
    return decorate(map, id, now);
}
/** Test seam: clears the publish throttle. */
function __resetThrottleForTesting() {
    lastPublishAt = 0;
    lastPublishFingerprint = "";
}
/** Reads without publishing — for consumers that only render. */
function readMachines(ctx) {
    const map = ctx.globalState.get(MACHINES_KEY) ?? {};
    return decorate(map, vscode.env.machineId, Date.now());
}
function decorate(map, thisId, now) {
    return Object.entries(map)
        .filter(([, s]) => s && typeof s.firstSeen === "number")
        // firstSeen is part of the synced slot, so every machine derives the same
        // ordering and "System 2" means the same system on all of them.
        .sort((a, b) => a[1].firstSeen - b[1].firstSeen || a[0].localeCompare(b[0]))
        .map(([id, slot], i) => ({
        ...slot,
        id,
        systemNo: i + 1,
        label: `System ${i + 1}`,
        isThisMachine: id === thisId,
        dormant: now - slot.lastSeen > DORMANT_MS,
    }));
}
/** Sums slots that describe the same billing cycle. */
function combinedCredits(views, cycleStart) {
    const total = views
        .filter(v => v.cycleStart === cycleStart)
        .reduce((s, v) => s + (v.cycleCredits || 0), 0);
    return Math.round(total * 100) / 100;
}
//# sourceMappingURL=machineSync.js.map