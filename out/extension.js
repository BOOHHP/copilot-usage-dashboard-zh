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
exports.workspaceHashFromStorageUri = workspaceHashFromStorageUri;
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const otelReceiver_1 = require("./otelReceiver");
const statusBar_1 = require("./statusBar");
const dashboardPanel_1 = require("./dashboardPanel");
const scanner_1 = require("./scanner");
const agentScanner_1 = require("./agentScanner");
const cliScanner_1 = require("./cliScanner");
const dashboardData_1 = require("./dashboardData");
const sidebarView_1 = require("./sidebarView");
const sidebarSnapshot_1 = require("./sidebarSnapshot");
const aicCredits_1 = require("./aicCredits");
const dailyLimitTracker_1 = require("./dailyLimitTracker");
const limitOverlay_1 = require("./limitOverlay");
const enforcement_1 = require("./enforcement");
const hookManager_1 = require("./hookManager");
const planDetector_1 = require("./planDetector");
const quotaSnapshot_1 = require("./quotaSnapshot");
const modelCatalog_1 = require("./modelCatalog");
const machineSync_1 = require("./machineSync");
const cache_1 = require("./cache");
const ttlTracker_1 = require("./ttlTracker");
const OTEL_PORT = 14318;
/**
 * Safety-net periodic scan when the live debug-log watcher and OTel receiver
 * aren't firing (e.g. fs.watch missed an event on a network share). Live
 * updates come from the file watcher (`setupDebugLogWatcher`) which fires
 * within ~1-2 seconds of any `main.jsonl` write, so this is only a fallback.
 */
const DEFAULT_REFRESH_MS = 30_000;
/** Debounce interval for OTel-triggered dashboard/status updates (ms) */
const OTEL_DEBOUNCE_MS = 2_000;
let receiver;
let statusBar;
let sidebarProvider;
/** Latest CurrentSessionInfo produced by updateStatusBar(), reused by the
 *  sidebar for metadata (model name / turn count / duration). The credit
 *  values themselves are sourced from dashData.liveOtel in pushSidebarSnapshot
 *  so the sidebar and dashboard never drift. */
let lastCurrentSession = null;
let scanTimer;
let lastScan;
let lastAgentScan;
let lastCliScan;
let output;
/**
 * fs.watch on workspaceStorage to catch `main.jsonl` writes in real time.
 * When another VS Code window owns OTLP port 14318, this window's receiver
 * gets no events — but Copilot still writes the exact API-billed
 * `copilotUsageNanoAiu` to `<wsRoot>/<wsId>/GitHub.copilot-chat/debug-logs/<sid>/main.jsonl`.
 * Watching for those writes lets us refresh within ~1-2s of any new request
 * instead of waiting up to 120s for the periodic timer.
 */
let debugLogWatcher;
/** Cooldown timer that suppresses duplicate scans within 500 ms of a fire. */
let debugLogCooldownTimer;
/** Set true while the cooldown is active if another event arrived; triggers a single trailing scan. */
let debugLogTrailingPending = false;
/** Tracks whether a runScan() is in flight so we never queue two in parallel. */
let debugLogScanInFlight = false;
/** ISO timestamp of when this VS Code instance activated the extension — used to scope "current" to this instance only */
let activationTime;
/** Cached dashboard data — invalidated when scan or OTel changes */
let cachedDashData;
let extCtx;
let lastOtelRequests = 0;
let otelDebounceTimer;
/** Prompt-cache TTL subsystem. Data-only — it never performs its own I/O. */
let ttlTracker;
/** Daily-limit subsystem */
let limitTracker;
let limitOverlay;
let enforcement;
let hookManager;
let limitDayKey;
function getAICConfig() {
    const cfg = vscode.workspace.getConfiguration("copilotUsage.aic");
    return {
        plan: cfg.get("plan") ?? aicCredits_1.DEFAULT_AIC_CONFIG.plan,
        billingCycleStartDay: cfg.get("billingCycleStartDay") ?? aicCredits_1.DEFAULT_AIC_CONFIG.billingCycleStartDay,
        monthlyCreditsIncluded: cfg.get("monthlyCreditsIncluded") ?? aicCredits_1.DEFAULT_AIC_CONFIG.monthlyCreditsIncluded,
        overageCostPerCredit: cfg.get("overageCostPerCredit") ?? aicCredits_1.DEFAULT_AIC_CONFIG.overageCostPerCredit,
        customModelCosts: cfg.get("customModelCosts") ?? aicCredits_1.DEFAULT_AIC_CONFIG.customModelCosts,
        // Issue #5 — scope billable totals to models GitHub actually bills.
        includeOnlyBilledModels: cfg.get("includeOnlyBilledModels") ?? aicCredits_1.DEFAULT_AIC_CONFIG.includeOnlyBilledModels,
        excludeModels: cfg.get("excludeModels") ?? aicCredits_1.DEFAULT_AIC_CONFIG.excludeModels,
        extraBilledModels: cfg.get("extraBilledModels") ?? aicCredits_1.DEFAULT_AIC_CONFIG.extraBilledModels,
    };
}
function buildData() {
    const otelStats = receiver?.getStats() ?? null;
    const otelReqs = otelStats?.requests ?? 0;
    // Return cached data if nothing changed
    if (cachedDashData && otelReqs === lastOtelRequests) {
        return cachedDashData;
    }
    lastOtelRequests = otelReqs;
    const t0 = Date.now();
    const scan = lastScan ?? {
        sessions: [],
        turns: [],
        toolCalls: [],
        subagents: [],
        stats: {
            sourceFiles: 0,
            canonicalSessions: 0,
            mirroredSessions: 0,
            mirrorCopiesPruned: 0,
            turnsStored: 0,
            toolCallsStored: 0,
            promptPreviews: 0,
            transcriptsFound: 0,
            debugLogSessions: 0,
        },
    };
    const aicConfig = getAICConfig();
    const byokPricing = vscode.workspace
        .getConfiguration("copilotUsage")
        .get("byokPricing");
    cachedDashData = (0, dashboardData_1.buildDashboardData)(scan, otelStats, aicConfig, lastAgentScan, activationTime, lastCliScan, (0, quotaSnapshot_1.getCachedQuotaSnapshot)(), byokPricing);
    // Publish this machine's rollup and fold in whatever other systems have
    // synced. Rollups only — never raw sessions, prompts or log contents.
    if (extCtx) {
        const aic = cachedDashData.aicSummary;
        const byDay = {};
        for (const d of aic.byDay) {
            byDay[d.day] = d.credits;
        }
        const byModel = {};
        for (const m of aic.byModel) {
            byModel[m.model] = m.totalCredits;
        }
        try {
            const machines = (0, machineSync_1.publishAndRead)(extCtx, {
                cycleStart: aic.billingCycleStart,
                cycleCredits: aic.totalCredits,
                sessions: cachedDashData.agentSummary.totalSessions,
                turns: scan.turns.length,
                totalTokens: cachedDashData.agentSummary.vscodeTotalTokens,
                byDay,
                byModel,
            });
            cachedDashData.machines = machines;
            cachedDashData.combinedCycleCredits = (0, machineSync_1.combinedCredits)(machines, aic.billingCycleStart);
        }
        catch (err) {
            output.appendLine(`machineSync: publish failed — ${String(err)}`);
        }
    }
    const elapsed = Date.now() - t0;
    if (elapsed > 200) {
        output.appendLine(`buildData took ${elapsed}ms (${scan.stats.turnsStored} turns, ${scan.stats.canonicalSessions} sessions)`);
    }
    // Refreshed on every call, including cache hits — the anchors are cheap and
    // must not go stale behind the memoized dashboard payload.
    cachedDashData.ttlBySession = buildTtlAnchors();
    return cachedDashData;
}
/**
 * The standalone `SukumarP.cache-timer` extension watches the same debug-logs
 * and renders its own countdown. Running both means two status-bar timers over
 * identical data, so warn once and leave the choice to the user.
 */
