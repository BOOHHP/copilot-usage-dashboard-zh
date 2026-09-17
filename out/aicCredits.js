"use strict";
/**
 * aicCredits.ts — AI Credits (AIC) cost calculation engine.
 *
 * GitHub Copilot moved to usage-based billing with AI Credits (AIC) starting June 1, 2026.
 * Reference: https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-organizations-and-enterprises
 *
 * This module provides a configurable, per-model credit cost system that can be
 * updated as GitHub changes pricing without code changes.
 *
 * Architecture:
 *  - ModelCostConfig defines per-model rates (credits per 1M tokens input/output)
 *  - PlanConfig defines plan-level limits and included credits
 *  - AICCalculator computes credits consumed from token counts
 *  - Configuration is loaded from settings with sensible defaults
 *
 * Rate resolution order (findModelRate):
 *   1. Live CAPI catalog via `getRatesFor()` — authoritative when available.
 *   2. Static `DEFAULT_MODEL_COSTS` / user-supplied `customModelCosts` —
 *      offline fallback (exact, then substring).
 *   3. Family fallback — newest rate in the same model family, so a point
 *      release GitHub ships between extension updates is still priced and
 *      still classified as Copilot-billable.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_AIC_CONFIG = exports.AICCalculator = exports.DEFAULT_PLANS = exports.DEFAULT_MODEL_COSTS = void 0;
exports.getPromoInfo = getPromoInfo;
exports.createCalculatorFromConfig = createCalculatorFromConfig;
exports.isByokWrapperCall = isByokWrapperCall;
exports.isCopilotVendor = isCopilotVendor;
exports.classifyModelBillability = classifyModelBillability;
const modelCatalog_1 = require("./modelCatalog");
// ─── Default Model Cost Rates ─────────────────────────────────
// Official GitHub Copilot AI Credits pricing (effective June 1, 2025)
// Source: https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing
//
// 1 AI credit = $0.01 USD. All rates are AI Credits per 1 Million tokens.
// Conversion: USD price × 100 = credits.
//
// Anthropic models include a separate "cache write" cost.
// OpenAI/Google models: cache write = 0 (no separate charge).
exports.DEFAULT_MODEL_COSTS = [
    // ── Anthropic (includes cache write cost) ──
    // Source: https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing#anthropic
    { model: "claude-opus-5", inputCreditsPerMillion: 500, outputCreditsPerMillion: 2500, cachedInputCreditsPerMillion: 50, cacheWriteCreditsPerMillion: 625, tier: "premium" },
    { model: "claude-opus-4.8", inputCreditsPerMillion: 500, outputCreditsPerMillion: 2500, cachedInputCreditsPerMillion: 50, cacheWriteCreditsPerMillion: 625, tier: "premium" },
    { model: "claude-opus-4.7", inputCreditsPerMillion: 500, outputCreditsPerMillion: 2500, cachedInputCreditsPerMillion: 50, cacheWriteCreditsPerMillion: 625, tier: "premium" },
    { model: "claude-opus-4.6", inputCreditsPerMillion: 500, outputCreditsPerMillion: 2500, cachedInputCreditsPerMillion: 50, cacheWriteCreditsPerMillion: 625, tier: "premium" },
    { model: "claude-opus-4.5", inputCreditsPerMillion: 500, outputCreditsPerMillion: 2500, cachedInputCreditsPerMillion: 50, cacheWriteCreditsPerMillion: 625, tier: "premium" },
    { model: "claude-sonnet-4.6", inputCreditsPerMillion: 300, outputCreditsPerMillion: 1500, cachedInputCreditsPerMillion: 30, cacheWriteCreditsPerMillion: 375, tier: "base" },
    { model: "claude-sonnet-4.5", inputCreditsPerMillion: 300, outputCreditsPerMillion: 1500, cachedInputCreditsPerMillion: 30, cacheWriteCreditsPerMillion: 375, tier: "base" },
    { model: "claude-sonnet-5", inputCreditsPerMillion: 200, outputCreditsPerMillion: 1000, cachedInputCreditsPerMillion: 20, cacheWriteCreditsPerMillion: 250, tier: "base" },
    { model: "claude-sonnet-4", inputCreditsPerMillion: 300, outputCreditsPerMillion: 1500, cachedInputCreditsPerMillion: 30, cacheWriteCreditsPerMillion: 375, tier: "base" },
    { model: "claude-haiku-4.5", inputCreditsPerMillion: 100, outputCreditsPerMillion: 500, cachedInputCreditsPerMillion: 10, cacheWriteCreditsPerMillion: 125, tier: "base" },
    // ── OpenAI ──
    // Source: https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing#openai
    { model: "gpt-4o-mini", inputCreditsPerMillion: 15, outputCreditsPerMillion: 60, cachedInputCreditsPerMillion: 7.5, cacheWriteCreditsPerMillion: 0, tier: "base" },
    { model: "gpt-4o", inputCreditsPerMillion: 250, outputCreditsPerMillion: 1000, cachedInputCreditsPerMillion: 125, cacheWriteCreditsPerMillion: 0, tier: "base" },
    { model: "gpt-5.6-sol", inputCreditsPerMillion: 200, outputCreditsPerMillion: 1000, cachedInputCreditsPerMillion: 50, cacheWriteCreditsPerMillion: 0, tier: "premium" },
    { model: "gpt-5.6-terra", inputCreditsPerMillion: 200, outputCreditsPerMillion: 1200, cachedInputCreditsPerMillion: 25, cacheWriteCreditsPerMillion: 0, tier: "premium" },
    { model: "gpt-5.6-luna", inputCreditsPerMillion: 20, outputCreditsPerMillion: 120, cachedInputCreditsPerMillion: 10, cacheWriteCreditsPerMillion: 0, tier: "base" },
    { model: "gpt-5.5", inputCreditsPerMillion: 500, outputCreditsPerMillion: 3000, cachedInputCreditsPerMillion: 50, cacheWriteCreditsPerMillion: 0, tier: "premium" },
    { model: "gpt-5.4", inputCreditsPerMillion: 250, outputCreditsPerMillion: 1500, cachedInputCreditsPerMillion: 25, cacheWriteCreditsPerMillion: 0, tier: "premium" },
    { model: "gpt-5.4-mini", inputCreditsPerMillion: 75, outputCreditsPerMillion: 450, cachedInputCreditsPerMillion: 7.5, cacheWriteCreditsPerMillion: 0, tier: "base" },
    { model: "gpt-5.4-nano", inputCreditsPerMillion: 20, outputCreditsPerMillion: 125, cachedInputCreditsPerMillion: 2, cacheWriteCreditsPerMillion: 0, tier: "base" },
    { model: "gpt-5.3-codex", inputCreditsPerMillion: 175, outputCreditsPerMillion: 1400, cachedInputCreditsPerMillion: 17.5, cacheWriteCreditsPerMillion: 0, tier: "premium" },
    { model: "gpt-5.2-codex", inputCreditsPerMillion: 175, outputCreditsPerMillion: 1400, cachedInputCreditsPerMillion: 17.5, cacheWriteCreditsPerMillion: 0, tier: "premium" },
    { model: "gpt-5.2", inputCreditsPerMillion: 175, outputCreditsPerMillion: 1400, cachedInputCreditsPerMillion: 17.5, cacheWriteCreditsPerMillion: 0, tier: "premium" },
    { model: "gpt-5-mini", inputCreditsPerMillion: 25, outputCreditsPerMillion: 200, cachedInputCreditsPerMillion: 2.5, cacheWriteCreditsPerMillion: 0, tier: "base" },
    { model: "gpt-4.1", inputCreditsPerMillion: 200, outputCreditsPerMillion: 800, cachedInputCreditsPerMillion: 50, cacheWriteCreditsPerMillion: 0, tier: "base" },
    // ── Google ──
    // Source: https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing#google
    { model: "gemini-3.6-flash", inputCreditsPerMillion: 75, outputCreditsPerMillion: 375, cachedInputCreditsPerMillion: 15, cacheWriteCreditsPerMillion: 0, tier: "base" },
    { model: "gemini-3.5-flash", inputCreditsPerMillion: 150, outputCreditsPerMillion: 900, cachedInputCreditsPerMillion: 15, cacheWriteCreditsPerMillion: 0, tier: "base" },
    { model: "gemini-3.1-pro", inputCreditsPerMillion: 200, outputCreditsPerMillion: 1200, cachedInputCreditsPerMillion: 20, cacheWriteCreditsPerMillion: 0, tier: "premium" },
    { model: "gemini-3-flash", inputCreditsPerMillion: 50, outputCreditsPerMillion: 300, cachedInputCreditsPerMillion: 5, cacheWriteCreditsPerMillion: 0, tier: "base" },
    { model: "gemini-2.5-pro", inputCreditsPerMillion: 125, outputCreditsPerMillion: 1000, cachedInputCreditsPerMillion: 12.5, cacheWriteCreditsPerMillion: 0, tier: "premium" },
    // ── Microsoft ──
    { model: "mai-code-1-flash", inputCreditsPerMillion: 75, outputCreditsPerMillion: 450, cachedInputCreditsPerMillion: 7, cacheWriteCreditsPerMillion: 0, tier: "base" },
    { model: "mai-code-1.1-flash", inputCreditsPerMillion: 20, outputCreditsPerMillion: 120, cachedInputCreditsPerMillion: 2, cacheWriteCreditsPerMillion: 0, tier: "base" },
    // ── xAI ──
    { model: "grok-4.5", inputCreditsPerMillion: 200, outputCreditsPerMillion: 600, cachedInputCreditsPerMillion: 20, cacheWriteCreditsPerMillion: 0, tier: "base" },
    // ── Fine-tuned (GitHub) ──
    { model: "raptor-mini", inputCreditsPerMillion: 25, outputCreditsPerMillion: 200, cachedInputCreditsPerMillion: 2.5, cacheWriteCreditsPerMillion: 0, tier: "base" },
];
// ─── Default Plan Configurations ──────────────────────────────
// Sources (verified live against docs.github.com):
//   • Individuals: https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals
//   • Org/Enterprise: https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-organizations-and-enterprises
//
// 1 AI credit = $0.01 USD.
//
// Individual plans (Pro / Pro+ / Max) include a "base credits" amount plus a
// "flex allotment" — both count toward the monthly total reported here:
//   Pro   = 1,000 base + 500 flex  = 1,500 total
//   Pro+  = 3,900 base + 3,100 flex = 7,000 total
//   Max   = 10,000 base + 10,000 flex = 20,000 total
//
// Organization plans (Business / Enterprise) pool credits at the billing
// entity level. Promotional uplift (June 1 – Sept 1, 2026) applies ONLY to
// existing Business and Enterprise customers — NOT to Free / Pro / Pro+ / Max.
//   Business    standard = 1,900 / promo = 3,000 (per user/month, pooled)
//   Enterprise  standard = 3,900 / promo = 7,000 (per user/month, pooled)
exports.DEFAULT_PLANS = {
    business: {
        planName: "business",
        includedPremiumRequests: 300, // legacy metric (pre-AIC)
        monthlyCreditsIncluded: 1900, // official: 1,900 AI credits per user/month (pooled)
        overageCostPerCredit: 0.01, // 1 credit = $0.01 USD
        billingCycleStartDay: 1,
    },
    business_promo: {
        planName: "business_promo",
        includedPremiumRequests: 300,
        monthlyCreditsIncluded: 3000, // promotional: June 1 – Sept 1, 2026
        overageCostPerCredit: 0.01,
        billingCycleStartDay: 1,
    },
    enterprise: {
        planName: "enterprise",
        includedPremiumRequests: 1000,
        monthlyCreditsIncluded: 3900, // official: 3,900 AI credits per user/month (pooled)
        overageCostPerCredit: 0.01,
        billingCycleStartDay: 1,
    },
    enterprise_promo: {
        planName: "enterprise_promo",
        includedPremiumRequests: 1000,
        monthlyCreditsIncluded: 7000, // promotional: June 1 – Sept 1, 2026
        overageCostPerCredit: 0.01,
        billingCycleStartDay: 1,
    },
    max: {
        planName: "max",
        includedPremiumRequests: 3000,
        monthlyCreditsIncluded: 20000, // Copilot Max: 10,000 base + 10,000 flex = 20,000
        overageCostPerCredit: 0.01,
        billingCycleStartDay: 1,
    },
    pro_plus: {
        planName: "pro_plus",
        includedPremiumRequests: 1500,
        monthlyCreditsIncluded: 7000, // Copilot Pro+: 3,900 base + 3,100 flex = 7,000
        overageCostPerCredit: 0.01,
        billingCycleStartDay: 1,
    },
    pro: {
        planName: "pro",
        includedPremiumRequests: 300,
        monthlyCreditsIncluded: 1500, // Copilot Pro: 1,000 base + 500 flex = 1,500
        overageCostPerCredit: 0.01,
        billingCycleStartDay: 1,
    },
    free: {
        planName: "free",
        includedPremiumRequests: 0,
        // Copilot Free: docs state an unspecified AI credits allowance plus 2,000
        // completions/month. GitHub has not published an official number, so 250
        // is a conservative placeholder. Override via copilotUsage.aic.monthlyCreditsIncluded.
        monthlyCreditsIncluded: 250,
        overageCostPerCredit: 0, // no overage on free — usage blocked
        billingCycleStartDay: 1,
    },
};
// ─── Promotional Period Detection ─────────────────────────────
/** Promo window: June 1, 2026 – September 1, 2026 (exclusive end) */
const PROMO_START = "2026-06-01";
const PROMO_END = "2026-09-01";
/** Promo budgets for existing customers during June 1 – Sept 1, 2026 */
const PROMO_BUDGETS = {
    business: 3000,
    business_promo: 3000,
    enterprise: 7000,
    enterprise_promo: 7000,
};
/**
 * Detect if the current date falls within the promotional period
 * and return the promo budget for the given plan.
 * Always uses the official standard budget from DEFAULT_PLANS for the
 * "without promo" comparison (ignoring any user overrides).
 */
