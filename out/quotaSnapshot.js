"use strict";
/**
 * quotaSnapshot.ts — GitHub's own AI-credit ledger.
 *
 * Every other number in this extension is reconstructed from local debug
 * logs. That reconstruction is structurally incomplete:
 *
 *   • Requests billed on another machine, in another IDE, on github.com,
 *     or by the cloud agent never produce a local `main.jsonl`.
 *   • Requests dispatched through VS Code's public `LanguageModelChat`
 *     wrapper (`debugName: "copilotLanguageModelWrapper"`) omit
 *     `copilotUsageNanoAiu` entirely, so they can only ever be rate-estimated.
 *   • Rotated / deleted debug logs take their credits with them.
 *
 * `GET /copilot_internal/user` is the same endpoint the official Copilot
 * extension polls to render its own quota UI. Its `quota_snapshots` block
 * carries the server-side truth:
 *
 *   quota_snapshots.premium_interactions = {
 *     quota_id:            "premium_interactions",
 *     credits_used:        38844,      // AIC consumed this cycle
 *     entitlement:         201900,     // pooled AIC available this cycle
 *     remaining:           163055,
 *     overage_count:       0,
 *     overage_permitted:   true,
 *     token_based_billing: true,       // false ⇒ legacy premium-request seat
 *     timestamp_utc:       "…"
 *   }
 *
 * Under usage-based billing GitHub reuses the `premium_interactions` quota id
 * for AI credits — `token_based_billing: true` is what marks the values as
 * AIC rather than legacy premium-request counts.
 *
 * We treat `credits_used` as authoritative for the headline total and keep
 * the locally-derived breakdown for attribution (per model, per day, per
 * session), which the API does not provide.
 *
 * Note: on a pooled Business/Enterprise plan `entitlement` is the *pooled*
 * allowance visible to this seat, which is why it can read 201,900 rather
 * than the per-user 1,900.
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
exports.getCachedQuotaSnapshot = getCachedQuotaSnapshot;
exports.clearQuotaSnapshotCache = clearQuotaSnapshotCache;
exports.parseQuotaSnapshot = parseQuotaSnapshot;
exports.fetchQuotaSnapshot = fetchQuotaSnapshot;
const vscode = __importStar(require("vscode"));
/** Cache TTL — the endpoint updates within a minute or two of real usage. */
const TTL_MS = 5 * 60 * 1000;
const ENDPOINT = "https://api.github.com/copilot_internal/user";
let cached = null;
/** Last snapshot fetched, without triggering a network call. */
function getCachedQuotaSnapshot() {
    return cached;
}
/** Drop the cache so the next `fetchQuotaSnapshot` re-queries. Test hook. */
function clearQuotaSnapshotCache() {
    cached = null;
}
/**
 * Pick the AI-credit quota out of a `/copilot_internal/user` payload.
 *
 * Exported so it can be unit-tested against recorded payloads without a
 * network call or a `vscode` session.
 */
function parseQuotaSnapshot(body) {
    const user = body;
    const snapshots = user?.quota_snapshots;
    if (!snapshots || typeof snapshots !== "object") {
        return null;
    }
    // `premium_interactions` is the AIC bucket under usage-based billing;
    // scan the rest as a hedge against GitHub renaming the quota id.
    const ordered = [
        snapshots["premium_interactions"],
        ...Object.entries(snapshots)
            .filter(([id]) => id !== "premium_interactions")
            .map(([, snap]) => snap),
    ];
    for (const snap of ordered) {
        if (!snap || typeof snap !== "object") {
            continue;
        }
        // `chat` / `completions` report token_based_billing too but are unlimited
        // and always read zero — an entitlement is what marks the real AIC bucket.
        const entitlement = Number(snap.entitlement ?? 0);
        const creditsUsed = Number(snap.credits_used ?? 0);
        if (entitlement <= 0 && creditsUsed <= 0) {
            continue;
        }
        if (snap.token_based_billing !== true) {
            continue;
        }
        return {
            creditsUsed,
            entitlement,
            remaining: Number(snap.remaining ?? Math.max(0, entitlement - creditsUsed)),
            overageCount: Number(snap.overage_count ?? 0),
            overagePermitted: snap.overage_permitted === true,
            quotaResetDate: typeof user?.quota_reset_date === "string" ? user.quota_reset_date : undefined,
            timestampUtc: typeof snap.timestamp_utc === "string" ? snap.timestamp_utc : undefined,
            fetchedAt: Date.now(),
        };
    }
    return null;
}
/**
 * Reuse whatever GitHub session VS Code already cached. Silent only — this
 * runs on every refresh, so it must never prompt. `planDetector` owns the
 * one-time consent flow; once the user has granted it, these silent calls
 * succeed for good.
 */
async function silentSession() {
    const scopeCandidates = [
        ["read:user"],
        ["user:email"],
        ["repo", "workflow", "read:user"],
        ["repo"],
    ];
    for (const scopes of scopeCandidates) {
        try {
            const s = await vscode.authentication.getSession("github", scopes, {
                silent: true,
                createIfNone: false,
            });
            if (s) {
                return s;
            }
        }
        catch {
            // Try the next scope set.
        }
    }
    return undefined;
}
/**
 * Fetch GitHub's authoritative credit ledger for the current cycle.
 *
 * Returns `null` on any failure (offline, no session, endpoint moved) so
 * callers transparently fall back to the locally-derived total. Never throws.
 */
async function fetchQuotaSnapshot(log, force = false) {
    if (!force && cached && Date.now() - cached.fetchedAt < TTL_MS) {
        return cached;
    }
    const session = await silentSession();
    if (!session) {
        log("quotaSnapshot: no silent GitHub session — skipping");
        return cached;
    }
    try {
        const res = await fetch(ENDPOINT, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${session.accessToken}`,
                Accept: "application/vnd.github+json",
                "User-Agent": "vscode-copilot-usage-dashboard",
            },
        });
        if (!res.ok) {
            log(`quotaSnapshot: ${ENDPOINT} returned ${res.status}`);
            return cached;
        }
        const snapshot = parseQuotaSnapshot(await res.json());
        if (!snapshot) {
            log("quotaSnapshot: response carried no token-based quota bucket");
            return cached;
        }
        cached = snapshot;
        log(`quotaSnapshot: credits_used=${snapshot.creditsUsed} entitlement=${snapshot.entitlement} remaining=${snapshot.remaining}`);
        return snapshot;
    }
    catch (err) {
        log(`quotaSnapshot: fetch error — ${String(err)}`);
        return cached;
    }
}
//# sourceMappingURL=quotaSnapshot.js.map