function warnOnCacheTimerConflict(context) {
    const KEY = "cacheTimerConflictNotified";
    if (context.globalState.get(KEY)) {
        return;
    }
    if (!vscode.extensions.getExtension("SukumarP.cache-timer")) {
        return;
    }
    void context.globalState.update(KEY, true);
    void vscode.window
        .showInformationMessage("Copilot Usage now tracks prompt-cache TTL natively. The separate \u201cCache TTL Timer\u201d extension will show a duplicate countdown.", "Show Extension", "Dismiss")
        .then(choice => {
        if (choice === "Show Extension") {
            void vscode.commands.executeCommand("workbench.extensions.search", "@installed SukumarP.cache-timer");
        }
    });
}
/** sessionId → countdown anchor for the dashboard's live Cache TTL column. */
function buildTtlAnchors() {
    const out = {};
    for (const s of ttlTracker?.getSessions() ?? []) {
        if (s.source !== "vscode") {
            continue;
        }
        out[s.sessionId] = {
            lastRequestMs: s.lastRequestMs,
            timerValue: s.timerValue,
            warnAt: s.warnAt,
            alertAt: s.alertAt,
            working: s.working,
            provider: s.provider,
        };
    }
    return out;
}
/**
 * VS Code stopped writing `workspace.json` into the storage dir, so the scanner
 * has no on-disk way to name a project. Record workspaceHash → folder name here
 * and every project the user opens gets named, including retroactively for
 * sessions already on disk.
 */
function rememberWorkspaceName(context) {
    const key = "workspaceNames";
    const map = { ...(context.globalState.get(key) ?? {}) };
    const hash = workspaceHashFromStorageUri(context.storageUri?.fsPath);
    const name = vscode.workspace.name;
    if (hash && name && map[hash] !== name) {
        map[hash] = name;
        void context.globalState.update(key, map);
    }
    (0, scanner_1.setProjectNameHints)(map);
}
/**
 * `storageUri` is `<...>/workspaceStorage/<hash>/<extensionId>`, so the hash is
 * the segment after `workspaceStorage` — not the last one.
 */
