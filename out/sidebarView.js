"use strict";
/**
 * sidebarView.ts — Activity Bar webview view ("Copilot Usage" sidebar).
 *
 * Single WebviewViewProvider rendering a 2-section accordion:
 *   1. USAGE & PACE   — Last request + Today/Week + Session + Pace
 *   2. BREAKDOWN      — Totals + daily sparkline + by-model + by-dow + tokens
 *
 * The top-30 sessions table lives in the full dashboard panel; we no longer
 * mirror it in the sidebar to keep the sidebar focused on at-a-glance burn.
 *
 * Pure read-only. No mutation actions. Daily-limit guard intentionally lives
 * in the status bar + shield overlay only.
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
exports.SidebarViewProvider = void 0;
const vscode = __importStar(require("vscode"));
class SidebarViewProvider {
    extensionUri;
    static viewType = "copilotUsage.panel";
    view;
    pending;
    onSessionOpen;
    onReady;
    constructor(extensionUri) {
        this.extensionUri = extensionUri;
    }
    /** Resolved by VS Code when the view becomes visible the first time. */
    resolveWebviewView(webviewView, _context, _token) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };
        webviewView.webview.html = this.getHtml();
        webviewView.webview.onDidReceiveMessage((msg) => {
            if (!msg) {
                return;
            }
            if (msg.type === "ready") {
                // Webview script is alive and listening. Flush any buffered snapshot
                // first, then ask extension.ts to build + post a fresh one so the
                // first paint reflects current data even if the view was opened
                // before any update fired.
                if (this.pending) {
                    void webviewView.webview.postMessage({ type: "snapshot", payload: this.pending });
                    this.pending = undefined;
                }
                if (this.onReady) {
                    this.onReady();
                }
            }
            else if (msg.type === "openDashboard") {
                void vscode.commands.executeCommand("copilotUsage.openDashboard");
            }
            else if (msg.type === "openSettings") {
                void vscode.commands.executeCommand("workbench.action.openSettings", "copilotUsage");
            }
        });
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                if (this.pending) {
                    void webviewView.webview.postMessage({ type: "snapshot", payload: this.pending });
                    this.pending = undefined;
                }
                // Re-fire onReady so extension.ts pushes a current snapshot whenever
                // the user hides + re-opens the sidebar — avoids showing stale data.
                if (this.onReady) {
                    this.onReady();
                }
            }
        });
        // No synchronous flush here — wait for the webview's `ready` ping. That
        // eliminates the race where postMessage fires before the webview script
        // has attached its message listener.
    }
    /** Called by extension.ts whenever data refreshes (OTel, scan, manual). */
    postSnapshot(snap) {
        if (this.view && this.view.visible) {
            void this.view.webview.postMessage({ type: "snapshot", payload: snap });
        }
        else {
            // Buffer the latest snapshot until the view becomes visible or resolves.
            this.pending = snap;
        }
    }
    setOnSessionOpen(cb) {
        this.onSessionOpen = cb;
    }
    /** Fires when the webview signals it is ready, and on every re-show. */
    setOnReady(cb) {
        this.onReady = cb;
    }
    // ─── HTML / CSS / JS ────────────────────────────────────────
    getHtml() {
        const nonce = makeNonce();
        const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <title>Copilot Usage</title>
  <style>${SIDEBAR_CSS}</style>
</head>
<body>
  <div id="root">
    <div class="status-row" id="status-row">
      <span class="status-dot" data-state="idle"></span>
      <span class="status-text" id="status-text">Connecting…</span>
      <button class="icon-btn" id="settings-btn" title="Open Copilot Usage settings" aria-label="Settings">⚙</button>
    </div>

    <details class="section" id="sec-pace" open>
      <summary id="sum-pace">USAGE &amp; PACE</summary>
      <div class="section-body" id="body-pace">
        <div class="muted small">Waiting for first Copilot request…</div>
      </div>
    </details>

    <details class="section" id="sec-breakdown">
      <summary id="sum-breakdown">BREAKDOWN</summary>
      <div class="section-body" id="body-breakdown">
        <div class="muted small">No data yet.</div>
      </div>
    </details>
  </div>
  <script nonce="${nonce}">${SIDEBAR_JS}</script>
</body>
</html>`;
    }
}
exports.SidebarViewProvider = SidebarViewProvider;
function makeNonce() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let s = "";
    for (let i = 0; i < 32; i++) {
        s += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return s;
}
// ─── CSS ──────────────────────────────────────────────────────
const SIDEBAR_CSS = `
:root { color-scheme: light dark; }
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  margin: 0;
  padding: 0;
}
.muted { color: var(--vscode-descriptionForeground); }
.small { font-size: 11px; }
.tiny  { font-size: 10px; }
.mono  { font-family: var(--vscode-editor-font-family, monospace); }

