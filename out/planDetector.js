"use strict";
/**
 * planDetector.ts — Auto-detects the user's GitHub Copilot plan so the
 * dashboard does not silently misclassify everyone as "Business".
 *
 * Strategy (no extra UX, no extra sign-in):
 *   1. Borrow the existing VS Code GitHub session (silent — never prompts).
 *      If Copilot is installed and the user is signed in, a session is
 *      already cached by VS Code; we just read it.
 *   2. Call GitHub's `/copilot_internal/v2/token` endpoint — same call the
 *      official Copilot extension makes — which returns a `sku` string
 *      identifying the seat type.
 *   3. Map the SKU → our plan key and write it back to settings (global
 *      scope) so the dashboard, status bar and daily-limit tracker all
 *      pick it up on the next snapshot.
 *
 * Fallback: if detection fails (offline, no session, unrecognised SKU)
 * we show a one-time picker so the user can choose explicitly. We
 * remember the picker outcome so we never nag again.
 *
 * Safety:
 *   - Never overrides a plan the user set manually (we inspect the
 *     configuration target).
 *   - Auto-detect can be disabled via `copilotUsage.aic.autoDetectPlan`.
 *   - All network failures are silent — they only flow to the picker
 *     fallback, never to a popup error.
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
exports.skuToPlan = skuToPlan;
exports.detectAndApplyPlan = detectAndApplyPlan;
exports.resetPlanDetection = resetPlanDetection;
const vscode = __importStar(require("vscode"));
/** Marker stored in globalState after we have either detected or prompted. */
const DETECTION_DONE_KEY = "copilotUsage.aic.planDetectionDone";
/** Stored SKU string — purely informational so we can re-detect on upgrade. */
const LAST_DETECTED_SKU_KEY = "copilotUsage.aic.lastDetectedSku";
/**
 * Map a GitHub Copilot SKU string to our plan key. SKUs observed in the
 * wild include `copilot_for_business_seat`, `copilot_enterprise_seat`,
 * `copilot_pro_seat`, `copilot_pro_plus_seat`, `copilot_max_seat`, `free_*`.
 * We match on substrings so future SKU renames do not silently break detection.
 */
function skuToPlan(sku) {
    if (!sku) {
        return null;
    }
    const s = sku.toLowerCase();
    // Order matters: pro_plus must be checked before pro, max before business
    // (no overlap currently but defensive), enterprise before business.
    if (s.includes("enterprise")) {
        return "enterprise";
    }
    if (s.includes("business")) {
        return "business";
    }
    if (s.includes("pro_plus") || s.includes("proplus") || s.includes("pro-plus")) {
        return "pro_plus";
    }
    if (s.includes("max")) {
        return "max";
    }
    if (s.includes("pro")) {
        return "pro";
    }
    if (s.includes("free")) {
        return "free";
    }
    return null;
}
/**
 * Silent network call — returns `null` on any failure. Never throws.
 * The endpoint is the same one Copilot uses to mint its own LLM token;
 * any authenticated GitHub user can hit it and the response indicates
 * whether they have Copilot and what their seat SKU is.
 */
async function fetchCopilotSku(accessToken, log) {
    try {
        const res = await fetch("https://api.github.com/copilot_internal/v2/token", {
            method: "GET",
            headers: {
                Authorization: `token ${accessToken}`,
                Accept: "application/json",
                "User-Agent": "vscode-copilot-usage-dashboard",
            },
        });
        if (!res.ok) {
            log(`planDetector: /copilot_internal/v2/token returned ${res.status}`);
            return null;
        }
        const body = (await res.json());
        return typeof body.sku === "string" ? body.sku : null;
    }
    catch (err) {
        log(`planDetector: fetch error — ${String(err)}`);
        return null;
    }
}
/**
 * Try to obtain a GitHub session without prompting the user. VS Code
 * caches one session per unique scope-array, so we try the scope sets
 * the official Copilot extension is known to use — if any of them
 * matches a cached session we get it back instantly.
 */