function workspaceHashFromStorageUri(storagePath) {
    if (!storagePath) {
        return "";
    }
    const parts = storagePath.split(/[\\/]+/).filter(Boolean);
    const i = parts.lastIndexOf("workspaceStorage");
    if (i >= 0 && parts[i + 1]) {
        return parts[i + 1];
    }
    // Unrecognised layout: the extension-id segment is the only thing we can
    // reliably strip, and it always contains a dot.
    const last = parts[parts.length - 1] ?? "";
    return last.includes(".") ? parts[parts.length - 2] ?? "" : last;
}
async function runScan() {
    try {
        const t0 = Date.now();
        const cfg = vscode.workspace.getConfiguration("copilotUsage");
        const wsOverride = cfg.get("workspaceStoragePath", "").trim();
        const cliEnabled = cfg.get("cli.enabled", true);
        const cliHomeOverride = cfg.get("cli.homePath", "").trim();
        const [scanResult, agentResult, cliResult] = await Promise.all([
            (0, scanner_1.scanWorkspaceStorage)(wsOverride || undefined),
            (0, agentScanner_1.scanAgentSessions)().catch((err) => {
                output.appendLine(`Agent scan error: ${err}`);
                return undefined;
            }),
            cliEnabled
                ? (0, cliScanner_1.scanCliSessions)(cliHomeOverride || undefined).catch((err) => {
                    output.appendLine(`CLI scan error: ${err}`);
                    return undefined;
                })
                : Promise.resolve(undefined),
        ]);
        lastScan = scanResult;
        lastAgentScan = agentResult;
        lastCliScan = cliResult;
        // GitHub's own credit ledger. Local logs are only ever a lower bound, so
        // this is what keeps the headline from drifting below github.com.
        await (0, quotaSnapshot_1.fetchQuotaSnapshot)(msg => output.appendLine(msg));
        cachedDashData = undefined; // Invalidate cache
        // Data-only refresh of the cache countdown anchors — no extra file I/O.
        ttlTracker?.ingest(lastScan, lastCliScan);
        const elapsed = Date.now() - t0;
        output.appendLine(`Scan: ${lastScan.stats.canonicalSessions} sessions, ${lastScan.stats.turnsStored} turns, ` +
            `${lastScan.stats.toolCallsStored} tools (${elapsed}ms)` +
            (lastAgentScan
                ? ` | Agent: OMP=${lastAgentScan.ompSessionCount} Pi=${lastAgentScan.piSessionCount} (${lastAgentScan.scanMs}ms)`
                : " | Agent: scan failed") +
            (lastCliScan
                ? ` | CLI: ${lastCliScan.sessions.length}/${lastCliScan.allTimeSessions} sessions, ` +
                    `${lastCliScan.totalLivePrompts} prompts, ${lastCliScan.totalAic} AIC ` +
                    `(${lastCliScan.reconciledSessions} ledger / ${lastCliScan.liveOnlySessions} live-only, ` +
                    `drift ${lastCliScan.driftAic > 0 ? "+" : ""}${lastCliScan.driftAic}, ${lastCliScan.scanMs}ms)`
                : cliEnabled ? " | CLI: scan failed" : ""));
    }
    catch (err) {
        output.appendLine(`Scan error: ${err}`);
    }
}
async function activate(context) {
    extCtx = context;
    (0, machineSync_1.registerSyncKeys)(context);
    output = vscode.window.createOutputChannel("Copilot Usage");
    context.subscriptions.push(output);
    rememberWorkspaceName(context);
    // Record activation time — used to scope "current" stats to this VS Code instance
    activationTime = new Date().toISOString();
    // ── Sidebar (Activity Bar) ─────────────────────────────────
    // Registered BEFORE any await. `activate` goes on to await a full
    // workspaceStorage scan, the OTel receiver bind and several global
    // `config.update` writes; while those are pending VS Code has no provider
    // for `copilotUsage.panel` and renders the view permanently blank — and if
    // any of them rejects, registration never runs at all. The provider needs
    // no scan data: it serves static HTML and asks for a snapshot via its
    // `ready` ping, which `pushSidebarSnapshot` answers safely at any time.
    sidebarProvider = new sidebarView_1.SidebarViewProvider(context.extensionUri);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(sidebarView_1.SidebarViewProvider.viewType, sidebarProvider, {
        webviewOptions: { retainContextWhenHidden: true },
    }), vscode.commands.registerCommand("copilotUsage.sidebar.refresh", async () => {
        // Use the serialized wrapper so a manual refresh racing with the
        // debug-log watcher never triggers two concurrent scans (they would
        // race on the mtime cache). runScanSerialized() also handles
        // updateStatusBar + DashboardPanel.updateIfVisible internally.
        await runScanSerialized();
    }), vscode.commands.registerCommand("copilotUsage.sidebar.openDashboard", () => {
        dashboardPanel_1.DashboardPanel.show(context.extensionUri, buildData());
    }));
    // Session click → open the full dashboard. The dashboard does not yet
    // support deep-linking to a specific session, so the `sessionId` payload
    // is accepted but unused (logged for traceability). When per-session
    // focus lands in DashboardPanel.show, wire it through here.
    sidebarProvider.setOnSessionOpen((sessionId) => {
        if (sessionId) {
            output.appendLine(`Sidebar session click → opening dashboard (sessionId=${sessionId})`);
        }
        dashboardPanel_1.DashboardPanel.show(context.extensionUri, buildData());
    });
    // First open (or re-show) → push a fresh snapshot immediately so the user
    // never sees stale "Waiting…" placeholders when scan/OTel data already exists.
    sidebarProvider.setOnReady(() => {
        pushSidebarSnapshot();
    });
    // Auto-detect the user's Copilot plan via their existing GitHub session
    // (silent — no extra sign-in). Falls back to a one-time picker if the
    // session is missing or the SKU is unrecognised. Fire-and-forget so we
    // never block activation on a network call.
    void (0, planDetector_1.detectAndApplyPlan)(context, m => output.appendLine(m));
    // Hydrate the authoritative GitHub model catalog (CDN known-models manifest
    // + Copilot CAPI /models). Used by `classifyModelBillability` as a stronger
    // signal than the built-in rate-table heuristic — see `modelCatalog.ts` and
    // issue #5. Best-effort, network failures are silent.
    const onlineCatalogEnabled = vscode.workspace
        .getConfiguration("copilotUsage.aic")
        .get("useOnlineModelCatalog") ?? true;
    void (0, modelCatalog_1.loadCatalog)(context, {
        enabled: onlineCatalogEnabled,
        log: m => output.appendLine(m),
    });
    // Refresh the catalog whenever the user's GitHub authentication changes
    // (sign-in, sign-out, account switch between individual/business/enterprise).
    // The CAPI host comes back as `endpoints.api` in the token response, which
    // is plan-aware — so signing into a Business account automatically points
    // the next `/models` fetch at `api.business.githubcopilot.com`, and likewise
    // for Enterprise. Without this listener the user would have to reload the
    // window for the new plan's models to show up.
    context.subscriptions.push(vscode.authentication.onDidChangeSessions(e => {
        if (e.provider.id !== "github") {
            return;
        }
        output.appendLine("auth: GitHub session changed — refreshing model catalog");
        const enabledNow = vscode.workspace
            .getConfiguration("copilotUsage.aic")
            .get("useOnlineModelCatalog") ?? true;
        void (0, modelCatalog_1.loadCatalog)(context, {
            enabled: enabledNow,
            log: m => output.appendLine(m),
            refreshNow: true,
        });
    }));
    // Refresh the catalog whenever VS Code's set of registered chat models
    // changes — i.e. the user added or removed a BYOK API key (Anthropic,
    // OpenAI, Gemini, …), installed/disabled an Ollama-style provider
    // extension, etc. `vscode.lm.selectChatModels()` reflects exactly this
    // set, so we re-read it to keep the third-party id → vendor map current.
    // VS Code fires this repeatedly while providers register during startup —
    // seven times in one observed activation — so coalesce into one refresh.
    try {
        if (vscode.lm && typeof vscode.lm.onDidChangeChatModels === "function") {
            let lmChangeTimer;
            context.subscriptions.push(vscode.lm.onDidChangeChatModels(() => {
                if (lmChangeTimer) {
                    clearTimeout(lmChangeTimer);
                }
                lmChangeTimer = setTimeout(() => {
                    lmChangeTimer = undefined;
                    output.appendLine("lm: chat-model registry changed — refreshing model catalog");
                    const enabledNow = vscode.workspace
                        .getConfiguration("copilotUsage.aic")
                        .get("useOnlineModelCatalog") ?? true;
                    void (0, modelCatalog_1.loadCatalog)(context, {
                        enabled: enabledNow,
                        log: m => output.appendLine(m),
                        refreshNow: true,
                    });
                }, 5000);
            }));
            context.subscriptions.push({
                dispose: () => {
                    if (lmChangeTimer) {
                        clearTimeout(lmChangeTimer);
                    }
                },
            });
        }
    }
    catch (err) {
        output.appendLine(`lm: onDidChangeChatModels subscription failed — ${String(err)}`);
    }
    // Initial scan of chatSession files — MUST complete before activate()
    // returns so the dashboard, status bar, and any "openDashboard" command
    // see populated data on cold start. v1.9.14 tried to make this fire-
    // and-forget and shipped a dashboard that rendered all zeros until the
    // scan completed — unacceptable. 1.10.95 repeated that mistake and was
    // reverted. The file watcher takes over for live updates after this
    // initial scan.
    //
    // The sidebar provider is registered above, before this await, so the view
    // is wired as early as possible — but note VS Code will not dispatch
    // resolveWebviewView until activate() itself resolves. If this scan is ever
    // slow again, fix the scan, not the ordering.
    await runScan();
    // Start OTel receiver
    receiver = new otelReceiver_1.OTelReceiver();
    receiver.log = (msg) => output.appendLine(msg);
    let port;
    try {
        port = await receiver.start(OTEL_PORT);
        output.appendLine(`OTel receiver started on port ${port}`);
        if (port !== OTEL_PORT) {
            output.appendLine(`Port ${OTEL_PORT} was in use, fell back to ${port}`);
        }
    }
    catch (err) {
        output.appendLine(`Failed to start OTel receiver: ${err}`);
        vscode.window.showWarningMessage(`Copilot Usage: Could not start OTel receiver. Check Output → "Copilot Usage" for details.`);
        port = 0;
    }
    // Configure VS Code OTel settings to point to our port
    if (port > 0) {
        const expectedEndpoint = `http://127.0.0.1:${port}`;
        try {
            const config = vscode.workspace.getConfiguration("github.copilot.chat.otel");
            const currentEndpoint = config.get("otlpEndpoint") ?? "";
            const currentEnabled = config.get("enabled");
            const currentOutfile = config.get("outfile") ?? "";
            // outfile overrides exporterType to "file", which prevents HTTP export
            const outfileConflict = currentOutfile.length > 0;
            const needsUpdate = currentEnabled !== true || currentEndpoint !== expectedEndpoint || outfileConflict;
            if (needsUpdate) {
                await config.update("enabled", true, vscode.ConfigurationTarget.Global);
                await config.update("exporterType", "otlp-http", vscode.ConfigurationTarget.Global);
                await config.update("otlpEndpoint", expectedEndpoint, vscode.ConfigurationTarget.Global);
                // Remove outfile — it overrides exporterType to "file".
                // The extension now relays /v1/logs to the same JSONL for hooks.
                if (outfileConflict) {
                    await config.update("outfile", undefined, vscode.ConfigurationTarget.Global);
                    output.appendLine(`Removed outfile setting (was: ${currentOutfile}) — relay handles JSONL output`);
                }
                output.appendLine(`Updated OTel settings: endpoint=${expectedEndpoint}`);
                void vscode.window
                    .showInformationMessage(`Copilot Usage: OTel receiver on port ${port}. Reload VS Code once for Copilot to start exporting.`, "Reload Window")
                    .then(choice => {
                    if (choice === "Reload Window") {
                        void vscode.commands.executeCommand("workbench.action.reloadWindow");
                    }
                });
            }
            else {
                output.appendLine(`OTel settings already correct: endpoint=${expectedEndpoint}`);
            }
            // Diagnostic summary — helps pinpoint why OTel may not be flowing
            const captureContent = config.get("captureContent");
            const dbSpan = config.get("dbSpanExporter.enabled");
            const exporterType = config.get("exporterType");
            output.appendLine(`OTel config summary: enabled=true exporterType=${exporterType} endpoint=${expectedEndpoint} captureContent=${captureContent} dbSpanExporter=${dbSpan}`);
            output.appendLine(`Tip: If no spans appear below, open "Help → Toggle Developer Tools → Console" and search for "[OTel]"`);
            output.appendLine(`Tip: After changing settings, run "Developer: Reload Window" for Copilot Chat to pick them up`);
        }
        catch (err) {
            output.appendLine(`Could not update settings: ${err}`);
        }
    }
    // Status bar
    statusBar = new statusBar_1.StatusBarProvider("copilotUsage.openDashboard");
    statusBar.setLang(context.globalState.get("copilotUsage.uiLang") === "zh" ? "zh" : "en");
    context.subscriptions.push({ dispose: () => statusBar?.dispose() });
    // ── Prompt-cache TTL subsystem ─────────────────────────────
    ttlTracker = new ttlTracker_1.TtlTracker(vscode.Uri.joinPath(context.extensionUri, "media", "alert.wav").fsPath, () => getAICConfig().overageCostPerCredit ?? 0.01);
    context.subscriptions.push(ttlTracker);
    // Repaint on every tick so the countdown is live, not just on scan.
    context.subscriptions.push(ttlTracker.onChange(() => {
        statusBar?.refreshTtl(ttlTracker?.getSessions() ?? []);
        pushSidebarSnapshot();
    }));
    // A hidden window has nothing to animate — pause the tick entirely.
    ttlTracker.setUiVisible(vscode.window.state.focused);
    context.subscriptions.push(vscode.window.onDidChangeWindowState(st => ttlTracker?.setUiVisible(st.focused)), vscode.commands.registerCommand("copilotUsage.cacheTtl.toggle", async () => {
        const cfg = vscode.workspace.getConfiguration("copilotUsage.cacheTtl");
        const next = !(cfg.get("enabled") ?? false);
        await cfg.update("enabled", next, vscode.ConfigurationTarget.Global);
        output.appendLine(`Cache TTL tracking ${next ? "enabled" : "disabled"}.`);
        void vscode.window.showInformationMessage(`Copilot Usage: prompt-cache TTL tracking ${next ? "enabled" : "disabled"}.`);
    }));
    warnOnCacheTimerConflict(context);
    // ── Daily limit subsystem ──────────────────────────────────
    limitTracker = new dailyLimitTracker_1.DailyLimitTracker(context);
    limitOverlay = new limitOverlay_1.LimitOverlay(context.extensionUri);
    enforcement = new enforcement_1.Enforcement(context, m => output.appendLine(m));
    hookManager = new hookManager_1.HookManager(m => output.appendLine(m));
    // Install global Copilot agent hooks (denies tool calls in CLI / custom agents
    // / cloud agent when daily limit is reached). Opt-out via setting.
    if ((0, dailyLimitTracker_1.getDailyLimitConfig)().installAgentHooks !== false) {
        void hookManager.install();
    }
    // React to stage changes — log only. Enforcement decisions happen on every
    // snapshot (below) so snooze/resume/expiry all take effect immediately.
    limitTracker.onStageChange((snap, prev) => {
        output.appendLine(`Daily-limit stage: ${prev} → ${snap.stage} (${snap.used}/${snap.limit} = ${snap.percent}%)`);
    });
    // Daily-limit commands
    context.subscriptions.push(vscode.commands.registerCommand("copilotUsage.dailyLimit.snooze", async () => {
        const mins = (0, dailyLimitTracker_1.getDailyLimitConfig)().snoozeMinutes;
        await limitTracker?.snooze(mins);
        output.appendLine(`Daily limit snoozed for ${mins} min.`);
        void vscode.window.showInformationMessage(`Copilot Usage: snoozed for ${mins} minutes.`);
        updateStatusBar();
    }), vscode.commands.registerCommand("copilotUsage.dailyLimit.resume", async () => {
        const aicCfg = getAICConfig();
        const snap = limitTracker?.last() ??
            limitTracker?.snapshot(lastScan, receiver?.getStats() ?? null, (0, aicCredits_1.createCalculatorFromConfig)(aicCfg), aicCfg.overageCostPerCredit ?? 0.01);
        if (snap) {
            await limitTracker?.markResumed(snap.dayKey);
        }
        await enforcement?.release();
        output.appendLine(`Daily limit overridden by user for today (${snap?.dayKey}).`);
        void vscode.window.showInformationMessage("Copilot Usage: resumed for today. Counter will still grow.");
        updateStatusBar();
    }), vscode.commands.registerCommand("copilotUsage.dailyLimit.reset", async () => {
        await limitTracker?.clearSnooze();
        await limitTracker?.clearResume();
        await enforcement?.release();
        output.appendLine("Daily-limit snooze + resume cleared — enforcement re-engaged on next snapshot.");
        void vscode.window.showInformationMessage("Copilot Usage: override ended. Block will re-engage if you're still over today's limit.");
        updateStatusBar();
    }), vscode.commands.registerCommand("copilotUsage.dailyLimit.showShield", () => {
        const aicCfg = getAICConfig();
        const calc = (0, aicCredits_1.createCalculatorFromConfig)(aicCfg);
        const snap = limitTracker.snapshot(lastScan, receiver?.getStats() ?? null, calc, aicCfg.overageCostPerCredit ?? 0.01);
        limitOverlay?.forceShow(snap);
    }), vscode.commands.registerCommand("copilotUsage.dailyLimit.installHooks", async () => {
        await hookManager?.install();
        const paths = hookManager?.paths();
        void vscode.window.showInformationMessage(`Copilot Usage: agent hooks installed at ${paths?.hookFile ?? "~/.copilot/hooks"}.`);
        // Push current snapshot to the new state file.
        updateStatusBar();
    }), vscode.commands.registerCommand("copilotUsage.dailyLimit.uninstallHooks", async () => {
        await hookManager?.uninstall();
        void vscode.window.showInformationMessage("Copilot Usage: agent hooks removed. CLI / custom agents / cloud agent will no longer be blocked.");
    }), vscode.commands.registerCommand("copilotUsage.aic.detectPlan", async () => {
        await (0, planDetector_1.resetPlanDetection)(context);
        await (0, planDetector_1.detectAndApplyPlan)(context, m => output.appendLine(m));
    }));
    // Re-evaluate when daily-limit settings change.
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration("copilotUsage.dailyLimit.installAgentHooks")) {
            const want = (0, dailyLimitTracker_1.getDailyLimitConfig)().installAgentHooks !== false;
            if (want && !hookManager?.isInstalled()) {
                void hookManager?.install();
            }
            else if (!want && hookManager?.isInstalled()) {
                void hookManager?.uninstall();
            }
        }
        if (e.affectsConfiguration("copilotUsage.cacheTtl")) {
            ttlTracker?.onConfigChanged();
            ttlTracker?.ingest(lastScan, lastCliScan);
        }
        if (e.affectsConfiguration("copilotUsage.dailyLimit") ||
            e.affectsConfiguration("copilotUsage.aic") ||
            e.affectsConfiguration("copilotUsage.cacheTtl")) {
            updateStatusBar();
        }
    }));
    // Initial status bar with scan data
    updateStatusBar();
    // LIVE PATH (cheap): on every OTel batch arrival, immediately refresh all
    // three consumers — status bar, sidebar, dashboard panel. These read from
    // in-memory OTel + the already-cached scan, so they cost ~ms. Holding them
    // behind the 2-second scan debounce (as v1.10.4 and earlier did) made the
    // dollars-first status bar and the +X¢ flash feel sluggish: the user would
    // see a request finish in chat ~2s before the bar's number ticked up.
    // `buildData()` is cache-keyed on `otelStats.requests`, so the two calls
    // below (one inside `updateStatusBar` → `pushSidebarSnapshot`, one for the
    // dashboard panel) return the same snapshot — no drift risk.
    //
    // DEBOUNCED PATH (expensive): coalesce bursts of OTel events into a single
    // `runScan()` so the debug-log `copilotUsageNanoAiu` overlay (exact API-
    // billed AIC) catches up without thrashing disk I/O. After the scan, we
    // refresh the UI one more time so the overlay-adjusted numbers land.
    receiver.onStats(() => {
        updateStatusBar();
        dashboardPanel_1.DashboardPanel.updateIfVisible(buildData());
        if (otelDebounceTimer) {
            return;
        }
        otelDebounceTimer = setTimeout(() => {
            otelDebounceTimer = undefined;
            void runScan().then(() => {
                updateStatusBar();
                dashboardPanel_1.DashboardPanel.updateIfVisible(buildData());
            });
        }, OTEL_DEBOUNCE_MS);
    });
    // Commands
    context.subscriptions.push(vscode.commands.registerCommand("copilotUsage.openDashboard", () => {
        dashboardPanel_1.DashboardPanel.show(context.extensionUri, buildData());
    }), vscode.commands.registerCommand("copilotUsage.refresh", async () => {
        await runScan();
        updateStatusBar();
        dashboardPanel_1.DashboardPanel.show(context.extensionUri, buildData());
    }), vscode.commands.registerCommand("copilotUsage.exportStats", async () => {
        await runScan();
        const data = buildData();
        const md = buildExportMarkdown(data);
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`copilot-usage-export-${ts}.md`),
            filters: { 'Markdown': ['md'], 'JSON': ['json'] },
            title: '导出 Copilot 用量统计 / Export Copilot Usage Stats',
        });
        if (!uri) return;
        const content = uri.fsPath.endsWith('.json') ? JSON.stringify(data, null, 2) : md;
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
        void vscode.window.showInformationMessage(`已导出用量统计: ${uri.fsPath}`);
        output.appendLine(`Exported usage stats to ${uri.fsPath}`);
    }));
    function buildExportMarkdown(d) {
        const L = [];
        const fmtN = n => (n == null || isNaN(n)) ? '0' : Number(n).toLocaleString('en-US');
        const fmtC = n => (n == null || isNaN(n)) ? '0.00' : Number(n).toFixed(2);
        const fmtUsd = n => '$' + ((n == null || isNaN(n)) ? 0 : n).toFixed(2);
        const pct = (a, b) => (b > 0 ? (a / b * 100).toFixed(1) + '%' : '—');
        const t = { sessions: d.sessionsAll.length, turns: 0, prompt: 0, output: 0, cached: 0, tools: 0, subs: 0 };
        for (const s of d.sessionsAll) {
            t.turns += s.turns || 0;
            t.prompt += (s.actualPrompt || s.prompt || 0);
            t.output += (s.actualOutput || s.output || 0);
            t.cached += (s.actualCached || 0);
        }
        for (const x of d.toolsAll) t.tools += x.count || 0;
        for (const x of d.subagentsAll) t.subs += x.count || 0;
        L.push('# Copilot 用量统计导出 / Copilot Usage Export', '');
        L.push(`> 导出时间 / Generated: ${new Date().toLocaleString('zh-CN')}  `);
        L.push(`> 数据来源 / Source: VS Code chatSessions + Live OTel + agent scanners  `);
        L.push('');
        // ── 1. 概览（Hero KPIs）──
        L.push('## 1. 概览 / Overview (Hero KPIs)', '');
        const aic = d.aicSummary;
        if (aic) {
            L.push('| 指标 | 数值 |', '|---|---|');
            L.push(`| AI 积分消耗 (本周期) | ${fmtC(aic.totalCredits)} AIC |`);
            L.push(`| 月度预算 | ${aic.monthlyBudget > 0 ? fmtN(aic.monthlyBudget) + ' AIC' : '未设置'} |`);
            L.push(`| 预算使用率 | ${aic.monthlyBudget > 0 ? pct(aic.totalCredits, aic.monthlyBudget) : '—'} |`);
            L.push(`| 预计本周期消耗 | ${fmtC(aic.projectedTotal)} AIC |`);
            L.push(`| 账单周期 | ${aic.billingCycleStart} ~ ${aic.billingCycleEnd} |`);
            L.push(`| 套餐 | ${aic.planName} |`);
            if (aic.quota) {
                L.push(`| GitHub 账单积分 | ${fmtC(aic.quota.creditsUsed)} / ${fmtN(aic.quota.entitlement)} |`);
                L.push(`| 本地日志积分 | ${fmtC(aic.quota.localTotal)} |`);
            }
            L.push('');
        }
        L.push('| Token 指标 | 数值 |', '|---|---|');
        L.push(`| 会话数 | ${fmtN(t.sessions)} |`);
        L.push(`| 轮次数 | ${fmtN(t.turns)} |`);
        L.push(`| 提示 Token | ${fmtN(t.prompt)} |`);
        L.push(`| 输出 Token | ${fmtN(t.output)} |`);
        L.push(`| 缓存 Token | ${fmtN(t.cached)} |`);
        L.push(`| 缓存命中率 | ${t.prompt > 0 ? pct(t.cached, t.prompt) : '—'} |`);
        L.push(`| 工具调用 | ${fmtN(t.tools)} |`);
        L.push(`| 子代理调用 | ${fmtN(t.subs)} |`);
        L.push('');
        // ── 2. 按来源用量 ──
        const ag = d.agentSummary;
        if (ag) {
            L.push('## 2. 按来源用量 / Usage by Source', '');
            L.push('| 指标 | VS Code | Oh My Pi | Pi | Copilot CLI |', '|---|---|---|---|---|');
            L.push(`| 会话 | ${fmtN(t.sessions)} | ${fmtN(ag.ompSessions || 0)} | ${fmtN(ag.piSessions || 0)} | ${fmtN(ag.cliSessions || 0)} |`);
            L.push(`| 轮次/调用 | ${fmtN(t.turns)} | ${fmtN(ag.ompLlmCalls || 0)} | ${fmtN(ag.piLlmCalls || 0)} | ${fmtN(ag.cliLlmCalls || 0)} |`);
            L.push(`| Token | ${fmtN(t.prompt + t.output)} | ${fmtN(ag.ompAllTimeTokens || 0)} | ${fmtN(ag.piAllTimeTokens || 0)} | ${fmtN(ag.cliAllTimeTokens || 0)} |`);
            L.push(`| AIC 积分 | ${fmtC(Math.max(0, (aic ? aic.totalCredits : 0) - (ag.ompTotalCredits || 0) - (ag.piTotalCredits || 0) - (ag.cliTotalCredits || 0)))} | ${fmtC(ag.ompTotalCredits || 0)} | ${fmtC(ag.piTotalCredits || 0)} | ${fmtC(ag.cliTotalCredits || 0)} |`);
            L.push('');
        }
        // ── 3. 按模型用量 ──
        L.push('## 3. 按模型用量 / Usage by Model', '');
        L.push('| 模型 | 倍率 | 会话 | 轮次 | 提示 | 输出 | 工具 | 子代理 | AIC 积分 |', '|---|---|---|---|---|---|---|---|---|');
        const byModel = {};
        for (const s of d.sessionsAll) {
            const k = s.modelName || s.model || 'unknown';
            const m = byModel[k] || (byModel[k] = { mult: s.multiplier || 0, sessions: new Set(), turns: 0, prompt: 0, output: 0, tools: 0, subs: 0, credits: 0 });
            if ((s.multiplier || 0) > m.mult) m.mult = s.multiplier;
            m.sessions.add(s.sessionId);
            m.turns += s.turns || 0;
            m.prompt += (s.actualPrompt || s.prompt || 0);
            m.output += (s.actualOutput || s.output || 0);
            m.tools += s.toolCalls || 0;
            m.subs += s.subagents || 0;
            if (s.aicByDay) for (const dd of s.aicByDay) m.credits += dd.credits;
            else if (s.aicCredits) m.credits += s.aicCredits;
        }
        const modelRows = Object.entries(byModel).sort((a, b) => b[1].credits - a[1].credits);
        for (const [k, m] of modelRows) {
            L.push(`| ${k} | ${m.mult || 1}x | ${m.sessions.size} | ${fmtN(m.turns)} | ${fmtN(m.prompt)} | ${fmtN(m.output)} | ${fmtN(m.tools)} | ${fmtN(m.subs)} | ${fmtC(m.credits)} |`);
        }
        L.push('');
        // ── 4. 每日积分 ──
        if (aic && aic.byDay && aic.byDay.length) {
            L.push('## 4. 每日积分 / Daily Credits', '');
            L.push('| 日期 | 积分 |', '|---|---|');
            for (const dd of aic.byDay) L.push(`| ${dd.day} | ${fmtC(dd.credits)} |`);
            L.push('');
        }
        // ── 5. 按项目 ──
        const byProj = {};
        for (const s of d.sessionsAll) {
            const k = s.project || 'unknown';
            const m = byProj[k] || (byProj[k] = { prompt: 0, output: 0, credits: 0, sessions: 0 });
            m.sessions += 1;
            m.prompt += (s.actualPrompt || s.prompt || 0);
            m.output += (s.actualOutput || s.output || 0);
            if (s.aicByDay) for (const dd of s.aicByDay) m.credits += dd.credits;
            else if (s.aicCredits) m.credits += s.aicCredits;
        }
        const projRows = Object.entries(byProj).sort((a, b) => (b[1].prompt + b[1].output) - (a[1].prompt + a[1].output));
        if (projRows.length) {
            L.push('## 5. 按项目用量 / Usage by Project', '');
            L.push('| 项目 | 会话 | 提示 | 输出 | AIC 积分 |', '|---|---|---|---|---|');
            for (const [k, m] of projRows) {
                L.push(`| ${k} | ${m.sessions} | ${fmtN(m.prompt)} | ${fmtN(m.output)} | ${fmtC(m.credits)} |`);
            }
            L.push('');
        }
        // ── 6. 按工具 ──
        const byTool = {};
        for (const x of d.toolsAll) byTool[x.toolName] = (byTool[x.toolName] || 0) + (x.count || 0);
        const toolRows = Object.entries(byTool).sort((a, b) => b[1] - a[1]);
        if (toolRows.length) {
            L.push('## 6. 按工具调用 / Usage by Tool', '');
            L.push('| 工具 | 调用次数 |', '|---|---|');
            for (const [k, v] of toolRows) L.push(`| ${k} | ${fmtN(v)} |`);
            L.push('');
        }
        // ── 7. 按子代理 ──
        const bySub = {};
        for (const x of d.subagentsAll) bySub[x.agentName] = (bySub[x.agentName] || 0) + (x.count || 0);
        const subRows = Object.entries(bySub).sort((a, b) => b[1] - a[1]);
        if (subRows.length) {
            L.push('## 7. 按子代理 / Usage by Subagent', '');
            L.push('| 子代理 | 调用次数 |', '|---|---|');
            for (const [k, v] of subRows) L.push(`| ${k} | ${fmtN(v)} |`);
            L.push('');
        }
        // ── 8. 会话明细 ──
        if (d.sessionsAll.length) {
            L.push('## 8. 会话明细 / All Sessions', '');
            L.push('| 会话 | 项目 | 模型 | 轮次 | 提示 | 输出 | 缓存% | 工具 | AIC |', '|---|---|---|---|---|---|---|---|---|');
            for (const s of d.sessionsAll) {
                const cr = s.aicByDay ? s.aicByDay.reduce((a, x) => a + x.credits, 0) : (s.aicCredits || 0);
                const hit = s.actualPrompt > 0 ? ((s.cacheHitPct || 0).toFixed(1) + '%') : '—';
                L.push(`| ${s.sessionShort || s.sessionId} | ${s.project || ''} | ${s.modelName || s.model || ''} | ${s.turns || 0} | ${fmtN(s.actualPrompt || s.prompt || 0)} | ${fmtN(s.actualOutput || s.output || 0)} | ${hit} | ${s.toolCalls || 0} | ${fmtC(cr)} |`);
            }
            L.push('');
        }
        // ── 9. 多系统 ──
        if (d.machines && d.machines.length > 1) {
            L.push('## 9. 多系统合计 / Systems — Combined Usage', '');
            L.push('| 系统 | 主机 | 积分（周期） | 会话 | 轮次 | Token | 最近上报 |', '|---|---|---|---|---|---|---|');
            for (const m of d.machines) {
                L.push(`| ${m.label} | ${m.host} | ${fmtC(m.cycleCredits || 0)} | ${m.sessions || 0} | ${m.turns || 0} | ${fmtN(m.totalTokens || 0)} | ${m.lastSeen ? new Date(m.lastSeen).toLocaleString('zh-CN') : ''} |`);
            }
            L.push('');
        }
        return L.join('\n');
    }
    // Handle export request from dashboard webview
    dashboardPanel_1.DashboardPanel.onExportStats = async () => {
        await vscode.commands.executeCommand("copilotUsage.exportStats");
    };
    // Keep the status-bar tooltip language in sync with the dashboard toggle.
    dashboardPanel_1.DashboardPanel.onLangChange = (lang) => {
        void context.globalState.update("copilotUsage.uiLang", lang);
        statusBar?.setLang(lang);
    };
    // Load persisted UI state (range / models / refresh / tz / lang) so a
    // re-opened dashboard keeps the user's filters and language instead of
    // snapping back to defaults. Set before any panel is built.
    dashboardPanel_1.DashboardPanel.uiState = context.globalState.get("copilotUsage.uiState") ?? null;
    dashboardPanel_1.DashboardPanel.onUiStateChange = (state) => {
        void context.globalState.update("copilotUsage.uiState", state);
        if (state && state.lang) {
            void context.globalState.update("copilotUsage.uiLang", state.lang);
        }
    };
    // Handle file open requests from dashboard webview
    dashboardPanel_1.DashboardPanel.onOpenFile = (filePath) => {
        const uri = vscode.Uri.file(filePath);
        void vscode.workspace.openTextDocument(uri).then(doc => vscode.window.showTextDocument(doc, { preview: true, preserveFocus: false }), err => {
            output.appendLine(`Failed to open file: ${filePath} — ${err}`);
            vscode.window.showErrorMessage(`Could not open file: ${filePath}`);
        });
    };
    // Handle manual refresh from dashboard webview
    dashboardPanel_1.DashboardPanel.onManualRefresh = () => {
        void runScan().then(() => {
            updateStatusBar();
            dashboardPanel_1.DashboardPanel.updateIfVisible(buildData());
            output.appendLine("Manual refresh triggered from dashboard");
        });
    };
    // Handle refresh rate changes from dashboard webview
    dashboardPanel_1.DashboardPanel.onRefreshRateChange = (intervalMs) => {
        if (scanTimer) {
            clearInterval(scanTimer);
            scanTimer = undefined;
        }
        if (intervalMs > 0) {
            scanTimer = setInterval(() => {
                void runScan().then(() => {
                    updateStatusBar();
                    dashboardPanel_1.DashboardPanel.updateIfVisible(buildData());
                });
            }, intervalMs);
            output.appendLine(`Dashboard refresh rate set to ${intervalMs / 1000}s`);
        }
        else {
            output.appendLine(`Dashboard auto-refresh disabled`);
        }
    };
    // Periodic rescan of chatSession files
    scanTimer = setInterval(() => {
        void runScan().then(() => {
            updateStatusBar();
            dashboardPanel_1.DashboardPanel.updateIfVisible(buildData());
        });
    }, DEFAULT_REFRESH_MS);
    context.subscriptions.push({
        dispose: () => {
            if (scanTimer) {
                clearInterval(scanTimer);
            }
        },
    });
    // Live debug-log file watcher. The debug-logs directory contains
    // `main.jsonl` files that Copilot appends to in real time with API-exact
    // `copilotUsageNanoAiu`. By watching it directly we make the dashboard live
    // even when another VS Code window owns the OTLP receiver port (only one
    // extension instance can bind port 14318 at a time).
    void setupDebugLogWatcher();
    context.subscriptions.push({
        dispose: () => {
            if (debugLogCooldownTimer) {
                clearTimeout(debugLogCooldownTimer);
                debugLogCooldownTimer = undefined;
            }
            if (debugLogWatcher) {
                try {
                    debugLogWatcher.close();
                }
                catch {
                    /* ignore */
                }
                debugLogWatcher = undefined;
            }
        },
    });
    // Settle rescan. A `main.jsonl`/chatSession file that another window (or
    // this one) is actively appending to at the exact moment the cold scan
    // above ran can carry transient duplicate rows — an empty in-progress row
    // plus the fully-populated one, or a subagent whose `child_session_ref`
    // hadn't landed yet (see the turnByKey dedup note in scanner.ts). Those
    // settle within a few seconds as Copilot Chat finishes writing, but
    // without this the inflated cold-start total would sit on screen until
    // the user sent a message and the debug-log watcher triggered a rescan.
    // One extra rescan a few seconds after activation lets the mtime cache
    // pick up the settled files and self-correct before any user action.
    const settleTimer = setTimeout(() => {
        void runScan().then(() => {
            updateStatusBar();
            dashboardPanel_1.DashboardPanel.updateIfVisible(buildData());
        });
    }, 5000);
    context.subscriptions.push({ dispose: () => clearTimeout(settleTimer) });
}
/**
 * Set up a recursive `fs.watch` on workspaceStorage that triggers a debounced
 * rescan whenever a `main.jsonl` file changes. Failure is non-fatal — the
 * periodic timer still provides eventual consistency.
 */
