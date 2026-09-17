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
exports.OTelReceiver = void 0;
const http = __importStar(require("http"));
const util_1 = require("./util");
// ─── Safe JSON Helpers ────────────────────────────────────────
// isObj / isArr / utcNow now imported from ./util
function nsToIso(ns) {
    try {
        const ms = parseInt(ns, 10) / 1_000_000;
        return new Date(ms).toISOString();
    }
    catch {
        return (0, util_1.utcNow)();
    }
}
/** Extract typed attribute value from OTel attribute array. */
function getAttr(attributes, key) {
    if (!(0, util_1.isArr)(attributes)) {
        return undefined;
    }
    for (const item of attributes) {
        if (!(0, util_1.isObj)(item) || item.key !== key) {
            continue;
        }
        const v = item.value;
        if (!(0, util_1.isObj)(v)) {
            return v;
        }
        for (const k of ["stringValue", "intValue", "doubleValue", "boolValue"]) {
            if (k in v) {
                return v[k];
            }
        }
    }
    return undefined;
}
function isToolSpan(span) {
    if (!(0, util_1.isObj)(span)) {
        return false;
    }
    const attrs = span.attributes ?? [];
    return ["tool.name", "gen_ai.tool.name", "tool.type"].some(k => getAttr(attrs, k) !== undefined);
}
function parseTraceGroups(payload, log) {
    const grouped = new Map();
    let totalSpans = 0;
    if (!(0, util_1.isObj)(payload)) {
        return [];
    }
    const resourceSpans = payload.resourceSpans;
    if (!(0, util_1.isArr)(resourceSpans)) {
        return [];
    }
    for (const rs of resourceSpans) {
        if (!(0, util_1.isObj)(rs)) {
            continue;
        }
        const scopeSpans = rs.scopeSpans;
        if (!(0, util_1.isArr)(scopeSpans)) {
            continue;
        }
        for (const ss of scopeSpans) {
            if (!(0, util_1.isObj)(ss)) {
                continue;
            }
            const spans = ss.spans;
            if (!(0, util_1.isArr)(spans)) {
                continue;
            }
            for (const span of spans) {
                if (!(0, util_1.isObj)(span)) {
                    continue;
                }
                const tid = span.traceId;
                if (typeof tid !== "string" || !tid) {
                    continue;
                }
                if (!grouped.has(tid)) {
                    grouped.set(tid, []);
                }
                grouped.get(tid).push(span);
                totalSpans++;
            }
        }
    }
    if (totalSpans > 0) {
        log?.(`OTel parseTraceGroups: ${grouped.size} trace group(s), ${totalSpans} span(s)`);
    }
    const results = [];
    for (const [traceId, spans] of grouped) {
        // Pick primary span (non-tool, with most token info)
        const candidates = spans.filter(s => !isToolSpan(s));
        const pool = candidates.length > 0 ? candidates : spans;
        const primary = pool.reduce((best, s) => {
            const a = s.attributes ?? [];
            const hasTokens = (getAttr(a, "gen_ai.usage.prompt_tokens") ?? getAttr(a, "gen_ai.usage.input_tokens")) !==
                undefined;
            const hasModel = (getAttr(a, "gen_ai.request.model") ?? getAttr(a, "gen_ai.response.model")) !== undefined;
            const score = (hasTokens ? 2 : 0) + (hasModel ? 1 : 0);
            const bestA = best.attributes ?? [];
            const bestHasTokens = (getAttr(bestA, "gen_ai.usage.prompt_tokens") ??
                getAttr(bestA, "gen_ai.usage.input_tokens")) !== undefined;
            const bestHasModel = (getAttr(bestA, "gen_ai.request.model") ?? getAttr(bestA, "gen_ai.response.model")) !==
                undefined;
            const bestScore = (bestHasTokens ? 2 : 0) + (bestHasModel ? 1 : 0);
            return score >= bestScore ? s : best;
        });
        if (!primary) {
            continue;
        }
        const attrs = primary.attributes ?? [];
        const model = String(getAttr(attrs, "gen_ai.response.model") ??
            getAttr(attrs, "gen_ai.request.model") ??
            getAttr(attrs, "llm.response.model") ??
            getAttr(attrs, "llm.request.model") ??
            "unknown");
        let promptTokens = Number(getAttr(attrs, "gen_ai.usage.prompt_tokens") ??
            getAttr(attrs, "llm.usage.prompt_tokens") ??
            getAttr(attrs, "gen_ai.usage.input_tokens") ??
            0);
        let completionTokens = Number(getAttr(attrs, "gen_ai.usage.completion_tokens") ??
            getAttr(attrs, "llm.usage.completion_tokens") ??
            getAttr(attrs, "gen_ai.usage.output_tokens") ??
            0);
        let cachedTokens = getAttr(attrs, "gen_ai.usage.cache_read.input_tokens");
        let cacheWriteTokens = getAttr(attrs, "gen_ai.usage.cache_creation.input_tokens") ??
            getAttr(attrs, "cache_creation_input_tokens");
        let ttft = getAttr(attrs, "copilot_chat.time_to_first_token");
        // Check ALL child spans for any token/timing data missed on the primary span
        for (const span of spans) {
            if (span === primary) {
                continue;
            }
            const ca = span.attributes ?? [];
            if (promptTokens === 0) {
                const pt = getAttr(ca, "gen_ai.usage.prompt_tokens") ??
                    getAttr(ca, "gen_ai.usage.input_tokens") ??
                    getAttr(ca, "llm.usage.prompt_tokens");
                if (pt !== undefined) {
                    promptTokens = Number(pt);
                }
            }
            if (completionTokens === 0) {
                const ct = getAttr(ca, "gen_ai.usage.completion_tokens") ??
                    getAttr(ca, "gen_ai.usage.output_tokens") ??
                    getAttr(ca, "llm.usage.completion_tokens");
                if (ct !== undefined) {
                    completionTokens = Number(ct);
                }
            }
            if (cachedTokens === undefined) {
                cachedTokens = getAttr(ca, "gen_ai.usage.cache_read.input_tokens");
            }
            if (cacheWriteTokens === undefined) {
                cacheWriteTokens =
                    getAttr(ca, "gen_ai.usage.cache_creation.input_tokens") ??
                        getAttr(ca, "cache_creation_input_tokens");
            }
            if (ttft === undefined) {
                ttft = getAttr(ca, "copilot_chat.time_to_first_token");
            }
            if (promptTokens > 0 &&
                completionTokens > 0 &&
                cachedTokens !== undefined &&
                ttft !== undefined) {
                break;
            }
        }
        if (!promptTokens && !completionTokens && cachedTokens === undefined && ttft === undefined) {
            const opName = String(getAttr(attrs, "gen_ai.operation.name") ?? "");
            const attrKeys = (0, util_1.isArr)(attrs)
                ? attrs
                    .map(a => ((0, util_1.isObj)(a) ? String(a.key ?? "") : ""))
                    .filter(Boolean)
                    .join(",")
                : "";
            log?.(`OTel: skipping trace (model=${model}, op=${opName}, spans=${spans.length}, no token data; keys=[${attrKeys}])`);
            continue;
        }
        results.push({
            requestId: typeof primary.spanId === "string" ? primary.spanId : traceId,
            traceId,
            conversationId: String(getAttr(attrs, "gen_ai.conversation.id") ?? ""),
            timestamp: nsToIso(String(primary.startTimeUnixNano ?? "0")),
            modelName: model,
            promptTokens,
            completionTokens,
            cachedTokens: Number(cachedTokens ?? 0),
            cacheWriteTokens: Number(cacheWriteTokens ?? 0),
            ttftMs: ttft !== undefined ? Number(ttft) : null,
        });
    }
    return results;
}
class OTelReceiver {
    /** Maximum retained requests before oldest are pruned. */
    static MAX_REQUESTS = 10_000;
    requests = [];
    /** Cumulative counters — never pruned, always accurate */
    cumulativeRequests = 0;
    cumulativePrompt = 0;
    cumulativeCompletion = 0;
    cumulativeCached = 0;
    metricState = new Map();
    metricDeltas = new Map(); // model -> cumulative cached delta
    server = null;
    listeners = [];
    _port = 0;
    _log = () => { };
    get port() {
        return this._port;
    }
    set log(fn) {
        this._log = fn;
    }
    onStats(listener) {
        this.listeners.push(listener);
    }
    getStats() {
        const byModel = new Map();
        for (const req of this.requests) {
            const key = req.modelName;
            if (!byModel.has(key)) {
                byModel.set(key, {
                    model: key,
                    requests: 0,
                    prompt: 0,
                    completion: 0,
                    traceCached: 0,
                    metricCached: 0,
                    cached: 0,
                    cacheWrite: 0,
                });
            }
            const m = byModel.get(key);
            m.requests++;
            m.prompt += req.promptTokens;
            m.completion += req.completionTokens;
            m.traceCached += req.cachedTokens;
            m.cacheWrite += req.cacheWriteTokens;
        }
        // Add metric cache deltas
        for (const [model, delta] of this.metricDeltas) {
            if (!byModel.has(model)) {
                byModel.set(model, {
                    model,
                    requests: 0,
                    prompt: 0,
                    completion: 0,
                    traceCached: 0,
                    metricCached: 0,
                    cached: 0,
                    cacheWrite: 0,
                });
            }
            byModel.get(model).metricCached = delta;
        }
        // Compute effective cached
        for (const m of byModel.values()) {
            m.cached = m.metricCached || m.traceCached;
        }
        const prompt = this.cumulativePrompt;
        const completion = this.cumulativeCompletion;
        const traceCached = this.cumulativeCached;
        const metricCached = Array.from(this.metricDeltas.values()).reduce((s, v) => s + v, 0);
        return {
            requests: this.cumulativeRequests,
            prompt,
            completion,
            cached: metricCached || traceCached,
            traceCached,
            metricCached,
            lastSeen: this.requests.length > 0 ? this.requests[this.requests.length - 1].timestamp : "",
            byModel,
            requestLog: this.requests.slice(),
            lastRequest: this.requests.length > 0 ? this.requests[this.requests.length - 1] : null,
        };
    }
    processMetrics(payload) {
        let inserted = 0;
        if (!(0, util_1.isObj)(payload)) {
            return 0;
        }
        const resourceMetrics = payload.resourceMetrics;
        if (!(0, util_1.isArr)(resourceMetrics)) {
            return 0;
        }
        for (const rm of resourceMetrics) {
            if (!(0, util_1.isObj)(rm)) {
                continue;
            }
            const scopeMetrics = rm.scopeMetrics;
            if (!(0, util_1.isArr)(scopeMetrics)) {
                continue;
            }
            for (const sm of scopeMetrics) {
                if (!(0, util_1.isObj)(sm)) {
                    continue;
                }
                const metrics = sm.metrics;
                if (!(0, util_1.isArr)(metrics)) {
                    continue;
                }
                for (const metric of metrics) {
                    if (!(0, util_1.isObj)(metric) || metric.name !== "gen_ai.client.token.usage") {
                        continue;
                    }
                    const histogram = (0, util_1.isObj)(metric.histogram) ? metric.histogram : undefined;
                    const sum = (0, util_1.isObj)(metric.sum) ? metric.sum : undefined;
                    const points = (0, util_1.isArr)(histogram?.dataPoints)
                        ? histogram.dataPoints
                        : (0, util_1.isArr)(sum?.dataPoints)
                            ? sum.dataPoints
                            : [];
                    if (!(0, util_1.isArr)(points)) {
                        continue;
                    }
                    for (const point of points) {
                        if (!(0, util_1.isObj)(point)) {
                            continue;
                        }
                        const attrs = point.attributes ?? [];
                        const tokenType = String(getAttr(attrs, "gen_ai.token.type") ?? "");
                        const model = String(getAttr(attrs, "gen_ai.response.model") ??
                            getAttr(attrs, "gen_ai.request.model") ??
                            "unknown");
                        if (!tokenType.toLowerCase().includes("cache")) {
                            continue;
                        }
                        const cumSum = point.sum ?? point.asDouble ?? point.asInt;
                        if (cumSum === undefined || cumSum === null) {
                            continue;
                        }
                        const key = `gen_ai.client.token.usage:${model}:${tokenType}`;
                        const current = Number(cumSum);
                        const last = this.metricState.get(key) ?? 0;
                        const delta = current - last;
                        if (delta > 0) {
                            this.metricState.set(key, current);
                            const prev = this.metricDeltas.get(model) ?? 0;
                            this.metricDeltas.set(model, prev + delta);
                            inserted++;
                        }
                        else if (current < last) {
                            this.metricState.set(key, current);
                        }
                    }
                }
            }
        }
        return inserted;
    }
    readChunkedBody(req) {
        const { promise, resolve, reject } = Promise.withResolvers();
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
        return promise;
    }
    notify() {
        const stats = this.getStats();
        for (const fn of this.listeners) {
            try {
                fn(stats);
            }
            catch {
                /* ignore */
            }
        }
    }
    async handleRequest(req, res) {
        const contentType = req.headers["content-type"] ?? "";
        this._log(`OTel HTTP: ${req.method} ${req.url} content-type=${contentType}`);
        if (req.method === "GET" && req.url === "/healthz") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            return;
        }
        if (req.method !== "POST") {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "not found" }));
            return;
        }
        const body = await this.readChunkedBody(req);
        this._log(`OTel body: ${body.length} bytes, url=${req.url}`);
        let payload = {};
        if (body.length > 0) {
            // Try JSON first, then attempt protobuf-like detection
            const isProtobuf = contentType.includes("protobuf") || contentType.includes("proto");
            if (isProtobuf) {
                this._log(`OTel: received protobuf content-type (${contentType}), cannot parse — Copilot is sending protobuf instead of JSON`);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, note: "protobuf not supported, use JSON" }));
                return;
            }
            try {
                payload = JSON.parse(body.toString("utf-8"));
            }
            catch {
                const firstByte = body[0];
                if (firstByte !== 0x7b /* '{' */) {
                    this._log(`OTel: body is not JSON (first byte=0x${firstByte?.toString(16)}), likely protobuf binary`);
                }
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "invalid JSON" }));
                return;
            }
        }
        if (req.url === "/v1/traces") {
            const parsed = parseTraceGroups(payload, this._log.bind(this));
            const existing = new Set(this.requests.map(r => r.requestId));
            const newReqs = parsed.filter(r => !existing.has(r.requestId));
            this._log(`OTel traces: parsed=${parsed.length}, new=${newReqs.length}`);
            this.requests.push(...newReqs);
            // Update cumulative counters (never affected by pruning)
            for (const r of newReqs) {
                this.cumulativeRequests++;
                this.cumulativePrompt += r.promptTokens;
                this.cumulativeCompletion += r.completionTokens;
                this.cumulativeCached += r.cachedTokens;
            }
            // Prune oldest requests when exceeding retention cap
            if (this.requests.length > OTelReceiver.MAX_REQUESTS) {
                this.requests = this.requests.slice(-OTelReceiver.MAX_REQUESTS);
            }
            this.notify();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, inserted: newReqs.length }));
            return;
        }
        if (req.url === "/v1/metrics") {
            const inserted = this.processMetrics(payload);
            if (inserted > 0) {
                this.notify();
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, inserted }));
            return;
        }
        if (req.url === "/v1/logs") {
            this._log(`OTel logs: accepted`);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            return;
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
    }
    async start(port = 14318) {
        const { promise, resolve, reject } = Promise.withResolvers();
        this.server = http.createServer((req, res) => {
            this.handleRequest(req, res).catch(() => {
                if (!res.headersSent) {
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "internal error" }));
                }
            });
        });
        // Try candidate ports
        const tryPort = (p, attempts) => {
            this.server.once("error", (err) => {
                if (err.code === "EADDRINUSE" && attempts > 0) {
                    tryPort(p + 1, attempts - 1);
                }
                else {
                    reject(err);
                }
            });
            this.server.listen(p, "127.0.0.1", () => {
                this._port = p;
                // Self-test: verify we can reach our own endpoint
                http
                    .get(`http://127.0.0.1:${p}/healthz`, testRes => {
                    testRes.resume();
                    this._log(`OTel receiver self-test: HTTP ${testRes.statusCode} — server is reachable at 127.0.0.1:${p}`);
                })
                    .on("error", (err) => {
                    this._log(`OTel receiver self-test FAILED: ${err.message} — receiver may not be reachable`);
                });
                resolve(p);
            });
        };
        tryPort(port, 5);
        return promise;
    }
    stop() {
        this.server?.close();
        this.server = null;
    }
}
exports.OTelReceiver = OTelReceiver;
//# sourceMappingURL=otelReceiver.js.map