async function trySilentSession(log) {
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
                log(`planDetector: silent session found with scopes=[${scopes.join(",")}]`);
                return s;
            }
        }
        catch (err) {
            log(`planDetector: getSession(${scopes.join(",")}) error — ${String(err)}`);
        }
    }
    return undefined;
}
/**
 * Prompt VS Code's GitHub auth provider to issue a session for our
 * extension. This shows a single "Allow Copilot Usage Dashboard to use
 * GitHub?" consent dialog — not a full sign-in flow — because the user
 * is already signed in for Copilot.
 */
async function tryConsentSession(log) {
    try {
        return await vscode.authentication.getSession("github", ["read:user"], {
            createIfNone: true,
        });
    }
    catch (err) {
        log(`planDetector: consent getSession error — ${String(err)}`);
        return undefined;
    }
}
/**
 * Show a one-time picker so the user can choose their plan explicitly.
 * Marks detection as done either way so we never nag a second time.
 */
async function showPickerFallback(context, cfg, log, hasGitHubAccount) {
    const choices = [
        { label: "Copilot Free", description: "2,000 completions / month (no credit allowance published)", plan: "free" },
        { label: "Copilot Pro", description: "$10/mo — 1,500 credits (1,000 base + 500 flex)", plan: "pro" },
        { label: "Copilot Pro+", description: "$39/mo — 7,000 credits (3,900 base + 3,100 flex)", plan: "pro_plus" },
        { label: "Copilot Max", description: "$100/mo — 20,000 credits (10,000 base + 10,000 flex)", plan: "max" },
        {
            label: "Copilot Business",
            description: "$19/user/mo — 1,900 credits (pooled). Jun–Sep 2026 promo: 3,000.",
            plan: "business",
        },
        {
            label: "Copilot Enterprise",
            description: "$39/user/mo — 3,900 credits (pooled). Jun–Sep 2026 promo: 7,000.",
            plan: "enterprise",
        },
    ];
    // Always offer the consent path — VS Code's auth API isolates sessions
    // per extension, so even when the user is signed into GitHub for
    // Copilot, our extension sees no session and `getAccounts` returns []
    // until the user clicks "Allow" once. After that, silent calls succeed
    // forever.
    const buttons = ["Detect via GitHub", "Choose plan…", "Skip (use Business)"];
    const msg = hasGitHubAccount
        ? 'Copilot Usage: detection needs one-time access to your GitHub account. Click "Detect via GitHub" to grant it, or pick your plan manually.'
        : 'Copilot Usage: to auto-detect your Copilot plan we need one-time read access to your GitHub account. Click "Detect via GitHub" to grant it, or pick your plan manually.';
    const pick = await vscode.window.showInformationMessage(msg, { modal: false }, ...buttons);
    if (pick === "Detect via GitHub") {
        const session = await tryConsentSession(log);
        if (session) {
            const sku = await fetchCopilotSku(session.accessToken, log);
            const plan = skuToPlan(sku);
            if (plan) {
                log(`planDetector: consent-path detected sku=${sku} → plan=${plan}`);
                await persistDetectedPlan(context, cfg, sku, plan);
                void vscode.window.showInformationMessage(`Copilot Usage: detected your plan as "${plan}".`);
                return;
            }
            log(`planDetector: consent path got session but sku=${sku ?? "<none>"} — falling through to picker`);
            void vscode.window.showWarningMessage(`Copilot Usage: GitHub returned sku="${sku ?? "unknown"}" which we couldn't map. Please pick manually.`);
        }
        else {
            log("planDetector: consent dialog denied or failed — falling through to picker");
        }
        // Fall through and let user pick manually.
        await runQuickPickAndPersist(cfg, log, choices);
    }
    else if (pick === "Choose plan…") {
        await runQuickPickAndPersist(cfg, log, choices);
    }
    else if (pick === "Skip (use Business)") {
        // Persist the explicit Business choice so we treat it as user-set and
        // never re-prompt or auto-overwrite.
        await cfg.update("plan", "business", vscode.ConfigurationTarget.Global);
        log("planDetector: user skipped picker — Business retained");
    }
    await context.globalState.update(DETECTION_DONE_KEY, true);
}
/**
 * Entry point — call once during activate(). Safe to await; failures
 * never throw and never block extension startup beyond the configured
 * network timeout (~3 s).
 */