async function setupDebugLogWatcher() {
    try {
        const wsOverride = vscode.workspace
            .getConfiguration("copilotUsage")
            .get("workspaceStoragePath", "")
            .trim();
        const wsRoot = await (0, scanner_1.getWorkspaceStoragePath)(wsOverride || undefined);
        if (!wsRoot) {
            return;
        }
        // recursive:true is supported on Windows + macOS natively and on Linux
        // since Node 20. Wrapped in try/catch so older runtimes degrade silently.
        debugLogWatcher = fs.watch(wsRoot, { recursive: true }, (_event, filename) => {
            if (!filename || !filename.toString().endsWith("main.jsonl")) {
                return;
            }
            fireDebugLogScan();
        });
        debugLogWatcher.on("error", err => {
            output.appendLine(`debug-log watcher error (non-fatal): ${err}`);
        });
        output.appendLine(`Watching debug-logs under ${wsRoot} for real-time updates`);
    }
    catch (err) {
        output.appendLine(`debug-log watcher setup failed (non-fatal): ${err}`);
    }
}
/**
 * Leading-edge fire + trailing coalesce. The first event triggers a scan
 * immediately (no debounce wait). While that scan and the 500 ms cooldown are
 * pending, additional events are coalesced into a single trailing scan that
 * runs once the cooldown elapses. Result: the dashboard reacts within ~10 ms
 * of the first write of an in-flight request, then catches up once more after
 * the burst finishes so the final totals are correct.
 *
 * runScan() itself is also serialized — we never have two scans in flight.
 */
