"use strict";
/**
 * byokPricing.ts — What the user's OWN provider charges for BYOK traffic.
 *
 * GitHub does not bill BYOK requests, so the dashboard reported them in AI
 * credits at Copilot's rate table — i.e. "what this would have cost on
 * Copilot", which is not a number on any invoice the user receives. This
 * module prices the same traffic at the provider's published rates instead.
 *
 * Scope and limits — read before trusting the output:
 *
 *  • **Separate currency, separate bill.** Provider dollars must never be
 *    added to AI credits or reach the headline. They are a different vendor's
 *    charge; the two only coexist as adjacent columns.
 *
 *  • **Cache writes are not observable.** `DebugRequest` carries one `cached`
 *    field, but Anthropic prices cache *writes* at 1.25x base input and cache
 *    *reads* at 0.1x — a 12.5x spread. VS Code does not record which is which,
 *    so `cacheWriteRatio` defaults to 0 (treat all cached tokens as reads) and
 *    the result is documented as a LOWER BOUND rather than presented as exact.
 *
 *  • **Rates are user-editable.** Published prices change; the defaults below
 *    were verified in Sept 2026 and are overridable via
 *    `copilotUsage.byokPricing.providers` without an extension update.
 *
 * Default rates: Anthropic documents that Microsoft Foundry meters token usage
 * at standard per-model Claude API rates, so the Claude API table is also the
 * Foundry rate card. USD per million tokens.
 *   <https://platform.claude.com/docs/en/about-claude/pricing>
 *   <https://platform.claude.com/docs/en/build-with-claude/claude-in-microsoft-foundry>
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_BYOK_PRICING = void 0;
exports.priceTokens = priceTokens;
exports.mergePricingConfig = mergePricingConfig;
/** Verified Sept 2026 against Anthropic's published pricing table. */
exports.DEFAULT_BYOK_PRICING = {
    cacheWriteRatio: 0,
    providers: [
        {
            match: "anthropic",
            regionMultiplier: 1.0,
            models: [
                { match: "opus", inputPerMillion: 5.0, outputPerMillion: 25.0, cachedReadPerMillion: 0.5, cacheWritePerMillion: 6.25 },
                { match: "sonnet", inputPerMillion: 2.0, outputPerMillion: 10.0, cachedReadPerMillion: 0.2, cacheWritePerMillion: 2.5 },
                { match: "haiku", inputPerMillion: 0.8, outputPerMillion: 4.0, cachedReadPerMillion: 0.08, cacheWritePerMillion: 1.0 },
            ],
        },
    ],
};
/**
 * Longest match wins so a specific entry beats a generic one — otherwise a
 * catch-all `match: "claude"` would shadow every per-model rate behind it.
 */
function bestMatch(candidates, subject) {
    const lower = (subject || "").toLowerCase();
    let best;
    for (const c of candidates) {
        const m = (c.match || "").toLowerCase();
        if (!m || !lower.includes(m)) {
            continue;
        }
        if (!best || m.length > best.match.length) {
            best = c;
        }
    }
    return best;
}
/**
 * Price one bucket of tokens. Returns null when no rate matches — the caller
 * must render "unpriced" rather than a misleading $0.00.
 *
 * `providerLabel` and `model` are matched independently: the display label
 * carries the provider name and the model id carries the family, and a
 * qualified id (`Azure Founday Anthropic/claude-opus-5`) contains both.
 */
function priceTokens(config, providerLabel, model, tokens) {
    const provider = bestMatch(config.providers ?? [], `${providerLabel} ${model}`);
    if (!provider) {
        return null;
    }
    const rate = bestMatch(provider.models ?? [], model);
    if (!rate) {
        return null;
    }
    const mult = provider.regionMultiplier && provider.regionMultiplier > 0 ? provider.regionMultiplier : 1;
    const writeRatio = Math.min(1, Math.max(0, config.cacheWriteRatio ?? 0));
    // Cached tokens are a SUBSET of input, so charging both would double-bill
    // the same tokens at two rates.
    const cached = Math.max(0, tokens.cachedTokens);
    const netInput = Math.max(0, tokens.inputTokens - cached);
    const cacheWrites = cached * writeRatio;
    const cacheReads = cached - cacheWrites;
    const inputUsd = (netInput / 1_000_000) * rate.inputPerMillion * mult;
    const outputUsd = (Math.max(0, tokens.outputTokens) / 1_000_000) * rate.outputPerMillion * mult;
    const cachedUsd = ((cacheReads / 1_000_000) * rate.cachedReadPerMillion +
        (cacheWrites / 1_000_000) * rate.cacheWritePerMillion) *
        mult;
    return {
        totalUsd: inputUsd + outputUsd + cachedUsd,
        inputUsd,
        outputUsd,
        cachedUsd,
        matchedProvider: provider.match,
        matchedModel: rate.match,
    };
}
/** Merge user-supplied providers over the defaults, matching on `match`. */
function mergePricingConfig(overrides) {
    if (!overrides) {
        return exports.DEFAULT_BYOK_PRICING;
    }
    const providers = [...exports.DEFAULT_BYOK_PRICING.providers];
    for (const p of overrides.providers ?? []) {
        if (!p || typeof p.match !== "string" || !p.match.trim()) {
            continue;
        }
        const idx = providers.findIndex(x => x.match.toLowerCase() === p.match.toLowerCase());
        if (idx >= 0) {
            providers[idx] = p;
        }
        else {
            providers.push(p);
        }
    }
    return {
        providers,
        cacheWriteRatio: typeof overrides.cacheWriteRatio === "number"
            ? overrides.cacheWriteRatio
            : exports.DEFAULT_BYOK_PRICING.cacheWriteRatio,
    };
}
//# sourceMappingURL=byokPricing.js.map