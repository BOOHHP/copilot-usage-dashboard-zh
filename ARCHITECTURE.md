# Architecture

Technical reference for the Copilot Usage Dashboard extension. See [README.md](README.md) for install and quick start.

## Data Sources

The scanner auto-detects the VS Code `workspaceStorage` root across platforms (override with `copilotUsage.workspaceStoragePath`):

| Platform                         | Path                                                       |
| -------------------------------- | ---------------------------------------------------------- |
| Windows                          | `%APPDATA%/Code/User/workspaceStorage`                     |
| macOS                            | `~/Library/Application Support/Code/User/workspaceStorage` |
| Linux                            | `~/.config/Code/User/workspaceStorage`                     |
| Dev container / Remote-SSH / WSL | `~/.vscode-server/data/User/workspaceStorage`              |
| VS Code Insiders                 | `Code - Insiders` / `.vscode-server-insiders` equivalents  |
| Portable                         | `$VSCODE_PORTABLE/user-data/User/workspaceStorage`         |

Inside that root the extension reads:

1. **chatSessions JSONL** at `{root}/{hash}/chatSessions/*.jsonl`
   - Parsed by [src/scanner.ts](src/scanner.ts) `parseSessionContent`. Handles `kind=0` (current — session metadata + embedded `v.requests[]`), `kind=1` (legacy — `[customTitle]` / `[requests, N, result]`), and `kind=2` (latest prompt snapshot). All three must keep working.
   - Tokens here are snapshots only — authoritative per-call data comes from debug-logs.
2. **debug-logs** at `{root}/{hash}/GitHub.copilot-chat/debug-logs/{session}/`
   - `main.jsonl` — per-event stream (`session_start`, `turn_start`, `llm_request`, `child_session_ref`). Each `llm_request` carries `attrs.model`, `attrs.inputTokens`, `attrs.outputTokens`, `attrs.cachedTokens`, and `attrs.copilotUsageNanoAiu` (exact API billing × 1e9). Per-event model attribution is required so auxiliary calls (e.g. `gpt-4o-mini` for title generation, `claude-haiku-4.5` for subagents) appear in per-model rows instead of being collapsed into the parent turn's model.
   - `runSubagent-*.jsonl` — subagent rounds. Credits are merged into the parent turn that spawned them (via `child_session_ref`).
   - `title-*.jsonl` — title generation. Fires before any `turn_start`, so the parser attributes it to turn 0 to avoid losing its small-model credits.