function fireDebugLogScan() {
    if (debugLogCooldownTimer) {
        // We're inside the cooldown window — record that a trailing scan is needed.
        debugLogTrailingPending = true;
        return;
    }
    // Leading edge: arm the cooldown and fire immediately.
    debugLogCooldownTimer = setTimeout(() => {
        debugLogCooldownTimer = undefined;
        if (debugLogTrailingPending) {
            debugLogTrailingPending = false;
            void runScanSerialized();
        }
    }, 500);
    void runScanSerialized();
}
/**
 * Serialized wrapper around runScan() so concurrent watcher events never
 * trigger two scans in parallel (they'd race on the mtime cache and waste
 * I/O). If a scan is already in flight, the caller is silently dropped —
 * the cooldown's trailing scan will pick up any missed work.
 */
async function runScanSerialized() {
    if (debugLogScanInFlight) {
        debugLogTrailingPending = true;
        return;
    }
    debugLogScanInFlight = true;
    try {
        await runScan();
        updateStatusBar();
        dashboardPanel_1.DashboardPanel.updateIfVisible(buildData());
    }
    finally {
        debugLogScanInFlight = false;
    }
}
/** Minutes elapsed since this VS Code window's extension activated. */
function computeWindowDurationMin() {
    if (!activationTime) {
        return 0;
    }
    const ms = Date.now() - new Date(activationTime).getTime();
    return Math.max(0, Math.round(ms / 60_000));
}
/**
 * Aggregate DAILY / WEEKLY / THIS-MONTH AIC + per-model token breakdowns for
 * the status-bar tooltip's donut row. All values come straight from
 * `dashData` — no independent bookkeeping. Per-model token shares within a
 * period drive the donut arcs (token-share ≈ cost-share within a period).
 */
