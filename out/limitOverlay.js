"use strict";
/**
 * limitOverlay.ts — The visual indicator for the daily AI Credits limit.
 *
 * Two surfaces:
 *   • Corner card  — appears at brace stage (≥ braceAtPercent). Small,
 *     non-modal toast via showWarningMessage.
 *   • Credit Shield — a full webview panel that opens at the limit stage.
 *     Glassmorphism card with animated radial credit ring, live countdown
 *     to next reset, and action buttons (Snooze / Resume / Dashboard).
 *
 * The shield is rendered as a normal webview panel (we cannot truly hover
 * outside the VS Code window, but auto-focusing the panel in a new column
 * gives the same attention-grabbing effect).
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
exports.LimitOverlay = void 0;
const vscode = __importStar(require("vscode"));
class LimitOverlay {
    extensionUri;
    shield;
    /** Last request count we already nagged for, per dayKey. */
    lastNaggedReq = new Map();
    /** Last request count we showed the brace toast for, per dayKey. */
    lastBraceReq = new Map();
    /** True after the chime has played for the current day's limit hit. */
    chimedDay;
    /** True while a corner toast is open — avoids stacking. */
    toastOpen = false;
    constructor(extensionUri) {
        this.extensionUri = extensionUri;
    }
    /** Show / update the appropriate surface for this snapshot. */
    render(snap) {
        if (!snap.enabled) {
            // Don't dispose the shield — user may have just toggled "Shield enabled"
            // off from inside the panel and needs the toggle to stay visible so they
            // can flip it back on. Just push the new snap; if the panel isn't open
            // we won't auto-open one.
            if (this.shield) {
                this.updateShield(snap, /*open*/ false);
            }
            return;
        }
        // Respect snooze + manual resume — no nag, but keep shield in sync if it's open.
        if (snap.snoozed || snap.resumed) {
            this.updateShield(snap, /*open*/ false);
            return;
        }
        if (snap.stage === "limit") {
            // Re-nag on every new request until user snoozes, resumes, or raises the limit.
            const lastReq = this.lastNaggedReq.get(snap.dayKey) ?? -1;
            const isNewRequest = snap.requestCount > lastReq;
            this.lastNaggedReq.set(snap.dayKey, snap.requestCount);
            this.openShield(snap, /*reveal*/ isNewRequest);
            if (isNewRequest) {
                this.showLimitToast(snap);
                if (snap.playSound && this.chimedDay !== snap.dayKey) {
                    this.chimedDay = snap.dayKey;
                    this.postChime();
                }
            }
        }
        else if (snap.stage === "brace") {
            const lastReq = this.lastBraceReq.get(snap.dayKey) ?? -1;
            if (snap.requestCount > lastReq) {
                this.lastBraceReq.set(snap.dayKey, snap.requestCount);
                this.showCornerCard(snap);
            }
            this.updateShield(snap, /*open*/ false);
        }
        else {
            // Stage dropped below brace (limit raised) — clear chime + reset trackers.
            if (snap.stage === "none" || snap.stage === "warn") {
                this.chimedDay = undefined;
            }
            this.updateShield(snap, /*open*/ false);
        }
    }
    /** Force-open the shield (used by `showShield` command). */
    forceShow(snap) {
        this.openShield(snap, /*reveal*/ true);
    }
    showCornerCard(snap) {
        if (this.toastOpen) {
            return;
        }
        this.toastOpen = true;
        const left = Math.max(0, snap.limit - snap.used).toFixed(1);
        const leftDollars = Math.max(0, snap.limitDollars - snap.usedDollars).toFixed(2);
        void vscode.window
            .showWarningMessage(`⚠ Copilot daily budget: $${snap.usedDollars.toFixed(2)} / $${snap.limitDollars.toFixed(2)} (${snap.used.toFixed(1)} / ${snap.limit} AIC, ${snap.percent}%). $${leftDollars} (${left} AIC) left today.`, "Open Shield", "Snooze")
            .then(c => {
            this.toastOpen = false;
            if (c === "Open Shield") {
                this.forceShow(snap);
            }
            else if (c === "Snooze") {
                void vscode.commands.executeCommand("copilotUsage.dailyLimit.snooze");
            }
        });
    }
    /** Limit-stage toast — re-shown on every new request until acknowledged. */
    showLimitToast(snap) {
        if (this.toastOpen) {
            return;
        }
        this.toastOpen = true;
        void vscode.window
            .showErrorMessage(`🛑 Copilot daily limit reached: $${snap.usedDollars.toFixed(2)} / $${snap.limitDollars.toFixed(2)} (${snap.used.toFixed(1)} / ${snap.limit} AIC). New requests will keep adding to your bill until you snooze, resume, or raise the limit.`, "Open Shield", "Snooze 10 min", "Resume anyway", "Raise limit…")
            .then(c => {
            this.toastOpen = false;
            if (c === "Open Shield") {
                this.forceShow(snap);
            }
            else if (c === "Snooze 10 min") {
                void vscode.commands.executeCommand("copilotUsage.dailyLimit.snooze");
            }
            else if (c === "Resume anyway") {
                void vscode.commands.executeCommand("copilotUsage.dailyLimit.resume");
            }
            else if (c === "Raise limit…") {
                void vscode.commands.executeCommand("workbench.action.openSettings", "copilotUsage.dailyLimit");
            }
        });
    }
    postChime() {
        if (!this.shield) {
            return;
        }
        void this.shield.webview.postMessage({ type: "chime" });
    }
    openShield(snap, reveal = true) {
        if (this.shield) {
            this.updateShield(snap, /*open*/ true);
            if (reveal) {
                try {
                    this.shield.reveal(vscode.ViewColumn.Active, false);
                }
                catch {
                    /* panel disposed */
                }
            }
            return;
        }
        this.shield = vscode.window.createWebviewPanel("copilotUsage.dailyLimitShield", "🛡️ Daily AI Credit Limit", { viewColumn: vscode.ViewColumn.Active, preserveFocus: false }, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [this.extensionUri],
        });
        this.shield.iconPath = vscode.Uri.joinPath(this.extensionUri, "images", "icon.png");
        this.shield.onDidDispose(() => {
            this.shield = undefined;
        });
        this.shield.webview.onDidReceiveMessage(async (msg) => {
            switch (msg?.type) {
                case "snooze":
                    void vscode.commands.executeCommand("copilotUsage.dailyLimit.snooze");
                    this.shield?.dispose();
                    break;
                case "resume":
                    void vscode.commands.executeCommand("copilotUsage.dailyLimit.resume");
                    this.shield?.dispose();
                    break;
                case "stop":
                    void vscode.commands.executeCommand("copilotUsage.dailyLimit.reset");
                    this.shield?.dispose();
                    break;
                case "raise":
                    // Use the @id: filter — it's the only way to pin VS Code's settings
                    // search to exact setting IDs. Tokens like "copilotUsage.dailyLimit"
                    // get fuzzy-matched and surface AIC monthly settings instead.
                    void vscode.commands.executeCommand("workbench.action.openSettings", "copilotUsage.dailyLimit");
                    break;
                case "setDollars": {
                    const v = Number(msg.value);
                    if (Number.isFinite(v) && v >= 0) {
                        await vscode.workspace
                            .getConfiguration("copilotUsage.dailyLimit")
                            .update("dollars", v, vscode.ConfigurationTarget.Global);
                    }
                    break;
                }
                case "setEnabled": {
                    const v = !!msg.value;
                    await vscode.workspace
                        .getConfiguration("copilotUsage.dailyLimit")
                        .update("enabled", v, vscode.ConfigurationTarget.Global);
                    break;
                }
                case "setHooks": {
                    const v = !!msg.value;
                    await vscode.workspace
                        .getConfiguration("copilotUsage.dailyLimit")
                        .update("installAgentHooks", v, vscode.ConfigurationTarget.Global);
                    break;
                }
                case "dashboard":
                    void vscode.commands.executeCommand("copilotUsage.openDashboard");
                    this.shield?.dispose();
                    break;
                case "close":
                    this.shield?.dispose();
                    break;
            }
        });
        this.shield.webview.html = this.renderHtml(snap);
    }
    updateShield(snap, open) {
        if (!this.shield) {
            if (open && snap.stage === "limit") {
                this.openShield(snap, false);
            }
            return;
        }
        void this.shield.webview.postMessage({ type: "update", snap });
    }
    disposeShield() {
        this.shield?.dispose();
        this.shield = undefined;
    }
    /** Standalone HTML — no external deps, theme-aware via VS Code CSS vars. */
    renderHtml(snap) {
        const initial = JSON.stringify(snap);
        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>Daily Credit Shield</title>
<style>
  :root {
    --bg: var(--vscode-editor-background, #1e1e1e);
    --fg: var(--vscode-editor-foreground, #ddd);
    --muted: var(--vscode-descriptionForeground, #999);
    --danger: #ff4d4f;
    --danger-2: #b91c1c;
    --warn: #f59e0b;
    --ok: #22c55e;
    --glass: rgba(255,255,255,0.04);
    --border: rgba(255,255,255,0.08);
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%; background: radial-gradient(ellipse at top, rgba(255,77,79,0.10), transparent 60%), var(--bg); color: var(--fg); font-family: var(--vscode-font-family, system-ui, sans-serif); overflow: hidden; }
  body { display: flex; align-items: center; justify-content: center; padding: 24px; }
  .stage { position: relative; width: 100%; max-width: 760px; }
  .sparks { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  .spark { position: absolute; width: 4px; height: 4px; border-radius: 50%; background: var(--danger); opacity: 0.0; animation: drift 6s linear infinite; filter: blur(0.5px); }
  @keyframes drift {
    0%   { transform: translate(var(--x0), 110%) scale(0.5); opacity: 0; }
    10%  { opacity: 0.5; }
    50%  { transform: translate(var(--x1), 30%) scale(1); opacity: 0.8; }
    100% { transform: translate(var(--x2), -10%) scale(0.4); opacity: 0; }
  }
  .card {
    position: relative;
    border-radius: 20px;
    padding: 32px 36px 24px;
    background: linear-gradient(180deg, var(--glass), rgba(255,255,255,0.02));
    border: 1px solid var(--border);
    backdrop-filter: blur(14px);
    box-shadow: 0 30px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,77,79,0.15), 0 0 40px rgba(255,77,79,0.10);
    animation: cardIn 480ms cubic-bezier(.2,.9,.2,1);
    overflow: hidden;
  }
  @keyframes cardIn { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }
  .head { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; }
  .shield-icon { font-size: 28px; filter: drop-shadow(0 0 6px rgba(255,77,79,0.6)); animation: pulse 2.4s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); filter: drop-shadow(0 0 12px rgba(255,77,79,0.9)); } }
  h1 { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: 0.3px; flex: 1; }
  .body { display: grid; grid-template-columns: 220px 1fr; gap: 28px; align-items: center; }
  @media (max-width: 560px) { .body { grid-template-columns: 1fr; text-align: center; } }
  .ring-wrap { position: relative; width: 200px; height: 200px; margin: auto; }
  .ring-wrap svg { width: 100%; height: 100%; transform: rotate(-90deg); }
  .ring-bg { stroke: rgba(255,255,255,0.08); fill: none; stroke-width: 14; }
  .ring-fg { fill: none; stroke-width: 14; stroke-linecap: round; transition: stroke-dashoffset 700ms cubic-bezier(.2,.9,.2,1), stroke 400ms; filter: drop-shadow(0 0 8px currentColor); }
  .ring-text { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .ring-dollars { font-size: 30px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
  .ring-aic { margin-top: 4px; font-size: 11px; color: var(--muted); letter-spacing: 0.4px; }
  .ring-pct { margin-top: 6px; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,0.08); }
  .meta { display: flex; flex-direction: column; gap: 10px; }
  .row { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; padding: 8px 12px; background: var(--glass); border: 1px solid var(--border); border-radius: 10px; }
  .row .k { color: var(--muted); }
  .row .v { font-weight: 600; font-variant-numeric: tabular-nums; }
  .row .sub { color: var(--muted); font-weight: 400; font-size: 11px; margin-left: 6px; }
  .lead { margin-top: 16px; font-size: 13px; color: var(--muted); line-height: 1.5; }
  .lead strong { color: var(--fg); }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }
  button { all: unset; cursor: pointer; padding: 10px 16px; border-radius: 10px; font-size: 13px; font-weight: 500; border: 1px solid var(--border); background: var(--glass); transition: transform 120ms, background 120ms, border-color 120ms; }
  button:hover { transform: translateY(-1px); background: rgba(255,255,255,0.08); }
  button.primary { background: linear-gradient(180deg, var(--danger), var(--danger-2)); border-color: rgba(255,77,79,0.4); color: white; box-shadow: 0 6px 18px rgba(255,77,79,0.35); }
  button.primary:hover { background: linear-gradient(180deg, #ff6669, #c91d1d); }
  button.stop { background: linear-gradient(180deg, #ef4444, #991b1b); border-color: rgba(239,68,68,0.5); color: white; box-shadow: 0 6px 18px rgba(239,68,68,0.4); font-weight: 700; }
  button.stop:hover { background: linear-gradient(180deg, #f87171, #7f1d1d); }
  button.ghost { color: var(--muted); }
  .footer { margin-top: 12px; font-size: 11px; color: var(--muted); opacity: 0.7; text-align: right; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; background: rgba(255,77,79,0.18); color: #ffb4b6; border: 1px solid rgba(255,77,79,0.35); }
  .badge.warn { background: rgba(245,158,11,0.18); color: #fde68a; border-color: rgba(245,158,11,0.35); }
  .badge.ok   { background: rgba(34,197,94,0.18);  color: #bbf7d0; border-color: rgba(34,197,94,0.35);  }

  /* ── Chibi mascot ── */
  .stage-floor {
    position: relative;
    height: 86px;
    margin-top: 14px;
    border-top: 1px dashed var(--border);
    overflow: hidden;
  }
  .mascot {
    position: absolute;
    bottom: 4px;
    left: 0;
    width: 64px;
    height: 72px;
    animation: walkAcross 9s linear infinite;
    will-change: transform;
  }
  @keyframes walkAcross {
    0%   { transform: translateX(-80px) scaleX(1); }
    49%  { transform: translateX(calc(100% + 0px)) scaleX(1); }
    50%  { transform: translateX(calc(100% + 0px)) scaleX(-1); }
    99%  { transform: translateX(-80px) scaleX(-1); }
    100% { transform: translateX(-80px) scaleX(1); }
  }
  .mascot.frozen { animation: none; left: 50%; transform: translateX(-50%); bottom: 6px; }
  .bob { animation: bob 0.45s ease-in-out infinite; transform-origin: center bottom; }
  @keyframes bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
  .leg.l { animation: legL 0.45s ease-in-out infinite; transform-origin: 50% 0%; }
  .leg.r { animation: legR 0.45s ease-in-out infinite; transform-origin: 50% 0%; }
  @keyframes legL { 0%,100% { transform: rotate(-20deg); } 50% { transform: rotate(20deg); } }
  @keyframes legR { 0%,100% { transform: rotate(20deg);  } 50% { transform: rotate(-20deg); } }
  .arm.l { animation: armL 0.45s ease-in-out infinite; transform-origin: 50% 0%; }
  .arm.r { animation: armR 0.45s ease-in-out infinite; transform-origin: 50% 0%; }
  @keyframes armL { 0%,100% { transform: rotate(25deg); }  50% { transform: rotate(-25deg); } }
  @keyframes armR { 0%,100% { transform: rotate(-25deg); } 50% { transform: rotate(25deg);  } }

  .bubble {
    position: absolute;
    bottom: 48px;
    padding: 4px 10px;
    background: var(--glass);
    border: 1px solid var(--border);
    border-radius: 10px;
    font-size: 11px;
    color: var(--fg);
    white-space: nowrap;
    backdrop-filter: blur(6px);
    pointer-events: none;
    opacity: 0;
    animation: bubblePop 9s linear infinite;
  }
  @keyframes bubblePop {
    0%, 10%   { opacity: 0; transform: translateY(4px); }
    15%, 40%  { opacity: 0.9; transform: translateY(0); }
    45%, 100% { opacity: 0; transform: translateY(-4px); }
  }
  .mascot.frozen + .bubble { left: 50%; transform: translateX(-50%); animation: none; opacity: 1; }

  /* coin trail for warn/brace stages */
  .coin {
    position: absolute;
    bottom: 8px;
    width: 8px; height: 8px; border-radius: 50%;
    background: radial-gradient(circle at 30% 30%, #fde68a, #f59e0b);
    box-shadow: 0 0 6px rgba(245,158,11,0.6);
    opacity: 0;
    animation: coinFall 1.6s ease-in infinite;
  }
  @keyframes coinFall {
    0%   { opacity: 0; transform: translateY(-30px) rotate(0); }
    20%  { opacity: 1; }
    80%  { opacity: 1; }
    100% { opacity: 0; transform: translateY(0) rotate(180deg); }
  }

  /* ── Inline settings strip ── */
  .settings-strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px;
    margin-top: 16px;
    padding: 12px 14px;
    background: rgba(255,255,255,0.03);
    border: 1px solid var(--border);
    border-radius: 12px;
    font-size: 12px;
  }
  .settings-strip .field { display: flex; align-items: center; gap: 8px; }
  .settings-strip label { color: var(--muted); font-weight: 500; }
  .settings-strip input[type="number"] {
    width: 78px;
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--vscode-input-background, rgba(0,0,0,0.25));
    color: var(--fg);
    font-family: inherit;
    font-size: 12px;
    outline: none;
  }
  .settings-strip input[type="number"]:focus { border-color: var(--danger); }
  .settings-strip .toggle {
    position: relative; width: 34px; height: 18px; flex-shrink: 0;
    background: rgba(255,255,255,0.12); border-radius: 999px;
    cursor: pointer; transition: background 180ms;
  }
  .settings-strip .toggle::after {
    content: ''; position: absolute; top: 2px; left: 2px;
    width: 14px; height: 14px; border-radius: 50%;
    background: #ddd; transition: transform 180ms;
  }
  .settings-strip .toggle.on { background: var(--ok); }
  .settings-strip .toggle.on::after { transform: translateX(16px); }
  .settings-strip .hint { color: var(--muted); font-size: 10px; opacity: 0.7; flex-basis: 100%; margin-top: -4px; }
  .settings-strip .saved { color: var(--ok); font-size: 10px; opacity: 0; transition: opacity 200ms; }
  .settings-strip .saved.show { opacity: 1; }
</style>
</head>
<body>
  <div class="stage">
    <div class="sparks" id="sparks"></div>
    <div class="card">
      <div class="head">
        <div class="shield-icon" id="shieldIcon">🛡️</div>
        <h1 id="title">Daily AI Credit Limit Reached</h1>
        <span class="badge" id="stageBadge">LIMIT</span>
      </div>
      <div class="body">
        <div class="ring-wrap">
          <svg viewBox="0 0 200 200">
            <circle class="ring-bg" cx="100" cy="100" r="85"></circle>
            <circle id="ring" class="ring-fg" cx="100" cy="100" r="85" stroke="var(--danger)" stroke-dasharray="534" stroke-dashoffset="0"></circle>
          </svg>
          <div class="ring-text">
            <div class="ring-dollars" id="dollars">$0.00</div>
            <div class="ring-aic" id="aicLine">0 / 0 AIC</div>
            <div class="ring-pct" id="pct">0%</div>
          </div>
        </div>
        <div class="meta">
          <div class="row"><span class="k">Spent today</span><span class="v"><span id="usedDollars">$0.00</span><span class="sub" id="usedAic">0 AIC</span></span></div>
          <div class="row"><span class="k">Daily budget</span><span class="v"><span id="limitDollars">$0.00</span><span class="sub" id="limitAic">0 AIC</span></span></div>
          <div class="row"><span class="k">Remaining</span><span class="v"><span id="remainingDollars">$0.00</span><span class="sub" id="remainingAic">0 AIC</span></span></div>
          <div class="row"><span class="k">Resets in</span><span class="v" id="reset">—</span></div>
          <div class="row"><span class="k">Enforcement</span><span class="v" id="mode">—</span></div>
        </div>
      </div>
      <div class="lead" id="lead">
        Copilot requests have been <strong>paused</strong> to protect your daily budget.
      </div>

      <!-- Chibi mascot floor -->
      <div class="stage-floor" id="floor">
        <div class="mascot" id="mascot">
          ${this.mascotSvg()}
        </div>
        <div class="bubble" id="bubble">…</div>
      </div>

      <div class="actions">
        <button class="primary" data-act="dashboard">Open Dashboard</button>
        <button data-act="snooze">Snooze 10 min</button>
        <button data-act="resume">Resume anyway</button>
        <button class="stop" data-act="stop" id="stopBtn" hidden>⛔ End Override &amp; Block</button>
        <button data-act="raise">More settings…</button>
        <button class="ghost" data-act="close">Hide</button>
      </div>

      <div class="settings-strip" id="settingsStrip">
        <div class="field">
          <label for="dollarInput">Daily $ limit</label>
          <input type="number" id="dollarInput" min="0" step="0.50" placeholder="0 = use credits" />
        </div>
        <div class="field">
          <label for="enabledToggle">Shield enabled</label>
          <div class="toggle" id="enabledToggle" role="switch" tabindex="0"></div>
        </div>
        <div class="field">
          <label for="hooksToggle">Block CLI / agents</label>
          <div class="toggle" id="hooksToggle" role="switch" tabindex="0"></div>
        </div>
        <span class="saved" id="savedHint">✓ Saved</span>
        <div class="hint">$0 → fall back to credits limit. Toggling "Shield enabled" off disables all enforcement.</div>
      </div>
      <div class="footer">Tip: configure limits in Settings → <em>copilotUsage.dailyLimit</em> (credits <em>or</em> dollars)</div>
    </div>
  </div>

<script>
  const vscode = acquireVsCodeApi();
  let snap = ${initial};

  // Sparks background — pure CSS animation, JS just spawns elements once.
  (function makeSparks() {
    const root = document.getElementById('sparks');
    for (let i = 0; i < 18; i++) {
      const s = document.createElement('div');
      s.className = 'spark';
      const x0 = (Math.random() * 100) + '%';
      const x1 = (Math.random() * 100) + '%';
      const x2 = (Math.random() * 100) + '%';
      s.style.setProperty('--x0', x0);
      s.style.setProperty('--x1', x1);
      s.style.setProperty('--x2', x2);
      s.style.animationDelay = (-Math.random() * 6) + 's';
      s.style.left = x0;
      root.appendChild(s);
    }
  })();

  function fmtDuration(ms) {
    if (ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm ' + sec + 's';
    return sec + 's';
  }
  function colorFor(stage, snap) {
    if (snap && (snap.snoozed || snap.resumed)) return 'var(--ok)';
    if (stage === 'limit') return 'var(--danger)';
    if (stage === 'brace') return '#f97316';
    if (stage === 'warn')  return 'var(--warn)';
    return 'var(--ok)';
  }
  function labelFor(stage, snap) {
    if (snap && snap.resumed) return 'RESUMED';
    if (snap && snap.snoozed) return 'SNOOZED';
    if (stage === 'limit') return 'LIMIT';
    if (stage === 'brace') return 'BRACE';
    if (stage === 'warn')  return 'WARN';
    return 'OK';
  }
  function titleFor(stage, snap) {
    if (snap && snap.resumed) return 'Daily Limit Overridden — Resumed';
    if (snap && snap.snoozed) return 'Daily Limit Snoozed';
    if (stage === 'limit') return 'Daily AI Credit Limit Reached';
    if (stage === 'brace') return 'Daily AI Credits Almost Gone';
    if (stage === 'warn')  return 'Daily AI Credit Usage High';
    return 'Daily AI Credit Status';
  }
  function bubbleFor(stage, snap) {
    if (snap && snap.resumed) return 'Resumed for today — spend carefully!';
    if (snap && snap.snoozed) return 'Snoozed — back to coding for now ✨';
    if (stage === 'limit') return "That's enough for today — save tomorrow's coins!";
    if (stage === 'brace') return 'Hold the line! Almost out of credits…';
    if (stage === 'warn')  return 'Steady… 75% of budget used.';
    return 'All good!';
  }

  const RING_CIRCUM = 2 * Math.PI * 85;

  function render() {
    const pct = Math.min(100, snap.percent || 0);
    const remAic = Math.max(0, snap.limit - snap.used);
    const remDol = Math.max(0, snap.limitDollars - snap.usedDollars);

    document.getElementById('dollars').textContent = '$' + snap.usedDollars.toFixed(2);
    document.getElementById('aicLine').textContent = snap.used.toFixed(1) + ' / ' + snap.limit + ' AIC';
    document.getElementById('pct').textContent = pct.toFixed(0) + '%';

    document.getElementById('usedDollars').textContent = '$' + snap.usedDollars.toFixed(2);
    document.getElementById('usedAic').textContent = snap.used.toFixed(2) + ' AIC';
    document.getElementById('limitDollars').textContent = '$' + snap.limitDollars.toFixed(2);
    document.getElementById('limitAic').textContent = snap.limit + ' AIC';
    document.getElementById('remainingDollars').textContent = '$' + remDol.toFixed(2);
    document.getElementById('remainingAic').textContent = remAic.toFixed(2) + ' AIC';
    document.getElementById('mode').textContent = snap.enforcement + (snap.dollarMode ? ' • $ mode' : '');

    document.getElementById('title').textContent = titleFor(snap.stage, snap);
    const badge = document.getElementById('stageBadge');
    badge.textContent = labelFor(snap.stage, snap);
    const isCalm = snap.snoozed || snap.resumed;
    badge.className = 'badge ' + (isCalm ? 'ok' : snap.stage === 'warn' ? 'warn' : snap.stage === 'none' ? 'ok' : '');

    const ring = document.getElementById('ring');
    const dash = RING_CIRCUM * (1 - pct / 100);
    ring.setAttribute('stroke-dashoffset', dash.toString());
    ring.setAttribute('stroke', colorFor(snap.stage, snap));

    const lead = document.getElementById('lead');
    if (snap.resumed) {
      lead.innerHTML = 'You <strong>overrode</strong> the limit for today. Copilot is fully active and your spend counter keeps growing. The override clears at the next reset.';
    } else if (snap.snoozed) {
      lead.innerHTML = 'Snoozed — nag silenced and Copilot temporarily resumed. Will re-engage when snooze expires if still over budget.';
    } else if (snap.stage === 'limit') {
      lead.innerHTML = 'You\\'ve spent <strong>$' + snap.usedDollars.toFixed(2) + '</strong> of your <strong>$' + snap.limitDollars.toFixed(2) + '</strong> daily Copilot budget. Inline completions are <strong>paused</strong> (mode: <em>' + snap.enforcement + '</em>). Add credits, wait for reset, or <strong>Resume anyway</strong>.';
    } else if (snap.stage === 'brace') {
      lead.innerHTML = '<strong>$' + remDol.toFixed(2) + '</strong> (' + remAic.toFixed(1) + ' AIC) left today. Consider wrapping up.';
    } else if (snap.stage === 'warn') {
      lead.innerHTML = 'You\\'ve used <strong>' + pct.toFixed(0) + '%</strong> of today\\'s $' + snap.limitDollars.toFixed(2) + ' budget.';
    } else {
      lead.innerHTML = 'You are within today\\'s $' + snap.limitDollars.toFixed(2) + ' budget. Carry on.';
    }

    // Mascot freezes only when at hard limit AND not snoozed/resumed.
    const mascot = document.getElementById('mascot');
    const bubble = document.getElementById('bubble');
    if (snap.stage === 'limit' && !isCalm) { mascot.classList.add('frozen'); }
    else { mascot.classList.remove('frozen'); }
    bubble.textContent = bubbleFor(snap.stage, snap);

    // Toggle the "End Override" stop button — only visible when snoozed or resumed.
    const stopBtn = document.getElementById('stopBtn');
    if (stopBtn) { stopBtn.hidden = !isCalm; }

    // Coin trail for warn/brace stages (not when calmed).
    paintCoins(!isCalm && (snap.stage === 'warn' || snap.stage === 'brace'));
  }

  function paintCoins(on) {
    const floor = document.getElementById('floor');
    floor.querySelectorAll('.coin').forEach(c => c.remove());
    if (!on) return;
    for (let i = 0; i < 5; i++) {
      const c = document.createElement('div');
      c.className = 'coin';
      c.style.left = (10 + i * 18) + '%';
      c.style.animationDelay = (-Math.random() * 1.6) + 's';
      floor.appendChild(c);
    }
  }

  function tick() {
    const el = document.getElementById('reset');
    if (!snap) return;
    const remaining = snap.msUntilReset - (Date.now() - tickBase);
    el.textContent = fmtDuration(remaining);
  }
  let tickBase = Date.now();
  setInterval(tick, 1000);

  document.querySelectorAll('button[data-act]').forEach(b => {
    b.addEventListener('click', () => vscode.postMessage({ type: b.getAttribute('data-act') }));
  });

  // ── Inline settings strip wiring ──
  const dollarInput = document.getElementById('dollarInput');
  const enabledToggle = document.getElementById('enabledToggle');
  const hooksToggle = document.getElementById('hooksToggle');
  const savedHint = document.getElementById('savedHint');
  let savedTimer = null;
  function flashSaved() {
    if (!savedHint) return;
    savedHint.classList.add('show');
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = setTimeout(() => savedHint.classList.remove('show'), 1200);
  }
  function syncSettingsStrip() {
    if (dollarInput && document.activeElement !== dollarInput) {
      dollarInput.value = (snap.dollarsSetting ?? 0) > 0 ? String(snap.dollarsSetting) : '';
    }
    if (enabledToggle) enabledToggle.classList.toggle('on', !!snap.enabled);
    if (hooksToggle) hooksToggle.classList.toggle('on', !!snap.installAgentHooks);
  }
  if (dollarInput) {
    let debounce = null;
    dollarInput.addEventListener('input', () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        const v = parseFloat(dollarInput.value);
        vscode.postMessage({ type: 'setDollars', value: Number.isFinite(v) ? v : 0 });
        flashSaved();
      }, 400);
    });
  }
  function bindToggle(el, type) {
    if (!el) return;
    const fire = () => {
      const next = !el.classList.contains('on');
      el.classList.toggle('on', next);
      vscode.postMessage({ type, value: next });
      flashSaved();
    };
    el.addEventListener('click', fire);
    el.addEventListener('keydown', (ev) => {
      if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); fire(); }
    });
  }
  bindToggle(enabledToggle, 'setEnabled');
  bindToggle(hooksToggle, 'setHooks');

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg && msg.type === 'update') {
      snap = msg.snap;
      tickBase = Date.now();
      render();
      syncSettingsStrip();
    } else if (msg && msg.type === 'chime') {
      playChime();
    }
  });

  // ── Web Audio chime ──
  // A short, soft 2-note descending bell. No autoplay until first user gesture
  // or message arrives — the webview is opened in response to a user-visible
  // event so this is allowed.
  function playChime() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const now = ctx.currentTime;
      const notes = [880, 587]; // A5 -> D5
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const start = now + i * 0.18;
        const end = start + 0.45;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(end + 0.05);
      });
      setTimeout(() => { try { ctx.close(); } catch (_) {} }, 1200);
    } catch (_) { /* audio not available */ }
  }

  // If we open the shield already at limit and playSound is enabled, chime once.
  if (snap && snap.stage === 'limit' && snap.playSound) {
    setTimeout(playChime, 250);
  }

  render();
  syncSettingsStrip();
  tick();