#root { display: flex; flex-direction: column; }

/* ── Status row ──────────────────────────────────────────── */
.status-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--vscode-panel-border, transparent);
  font-size: 11px;
}
.status-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--vscode-descriptionForeground);
  flex: 0 0 auto;
}
.status-dot[data-state="live"] { background: #3fb950; box-shadow: 0 0 4px #3fb950aa; }
.status-dot[data-state="scan"] { background: #d29922; }
.status-dot[data-state="idle"] { background: var(--vscode-descriptionForeground); }
.status-text { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.icon-btn {
  background: transparent; border: none; cursor: pointer;
  color: var(--vscode-foreground); opacity: 0.7;
  padding: 2px 4px; border-radius: 3px;
  font-size: 13px;
}
.icon-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, transparent); }

.chip {
  display: inline-block;
  padding: 0 5px;
  border-radius: 3px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  margin-left: 4px;
}
.chip.promo { background: #d2992233; color: #d29922; }
.chip.premium { background: #a371f733; color: #a371f7; }
.chip.base { background: #3fb95033; color: #3fb950; }

/* ── Sections (accordion) ────────────────────────────────── */
.section {
  /* Brighter outer border so each top-level block reads as a distinct
     card against the side bar background. Falls back gracefully when
     focusBorder is unset in older themes. */
  border: 1px solid var(--vscode-focusBorder, var(--vscode-contrastBorder, var(--vscode-panel-border, #444)));
  border-radius: 6px;
  margin: 6px 8px;
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  box-shadow: 0 0 0 1px var(--vscode-widget-shadow, transparent) inset;
}
.section + .section { margin-top: 8px; }
.section > summary {
  list-style: none;
  cursor: pointer;
  padding: 8px 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--vscode-foreground);
  user-select: none;
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: 6px 6px 0 0;
}
.section[open] > summary {
  border-bottom: 1px solid var(--vscode-panel-border, transparent);
}
.section > summary::-webkit-details-marker { display: none; }
.section > summary::before {
  content: "▸";
  display: inline-block;
  width: 10px;
  font-size: 9px;
  color: var(--vscode-descriptionForeground);
  transition: transform 120ms ease;
}
.section[open] > summary::before { transform: rotate(90deg); }
.section[open] > summary { border-left: 2px solid var(--vscode-focusBorder, var(--vscode-progressBar-background)); }
.section-body { padding: 4px 10px 12px; }

/* ── Side-by-side pair (Last Request + Session) ──────────── */
.pair-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin: 6px 0;
}
.pair-grid > .card { margin: 0; }
/* Collapse to single column on very narrow sidebars (≤220px) so values
   don't truncate awkwardly. */
@media (max-width: 240px) {
  .pair-grid { grid-template-columns: 1fr; }
}

/* ── Cards / KPI grid ────────────────────────────────────── */
.card {
  margin: 6px 0;
  padding: 8px 10px;
  background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  border: 1px solid var(--vscode-panel-border, transparent);
  border-radius: 4px;
}
.card-title {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 4px;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px;
}
.card-title .accent { color: var(--vscode-charts-orange, #d29922); font-weight: 600; }
.big { font-size: 18px; font-weight: 600; line-height: 1.1; }
.medium { font-size: 14px; font-weight: 600; }
.unit { font-size: 10px; color: var(--vscode-descriptionForeground); margin-left: 4px; }

.kpi-grid {
  display: grid;
  /* minmax(0, 1fr) lets the tracks shrink below their intrinsic content
     width — without this the right-hand KPI (e.g. "THIS WEEK 27,755 AIC")
     would overflow the card when the sidebar is narrowed. */
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 6px;
  margin: 6px 0;
}
.kpi {
  background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  border: 1px solid var(--vscode-panel-border, transparent);
  border-radius: 4px;
  padding: 6px 8px;
  min-width: 0;            /* allow flex/grid child to shrink */
  overflow: hidden;        /* clip any residual overflow at narrow widths */
}
.kpi .label {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--vscode-descriptionForeground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kpi .value {
  font-size: 15px;
  font-weight: 600;
  /* Allow long numbers + unit to wrap to a second line instead of
     overflowing the card horizontally. */
  word-break: break-word;
  overflow-wrap: anywhere;
  line-height: 1.15;
}
.kpi .value .unit { white-space: nowrap; }
.kpi .sub {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  word-break: break-word;
  overflow-wrap: anywhere;
}

/* On very narrow sidebars stack the two KPIs vertically so each value
   gets full width and never clips. */
@media (max-width: 220px) {
  .kpi-grid { grid-template-columns: minmax(0, 1fr); }
}

/* ── Inline metrics row (in/out/cache) ───────────────────── */
.metrics-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  margin-top: 4px;
}
.metrics-row strong { color: var(--vscode-foreground); font-weight: 600; }

/* ── Bars (horizontal) ───────────────────────────────────── */
.bar-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(16px, 56px) auto;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  padding: 2px 0;
  min-width: 0;
}
.bar-row .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.bar-track {
  height: 6px;
  background: var(--vscode-progressBar-background, #2b2b2b);
  border-radius: 3px;
  overflow: hidden;
  opacity: 0.4;
  min-width: 0;
}
.bar-fill {
  height: 100%;
  background: var(--vscode-charts-blue, #4da3ff);
  border-radius: 3px;
}
.bar-row .value { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; padding-left: 4px; }
.card { min-width: 0; }

/* ── Prompt-cache TTL ────────────────────────────────────── */
.ttl-lead {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-variant-numeric: tabular-nums;
}
.ttl-lead .clock { font-size: 18px; font-weight: 600; line-height: 1.1; }
.ttl-track {
  height: 6px;
  background: var(--vscode-progressBar-background, #2b2b2b);
  border-radius: 3px;
  overflow: hidden;
  opacity: 0.45;
  margin: 6px 0 4px;
}
.ttl-fill { height: 100%; border-radius: 3px; transition: width 0.9s linear; }
.ttl-fill[data-state="hot"]    { background: var(--vscode-charts-blue, #4da3ff); }
.ttl-fill[data-state="green"]  { background: var(--vscode-charts-green, #3fb950); }
.ttl-fill[data-state="yellow"] { background: var(--vscode-charts-yellow, #d29922); }
.ttl-fill[data-state="red"]    { background: var(--vscode-charts-red, #f85149); }
.ttl-fill[data-state="cold"]   { background: var(--vscode-descriptionForeground, #888); }
.ttl-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  padding: 2px 0;
  min-width: 0;
}
.ttl-row .clock { font-variant-numeric: tabular-nums; white-space: nowrap; }
.ttl-row .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.ttl-row .value { font-variant-numeric: tabular-nums; white-space: nowrap; }

/* ── Pace progress (with overage state) ──────────────────── */
.pace-bar {
  height: 8px;
  background: var(--vscode-progressBar-background, #2b2b2b);
  border-radius: 4px;
  overflow: hidden;
  margin: 6px 0 4px;
  position: relative;
}
.pace-fill {
  height: 100%;
  background: var(--vscode-charts-green, #3fb950);
  transition: width 200ms ease;
}
.pace-bar[data-state="warn"] .pace-fill { background: var(--vscode-charts-orange, #d29922); }
.pace-bar[data-state="over"] .pace-fill { background: var(--vscode-charts-red, #f85149); }

/* ── Sparkline ───────────────────────────────────────────── */
.spark {
  display: block;
  width: 100%;
  height: 28px;
  margin-top: 6px;
}
.spark-bar { fill: var(--vscode-charts-blue, #4da3ff); opacity: 0.85; }
.spark-bar.peak { fill: var(--vscode-charts-orange, #d29922); }

.footer-link {
  margin-top: 8px;
  text-align: center;
  font-size: 11px;
  color: var(--vscode-textLink-foreground);
  cursor: pointer;
  padding: 4px;
}
.footer-link:hover { text-decoration: underline; }
`;
// ─── JS (runs in webview) ─────────────────────────────────────
const SIDEBAR_JS = `
(function () {
  const vscode = acquireVsCodeApi();

  // ── i18n (zh-CN incremental layer) ───────────────────────
  const _savedLang = (vscode.getState() || {}).lang === 'zh' ? 'zh' : 'en';
  let LANG = _savedLang;
  const I18N = {
    'USAGE & PACE':'用量与节奏','BREAKDOWN':'用量细分',
    'Connecting…':'连接中…','Live':'实时','Scan-only':'仅扫描','Idle':'空闲',
    '⚡ Last Request':'⚡ 最近请求','🧵 Session (this window)':'🧵 会话（本窗口）',
    'Waiting for first Copilot request…':'等待首个 Copilot 请求…',
    'No requests in this window yet.':'本窗口暂无请求。',
    'Today':'今日','This Week':'本周','Pace':'消耗节奏',
    'projected overage':'预计超额','projected this cycle':'本周期预测',
    '🧊 Cache Reuse':'🧊 缓存复用','Daily Usage (14d)':'每日用量（14天）',
    'Cache Hit Rate (cycle)':'缓存命中率（周期）','excellent':'极佳','ok':'一般','cold':'已冷',
    'Total Credits (cycle)':'总积分（周期）','By Model':'按模型','By Day of Week':'按星期','Tokens (cycle)':'Token（周期）',
    'Input':'输入','Output':'输出','Cache':'缓存',
    'No data yet.':'暂无数据。','more in dashboard':'更多见仪表盘'
  };
  const I18N_SUB = [
    ['just now','刚刚'],['s ago','秒前'],['m ago','分钟前'],['h ago','小时前'],['d ago','天前'],
    [' reqs',' 次请求'],[' turns',' 轮'],[' min',' 分钟'],[' warm · lifetimes approximate',' 条热缓存 · 生命周期为估算'],
    ['cached / ','缓存 / '],[' prompt',' 提示'],['peak ','峰值 '],[' on ','，在 '],
    ['AIC · overage ','AIC · 超额 '],['promo budget ','促销预算 '],['budget ','预算 '],
    ['promo until ','促销至 '],['ends ','结束于 '],[' · promo',' · 促销'],
    ['in ','入 '],['out ','出 '],['cache ','缓存 ']
  ];
  function T(s){ return (LANG === 'zh' && I18N[s] !== undefined) ? I18N[s] : s; }
  function TS(s){
    if (LANG !== 'zh') return s;
    if (I18N[s] !== undefined) return I18N[s];
    let out = s;
    for (const [en, zh] of I18N_SUB) { if (out.indexOf(en) !== -1) out = out.split(en).join(zh); }
    return out;
  }
  function applyStaticI18n(){
    const sp = document.getElementById('sum-pace');
    if (sp) sp.textContent = T('USAGE & PACE');
    const sb = document.getElementById('sum-breakdown');
    if (sb) sb.textContent = T('BREAKDOWN');
    const st = document.getElementById('status-text');
    if (st && st.dataset.orig !== undefined) st.innerHTML = st.dataset.orig;
  }
  function toggleLang(){
    LANG = LANG === 'zh' ? 'en' : 'zh';
    const s = vscode.getState() || {}; s.lang = LANG; vscode.setState(s);
    applyStaticI18n();
    lastSnapshot && render(lastSnapshot);
  }
  let lastSnapshot = null;

  // Restore expanded state across reloads.
  const stored = vscode.getState() || {};
  for (const id of ["sec-pace", "sec-breakdown", "sec-sessions"]) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (typeof stored[id] === "boolean") el.open = stored[id];
    el.addEventListener("toggle", () => {
      const s = vscode.getState() || {};
      s[id] = el.open;
      vscode.setState(s);
    });
  }

  document.getElementById("settings-btn").addEventListener("click", () => {
    vscode.postMessage({ type: "openSettings" });
  });

  const langBtn = document.createElement("button");
  langBtn.className = "icon-btn";
  langBtn.id = "lang-btn";
  langBtn.title = "切换语言 / Switch language";
  langBtn.style.cssText = "font-size:10px;font-weight:700;";
  langBtn.textContent = LANG === 'zh' ? 'EN' : '中文';
  langBtn.addEventListener("click", () => {
    toggleLang();
    langBtn.textContent = LANG === 'zh' ? 'EN' : '中文';
  });
  document.getElementById("settings-btn").parentNode.insertBefore(langBtn, document.getElementById("settings-btn"));

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg && msg.type === "snapshot") { lastSnapshot = msg.payload; render(msg.payload); }
  });

  // Tell the extension we're alive and listening. The extension will respond
  // with a freshly-built snapshot so first paint always reflects current data.
  vscode.postMessage({ type: "ready" });

  // ── Formatting helpers ────────────────────────────────────
  function fmt(n) {
    if (n == null || isNaN(n)) return "0";
    if (Math.abs(n) >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
    if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
    if (Math.abs(n) >= 10_000) return (n / 1_000).toFixed(1) + "K";
    if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(2) + "K";
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }
  function fmtUsd(n) {
    if (n == null || isNaN(n)) return "$0.00";
    if (Math.abs(n) >= 1000) return "$" + (n / 1000).toFixed(2) + "K";
    return "$" + n.toFixed(2);
  }
  function fmtAic(n) {
    if (n == null || isNaN(n)) return "0";
    if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
    return n.toFixed(1);
  }
  function ago(ms) {
    if (!ms || ms < 0) return "";
    if (ms < 1000) return TS("just now");
    if (ms < 60_000) return Math.floor(ms / 1000) + TS("s ago");
    if (ms < 3_600_000) return Math.floor(ms / 60_000) + TS("m ago");
    if (ms < 86_400_000) return Math.floor(ms / 3_600_000) + TS("h ago");
    return Math.floor(ms / 86_400_000) + TS("d ago");
  }
  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }
  function sparkSvg(values, peakIdx) {
    if (!values || values.length === 0) return "";
    const max = Math.max(...values, 1);
    const w = 100; const h = 28;
    const bw = w / values.length;
    let bars = "";
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      const bh = Math.max(1, (v / max) * (h - 2));
      const x = i * bw;
      const y = h - bh;
      const cls = i === peakIdx ? "spark-bar peak" : "spark-bar";
      bars += '<rect class="' + cls + '" x="' + x.toFixed(2) + '" y="' + y.toFixed(2)
        + '" width="' + (bw * 0.75).toFixed(2) + '" height="' + bh.toFixed(2) + '"/>';
    }
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' + bars + '</svg>';
  }

  // ── Render ────────────────────────────────────────────────
  function render(s) {
    if (!s) return;
    renderStatus(s.status);
    renderPace(s);
    renderBreakdown(s.breakdown);
    applyStaticI18n();
  }

  function renderStatus(st) {
    document.querySelector(".status-dot").setAttribute("data-state", st.liveState);
    const stateLabel = st.liveState === "live" ? T("Live")
      : st.liveState === "scan" ? T("Scan-only")
      : T("Idle");
    const promoChip = st.promoActive
      ? ' <span class="chip promo">Promo</span>'
      : "";
    document.getElementById("status-text").innerHTML =
      stateLabel + ' · <strong>' + esc(st.planName) + '</strong>' + promoChip;
  }

  function renderPace(s) {
    const body = document.getElementById("body-pace");
    const lr = s.lastRequest;
    const tw = s.todayWeek;
    const sess = s.session;
    const pace = s.pace;

    const peakIdx = lr && lr.sparkline.length
      ? lr.sparkline.indexOf(Math.max(...lr.sparkline))
      : -1;

    let lastReqCard = "";
    if (lr) {
      lastReqCard =
        '<div class="card">' +
          '<div class="card-title"><span>'+T('⚡ Last Request')+'</span><span class="accent">' + fmtAic(lr.aic) + ' AIC</span></div>' +
          '<div class="medium">' + esc(lr.model) + '</div>' +
          '<div class="muted small">' + esc(ago(lr.agoMs)) + '</div>' +
          '<div class="metrics-row">' +
            '<span>'+T('in')+' <strong>' + fmt(lr.promptTokens) + '</strong></span>' +
            '<span>'+T('out')+' <strong>' + fmt(lr.completionTokens) + '</strong></span>' +
            '<span>'+T('cache')+' <strong>' + fmt(lr.cachedTokens) + '</strong></span>' +
          '</div>' +
          (lr.sparkline.length ? sparkSvg(lr.sparkline, peakIdx) : "") +
        '</div>';
    } else {
      lastReqCard = '<div class="card muted small">'+T('Waiting for first Copilot request…')+'</div>';
    }

    const kpiCard =
      '<div class="kpi-grid">' +
        '<div class="kpi">' +
          '<div class="label">'+T('Today')+'</div>' +
          '<div class="value">' + fmtAic(tw.todayAic) + '<span class="unit">AIC</span></div>' +
          '<div class="sub">' + fmtUsd(tw.todayUsd) + ' · ' + tw.todayRequests + TS(' reqs') + '</div>' +
        '</div>' +
        '<div class="kpi">' +
          '<div class="label">'+T('This Week')+'</div>' +
          '<div class="value">' + fmtAic(tw.weekAic) + '<span class="unit">AIC</span></div>' +
          '<div class="sub">' + fmtUsd(tw.weekUsd) + '</div>' +
        '</div>' +
      '</div>';

    const sessCard = sess
      ? '<div class="card">' +
          '<div class="card-title"><span>'+T('🧵 Session (this window)')+'</span><span class="accent">' + fmtAic(sess.aic) + ' AIC</span></div>' +
          '<div class="medium">' + esc(sess.model) + '</div>' +
          '<div class="muted small">' + sess.turns + TS(' turns') + ' · ' + sess.durationMin + TS(' min') + '</div>' +
        '</div>'
      : '<div class="card muted small">'+T('No requests in this window yet.')+'</div>';

    // Side-by-side: Last Request + Session (this window). They are the two
    // "current activity" cards — putting them in a 2-col grid lets the user
    // compare per-request and per-session burn at a glance, and frees vertical
    // room for the Today/Week KPIs and Pace card below.
    const pairBlock =
      '<div class="pair-grid">' + lastReqCard + sessCard + '</div>';

    const paceState = pace.overagePct >= 100 ? "over" : pace.overagePct >= 75 ? "warn" : "ok";
    const fillPct = Math.min(100, pace.overagePct).toFixed(1);
    const overageBadge = pace.overBudget
      ? '<span class="chip" style="background:#f8514933;color:#f85149">' + pace.overagePct.toFixed(0) + '% ⚠</span>'
      : '<span class="chip base">' + pace.overagePct.toFixed(0) + '%</span>';
    const promoAnnot = pace.promoActive && pace.promoEndDate && new Date(pace.promoEndDate) > new Date()
      ? ' · ' + TS('promo until ') + esc(pace.promoEndDate.slice(0, 10))
      : '';
    const paceCard =
      '<div class="card">' +
        '<div class="card-title"><span>'+T('Pace')+'</span>' + overageBadge + '</div>' +
        '<div class="big">' + (pace.projectedUsd > 0 ? fmtUsd(pace.projectedUsd) : fmtAic(pace.projectedCredits) + ' AIC') + '</div>' +
        '<div class="muted small">' + (pace.overBudget ? T("projected overage") : T("projected this cycle")) + '</div>' +
        '<div class="pace-bar" data-state="' + paceState + '"><div class="pace-fill" style="width:' + fillPct + '%"></div></div>' +
        '<div class="muted tiny">' + TS('ends ') + esc(pace.cycleEnd.slice(0, 10)) + promoAnnot + '</div>' +
      '</div>';

    // Order: pair (Last Request + Session side-by-side) first — the two
    // "current activity" cards live together at the top. Then the Today /
    // Week KPI row, the cache-reuse countdown, then the Pace card.
    body.innerHTML = pairBlock + kpiCard + ttlCard(s.ttl) + paceCard;
  }

  // Cache reuse: how good the reuse is (hit rate) plus how long it lasts
  // (countdown) on one card — the two halves of the same question.
  function ttlCard(t) {
    if (!t) return '';
    const lead = t.lead;
    const pct = (lead.fraction * 100).toFixed(1);
    const hit = t.cacheHitPct > 0
      ? '<span class="chip base">' + t.cacheHitPct.toFixed(0) + '% hit</span>'
      : '';
    let rows = '';
    if (t.rows.length > 1) {
      for (const r of t.rows) {
        rows +=
          '<div class="ttl-row">' +
            '<span class="clock">' + stateDot(r.state) + ' ' + esc(r.display) + '</span>' +
            '<span class="label" title="' + esc(r.title) + '">' + esc(r.title) + '</span>' +
            '<span class="value">' + fmtUsd(r.costUsd) + '</span>' +
          '</div>';
      }
    }
    return '<div class="card">' +
        '<div class="card-title"><span>'+T('🧊 Cache Reuse')+'</span>' + hit + '</div>' +
        '<div class="ttl-lead">' +
          '<span class="clock">' + stateDot(lead.state) + ' ' + esc(lead.display) + '</span>' +
          '<span class="muted small">' + esc(lead.provider) + '</span>' +
        '</div>' +
        '<div class="ttl-track"><div class="ttl-fill" data-state="' + esc(lead.state) + '" style="width:' + pct + '%"></div></div>' +
        '<div class="muted tiny">' + t.warmCount + TS(' warm · lifetimes approximate') + '</div>' +
        rows +
      '</div>';
  }

  function stateDot(state) {
    return state === 'hot' ? '🔥'
      : state === 'green' ? '🟢'
      : state === 'yellow' ? '🟡'
      : state === 'red' ? '🔴'
      : '❄️';
  }

  function renderBreakdown(b) {
    const body = document.getElementById("body-breakdown");
    if (!b) { body.innerHTML = '<div class="muted small">'+T('No data yet.')+'</div>'; return; }

    const peakIdx = b.dailySparkline.indexOf(Math.max(...b.dailySparkline));
    const sparkBlock =
      '<div class="card-title"><span>'+T('Daily Usage (14d)')+'</span>' +
      (b.peakValue > 0 ? '<span class="muted tiny">'+TS('peak ') + fmtAic(b.peakValue) + TS(' on ') + esc(b.peakDay.slice(5)) + '</span>' : '') +
      '</div>' +
      sparkSvg(b.dailySparkline, peakIdx);

    let modelBars = '';
    for (const m of b.byModel) {
      const tierChip = m.tier ? '<span class="chip ' + esc(m.tier) + '" style="font-size:8px">' + esc(m.tier) + '</span>' : '';
      modelBars +=
        '<div class="bar-row">' +
          '<span class="label" title="' + esc(m.model) + '">' + esc(m.model) + tierChip + '</span>' +
          '<div class="bar-track"><div class="bar-fill" style="width:' + m.pct.toFixed(1) + '%"></div></div>' +
          '<span class="value">' + fmtAic(m.credits) + '</span>' +
        '</div>';
    }
    if (b.modelsMore > 0) {
      modelBars += '<div class="footer-link" data-action="openDashboard">+' + b.modelsMore + ' '+T('more in dashboard')+' ⤢</div>';
    }

    const dowMap = {'Sun':'日','Mon':'一','Tue':'二','Wed':'三','Thu':'四','Fri':'五','Sat':'六'};
    let dowBars = '';
    for (const d of b.byDow) {
      dowBars +=
        '<div class="bar-row">' +
          '<span class="label">' + (LANG === 'zh' ? (dowMap[d.dow] || d.dow) : d.dow) + '</span>' +
          '<div class="bar-track"><div class="bar-fill" style="width:' + d.pct.toFixed(1) + '%"></div></div>' +
          '<span class="value">' + fmtAic(d.credits) + '</span>' +
        '</div>';
    }

    const maxTok = Math.max(b.tokens.input, b.tokens.output, b.tokens.cached, 1);
    const tokRows =
      tokBar(T('Input'),  b.tokens.input,  maxTok) +
      tokBar(T('Output'), b.tokens.output, maxTok) +
      tokBar(T('Cache'),  b.tokens.cached, maxTok);
    const hitPctLabel = b.cacheHitPct >= 80 ? T('excellent')
                     : b.cacheHitPct >= 30 ? T('ok')
                     : T('cold');
    const cacheHitCard = b.tokens.input > 0
      ? '<div class="card">' +
          '<div class="card-title"><span>'+T('Cache Hit Rate (cycle)')+'</span></div>' +
          '<div class="big">' + b.cacheHitPct.toFixed(1) + '%<span class="unit">' + hitPctLabel + '</span></div>' +
          '<div class="muted tiny">' + fmt(b.tokens.cached) + TS('cached / ') + fmt(b.tokens.input) + TS(' prompt') + '</div>' +
        '</div>'
      : '';

    const budgetLabel = b.budget > 0
      ? '<div class="muted tiny">' + (b.promoActive ? TS('promo budget ') : TS('budget ')) + fmtAic(b.budget) + ' AIC</div>'
      : '';

    body.innerHTML =
      '<div class="card">' +
        '<div class="card-title"><span>'+T('Total Credits (cycle)')+'</span></div>' +
        '<div class="big">' + fmtAic(b.totalAic) + '<span class="unit">AIC · '+TS('overage ') + fmtUsd(b.totalUsd) + '</span></div>' +
        budgetLabel +
      '</div>' +
      cacheHitCard +
      '<div class="card">' + sparkBlock + '</div>' +
      '<div class="card"><div class="card-title"><span>'+T('By Model')+'</span></div>' + modelBars + '</div>' +
      '<div class="card"><div class="card-title"><span>'+T('By Day of Week')+'</span></div>' + dowBars + '</div>' +
      '<div class="card"><div class="card-title"><span>'+T('Tokens (cycle)')+'</span></div>' + tokRows + '</div>';

    body.querySelectorAll('[data-action="openDashboard"]').forEach(el => {
      el.addEventListener('click', () => vscode.postMessage({ type: 'openDashboard' }));
    });
  }

  function tokBar(label, val, max) {
    const pct = max > 0 ? (val / max) * 100 : 0;
    return '<div class="bar-row">' +
        '<span class="label">' + label + '</span>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + pct.toFixed(1) + '%"></div></div>' +
        '<span class="value">' + fmt(val) + '</span>' +
      '</div>';
  }
}());
`;
//# sourceMappingURL=sidebarView.js.map