function computeStatusBarRanges(dashData) {
    const today = new Date().toISOString().slice(0, 10);
    const week = new Date();
    week.setDate(week.getDate() - 6);
    const weekStart = week.toISOString().slice(0, 10);
    // THIS MONTH = current calendar month (first day of the month through
    // today), NOT a 30-day rolling window. Users expect the "This Month"
    // label to mean the current month on the calendar.
    const nowMonth = new Date();
    const monthStart = new Date(nowMonth.getFullYear(), nowMonth.getMonth(), 1)
        .toISOString()
        .slice(0, 10);
    let dailyAic = 0;
    let weeklyAic = 0;
    let monthAic = 0;
    for (const row of dashData.aicSummary.byDay) {
        if (row.day === today) {
            dailyAic += row.credits;
        }
        if (row.day >= weekStart && row.day <= today) {
            weeklyAic += row.credits;
        }
        if (row.day >= monthStart && row.day <= today) {
            monthAic += row.credits;
        }
    }
    const dailyModelMap = new Map();
    const weeklyModelMap = new Map();
    const monthModelMap = new Map();
    let dailyTokens = 0;
    let weeklyTokens = 0;
    let monthTokens = 0;
    for (const d of dashData.dailyByModel) {
        const tk = d.prompt + d.output;
        if (d.day === today) {
            dailyTokens += tk;
            dailyModelMap.set(d.model, (dailyModelMap.get(d.model) ?? 0) + tk);
        }
        if (d.day >= weekStart && d.day <= today) {
            weeklyTokens += tk;
            weeklyModelMap.set(d.model, (weeklyModelMap.get(d.model) ?? 0) + tk);
        }
        if (d.day >= monthStart && d.day <= today) {
            monthTokens += tk;
            monthModelMap.set(d.model, (monthModelMap.get(d.model) ?? 0) + tk);
        }
    }
    const toArr = (m) => [...m.entries()]
        .map(([model, tokens]) => ({ model, tokens }))
        .sort((a, b) => b.tokens - a.tokens);
    return {
        daily: { aic: dailyAic, tokens: dailyTokens, byModel: toArr(dailyModelMap) },
        weekly: { aic: weeklyAic, tokens: weeklyTokens, byModel: toArr(weeklyModelMap) },
        month: { aic: monthAic, tokens: monthTokens, byModel: toArr(monthModelMap) },
    };
}
/**
 * Cycle-wide cache-hit % across every session whose lastDate lies in the
 * current billing cycle. Formula lives in cache.ts (single source of truth).
 * Returns undefined when there is no prompt data in the cycle (idle
 * workspace or pre-AIC period).
 */