function getPromoInfo(planName, _monthlyCreditsIncluded) {
    const today = new Date().toISOString().slice(0, 10);
    const isPromoActive = today >= PROMO_START && today < PROMO_END;
    const promoBudget = PROMO_BUDGETS[planName] ?? 0;
    // Standard budget: always use the official non-promo value for accurate comparison
    const basePlan = planName.replace("_promo", "");
    const standardBudget = exports.DEFAULT_PLANS[basePlan]?.monthlyCreditsIncluded
        ?? exports.DEFAULT_PLANS.business.monthlyCreditsIncluded;
    return {
        isPromoActive,
        promoBudget: isPromoActive ? promoBudget : 0,
        standardBudget,
        promoEndDate: PROMO_END,
    };
}
// ─── AIC Calculator ───────────────────────────────────────────
class AICCalculator {
    modelCosts;
    plan;
    constructor(modelCosts = exports.DEFAULT_MODEL_COSTS, plan = exports.DEFAULT_PLANS.business) {
        this.modelCosts = new Map();
        for (const mc of modelCosts) {
            this.modelCosts.set(mc.model.toLowerCase(), mc);
        }
        this.plan = plan;
    }
    /** Update plan configuration */
    setPlan(plan) {
        this.plan = plan;
    }
    /** Get current plan */
    getPlan() {
        return this.plan;
    }
    /** Update model costs (merges with existing) */
    updateModelCosts(costs) {
        for (const mc of costs) {
            this.modelCosts.set(mc.model.toLowerCase(), mc);
        }
    }
    /** Get all configured model costs */
    getModelCosts() {
        return Array.from(this.modelCosts.values());
    }
    /**
     * Whether `modelName` is recognised as a GitHub-Copilot-billable model.
     *
     * Used by issue #5 to filter out local Ollama / LM Studio / BYOK models
     * (which VS Code still routes through its chat OTel pipeline but which
     * GitHub does NOT bill in AI Credits) so they don't inflate the dashboard's
     * billable total.
     *
     * A model is considered "known GHC" iff it matches an entry in the rate
     * table (default + any user-supplied `customModelCosts`). The match uses
     * the same normalization as `findModelRate()` so e.g. "claude-opus-4-6"
     * and "claude-opus-4.6" both resolve.
     */
    isKnownGHCModel(modelName) {
        return this.findModelRate(modelName) !== null;
    }
    /**
     * Find the best matching cost rate for a model name.
    * Uses one-way substring matching for flexibility with normalization:
     * OTel reports model names with hyphens (e.g., "claude-opus-4-6") while the
     * rate table uses dots (e.g., "claude-opus-4.6"). We normalize version
     * separators before matching.
    *
    * The observed model name may include a suffix or provider namespace around
    * a known rate-table id (for example "gpt-4o-mini-2024-07-18"), but a short
    * observed id must not match a longer rate-table id. Otherwise local/BYOK
    * aliases like "gpt-4" or "claude" are incorrectly treated as GitHub
    * Copilot-billable models.
    *
    * Unmatched ids get one last chance via `_findFamilyRate()` before we give
    * up and treat the model as unknown.
     */
    findModelRate(modelName) {
        const explicit = this._findExplicitRate(modelName);
        if (explicit) {
            return explicit;
        }
        const normalized = modelName.toLowerCase().replace(/(\d)-(\d)/g, "$1.$2");
        // Reaching here means the snapshot may predate this model — let the
        // catalog decide whether that warrants an out-of-band refresh.
        (0, modelCatalog_1.notifyUnknownModel)(modelName);
        // 3) Family fallback — price an unseen point release from its family.
        return this._findFamilyRate(normalized);
    }
    /** Rate lookup restricted to authoritative sources — no family guessing. */
    _findExplicitRate(modelName) {
        // 1) Live CAPI catalog — authoritative and self-updating.
        const live = (0, modelCatalog_1.getRatesFor)(modelName);
        if (live)
            return live;
        // 2) Fall back to the static rate table (default + user overrides).
        const lower = modelName.toLowerCase();
        // Normalize: replace version-number hyphens with dots
        // "claude-opus-4-6" → "claude-opus-4.6", "gpt-4o-mini" stays unchanged
        const normalized = lower.replace(/(\d)-(\d)/g, "$1.$2");
        // Exact match first (try both original and normalized)
        if (this.modelCosts.has(lower)) {
            return this.modelCosts.get(lower);
        }
        if (normalized !== lower && this.modelCosts.has(normalized)) {
            return this.modelCosts.get(normalized);
        }
        // Substring match: find longest matching key (try both forms)
        let bestMatch = null;
        let bestLen = 0;
        for (const [key, rate] of this.modelCosts) {
            if ((normalized.includes(key) || lower.includes(key)) && key.length > bestLen) {
                bestMatch = rate;
                bestLen = key.length;
            }
        }
        return bestMatch;
    }
    /**
     * Resolve a model the rate table has never seen by borrowing the newest
     * rate from its own family: `claude-opus-6` → `claude-opus-4.8`,
     * `gpt-5.7-codex` → `gpt-5.3-codex`, `gemini-4.0-flash` → `gemini-3.6-flash`.
     *
     * Without this, every model GitHub ships between extension releases (and
     * every model the live CAPI catalog fails to return) falls through to the
     * "unknown model" path in `calculateCredits()`: gpt-4.1 rates, a wrong
     * `base` tier, and — worst — `isKnownGHCModel() === false`, which dumps a
     * genuinely Copilot-billed model into the non-billable panel.
     *
     * The version tail may only be a bare integer when the family has two or
     * more segments. That keeps short BYOK aliases such as `gpt-4` / `gpt-5` /
     * `claude` unresolved, which the provider guard depends on
     * (tests/verify-rate-match-provider-guard.js). A brand-new major like
     * `gpt-6` therefore still needs the live catalog or a table entry.
     */
    _findFamilyRate(normalized) {
        // "5.6-sol" → version "5.6", variant "sol"; "4.8" → version "4.8", variant "".
        const VERSION_TAIL = /^(\d[\d.]*)(?:-(.+))?$/;
        const segs = normalized.split("-");
        for (let i = segs.length - 1; i >= 1; i--) {
            const tail = VERSION_TAIL.exec(segs.slice(i).join("-"));
            if (!tail || (i < 2 && !tail[1].includes("."))) {
                continue;
            }
            const variant = tail[2] ?? "";
            const prefix = segs.slice(0, i).join("-") + "-";
            let best = null;
            let bestVersion = -1;
            for (const [key, rate] of this.modelCosts) {
                if (!key.startsWith(prefix)) {
                    continue;
                }
                const cand = VERSION_TAIL.exec(key.slice(prefix.length));
                if (!cand || (cand[2] ?? "") !== variant) {
                    continue;
                }
                const version = parseFloat(cand[1]);
                if (version > bestVersion) {
                    bestVersion = version;
                    best = rate;
                }
            }
            if (best) {
                return { ...best, model: normalized };
            }
        }
        return null;
    }
    /**
     * Calculate credits for a single request/turn.
     */
    calculateCredits(modelName, inputTokens, outputTokens, cachedTokens = 0, cacheWriteTokens = 0) {
        const rate = this.findModelRate(modelName);
        if (!rate) {
            // Unknown model — apply GPT-4.1 rates as conservative default
            const defaultRate = {
                model: modelName,
                inputCreditsPerMillion: 200,
                outputCreditsPerMillion: 800,
                cachedInputCreditsPerMillion: 50,
                cacheWriteCreditsPerMillion: 0,
                tier: "base",
            };
            return this._compute(defaultRate, inputTokens, outputTokens, cachedTokens, cacheWriteTokens);
        }
        return this._compute(rate, inputTokens, outputTokens, cachedTokens, cacheWriteTokens);
    }
    _compute(rate, inputTokens, outputTokens, cachedTokens, cacheWriteTokens) {
        // Net input = total input - cached - cache_write
        // (prompt_tokens from the API includes cached reads AND cache writes)
        const netInput = Math.max(0, inputTokens - cachedTokens - cacheWriteTokens);
        const inputCredits = (netInput / 1_000_000) * rate.inputCreditsPerMillion;
        const outputCredits = (outputTokens / 1_000_000) * rate.outputCreditsPerMillion;
        const cachedCredits = (cachedTokens / 1_000_000) * rate.cachedInputCreditsPerMillion;
        const cacheWriteCredits = (cacheWriteTokens / 1_000_000) * rate.cacheWriteCreditsPerMillion;
        return {
            inputCredits,
            outputCredits,
            cachedCredits,
            totalCredits: inputCredits + outputCredits + cachedCredits + cacheWriteCredits,
            model: rate.model,
            tier: rate.tier,
            inputTokens,
            outputTokens,
            cachedTokens,
        };
    }
    /**
     * Compute a full credit summary from session data.
     *
     * Each entry is classified as **billable** or **non-billable** before being
     * accumulated. Headline totals reflect billable usage only; non-billable
     * usage (BYOK / local Ollama / unrecognised models without
     * `copilotUsageNanoAiu`) is surfaced separately under `nonBillable`.
     * See issue #5.
     *
     * An entry is treated as billable when:
     *   • `actualCredits > 0` (GitHub's backend already billed it), OR
     *   • `entry.billable === true` (caller forced it on, e.g. allow-list), OR
     *   • `entry.billable` is undefined AND the model is known to the rate table.
     *
     * The summary is also restricted to the current billing cycle window —
     * previously every entry since the AIC effective date (`2026-06-01`) was
     * counted, which over-reported once a user crossed a cycle boundary or had
     * a non-day-1 cycle start.
     */
    computeSummary(entries) {
        // Billing-cycle window — entries outside this window are dropped so the
        // dashboard total matches "what GitHub will bill you this cycle" rather
        // than "everything since June 1". (Fix #2 in issue #5.)
        const { start, end, daysRemaining } = this._getBillingCycle();
        const byModel = new Map();
        const byDay = new Map();
        let totalCredits = 0;
        let totalInput = 0;
        let totalOutput = 0;
        let totalCached = 0;
        // Non-billable bucket (informational only — never sums into headline totals
        // or budget math).
        const nonBillableByModel = new Map();
        const nonBillableByDay = new Map();
        let nonBillableTotal = 0;
        const accumulate = (map, usage) => {
            const existing = map.get(usage.model);
            if (existing) {
                existing.inputCredits += usage.inputCredits;
                existing.outputCredits += usage.outputCredits;
                existing.cachedCredits += usage.cachedCredits;
                existing.totalCredits += usage.totalCredits;
                existing.inputTokens = (existing.inputTokens ?? 0) + (usage.inputTokens ?? 0);
                existing.outputTokens = (existing.outputTokens ?? 0) + (usage.outputTokens ?? 0);
                existing.cachedTokens = (existing.cachedTokens ?? 0) + (usage.cachedTokens ?? 0);
            }
            else {
                map.set(usage.model, { ...usage });
            }
        };
        for (const entry of entries) {
            // Cycle-window filter. Empty/"unknown" dates are kept (callers like the
            // agent-session path may pass dates derived from agent metadata).
            const day = entry.date || "unknown";
            if (day !== "unknown" && (day < start || day > end)) {
                continue;
            }
            let usage;
            if (entry.actualCredits !== undefined && entry.actualCredits > 0) {
                // API-reported actual credits (includes cache discounts) — authoritative total.
                // To preserve a meaningful input/output/cached breakdown for the
                // "AI Credits by Model" table, derive the rate-based split from the
                // entry's tokens and scale each component so the three sum to the
                // exact API-billed total. Without this, the table previously
                // attributed 100% of credits to the Input column and showed
                // Output=0 / Cached=0 for every model whose debug logs carried
                // `copilotUsageNanoAiu` (i.e. essentially every post-June-1 turn).
                const rate = this.findModelRate(entry.model);
                const estimate = rate
                    ? this._compute(rate, entry.inputTokens, entry.outputTokens, entry.cachedTokens, 0)
                    : null;
                const estTotal = estimate
                    ? estimate.inputCredits + estimate.outputCredits + estimate.cachedCredits
                    : 0;
                if (estimate && estTotal > 0) {
                    const scale = entry.actualCredits / estTotal;
                    usage = {
                        inputCredits: estimate.inputCredits * scale,
                        outputCredits: estimate.outputCredits * scale,
                        cachedCredits: estimate.cachedCredits * scale,
                        totalCredits: entry.actualCredits,
                        model: entry.billable === false ? entry.model : rate?.model ?? entry.model,
                        tier: rate?.tier ?? "premium",
                        inputTokens: entry.inputTokens,
                        outputTokens: entry.outputTokens,
                        cachedTokens: entry.cachedTokens,
                    };
                }
                else {
                    // No rate match or zero token counts (e.g. OMP/Pi agent entries
                    // that don't supply per-bucket tokens) — fall back to all-input.
                    usage = {
                        inputCredits: entry.actualCredits,
                        outputCredits: 0,
                        cachedCredits: 0,
                        totalCredits: entry.actualCredits,
                        model: entry.billable === false ? entry.model : rate?.model ?? entry.model,
                        tier: rate?.tier ?? "premium",
                        inputTokens: entry.inputTokens,
                        outputTokens: entry.outputTokens,
                        cachedTokens: entry.cachedTokens,
                    };
                }
            }
            else {
                usage = this.calculateCredits(entry.model, entry.inputTokens, entry.outputTokens, entry.cachedTokens);
                // `calculateCredits` reports the rate-table id it matched, which drops
                // any provider prefix the caller attached. For a non-billable row that
                // prefix is the only thing distinguishing BYOK traffic from the
                // identically-named Copilot model, so keep the caller's name — same
                // rule the `actualCredits` branch above already applies.
                if (entry.billable === false) {
                    usage = { ...usage, model: entry.model };
                }
            }
            // Billable classification. Caller's explicit `billable` flag wins —
            // the dashboard knows things the calculator can't (e.g. "this OMP/Pi
            // agent call uses an Ollama model and shouldn't count as billed even
            // though we attached our own rate-derived `actualCredits` to it").
            // When the caller doesn't decide, `actualCredits > 0` (i.e. the value
            // came straight from GitHub's `copilotUsageNanoAiu`) is the next-best
            // positive signal, falling back to "is this a known GHC model?".
            let isBillable;
            if (entry.billable !== undefined) {
                isBillable = entry.billable;
            }
            else if (entry.actualCredits !== undefined && entry.actualCredits > 0) {
                isBillable = true;
            }
            else {
                isBillable = this.isKnownGHCModel(entry.model);
            }
            if (!isBillable) {
                nonBillableTotal += usage.totalCredits;
                accumulate(nonBillableByModel, usage);
                let dayBucket = nonBillableByDay.get(day);
                if (!dayBucket) {
                    dayBucket = new Map();
                    nonBillableByDay.set(day, dayBucket);
                }
                accumulate(dayBucket, usage);
                continue;
            }
            totalCredits += usage.totalCredits;
            totalInput += usage.inputCredits;
            totalOutput += usage.outputCredits;
            totalCached += usage.cachedCredits;
            // Aggregate by model
            const existing = byModel.get(usage.model);
            if (existing) {
                existing.inputCredits += usage.inputCredits;
                existing.outputCredits += usage.outputCredits;
                existing.cachedCredits += usage.cachedCredits;
                existing.totalCredits += usage.totalCredits;
            }
            else {
                byModel.set(usage.model, { ...usage });
            }
            // Aggregate by day
            byDay.set(day, (byDay.get(day) ?? 0) + usage.totalCredits);
        }
        // Billing cycle calculations
        const daysElapsed = this._getDaysElapsed(start);
        const dailyAverage = daysElapsed > 0 ? totalCredits / daysElapsed : totalCredits;
        const projectedTotal = dailyAverage * (daysElapsed + daysRemaining);
        const creditsRemaining = this.plan.monthlyCreditsIncluded > 0
            ? Math.max(0, this.plan.monthlyCreditsIncluded - totalCredits)
            : -1;
        const overage = this.plan.monthlyCreditsIncluded > 0
            ? Math.max(0, totalCredits - this.plan.monthlyCreditsIncluded)
            : 0;
        return {
            totalCredits,
            inputCredits: totalInput,
            outputCredits: totalOutput,
            cachedCredits: totalCached,
            byModel,
            byDay,
            nonBillable: {
                totalCredits: nonBillableTotal,
                byModel: nonBillableByModel,
                byDay: nonBillableByDay,
            },
            plan: this.plan,
            creditsRemaining,
            estimatedOverageCost: overage * this.plan.overageCostPerCredit,
            billingCycleStart: start,
            billingCycleEnd: end,
            daysRemaining,
            dailyAverage,
            projectedTotal,
        };
    }
    _getBillingCycle() {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const startDay = this.plan.billingCycleStartDay;
        let cycleStart;
        let cycleEnd;
        if (now.getDate() >= startDay) {
            cycleStart = new Date(year, month, startDay);
            cycleEnd = new Date(year, month + 1, startDay - 1);
        }
        else {
            cycleStart = new Date(year, month - 1, startDay);
            cycleEnd = new Date(year, month, startDay - 1);
        }
        const msRemaining = cycleEnd.getTime() - now.getTime();
        const daysRemaining = Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)));
        // Serialize using LOCAL year/month/day, not UTC. The cycle is anchored to
        // the user's local calendar (billingCycleStartDay is a local day-of-month),
        // so converting via toISOString() shifts the date one day earlier for
        // positive UTC offsets (e.g. UTC+05:30 turns local Jun 1 00:00 into UTC
        // May 31 18:30, then slice(0,10) yields "2026-05-31"). See issue #2.
        return {
            start: formatLocalYMD(cycleStart),
            end: formatLocalYMD(cycleEnd),
            daysRemaining,
        };
    }
    _getDaysElapsed(cycleStart) {
        // Parse YYYY-MM-DD as LOCAL midnight, not UTC midnight. `new Date("YYYY-MM-DD")`
        // is interpreted as UTC per ECMA-262, which skews elapsed-day math by one
        // for users west of UTC and (combined with `now` in local time) by up to
        // a day for users east of UTC.
        const start = parseLocalYMD(cycleStart);
        const now = new Date();
        const elapsed = now.getTime() - start.getTime();
        return Math.max(1, Math.ceil(elapsed / (24 * 60 * 60 * 1000)));
    }
}
exports.AICCalculator = AICCalculator;
// ─── Local-date helpers (timezone-safe) ────────────────────────────────
// These intentionally avoid `toISOString()` so the produced string reflects
// the user's local calendar day. Used for billing-cycle labels, calendar
// headers, and any "today marker" that must match what the user sees on a
// wall clock — never for serializing UTC instants.
function formatLocalYMD(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}
function parseLocalYMD(ymd) {
    // Expect strict "YYYY-MM-DD". Fall back to native parsing for anything else
    // (e.g. full ISO timestamps) so this stays a drop-in replacement.
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!m) {
        return new Date(ymd);
    }
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
exports.DEFAULT_AIC_CONFIG = {
    plan: "business",
    billingCycleStartDay: 1,
    monthlyCreditsIncluded: 1900,
    overageCostPerCredit: 0.01,
    customModelCosts: [],
    includeOnlyBilledModels: true,
    excludeModels: [],
    extraBilledModels: [],
};
/**
 * Create an AICCalculator from persisted configuration.
 */
