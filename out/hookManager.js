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
exports.HookManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
/**
 * Manages GitHub Copilot lifecycle hooks for daily limit enforcement.
 *
 * Surfaces covered (per https://docs.github.com/en/copilot/reference/hooks-reference):
 *  - Copilot CLI sessions
 *  - Local custom agents (those defined under `.agents/` like g.claudette-auto)
 *  - Copilot cloud agent jobs (only if .github/hooks/*.json is committed to the repo)
 *
 * NOT covered by hooks:
 *  - Plain Copilot Chat (Ask mode) sidebar — no hook surface exists for it
 *  - Inline ghost-text completions — handled by `enforcement: pause` instead
 *
 * Architecture:
 *  - Hook config:      ~/.copilot/hooks/copilot-usage-limit.json (or %USERPROFILE%\.copilot\hooks\)
 *  - Hook scripts:     ~/.copilot-usage/check-limit.{ps1,sh} + warn-limit.{ps1,sh}
 *  - Live state file:  ~/.copilot-usage/limit-state.json (updated on every snapshot)
 *
 * The PreToolUse hook reads the state file and denies tool calls when blocked.
 * This effectively halts agents (they can read your prompt but can't execute
 * any tools — read files, run commands, edit code, etc.).
 */
const HOOK_FILE_NAME = "copilot-usage-limit.json";
const STATE_FILE_NAME = "limit-state.json";
class HookManager {
    log;
    installed = false;
    constructor(log) {
        this.log = log;
    }
    /** Root for our state + scripts (lives outside .copilot to avoid collisions). */
    stateDir() {
        return path.join(os.homedir(), ".copilot-usage");
    }
    stateFile() {
        return path.join(this.stateDir(), STATE_FILE_NAME);
    }
    /** GitHub Copilot's hook discovery dir (honors COPILOT_HOME if set). */
    hookDir() {
        const copilotHome = process.env.COPILOT_HOME;
        const base = copilotHome ? copilotHome : path.join(os.homedir(), ".copilot");
        return path.join(base, "hooks");
    }
    hookFile() {
        return path.join(this.hookDir(), HOOK_FILE_NAME);
    }
    /** Install hook config + scripts. Idempotent — overwrites our own files only. */
    async install() {
        try {
            const sDir = this.stateDir();
            const hDir = this.hookDir();
            await fs.promises.mkdir(sDir, { recursive: true });
            await fs.promises.mkdir(hDir, { recursive: true });
            // Write the four scripts (Windows + Unix variants).
            const checkPs1 = path.join(sDir, "check-limit.ps1");
            const checkSh = path.join(sDir, "check-limit.sh");
            const warnPs1 = path.join(sDir, "warn-limit.ps1");
            const warnSh = path.join(sDir, "warn-limit.sh");
            const statePath = this.stateFile();
            await fs.promises.writeFile(checkPs1, this.renderCheckPs1(statePath), "utf8");
            await fs.promises.writeFile(checkSh, this.renderCheckSh(statePath), "utf8");
            await fs.promises.writeFile(warnPs1, this.renderWarnPs1(statePath), "utf8");
            await fs.promises.writeFile(warnSh, this.renderWarnSh(statePath), "utf8");
            // Make Unix scripts executable.
            if (process.platform !== "win32") {
                try {
                    await fs.promises.chmod(checkSh, 0o755);
                    await fs.promises.chmod(warnSh, 0o755);
                }
                catch {
                    /* best effort */
                }
            }
            // Write the hook config file.
            const hookConfig = {
                version: 1,
                hooks: {
                    PreToolUse: [
                        {
                            type: "command",
                            powershell: `powershell -NoProfile -ExecutionPolicy Bypass -File "${checkPs1}"`,
                            bash: `bash "${checkSh}"`,
                            timeoutSec: 5,
                        },
                    ],
                    UserPromptSubmit: [
                        {
                            type: "command",
                            powershell: `powershell -NoProfile -ExecutionPolicy Bypass -File "${warnPs1}"`,
                            bash: `bash "${warnSh}"`,
                            timeoutSec: 5,
                        },
                    ],
                },
            };
            await fs.promises.writeFile(this.hookFile(), JSON.stringify(hookConfig, null, 2), "utf8");
            // Initial state — not blocked until we get our first snapshot.
            if (!fs.existsSync(statePath)) {
                await this.writeState({
                    blocked: false,
                    reason: "Initializing",
                    dayKey: "",
                    used: 0,
                    limit: 0,
                    usedDollars: 0,
                    limitDollars: 0,
                    percent: 0,
                    resetsInMs: 0,
                    snoozed: false,
                    resumed: false,
                    updatedAt: Date.now(),
                });
            }
            this.installed = true;
            this.log(`Installed Copilot hooks → ${this.hookFile()}`);
        }
        catch (err) {
            this.log(`Hook install failed: ${err}`);
        }
    }
    /** Remove hook config + scripts + state. */
    async uninstall() {
        try {
            const files = [
                this.hookFile(),
                path.join(this.stateDir(), "check-limit.ps1"),
                path.join(this.stateDir(), "check-limit.sh"),
                path.join(this.stateDir(), "warn-limit.ps1"),
                path.join(this.stateDir(), "warn-limit.sh"),
                this.stateFile(),
            ];
            for (const f of files) {
                try {
                    await fs.promises.unlink(f);
                }
                catch {
                    /* not present */
                }
            }
            this.installed = false;
            this.log("Uninstalled Copilot hooks.");
        }
        catch (err) {
            this.log(`Hook uninstall failed: ${err}`);
        }
    }
    /** Update the state file from a daily-limit snapshot. Cheap — call on every snapshot. */
    async updateFromSnapshot(snap) {
        if (!this.installed) {
            return;
        }
        const blocked = snap.enabled && snap.stage === "limit" && !snap.snoozed && !snap.resumed;
        const remainingDol = Math.max(0, snap.limitDollars - snap.usedDollars);
        const reason = blocked
            ? `Daily AI Credit limit reached — $${snap.usedDollars.toFixed(2)} of $${snap.limitDollars.toFixed(2)} spent. Resets in ${(snap.msUntilReset / 3_600_000).toFixed(1)}h. Open VS Code → Copilot Usage Shield to snooze, override, or raise the limit.`
            : snap.snoozed
                ? `Snoozed — $${remainingDol.toFixed(2)} (${snap.percent}% of budget used)`
                : snap.resumed
                    ? `Override active until daily reset — counter still growing ($${snap.usedDollars.toFixed(2)})`
                    : `OK — $${remainingDol.toFixed(2)} remaining of $${snap.limitDollars.toFixed(2)} daily budget`;
        await this.writeState({
            blocked,
            reason,
            dayKey: snap.dayKey,
            used: snap.used,
            limit: snap.limit,
            usedDollars: snap.usedDollars,
            limitDollars: snap.limitDollars,
            percent: snap.percent,
            resetsInMs: snap.msUntilReset,
            snoozed: !!snap.snoozed,
            resumed: !!snap.resumed,
            updatedAt: Date.now(),
        });
    }
    async writeState(state) {
        try {
            await fs.promises.writeFile(this.stateFile(), JSON.stringify(state, null, 2), "utf8");
        }
        catch (err) {
            this.log(`Failed to write hook state: ${err}`);
        }
    }
    /** True if our hook config file currently exists on disk. */
    isInstalled() {
        try {
            return fs.existsSync(this.hookFile());
        }
        catch {
            return false;
        }
    }
    /** Show install location to user (for the status notification). */
    paths() {
        return { hookFile: this.hookFile(), stateFile: this.stateFile() };
    }
    // ───── Script templates ─────
    /**
     * PreToolUse check (PowerShell). Reads state, exits with permissionDecision=deny
     * when blocked. Fail-open by default (exit 0 with no output = allow).
     *
     * NOTE: PreToolUse is fail-CLOSED per spec — any crash/non-zero exit denies the
     * tool call. We trap errors and explicitly `exit 0` to fail-open on script bugs,
     * so a broken hook never accidentally blocks the agent.
     */
    renderCheckPs1(statePath) {
        return `# Copilot Usage Dashboard — PreToolUse limit check (auto-generated, do not edit)
$ErrorActionPreference = "SilentlyContinue"
try {
    $statePath = "${statePath.replace(/\\/g, "\\\\")}"
    if (-not (Test-Path $statePath)) { exit 0 }
    $raw = Get-Content $statePath -Raw -ErrorAction Stop
    $state = $raw | ConvertFrom-Json -ErrorAction Stop
    if ($state.blocked -eq $true) {
        $payload = @{
            permissionDecision = "deny"
            permissionDecisionReason = $state.reason
        } | ConvertTo-Json -Compress
        Write-Output $payload
        exit 0
    }
    exit 0
} catch {
    # Fail-open on script error so a broken hook never blocks productivity.
    exit 0
}
`;
    }
    renderCheckSh(statePath) {
        return `#!/usr/bin/env bash
# Copilot Usage Dashboard — PreToolUse limit check (auto-generated, do not edit)
set +e
STATE_PATH="${statePath.replace(/"/g, '\\"')}"
[ -f "$STATE_PATH" ] || exit 0

# Prefer jq if present; fall back to a minimal grep parse.
if command -v jq >/dev/null 2>&1; then
    BLOCKED=$(jq -r '.blocked // false' "$STATE_PATH" 2>/dev/null)
    REASON=$(jq -r '.reason // "Daily limit reached"' "$STATE_PATH" 2>/dev/null)
else
    BLOCKED=$(grep -o '"blocked":[^,}]*' "$STATE_PATH" 2>/dev/null | head -1 | sed 's/.*://;s/ //g')
    REASON=$(grep -o '"reason":"[^"]*"' "$STATE_PATH" 2>/dev/null | head -1 | sed 's/"reason":"//;s/"$//')
fi

if [ "$BLOCKED" = "true" ]; then
    REASON_ESCAPED=$(printf '%s' "$REASON" | sed 's/\\\\/\\\\\\\\/g;s/"/\\\\"/g')
    printf '{"permissionDecision":"deny","permissionDecisionReason":"%s"}\\n' "$REASON_ESCAPED"
    exit 0
fi
exit 0
`;
    }
    /**
     * UserPromptSubmit warning (PowerShell). Emits a stderr message so the user
     * sees the warning, but does not block (UserPromptSubmit has no decision control).
     */
    renderWarnPs1(statePath) {
        return `# Copilot Usage Dashboard — UserPromptSubmit warning (auto-generated, do not edit)
$ErrorActionPreference = "SilentlyContinue"
try {
    $statePath = "${statePath.replace(/\\/g, "\\\\")}"
    if (-not (Test-Path $statePath)) { exit 0 }
    $state = Get-Content $statePath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    if ($state.blocked -eq $true) {
        [Console]::Error.WriteLine("[Copilot Usage] $($state.reason)")
        [Console]::Error.WriteLine("[Copilot Usage] Tool calls will be denied until you snooze, override, or the daily reset.")
    } elseif ($state.percent -ge 75 -and -not $state.snoozed -and -not $state.resumed) {
        [Console]::Error.WriteLine("[Copilot Usage] Warning: $($state.percent)% of today's AI Credit budget used ($([math]::Round($state.usedDollars,2))/$([math]::Round($state.limitDollars,2)))")
    }
    exit 0
} catch {
    exit 0
}
`;
    }
    renderWarnSh(statePath) {
        return `#!/usr/bin/env bash
# Copilot Usage Dashboard — UserPromptSubmit warning (auto-generated, do not edit)
set +e
STATE_PATH="${statePath.replace(/"/g, '\\"')}"
[ -f "$STATE_PATH" ] || exit 0

if command -v jq >/dev/null 2>&1; then
    BLOCKED=$(jq -r '.blocked // false' "$STATE_PATH" 2>/dev/null)
    REASON=$(jq -r '.reason // ""' "$STATE_PATH" 2>/dev/null)
    PCT=$(jq -r '.percent // 0' "$STATE_PATH" 2>/dev/null)
else
    BLOCKED=$(grep -o '"blocked":[^,}]*' "$STATE_PATH" 2>/dev/null | head -1 | sed 's/.*://;s/ //g')
    REASON=$(grep -o '"reason":"[^"]*"' "$STATE_PATH" 2>/dev/null | head -1 | sed 's/"reason":"//;s/"$//')
    PCT=$(grep -o '"percent":[^,}]*' "$STATE_PATH" 2>/dev/null | head -1 | sed 's/.*://;s/ //g')
fi

if [ "$BLOCKED" = "true" ]; then
    echo "[Copilot Usage] $REASON" >&2
    echo "[Copilot Usage] Tool calls will be denied until you snooze, override, or the daily reset." >&2
elif [ "\${PCT%.*}" -ge 75 ] 2>/dev/null; then
    echo "[Copilot Usage] Warning: $PCT% of today's AI Credit budget used" >&2
fi
exit 0
`;
    }
}
exports.HookManager = HookManager;
//# sourceMappingURL=hookManager.js.map