3. **transcripts** at `{root}/{hash}/GitHub.copilot-chat/transcripts/`
4. **[Oh My Pi](https://github.com/can1357/oh-my-pi) (OMP) agent sessions** at `~/.omp/agent/sessions/**/*.jsonl` — scanned concurrently with mtime caching; contributes LLM calls, tokens, and AIC credits to the shared budget
5. **[Pi](https://github.com/earendil-works/pi) coding-agent sessions** at `~/.pi/agent/sessions/**/*.jsonl` — same scanning model as OMP
6. **Live OTel** (optional) — built-in OTLP HTTP receiver on port 14318

All file I/O is fully async with concurrent reads (16-worker pool) and mtime caching.
OMP/Pi token counts are reported as all-time historical; AIC credits for those sources are scoped to the current billing cycle.

Contributors: [.agents/agents.md](.agents/agents.md) documents the JSONL parsing contract and invariants. [tests/scan-june-workspace.ts](tests/scan-june-workspace.ts) is an independent audit script that re-implements `llm_request` parsing and must continue to print `Extension credit display matches API ground truth` (0.0% drift) after any parser change.

## OpenTelemetry Auto-Config

The extension auto-configures Copilot Chat OTel settings on first activation:

| Setting                                 | Value                    |
| --------------------------------------- | ------------------------ |
| `github.copilot.chat.otel.enabled`      | `true`                   |
| `github.copilot.chat.otel.exporterType` | `otlp-http`              |
| `github.copilot.chat.otel.otlpEndpoint` | `http://127.0.0.1:14318` |

A VS Code reload is needed after first install for Copilot to start exporting telemetry.

## AI Credits (AIC)

Since June 1, 2026, GitHub Copilot uses [usage-based billing with AI Credits](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-organizations-and-enterprises).

Configure your plan in Settings → search `copilotUsage.aic`:

| Setting                                   | Default    | Description                                               |
| ----------------------------------------- | ---------- | --------------------------------------------------------- |
| `copilotUsage.aic.plan`                   | `business` | Your Copilot plan                                         |
| `copilotUsage.aic.billingCycleStartDay`   | `1`        | Day of month billing cycle starts                         |
| `copilotUsage.aic.monthlyCreditsIncluded` | `1900`     | Monthly included credits per user (override plan default) |
| `copilotUsage.aic.overageCostPerCredit`   | `0.01`     | 1 AI credit = $0.01 USD                                   |
| `copilotUsage.aic.customModelCosts`       | `[]`       | Custom per-model credit rates                             |

### Plan Defaults

Per user/month, pooled at billing entity:

| Plan               | Credits/Month | Overage       | Notes                    |
| ------------------ | ------------- | ------------- | ------------------------ |
| Free               | 250           | N/A (blocked) |                          |
| Pro                | 1,000         | $0.01/credit  |                          |
| Pro+               | 7,500         | $0.01/credit  |                          |
| Business           | 1,900         | $0.01/credit  | Pooled across org        |
| Business (promo)   | 3,000         | $0.01/credit  | June–Sept 2026           |
| Enterprise         | 3,900         | $0.01/credit  | Pooled across enterprise |
| Enterprise (promo) | 7,000         | $0.01/credit  | June–Sept 2026           |

1 AI credit = $0.01 USD. Credits are pooled — an org with 10 Business users gets 19,000 credits shared.

### Custom Model Costs

Override or add model pricing via `copilotUsage.aic.customModelCosts`:

```json
"copilotUsage.aic.customModelCosts": [
  {
    "model": "claude-opus-4.6",
    "inputCreditsPerMillion": 500,
    "outputCreditsPerMillion": 2500,
    "cachedInputCreditsPerMillion": 50,
    "cacheWriteCreditsPerMillion": 625,
    "tier": "premium"
  }
]
```

Credits are calculated as: `(net_input_tokens / 1M) × inputRate + (output_tokens / 1M) × outputRate + (cached_read_tokens / 1M) × cachedRate`

Anthropic models also incur cache write costs: `(cache_write_tokens / 1M) × cacheWriteRate`

### BYOK Provider Cost

Everything above is denominated in **AI credits** — GitHub's unit. Traffic
through your own endpoint (Azure AI Foundry, Anthropic, OpenAI, Ollama) is not
billed by GitHub at all, so credits describe only what it *would* have cost on
Copilot. `copilotUsage.byokPricing` prices that same traffic in the currency you
are actually invoiced in:

```json
"copilotUsage.byokPricing": {
  "cacheWriteRatio": 0,
  "providers": [
    {
      "match": "Azure Founday Anthropic",
      "regionMultiplier": 1.0,
      "models": [
        {
          "match": "opus",
          "inputPerMillion": 5.0,
          "outputPerMillion": 25.0,
          "cachedReadPerMillion": 0.5,
          "cacheWritePerMillion": 6.25
        }
      ]
    }
  ]
}
```

`providers[].match` is matched case-insensitively against `"<provider label> <model id>"`;
`models[].match` against the model id. **Longest match wins**, so a specific
deployment entry beats a generic family entry regardless of array order.
Overrides merge over the built-in defaults by `match`, so an empty object keeps
the shipped Anthropic rates.

Cost is `(input − cached)/1M × inputRate + output/1M × outputRate + cached/1M × cacheRate`,
all scaled by `regionMultiplier`. Cached tokens are subtracted from input to
avoid billing the same token twice — on a cache-heavy agent workload that
double-count would roughly double the figure.

Two deliberate behaviours:

- **No matching rate returns `null`, rendered as `—`.** Never `$0.00`. An
  unconfigured Azure deployment and a genuinely free local model would
  otherwise be indistinguishable, and one of those is an unbounded
  under-report.
- **The result is a lower bound.** Anthropic prices cache reads at `0.1×` input
  and cache writes at `1.25×`–`2.0×`, but VS Code records a single `cached`
  count with no way to separate them. `cacheWriteRatio` (default `0`, all
  reads) sets the assumed split.

Provider dollars are reported in their own column and are never summed into
credits — they are separate vendors' bills.

## Daily AI Credit Limit Guard

Cap daily spend independently of the monthly AIC budget. Disabled by default — enable in Settings → search `copilotUsage.dailyLimit`.

| Setting                                     | Default | Description                                                                                                                  |
| ------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `copilotUsage.dailyLimit.enabled`           | `false` | Master switch. Off by default; turn on to opt in.                                                                            |
| `copilotUsage.dailyLimit.credits`           | `100`   | Daily limit in AI credits (1 credit = $0.01).                                                                                |
| `copilotUsage.dailyLimit.dollars`           | `0`     | Daily limit in USD. When > 0, overrides `credits`.                                                                           |
| `copilotUsage.dailyLimit.warnAtPercent`     | `75`    | Percent at which the status bar turns amber.                                                                                 |
| `copilotUsage.dailyLimit.braceAtPercent`    | `90`    | Percent at which the floating corner card appears.                                                                           |
| `copilotUsage.dailyLimit.enforcement`       | `pause` | `soft` (overlay only) / `pause` (kills inline completions) / `strict` (disables Copilot + Chat — needs reload).              |
| `copilotUsage.dailyLimit.snoozeMinutes`     | `10`    | How long the Snooze button postpones enforcement.                                                                            |
| `copilotUsage.dailyLimit.resetHour`         | `0`     | Local hour at which the counter rolls over (0–23).                                                                           |
| `copilotUsage.dailyLimit.playSound`         | `false` | Play a soft chime when the daily limit is first reached.                                                                     |
| `copilotUsage.dailyLimit.installAgentHooks` | `true`  | Install lifecycle hooks at `~/.copilot/hooks/` so CLI / agents stop too. Only takes effect when the daily limit is enabled.  |

### Agent Hooks

When enabled, the extension installs `PreToolUse` and `UserPromptSubmit` lifecycle hooks at `~/.copilot/hooks/` that deny tool calls in Copilot CLI, local custom agents (`.agents/*.md`), and the Copilot cloud agent when the daily limit is hit. Fail-OPEN by design — if the hook script errors out, the tool call is allowed through.

## Features Summary

- Unified usage across VS Code Copilot Chat, Oh My Pi, and Pi sessions
- AI Credits tracking with configurable per-model rates
- BYOK provider cost in real USD for Azure / Anthropic / OpenAI endpoints GitHub does not bill
- Budget monitoring with uncapped overage percentage, days-of-runway, projected end-of-cycle
- Hero KPI cards, tabbed Breakdown (Model / Project / Tool / Subagent), collapsible expanders, side-by-side Trend charts
- Token counts (prompt, output, cached) per session, model, project, day
- Per-source table splitting Sessions / Turns / Tokens / AIC across VS Code, OMP, Pi
- Session browser with title, preview, duration, tools, subagent usage
- Clickable links to session log and transcript JSONL files
- Daily usage trends and monthly credits calendar heatmap
- Tool and subagent call tracking
- Live OpenTelemetry receiver (OTLP HTTP on port 14318)
- Auto-refresh (30s / 1m / 2m / 5m / Off) + manual refresh
- Status bar with session count and token totals
- Multi-root workspace support
