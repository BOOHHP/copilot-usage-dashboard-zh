"use strict";
/**
 * ttlSound.ts — OS-native alert playback for the prompt-cache TTL tracker.
 *
 * Derived from the MIT-licensed `cache-timer` extension (© 2026 sukumarp2022),
 * with the Windows command hardened: the sound path is handed to PowerShell
 * through an environment variable instead of being interpolated into the
 * `-Command` string, so a crafted `copilotUsage.cacheTtl.soundPath` cannot
 * break out into arbitrary PowerShell. Paths are additionally validated by
 * {@link resolveSoundPath} before ever reaching a player.
 *
 * No `vscode` import — the extension host passes the bundled fallback path in.
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
exports.WIN_SOUND_ENV = void 0;
exports.resolveSoundPath = resolveSoundPath;
exports.buildPlayerCommand = buildPlayerCommand;
exports.playOnce = playOnce;
exports.createAlertQueue = createAlertQueue;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/** Extensions the bundled players can actually decode. */
const ALLOWED_EXTS = new Set([".wav", ".mp3", ".ogg", ".aiff", ".aif", ".m4a"]);
/**
 * Validate a user-configured sound path, falling back to the bundled asset.
 * Rejects relative paths, missing files, directories, and unknown extensions.
 * Returns `""` when neither the override nor the fallback is usable.
 */
function resolveSoundPath(userPath, bundledPath) {
    const candidate = (userPath ?? "").trim();
    if (candidate && isUsableSound(candidate)) {
        return candidate;
    }
    return isUsableSound(bundledPath) ? bundledPath : "";
}
function isUsableSound(p) {
    if (!p || !path.isAbsolute(p)) {
        return false;
    }
    if (!ALLOWED_EXTS.has(path.extname(p).toLowerCase())) {
        return false;
    }
    try {
        return fs.statSync(p).isFile();
    }
    catch {
        return false;
    }
}
/** Env var the PowerShell branch reads the path from. Never interpolated. */
exports.WIN_SOUND_ENV = "COPILOT_USAGE_TTL_SOUND";
function buildPlayerCommand(platform, soundPath) {
    switch (platform) {
        case "darwin":
            return { cmd: "afplay", args: [soundPath] };
        case "win32":
            return {
                cmd: "powershell",
                args: [
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    `(New-Object Media.SoundPlayer $env:${exports.WIN_SOUND_ENV}).PlaySync();`,
                ],
                env: { [exports.WIN_SOUND_ENV]: soundPath },
            };
        case "linux":
            return { cmd: "paplay", args: [soundPath] };
        default:
            return undefined;
    }
}
function once(fn) {
    let called = false;
    return () => {
        if (!called) {
            called = true;
            fn();
        }
    };
}
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Play one sound to completion. Best-effort: resolves (never rejects) on any
 * failure, and falls back to `aplay` on Linux when `paplay` is absent.
 */
function playOnce(soundPath, platform) {
    const pc = buildPlayerCommand(platform, soundPath);
    if (!pc) {
        return Promise.resolve();
    }
    return new Promise(resolve => {
        const done = once(resolve);
        try {
            const child = (0, child_process_1.spawn)(pc.cmd, pc.args, {
                stdio: "ignore",
                env: pc.env ? { ...process.env, ...pc.env } : process.env,
            });
            child.on("close", done);
            child.on("error", () => {
                if (platform === "linux") {
                    try {
                        const fallback = (0, child_process_1.spawn)("aplay", [soundPath], { stdio: "ignore" });
                        fallback.on("close", done);
                        fallback.on("error", () => done());
                        return;
                    }
                    catch {
                        /* give up quietly */
                    }
                }
                done();
            });
        }
        catch {
            done();
        }
    });
}
/** Gap between consecutive alerts so each is audibly distinct. */
const ALERT_GAP_MS = 150;
/**
 * Serialize playback so several sessions turning red on the same tick are
 * heard one after another instead of overlapping into one muddy sound.
 */
function createAlertQueue(play = playOnce, gapMs = ALERT_GAP_MS) {
    let chain = Promise.resolve();
    return {
        enqueue(soundPath, platform, count = 1) {
            if (!soundPath) {
                return;
            }
            const times = Math.min(10, Math.max(1, Math.floor(count)));
            for (let i = 0; i < times; i++) {
                chain = chain
                    .then(() => play(soundPath, platform))
                    .then(() => (gapMs > 0 ? delay(gapMs) : undefined))
                    .catch(() => {
                    /* one failed alert must never break the queue */
                });
            }
        },
        drain() {
            return chain;
        },
    };
}
//# sourceMappingURL=ttlSound.js.map