</script>
</body>
</html>`;
    }
    /** Inline SVG of a tiny chibi guardian. Pure shapes; no external assets. */
    mascotSvg() {
        return /* html */ `
<svg viewBox="0 0 64 72" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="bodyG" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#ff6b6b"/>
      <stop offset="1" stop-color="#b91c1c"/>
    </linearGradient>
    <radialGradient id="cheekG" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffb1b1" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#ffb1b1" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <g class="bob">
    <!-- shield body -->
    <path d="M14 22 Q32 12 50 22 V42 Q50 56 32 64 Q14 56 14 42 Z" fill="url(#bodyG)" stroke="#fff" stroke-opacity="0.25" stroke-width="1.2"/>
    <!-- shield emblem -->
    <path d="M28 30 L36 30 L34 40 L30 40 Z" fill="#fef3c7" opacity="0.95"/>
    <!-- head -->
    <circle cx="32" cy="18" r="11" fill="#ffe0d6" stroke="#fff" stroke-opacity="0.3" stroke-width="1.2"/>
    <!-- hair tuft -->
    <path d="M22 14 Q28 4 36 12 Q40 6 42 14 Q44 18 36 18 Q28 20 22 18 Z" fill="#3b2a2a"/>
    <!-- eyes -->
    <circle cx="28" cy="19" r="1.6" fill="#1b1b1b"/>
    <circle cx="36" cy="19" r="1.6" fill="#1b1b1b"/>
    <circle cx="28.6" cy="18.4" r="0.5" fill="#fff"/>
    <circle cx="36.6" cy="18.4" r="0.5" fill="#fff"/>
    <!-- cheeks -->
    <circle cx="26" cy="22" r="2.4" fill="url(#cheekG)"/>
    <circle cx="38" cy="22" r="2.4" fill="url(#cheekG)"/>
    <!-- mouth -->
    <path d="M30 23 Q32 25 34 23" stroke="#7a1d1d" stroke-width="1.2" fill="none" stroke-linecap="round"/>
    <!-- arms -->
    <g transform="translate(16,32)"><rect class="arm l" x="-3" y="0" width="6" height="14" rx="3" fill="#ffe0d6"/></g>
    <g transform="translate(48,32)"><rect class="arm r" x="-3" y="0" width="6" height="14" rx="3" fill="#ffe0d6"/></g>
    <!-- legs -->
    <g transform="translate(26,60)"><rect class="leg l" x="-3" y="0" width="6" height="10" rx="3" fill="#3b2a2a"/></g>
    <g transform="translate(38,60)"><rect class="leg r" x="-3" y="0" width="6" height="10" rx="3" fill="#3b2a2a"/></g>
  </g>
</svg>`;
    }
}
exports.LimitOverlay = LimitOverlay;
//# sourceMappingURL=limitOverlay.js.map