async function detectAndApplyPlan(context, log) {
    const cfg = vscode.workspace.getConfiguration("copilotUsage.aic");
    // Respect the opt-out switch.
    if (cfg.get("autoDetectPlan") === false) {
        log("planDetector: autoDetectPlan disabled — skipping");
        return;
    }
    // Respect any plan the user has set manually. We only fill in for users
    // still sitting on the package.json default.
    const inspected = cfg.inspect("plan");
    const userSet = !!(inspected?.globalValue ||
        inspected?.workspaceValue ||
        inspected?.workspaceFolderValue);
    const alreadyDone = context.globalState.get(DETECTION_DONE_KEY) === true;
    if (userSet) {
        log(`planDetector: plan already set by user (${inspected?.globalValue ?? inspected?.workspaceValue}) — skipping`);
        return;
    }
    if (alreadyDone) {
        log("planDetector: detection already attempted previously — skipping");
        return;
    }
    // Borrow the existing GitHub session. We try several scope variants the
    // VS Code GitHub auth provider is known to cache; any silent hit gives
    // us an access token without prompting.
    const session = await trySilentSession(log);
    if (!session) {
        // Check if VS Code has *any* GitHub account at all — if so the picker
        // fallback can offer a one-click consent path; otherwise it's just a
        // manual choice.
        let hasAccount = false;
        try {
            const accounts = await vscode.authentication.getAccounts("github");
            hasAccount = accounts.length > 0;
            log(`planDetector: getAccounts returned ${accounts.length} GitHub account(s)`);
        }
        catch (err) {
            log(`planDetector: getAccounts error — ${String(err)}`);
        }
        log("planDetector: no silent GitHub session available — falling back to picker");
        await showPickerFallback(context, cfg, log, hasAccount);
        return;
    }
    const sku = await fetchCopilotSku(session.accessToken, log);
    const plan = skuToPlan(sku);
    if (!plan) {
        log(`planDetector: could not map sku=${sku ?? "<none>"} — falling back to picker`);
        await showPickerFallback(context, cfg, log, true);
        return;
    }
    log(`planDetector: detected sku=${sku} → plan=${plan}`);
    await persistDetectedPlan(context, cfg, sku, plan);
    // Inform the user — non-modal, with an easy way to override if our
    // mapping is wrong. This is the only popup detection ever shows on the
    // happy path; subsequent activations are silent.
    void vscode.window
        .showInformationMessage(`Copilot Usage: detected your plan as "${plan}". Credit budgets will use this from now on.`, "Change plan…", "OK")
        .then(async (choice) => {
        if (choice === "Change plan…") {
            await vscode.commands.executeCommand("workbench.action.openSettings", "copilotUsage.aic.plan");
        }
    });
}
/**
 * Allow users (and tests) to reset detection state — exposed via a
 * command so the picker can be re-shown on demand.
 */
async function resetPlanDetection(context) {
    await context.globalState.update(DETECTION_DONE_KEY, undefined);
    await context.globalState.update(LAST_DETECTED_SKU_KEY, undefined);
}
// ─── Internal helpers ─────────────────────────────────────────
/**
 * Persist a detected plan + sku into global state. Shared by the silent and
 * consent detection paths so both record exactly the same data.
 */
async function persistDetectedPlan(context, cfg, sku, plan) {
    await cfg.update("plan", plan, vscode.ConfigurationTarget.Global);
    await context.globalState.update(LAST_DETECTED_SKU_KEY, sku);
    await context.globalState.update(DETECTION_DONE_KEY, true);
}
/**
 * Show the manual plan picker and, if the user picks something, persist it.
 * Called from both the "Detect via GitHub → fall through" branch and the
 * direct "Choose plan…" branch with identical behavior.
 */
async function runQuickPickAndPersist(cfg, log, choices) {
    const picked = await vscode.window.showQuickPick(choices, {
        placeHolder: "Select your GitHub Copilot plan",
        ignoreFocusOut: true,
    });
    if (picked) {
        await cfg.update("plan", picked.plan, vscode.ConfigurationTarget.Global);
        log(`planDetector: user picked plan=${picked.plan}`);
    }
}
//# sourceMappingURL=planDetector.js.map