function createCalculatorFromConfig(config) {
    const planBase = exports.DEFAULT_PLANS[config.plan] ?? exports.DEFAULT_PLANS.business;
    const plan = {
        ...planBase,
        billingCycleStartDay: config.billingCycleStartDay,
        monthlyCreditsIncluded: config.monthlyCreditsIncluded,
        overageCostPerCredit: config.overageCostPerCredit,
    };
    // Merge default + custom model costs
    const allCosts = [...exports.DEFAULT_MODEL_COSTS];
    if (config.customModelCosts.length > 0) {
        for (const custom of config.customModelCosts) {
            // Replace if exists, otherwise add
            const idx = allCosts.findIndex(c => c.model.toLowerCase() === custom.model.toLowerCase());
            if (idx >= 0) {
                allCosts[idx] = custom;
            }
            else {
                allCosts.push(custom);
            }
        }
    }
    return new AICCalculator(allCosts, plan);
}
/**
 * `attrs.debugName` value Copilot Chat stamps on requests dispatched through
 * VS Code's public `LanguageModelChat` API — i.e. served by a BYOK provider
 * rather than Copilot's own routes, which instead name the calling feature
 * (`panel/editAgent`, `summarizeConversationHistory`, `title`, …).
 */
const BYOK_WRAPPER_DEBUG_NAME = "copilotlanguagemodelwrapper";
/**
 * Whether a request's `debugName` proves a BYOK provider served it.
 *
 * This is the only per-request routing evidence available when a model id is
 * served by BOTH Copilot and a BYOK key (e.g. `claude-opus-5`), where the id
 * alone cannot decide. Verified against real debug logs: every
 * `copilotLanguageModelWrapper` request reported zero `copilotUsageNanoAiu`,
 * while the same models' Copilot-routed requests reported real credits.
 */
