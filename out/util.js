"use strict";
/**
 * util.ts — Tiny shared helpers used across scanner.ts, agentScanner.ts and otelReceiver.ts.
 *
 * Extracted to eliminate cross-file duplicates flagged by Fallow's code-duplication
 * analyzer. Behavior is identical to the previous in-file copies.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isObj = isObj;
exports.isArr = isArr;
exports.utcNow = utcNow;
exports.mapConcurrent = mapConcurrent;
/** Check if unknown value is a non-null, non-array object. */
function isObj(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
}
/** Check if unknown value is an array. */
function isArr(v) {
    return Array.isArray(v);
}
/** Current UTC time as ISO-8601 string. */
function utcNow() {
    return new Date().toISOString();
}
/**
 * Run async tasks with bounded concurrency, preserving input order.
 * Spawns `min(concurrency, items.length)` worker promises; each pulls the next
 * item from a shared index until the input is exhausted.
 */
async function mapConcurrent(items, concurrency, fn) {
    const results = new Array(items.length);
    let idx = 0;
    async function worker() {
        while (idx < items.length) {
            const i = idx++;
            results[i] = await fn(items[i]);
        }
    }
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
    await Promise.all(workers);
    return results;
}
//# sourceMappingURL=util.js.map