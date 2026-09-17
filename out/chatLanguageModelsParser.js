"use strict";
/**
 * chatLanguageModelsParser.ts — Pure parser for the user's
 * `<UserDir>/chatLanguageModels.json`.
 *
 * Kept in its own file (zero imports) so the parser can be exercised
 * directly from Node tests without needing a `vscode` stub. The IO/path
 * resolution lives in `modelCatalog.ts/readUserChatLanguageModels()` which
 * calls this function with the file's text.
 *
 * File schema — two distinct shapes carry model ids, and BYOK uses the
 * second one:
 *   [
 *     {
 *       "name":   "Copilot",
 *       "vendor": "copilot",
 *       "settings": { "<modelId>": { ...per-model opts... }, ... }
 *     },
 *     {
 *       "name":   "Azure Foundry Anthropic",
 *       "vendor": "customendpoint",
 *       "apiKey": "${input:chat.lm.secret.-27b7acf0}",
 *       "models": [ { "id": "claude-opus-5", "name": "…", "url": "…" }, … ]
 *     },
 *     ...
 *   ]
 *
 *  • `vendor === "copilot"` means GitHub bills it; anything else
 *    (customendpoint, ollama, lmstudio, anthropic, openai, azure, …) is
 *    third-party / not billed.
 *  • `settings` keys are per-model *option* overrides and are NOT a vendor
 *    declaration. VS Code writes them into the Copilot provider entry for
 *    whichever model is selected in the picker — including BYOK models. A
 *    real config proved it: `gpt-5.6-sol` is declared only under
 *    `vendor: "azure"` yet still has a `reasoningEffort` override under the
 *    Copilot entry's `settings`. So a `settings` key must never be read as
 *    "Copilot serves this id".
 *  • `models[]` is the documented BYOK declaration array (built-in providers
 *    and Custom Endpoint) and is the only authoritative vendor signal in this
 *    file. Ignoring it was why BYOK ids such as `claude-opus-5` were never
 *    recorded as third-party and instead got priced by the rate table's
 *    family fallback as Copilot premium traffic.
 *  • Providers that enumerate models at runtime (Ollama, LM Studio) may have
 *    neither block — those are covered by the `vscode.lm` registry reader in
 *    `modelCatalog.ts`, and otherwise fall through to `isKnownGHCModel()`.
 *
 * See <https://code.visualstudio.com/docs/agent-customization/language-models>
 * ("Model configuration reference").
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseUserChatLanguageModels = parseUserChatLanguageModels;
exports.mergeThirdPartyMaps = mergeThirdPartyMaps;
/**
 * Parse the raw JSON text of `chatLanguageModels.json` and return a map of
 * `lowercase model id → vendor name` for **unambiguous** third-party
 * associations.
 *
 * Rules:
 *  • Only `models[]` declares a vendor. A `settings` key is a per-model
 *    option override that VS Code also writes under the Copilot entry for
 *    BYOK models, so it carries no billability information and is skipped.
 *  • Model ids declared under `vendor === "copilot"` are IGNORED — they're
 *    billable, and the authoritative billing source for them is the CAPI
 *    /models response, not this file.
 *  • If a model id is declared under more than one vendor (e.g. both Copilot
 *    and an Anthropic BYOK key), it's AMBIGUOUS — omit from the map. The
 *    classifier will fall back to the CAPI entry / heuristic.
 *  • Only ids declared under exactly one non-Copilot vendor are recorded.
 */
function parseUserChatLanguageModels(rawJson) {
    const out = new Map();
    let parsed;
    try {
        parsed = JSON.parse(rawJson);
    }
    catch {
        return out;
    }
    if (!Array.isArray(parsed)) {
        return out;
    }
    // First pass: tally (id → set of vendors).
    const idToVendors = new Map();
    for (const raw of parsed) {
        const entry = raw;
        const vendor = typeof entry?.vendor === "string" ? entry.vendor.trim() : "";
        if (!vendor) {
            continue;
        }
        const ids = [];
        if (Array.isArray(entry.models)) {
            for (const m of entry.models) {
                if (typeof m?.id === "string") {
                    ids.push(m.id);
                }
            }
        }
        for (const rawId of ids) {
            const id = rawId.trim().toLowerCase();
            if (!id) {
                continue;
            }
            const set = idToVendors.get(id) ?? new Set();
            set.add(vendor.toLowerCase());
            idToVendors.set(id, set);
        }
    }
    // Second pass: keep unambiguous third-party associations only.
    //
    // Ambiguity is only about *billability*, so it hinges solely on whether
    // `copilot` is one of the vendors. An id declared under two BYOK vendors
    // (e.g. the same model reached via both `azure` and `customendpoint`, which
    // the docs actively encourage) is still unambiguously not-GitHub-billed —
    // dropping it would send it back to the rate table and bill it.
    for (const [id, vendors] of idToVendors) {
        if (vendors.has("copilot")) {
            continue; // billable, or a Copilot/BYOK alias collision — let CAPI decide
        }
        const [vendor] = vendors;
        out.set(id, vendors.size === 1 ? vendor : "multiple");
    }
    return out;
}
/**
 * Merge two `id → vendor` maps produced by different third-party detection
 * sources (e.g. `chatLanguageModels.json` vs `vscode.lm.selectChatModels()`).
 *
 * Rules:
 *  • If both sources agree on the same non-Copilot vendor for an id, keep it.
 *  • If they disagree, keep the id under `"multiple"`. Neither input can
 *    contain `copilot` (both producers filter it out), so a disagreement is
 *    still unambiguous evidence that the id is not GitHub-billed — dropping
 *    it would hand the id back to the rate table and bill it.
 *  • If only one source has the id, keep that mapping.
 */
function mergeThirdPartyMaps(a, b) {
    const out = new Map(a);
    for (const [id, vendor] of b) {
        const existing = out.get(id);
        if (existing === undefined) {
            out.set(id, vendor);
        }
        else if (existing !== vendor) {
            out.set(id, "multiple");
        }
        // else: same vendor in both sources — keep as-is.
    }
    return out;
}
//# sourceMappingURL=chatLanguageModelsParser.js.map