function computeCycleCacheHit(dashData) {
    const start = dashData.aicSummary.billingCycleStart;
    const end = dashData.aicSummary.billingCycleEnd;
    let prompt = 0;
    let cached = 0;
    for (const s of dashData.sessionsAll) {
        if (!s.lastDate || s.lastDate < start || s.lastDate > end) {
            continue;
        }
        prompt += s.actualPrompt || s.prompt || 0;
        cached += s.actualCached || 0;
    }
    if (prompt <= 0) {
        return undefined;
    }
    return (0, cache_1.computeCacheHit)(prompt, cached).pct;
}
function updateStatusBar() {
    if (!statusBar) {
        return;
    }
    const scan = lastScan?.stats ?? null;
    const otel = receiver?.getStats() ?? null;
    const aicConfig = getAICConfig();
    const calculator = (0, aicCredits_1.createCalculatorFromConfig)(aicConfig);
    const ttlCfg = (0, ttlTracker_1.getTtlConfig)();
    const AIC_START = dashboardData_1.AIC_EFFECTIVE_DATE;
    // SOURCE OF TRUTH for AIC: `dashData.liveOtel` — the same numbers the
    // dashboard widgets and the sidebar render. Until v1.10.5 the status bar
    // had its own independent reimplementation of session/last-request AIC
    // computation, which had drifted from `dashboardData.liveOtel` repeatedly
    // (v1.9.17: bar 8025.8 vs dashboard 111.2; v1.10.2 sidebar 214.1 vs
    // dashboard 129.3; v1.10.4 bar $1.53 / 153.3 vs dashboard 90.3). Reading
    // straight from `dashData.liveOtel` makes drift impossible by construction
    // — there is now exactly one producer of the per-model exact-AIU overlay.
    // See .agents/agents.md "Status bar consumption" — this is the prescribed
    // shape (status bar and dashboard MUST stay in lock-step).
    const dashData = buildData();
    const currentSessionAIC = dashData.liveOtel.sessionAIC;
    const lastRequestAIC = dashData.liveOtel.lastRequestAIC;
    // `informationalAIC` is the sum of byModel rows the classifier marked
    // non-billable (Ollama / BYOK / unknown). The status-bar tooltip uses it
    // to render "(+X.XX informational excluded)" next to the session total
    // so users can see WHY the headline AIC is below the per-model sum,
    // instead of the silent drop-to-zero we shipped in v1.10.13.
    const informationalAIC = dashData.liveOtel.informationalAIC ?? 0;
    // Build currentSession METADATA only (model / turns / prompt / output /
    // duration). The `aicCredits` field is filled from `currentSessionAIC`
    // above — no credit math happens in this block.
    let currentSession = null;
    // Turns active in THIS VS Code window (post-activation, on-or-after AIC start).
    const instanceTurns = lastScan
        ? lastScan.turns.filter(t => t.timestamp && t.timestamp >= activationTime && t.timestamp.slice(0, 10) >= AIC_START)
        : [];
    // Count tool calls scoped to those turns via (sessionId, turnIndex) match.
    // Shared by both the OTel and debug-log paths so the value never depends
    // on which data source rendered first.
    let instanceToolCalls = 0;
    if (lastScan && instanceTurns.length > 0) {
        const turnKeys = new Set(instanceTurns.map(t => `${t.sessionId}|${t.turnIndex}`));
        for (const tc of lastScan.toolCalls) {
            if (turnKeys.has(`${tc.sessionId}|${tc.turnIndex}`)) {
                instanceToolCalls++;
            }
        }
    }
    if (otel && otel.requests > 0) {
        let otelPrompt = 0;
        let otelOutput = 0;
        let otelModel = "unknown";
        let maxTokens = 0;
        for (const m of otel.byModel.values()) {
            otelPrompt += m.prompt;
            otelOutput += m.completion;
            if (m.prompt + m.completion > maxTokens) {
                maxTokens = m.prompt + m.completion;
                otelModel = m.model;
            }
        }
        currentSession = {
            sessionId: "otel",
            sessionShort: "otel",
            model: otelModel,
            turns: otel.requests,
            prompt: otelPrompt,
            output: otelOutput,
            toolCalls: instanceToolCalls,
            durationMin: computeWindowDurationMin(),
            aicCredits: currentSessionAIC,
        };
    }
    else if (lastScan && instanceTurns.length > 0) {
        let instancePrompt = 0;
        let instanceOutput = 0;
        const modelTokens = new Map();
        for (const t of instanceTurns) {
            instancePrompt += t.debugPromptTokens || t.promptTokens;
            instanceOutput += t.debugOutputTokens || t.outputTokens;
            const m = t.modelFamily || "unknown";
            modelTokens.set(m, (modelTokens.get(m) ?? 0) +
                (t.debugPromptTokens || t.promptTokens) +
                (t.debugOutputTokens || t.outputTokens));
        }
        const topModel = [...modelTokens.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
        currentSession = {
            sessionId: "instance",
            sessionShort: "instance",
            model: topModel,
            turns: instanceTurns.length,
            prompt: instancePrompt,
            output: instanceOutput,
            toolCalls: instanceToolCalls,
            durationMin: computeWindowDurationMin(),
            aicCredits: currentSessionAIC,
        };
    }
    statusBar.updateStatus({
        otel,
        scan,
        currentSession,
        totalSessions: scan?.canonicalSessions ?? 0,
        currentSessionAIC,
        lastRequestAIC,
        informationalAIC,
        dailyLimit: computeAndPushDailyLimit(calculator),
        dollarPerCredit: aicConfig.overageCostPerCredit ?? 0.01,
        ranges: computeStatusBarRanges(dashData),
        cycleCacheHitPct: computeCycleCacheHit(dashData),
        liveSessionPrompt: dashData.liveOtel.prompt,
        liveSessionCached: dashData.liveOtel.cached,
        ttlSessions: ttlTracker?.getSessions() ?? [],
        ttlShowInStatusBar: ttlCfg.enabled && ttlCfg.showInStatusBar,
        ttlMaxSessions: ttlCfg.maxSessions,
    });
    // Stash current-session metadata for the sidebar (model / turns / duration).
    // The sidebar's AIC numbers themselves are read from dashData.liveOtel in
    // pushSidebarSnapshot() so they always match the dashboard widgets.
    lastCurrentSession = currentSession;
    // Reuse the dashData we already computed — avoids a second buildData() call
    // per status update tick.
    pushSidebarSnapshot(dashData);
}
/** Build + post the latest SidebarSnapshot using whatever data we already have. */
function pushSidebarSnapshot(precomputed) {
    if (!sidebarProvider) {
        return;
    }
    try {
        // Reuse the caller's dashData when available (the common updateStatusBar
        // path already built it) — otherwise build our own. Both branches feed
        // the same `dashData.liveOtel` values into the sidebar so the AIC
        // numbers are guaranteed identical to the dashboard widgets.
        const dashData = precomputed ?? buildData();
        // SESSION-AIC SOURCE OF TRUTH: read from `dashData.liveOtel.sessionAIC`
        // and `dashData.liveOtel.lastRequestAIC` — NOT from the status-bar's
        // independent reimplementation cached in `lastCurrentSessionAIC` /
        // `lastRequestAICCached`. Per .agents/agents.md, the status-bar logic
        // and the dashboard liveOtel logic are independent reimplementations
        // that have drifted before (v1.9.17 regression: status bar said 8025.8
        // AIC while dashboard said 111.2 — and again in the wild during 1.10.2
        // testing where the sidebar showed 214.1 vs the dashboard's 129.3 for
        // the same window). Sourcing the sidebar from `dashData.liveOtel`
        // guarantees the sidebar and the dashboard widgets always agree.
        //
        // currentSessionModel / Turns / DurationMin are pure metadata (no
        // credit math) so they can keep coming from the status-bar helper.
        const snap = (0, sidebarSnapshot_1.buildSidebarSnapshot)({
            dashData,
            scanTurns: lastScan?.turns ?? [],
            liveStats: receiver?.getStats() ?? null,
            lastRequestAIC: dashData.liveOtel.lastRequestAIC,
            currentSessionAIC: dashData.liveOtel.sessionAIC,
            currentSessionModel: lastCurrentSession?.model ?? null,
            currentSessionTurns: lastCurrentSession?.turns ?? 0,
            currentSessionDurationMin: lastCurrentSession?.durationMin ?? 0,
            activationTime,
            ttlSessions: ttlTracker?.getSessions() ?? [],
        });
        sidebarProvider.postSnapshot(snap);
    }
    catch (err) {
        output?.appendLine(`Sidebar snapshot build failed (non-fatal): ${err}`);
    }
}
function computeAndPushDailyLimit(calculator) {
    if (!limitTracker) {
        return undefined;
    }
    const cfg = (0, dailyLimitTracker_1.getDailyLimitConfig)();
    const aicCfg = getAICConfig();
    const dpc = aicCfg.overageCostPerCredit ?? 0.01;
    const snap = limitTracker.snapshot(lastScan, receiver?.getStats() ?? null, calculator, dpc);
    // When the guard is disabled, still propagate the (disabled) snapshot so the
    // hook state file unblocks agents and any enforcement is released. Skip the
    // overlay nag/enforce logic only.
    if (!cfg.enabled) {
        void hookManager?.updateFromSnapshot(snap);
        void enforcement?.release();
        // Keep shield in sync if it happens to be open (e.g. user just toggled off
        // from inside the webview — they want the toggle to still respond).
        limitOverlay?.render(snap);
        return summarizeSnapshot(snap);
    }
    // Auto-clear resume/snooze when the day rolls over.
    if (limitDayKey && limitDayKey !== snap.dayKey) {
        void (async () => {
            await limitTracker?.clearSnooze();
            await limitTracker?.clearResume();
            await enforcement?.release();
            output?.appendLine(`Day rolled ${limitDayKey} → ${snap.dayKey} — snooze/resume cleared, pause released.`);
        })();
    }
    limitDayKey = snap.dayKey;
    // Fire stage-change listeners (overlay + enforcement).
    limitTracker.push(snap);
    // Update hook state file so CLI / custom agents / cloud agent see the new
    // blocked/unblocked state on their next tool call.
    void hookManager?.updateFromSnapshot(snap);
    // Continuous enforcement decision — runs on every snapshot, not just stage change.
    // This is what makes Snooze/Resume/expiry transitions actually take effect.
    const shouldBlock = snap.stage === "limit" && !snap.snoozed && !snap.resumed;
    void (async () => {
        if (shouldBlock) {
            await enforcement?.enforce(snap.enforcement);
        }
        else {
            await enforcement?.release();
        }
    })();
    // Always re-render overlay so it can re-nag on every new request while at limit.
    limitOverlay?.render(snap);
    return summarizeSnapshot(snap);
}
/** Project the subset of snapshot fields exposed via the status bar callback. */
function summarizeSnapshot(snap) {
    return {
        stage: snap.stage,
        used: snap.used,
        limit: snap.limit,
        percent: snap.percent,
        usedDollars: snap.usedDollars,
        limitDollars: snap.limitDollars,
        dollarMode: snap.dollarMode,
        snoozed: snap.snoozed,
        resumed: snap.resumed,
    };
}
function deactivate() {
    if (scanTimer) {
        clearInterval(scanTimer);
    }
    if (otelDebounceTimer) {
        clearTimeout(otelDebounceTimer);
    }
    if (debugLogCooldownTimer) {
        clearTimeout(debugLogCooldownTimer);
        debugLogCooldownTimer = undefined;
    }
    if (debugLogWatcher) {
        try {
            debugLogWatcher.close();
        }
        catch {
            /* ignore */
        }
        debugLogWatcher = undefined;
    }
    receiver?.stop();
    statusBar?.dispose();
}
//# sourceMappingURL=extension.js.map