function isByokWrapperCall(debugName) {
    return (debugName || "").trim().toLowerCase() === BYOK_WRAPPER_DEBUG_NAME;
}
function isCopilotSourceHint(sourceHint) {
    const lower = (sourceHint || "").toLowerCase();
    if (isByokWrapperCall(lower)) {
        return false;
    }
    return lower.includes("github") || lower.includes("copilot");
}
function isCopilotResolvedModelId(modelName) {
    const lower = (modelName || "").toLowerCase().trim();
    return /^(capi|capui)[-_]/.test(lower);
}
/**
 * Whether a vendor string recorded by VS Code denotes Copilot's own route.
 * Anything else (`customendpoint`, `ollama`, `azure`, …) is a BYOK provider
 * the user pays for directly.
 */
function isCopilotVendor(vendor) {
    return (vendor || "").trim().toLowerCase() === "copilot";
}
function classifyModelBillability(calculator, config, modelName, hasActualCredits, catalogLookup, sourceHint, recordedVendor) {
    const lower = (modelName || "").toLowerCase();
    const vendor = (recordedVendor || "").trim().toLowerCase();
    const isCopilotRouted = isCopilotVendor(vendor) || isCopilotSourceHint(sourceHint) || isCopilotResolvedModelId(modelName);
    const viaByokWrapper = isByokWrapperCall(sourceHint);
    // 1. Explicit exclude wins over everything else (lets the user mark a
    //    particular alias as informational even if the rate table knows it).
    for (const pat of config.excludeModels ?? []) {
        if (pat && lower.includes(pat.toLowerCase())) {
            return false;
        }
    }
    // 2. The strongest positive signal: GitHub's backend already billed it.
    if (hasActualCredits) {
        return true;
    }
    // 3. User-supplied allowlist (preview models not yet in the rate table).
    for (const pat of config.extraBilledModels ?? []) {
        if (pat && lower.includes(pat.toLowerCase())) {
            return true;
        }
    }
    // 4. Master switch off → preserve legacy behaviour (everything counts).
    if (config.includeOnlyBilledModels === false) {
        return true;
    }
    // 4a. Observed routing beats every inference below. VS Code stamps the
    //     dispatching vendor on each request's `modelId`
    //     (`customendpoint/Azure OAI/claude-opus-5`), so a colliding id needs no
    //     guesswork: a non-Copilot vendor means the user's own key paid for it.
    //     Requests GitHub actually billed already returned at step 2, so this
    //     can never contradict a real credit figure.
    if (vendor && !isCopilotVendor(vendor)) {
        return false;
    }
    // 4b. Fallback routing evidence for turns with no recorded vendor (legacy
    //     sessions, debug-log-only rows). When the id is declared under a
    //     non-Copilot vendor AND this particular request went out through the
    //     public LanguageModelChat wrapper, a BYOK provider served it — even if
    //     Copilot's CAPI also sells the same id. This is what splits a colliding
    //     model (`claude-opus-5`) into its billed and unbilled halves instead of
    //     forcing the whole row one way.
    if (viaByokWrapper && catalogLookup?.(modelName)?.userThirdParty === true) {
        return false;
    }
    // 5. GitHub/Copilot model names must not land in the non-billable bucket.
    //    Pre-June-1 usage is filtered by date before this function is called;
    //    for in-window rows, known Copilot models are billable unless the user
    //    explicitly excluded them above.
    //
    //    Skipped when the catalog reports an EXCLUSIVE third-party vendor for
    //    this id — a provider the user declared in `chatLanguageModels.json`
    //    that Copilot's own CAPI does not serve. That is the only signal strong
    //    enough to prove the id never touched a GitHub-billed route, so the
    //    rate-table name collision (`claude-opus-5` / `claude-sonnet-5` also
    //    exist as Copilot models) must not promote it. Alias collisions where
    //    CAPI *does* serve the id keep `exclusiveThirdParty` unset and stay
    //    billable, preserving the v1.10.15 OMP/Pi/CLI fix.
    const hit = catalogLookup?.(modelName) ?? null;
    const exclusiveThirdParty = hit?.exclusiveThirdParty === true && !isCopilotRouted;
    if (!exclusiveThirdParty && calculator.isKnownGHCModel(modelName)) {
        return true;
    }
    // 6. Authoritative online catalog (CDN manifest + Copilot CAPI /models).
    if (hit) {
        // 6a. CAPI verdict is authoritative — GitHub itself told us.
        if (hit.source === "capi") {
            return hit.billable;
        }
        if (isCopilotRouted) {
            return true;
        }
        // 6b. user-config / BYOK verdict for an id the rate table doesn't claim.
        return hit.billable;
    }
    // 7. Copilot-routed opaque resolved ids are billable even before the
    //    public model catalog/rate table learns their internal deployment name.
    if (isCopilotRouted) {
        return true;
    }
    // 8. Default: unknown models are informational/non-billable.
    return false;
}
//# sourceMappingURL=aicCredits.js.map