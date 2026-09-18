# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.11.3] - 2026-09-04

## [1.11.4-zh] - 2026-09-18 (Chinese localization fork)

### Added

- 🌐 中英双语切换：主仪表盘、侧边栏、状态栏 tooltip 三处界面统一，右上角「中文 / EN」即时切换，选择跨重开保持。
- 📤 用量导出：命令面板 `Copilot Usage: Export Stats` 或仪表盘「⤓ 导出」按钮，按 Dashboard 分类导出 Markdown / JSON 统计。
- ↺ 「重置」按钮：刷新不再重置筛选视图；显式点击「↺ 重置」才恢复默认（保留当前语言）。

### Fixed

- 刷新（含自动刷新）不再冲掉模型筛选 / 时间范围 / 时区选择。
- 语言与筛选状态持久化到 globalState：关闭并重开仪表盘后保持上次的中文与筛选。

---

### Fixed

- **The AIC total drifted below github.com, and the gap kept growing.** The
  dashboard reported `38,048` credits against GitHub's own `38,844` for the same
  cycle — an offset that widened rather than holding steady.

  Every credit figure was reconstructed from local debug logs, which is
  structurally a *lower bound* on what GitHub bills. Three blind spots feed it,
  and all three accrue monotonically, so the gap can only widen:

  - Requests dispatched through VS Code's public `LanguageModelChat` API
    (`debugName: "copilotLanguageModelWrapper"`) record `inputTokens` and
    `outputTokens` but omit `copilotUsageNanoAiu` entirely, so they were only
    ever rate-estimated. Measured at 373 requests / 39M input tokens in a single
    September cycle.
  - Usage billed on another machine, another IDE, github.com, or the cloud agent
    never writes a local `main.jsonl` at all.
  - Rotated or deleted debug logs take their credits with them.

  New `quotaSnapshot` module reads GitHub's own ledger from
  `GET /copilot_internal/user` → `quota_snapshots.premium_interactions`, the
  same endpoint the official Copilot extension polls for its quota UI. Its
  `credits_used` now drives the headline, while the locally-derived numbers
  continue to supply the per-model, per-day and per-session attribution the API
  does not provide. The residual delta is surfaced in the dashboard note so it
  stays visible rather than silently re-accumulating.

  Reconciliation is applied to `aicSummary.byDay` as well, not just the hero, so
  the Usage-by-Model total, the sidebar and the status bar cannot drift apart
  again — the single-credit-basis guarantee from 1.10.91 still holds.

- **"2000% of budget — over budget pace" on a seat using 19% of its allowance.**
  `monthlyBudget` came from the plan table's *per-user* 1,900 credits, but
  Business and Enterprise credits are pooled at the billing entity. GitHub's
  `entitlement` reports the pooled figure the seat can actually draw on, and now
  supplies both `monthlyBudget` and `creditsRemaining`, which also clears the
  phantom `$361.48` overage cost.

- **Daily pace and the projection were still computed on the local basis**, so
  the hero divided a partial run rate by the active-day count and extrapolated
  it against the pooled entitlement — the source of the `↑ projecting 15019% of
  budget` banner. Both now derive from the reconciled cycle total.

### Added

- **The hero and the model table now show where each credit came from.** The
  headline is GitHub's figure; its subtitle breaks out how much of it the local
  logs actually account for and how much is unattributed, and Usage-by-Model
  gains an `unattributed / no local log` row so the table still totals to the
  hero instead of quietly falling short of it. Both appear only for the current
  cycle, which is the only range the quota snapshot covers.

- **BYOK traffic is now priced in the currency you are actually billed in.**
  Requests through your own Azure AI Foundry / Anthropic / OpenAI endpoint are
  not billed by GitHub, so the non-billable panel could only ever show them as
  *Copilot-equivalent* credits — a number that appears on no invoice you
  receive. A **Provider cost** column now applies your provider's published
  per-token rates to the same traffic and reports real USD, kept strictly
  separate from AI credits because it is a different vendor's bill.

  Built-in defaults cover the Anthropic family at published Claude API rates
  (Opus `$5`/`$25` per Mtok with `$0.50` cache reads; Sonnet `$2`/`$10` with
  `$0.20`), which Anthropic documents as also being the Microsoft Foundry rate
  card. Everything is overridable through `copilotUsage.byokPricing`, including
  a `regionMultiplier` for Azure US Data Zone deployments (`1.1x`).

  Two deliberate constraints, both visible in the UI:

  - A model with **no configured rate renders `—`, never `$0.00`**. A local
    Ollama model and an unconfigured Azure deployment would otherwise look
    identical, and only one of them is genuinely free.
  - The total is a **lower bound**. Anthropic prices cache reads at `0.1x` and
    cache writes at `1.25x`–`2.0x`, but VS Code records a single `cached` count
    and cannot distinguish them. Cached tokens are priced as reads by default;
    `copilotUsage.byokPricing.cacheWriteRatio` shifts the split.

### Notes

- The quota call reuses the silent GitHub session `planDetector` already
  establishes — no new sign-in, and a 5-minute TTL keeps it off the hot refresh
  path.
- Every failure mode (offline, no session, endpoint moved) falls back to the
  previous locally-derived behaviour and omits the `quota` block. Nothing
  degrades to zeros.

## [1.11.2] - 2026-08-23

### Fixed

- **BYOK rows lost the provider label 1.11.1 had just added.** The non-billable
  table still showed a bare `claude-opus-5` alongside the correctly-labelled
  `Azure Founday Anthropic/claude-opus-5`, as if two different models were in
  play.

  The label was being attached correctly and then discarded one layer down.
  `computeSummary` reports the rate-table id that `calculateCredits` matched, so
  `Azure Founday Anthropic/claude-opus-5` substring-matched `claude-opus-5` and
  came back renamed to it. The branch handling rows with a real billed figure
  already kept the caller's name for non-billable rows; the rate-estimate branch
  did not.

  That is exactly backwards from what the split needs: BYOK traffic by
  definition carries no `copilotUsageNanoAiu`, so it always takes the estimate
  branch — the only rows the label exists for were the only rows losing it.
  Agent rows kept theirs because they carry a provider cost ledger and take the
  other branch, which is why the two spellings appeared side by side.

  Non-billable rows now keep the name the caller supplied on both paths. Credit
  totals are unchanged — this is a labelling fix, and billable rows still use
  the bare id so they stay comparable with GitHub's own reporting.

  Traffic that reached a BYOK provider through a Copilot-vendor turn still shows
  a bare id: there is no recorded provider name to attribute it to, and
  inventing one would be worse than leaving it unqualified.

## [1.11.1] - 2026-08-23

### Fixed

- **Agent rows showed `0.00` input credits.** Every Azure-routed Claude row in
  the non-billable table reported no input spend at all, with the entire ledger
  total pushed into output and cached.

  Agent sessions report `input` already net of cache, but the calculator
  subtracts cache from whatever `inputTokens` it is handed — so the cached
  tokens were being deducted twice. On a cache-heavy session that is fatal
  rather than merely inaccurate: `claude-opus-5` recorded 1,840 net input
  tokens against 235M cache reads, so the subtraction clamped at zero and the
  input share vanished. Agent tokens are now passed gross, matching the
  convention already documented in `agentScanner.ts`.

  Only the split across input/output/cached changes; the agent's own ledger
  total is still reported exactly as recorded, so no headline figure moves.
  Sessions with no cache activity are unaffected.

- **BYOK traffic is now attributed by recorded routing, not inference.** A model
  sold by both Copilot and your own key — `claude-opus-5` served from an Azure
  AI Foundry endpoint — was billed as Copilot premium. The classifier had no
  per-request proof of which route a call took, so the id matching the premium
  rate table won.

  VS Code records the answer on every request. Each one carries a vendor-prefixed
  `modelId` (`copilot/claude-opus-5` vs
  `customendpoint/Azure Founday Anthropic/claude-opus-5`), and the session header
  repeats it as `selectedModel.metadata.vendor`. The scanner discarded that
  prefix to recover the bare model name. It now keeps the vendor and carries it
  through to classification, where a non-Copilot vendor marks the request
  non-billable outright.

  This is observed routing rather than an inference from `chatLanguageModels.json`,
  so it resolves colliding ids without consulting the model catalog at all.
  A real `copilotUsageNanoAiu` figure still wins — GitHub having actually billed
  a request is stronger evidence than any local signal — and turns with no
  recorded vendor keep the previous BYOK-wrapper heuristic unchanged. Auxiliary
  calls within a turn (title generation, subagent rounds) are excluded, since
  those run on Copilot's own route regardless of the model you picked.

  A turn's vendor is not pinned to auxiliary calls it dispatches on other
  models — title generation and subagent rounds run on Copilot's route whatever
  you picked, so inheriting a BYOK vendor there would wrongly demote billable
  usage. Matching the turn's model is the usual proof of ownership, but it
  rejected a real case: a subagent running `claude-opus-5` inside a
  `claude-sonnet-5` turn on the *same* Azure endpoint. Those 339 requests fell
  back to the wrapper heuristic and appeared as a second, unlabelled
  `claude-opus-5` row. A request dispatched through the public LanguageModelChat
  wrapper is BYOK-served by definition, so that now counts as proof on its own
  (verified: 698 of 698 wrapper requests reported zero credits — no exceptions).

  Non-billable rows are now labelled with the provider you named —
  `Azure Founday Anthropic/claude-opus-5` — so they are distinguishable from the
  genuine Copilot model. VS Code's own `customendpoint` vendor string is a
  transport mechanism rather than a provider, so it only appears when no name
  was recorded. Billable rows keep the bare id to stay comparable with GitHub's
  own reporting.

- **Live session credits were double-counted across model-version aliases.** A
  request billed at 5.0 credits reported 11.0. The debug log records the API
  *response* model while OTel records the *request* model, so one call surfaces
  as both `claude-opus-4.7` and `claude-opus-4.6`. Reconciliation already
  matched those by family, but the per-model rollup keyed on the minor-versioned
  name — so the OTel spelling found no exact match, looked unbilled, and had a
  full rate estimate added on top of the exact credits. Rows whose family
  already carries exact debug credits no longer take the estimate.

  This surfaced only because the regression test guarding it had never actually
  executed: `verify-live-aic-reconciliation.js` imported `dashboardData` without
  the `vscode` stub, so the require chain threw before the first assertion. The
  stub is now installed and all three cases run.

- **Catalog schema bumps no longer fail their own tests.** Two fixtures pinned
  `vendorMapVersion: 2` as a literal, so raising the parser to v3 made a
  current-schema snapshot look stale and forced a refresh the tests were
  written to prove would not happen. `VENDOR_MAP_VERSION` is exported and the
  fixtures track it.

- **The status-bar hover no longer flickers once a second.** The TTL countdown
  ticks every second, and each tick reassigned `item.tooltip` — which makes
  VS Code tear down and re-lay-out an open hover. The tooltip is now rebuilt
  only when a session actually changes colour band, keyed on `sessionId:state`
  with the per-second `remaining` value deliberately excluded. The bar text
  still updates every second.

  Tradeoff: an open hover no longer counts down. It holds the value it was
  opened with until a band changes. A live countdown requires reassigning the
  tooltip, which is precisely what caused the flicker.

- **A single cache-TTL row no longer stretches the whole hover.** The hover
  sizes itself to its widest line, so one long row distorted every other
  section. Three things were inflating it: session titles truncated at 34
  characters (now 22 in this surface only — the sidebar keeps 34), a redundant
  provider label such as `customendpoint`, and a `$0.00` cost carrying no
  information. Cost now appears only when non-zero. The trailing note is
  wrapped across two lines for the same reason.

### Added

- **Prompt-cache TTL tracking.** The dashboard already reported the cache hit
  rate *after the fact*; it could not tell you the one thing that actually
  changes the bill — whether your next turn will still hit that cache. Providers
  expire a cached prefix after a few minutes of inactivity, and once it lapses
  the entire conversation is re-billed at the full input rate. On a long agent
  session with a 95%+ hit rate that is the difference between a few credits and
  a few hundred.

  A live countdown now shows how long each session's cache stays warm, derived
  from the `turn_start` / `turn_end` / `llm_request` timestamps the scanner
  already reads. It surfaces in four places:

  - **Status bar** — the most urgent session's countdown, appended to the
    existing item. Never a second status-bar entry.
  - **Status-bar tooltip** — folded into the existing *Cache reuse* card, with
    a per-session table (state, title, provider, spend).
  - **Sidebar** — a *Cache Reuse* card with a progress bar per session.
  - **Dashboard** — a *Cache TTL* column on the sessions table that ticks in
    the webview.

  Sessions still generating show `HOT` rather than a countdown, because the
  cache is being refreshed as they run. Copilot CLI sessions are tracked too,
  via the same `~/.copilot/session-state` events the CLI scanner reads.

  Off by default — enable `copilotUsage.cacheTtl.enabled`. Lifetimes are
  per-provider and configurable under `copilotUsage.cacheTtl.ttl`; only
  Anthropic documents a TTL (~5 min), so the rest ship as tunable estimates and
  are labelled approximate in the UI. Optional expiry sound
  (`soundEnabled`) and notification (`notifyOnRed`) are both off by default.

  Derived in part from [cache-timer](https://github.com/sukumarp2022/cache-timer)
  (MIT © 2026 sukumarp2022) — see `NOTICE`. The timer math and alert gating are
  ported; the polling data layer is not, since this extension's incremental,
  watcher-driven scanner already had the timestamps.

### Changed

- The 1s countdown tick only runs while the feature is enabled, the window is
  focused, and at least one session is warm. It is pure arithmetic over cached
  state — it never triggers a scan.

## [1.10.99] - 2026-08-15

### Fixed

- **Projects still rendered as `workspace-<hash8>` despite the 1.10.98 naming
  fix.** `rememberWorkspaceName` keyed the registry on
  `path.basename(context.storageUri.fsPath)`, but `storageUri` is
  `<…>/workspaceStorage/<hash>/<extensionId>` — the last segment is the
  extension id, not the workspace hash. Every lookup therefore stored
  `pvjagtap.copilot-usage-dashboard → <name>`, which matches no workspace
  directory, so the fallback label survived. The hash is now taken from the
  segment following `workspaceStorage`.

## [1.10.98] - 2026-08-15

### Fixed

- **Chats started without a folder open were never counted.** VS Code writes
  those to a flat `globalStorage/emptyWindowChatSessions` directory rather than
  `workspaceStorage/<hash>/chatSessions`, and the scanner only ever walked the
  latter. On a real profile that hid 24 of 28 session files (13.6 MB of 15.6 MB)
  and truncated history from 2025-07-09 to 2026-02. `discoverEmptyWindowSessionFiles`
  now adds the global store, derived as a sibling of the resolved
  `workspaceStorage` root, and attributes it to the project `(no folder)`.
  When the configured root points at the *target* of a relocated storage dir
  the sibling does not exist, so discovery falls back to the standard root
  that resolves to the same path. Unrelated roots — a test fixture, another
  machine's export — match nothing and correctly get no global store.

- **Pre-JSONL `.json` sessions were skipped.** Both discovery passes filtered on
  `.jsonl`, dropping the older single-object format still present on disk
  (including a 1.3 MB session). Those files hold exactly the payload that a
  `kind=0` op carries, so they are now wrapped into one and fed through the
  existing legacy parser path unchanged.

- **Symlinked workspace directories could vanish silently.** `listWorkspaceDirsSorted`
  filtered on `Dirent.isDirectory()`, which is `false` for symlinks and Windows
  junctions, so a per-workspace link would have been skipped without error. It
  now keeps symlink entries and lets the existing `stat`-based checks reject
  anything that is not a directory. A symlinked `workspaceStorage` *root* was
  never affected — `readdir` and `fsp.stat` both follow it.

## [1.10.97] - 2026-08-15

### Fixed

- **Every VS Code chat session was being discarded — the dashboard reported 0
  sessions, 0 turns and 0 tokens while Copilot was actively in use.** VS Code
  changed the `chatSessions` JSONL layout. It previously wrote a `kind=0`
  header carrying `sessionId` plus an embedded `v.requests[]`; it now writes a
  header-less delta log where `kind=1` sets a value at a path
  (`["requests", 9, "promptTokens"]`) and `kind=2` appends to an array, with the
  session id present only in the filename.

  `parseSessionContent` read `sessionId` exclusively from the `kind=0` op and
  bailed with `return null` when it was empty, so every current-format file was
  dropped. The file was found and read — `sourceFiles: 1` — but produced
  `canonicalSessions: 0`, which is why the failure was invisible: no error, just
  an empty dashboard with all usage appearing to come from Pi.

  The parser now replays the ops into a requests array and derives:
  - session id from `result.metadata.sessionId`, falling back to the filename
  - model from `modelId` (`copilot/claude-opus-5` → `claude-opus-5`)
  - `promptTokens`, `completionTokens` and `copilotCredits` per request
  - timestamps from `modelState.completedAt` / `responseTimestamp` / `timestamp`
  - tool calls and subagents from `result.metadata.toolCallRounds`

  Replay capture runs before the legacy branches, which `continue` past several
  of these ops — `requests/N/result` is the only carrier of `toolCallRounds`,
  and capturing it after those branches silently yielded 0 tool calls.

  On the reporting profile this restores 1 session / 18 turns / 46 tool calls /
  1,712.38 credits where the dashboard previously showed nothing. The legacy
  `kind=0` path is unchanged and the 546-session legacy fixture still
  reconciles exactly.

### Added

- `tests/verify-chatsession-formats.js` — builds both the legacy and current
  shapes as fixtures and asserts each yields a session, turns, tokens, credits,
  tool calls and subagents, including the filename-only session-id fallback.

## [1.10.96] - 2026-08-15

### Reverted

- **1.10.95's non-blocking initial scan is reverted.** `await runScan()` is
  restored in `activate()`. Making it fire-and-forget was wrong on three
  counts:

  1. It re-introduced the regression v1.9.14 shipped and the codebase had
     already rejected in writing — a dashboard rendering all zeros while the
     scan runs. The comment recording that decision was removed rather than
     heeded.
  2. `runScan().then(…)` carried no `.catch()`, so any throw in the follow-up
     (status bar, sidebar snapshot, dashboard repaint) became an unhandled
     promise rejection.
  3. It was justified by a 90.7 s cold scan measured from a log written when
     910 sessions existed on disk. Async execution does not make a 90 s scan
     acceptable — it only moves who waits. If the scan is slow, the scan is
     what needs fixing.

  The 1.10.93 registration-order fix is kept: the sidebar provider and its
  `setOnReady` hook are still wired before the first `await`, which is correct
  and costs nothing. Note this alone does not make the view appear early — VS
  Code does not dispatch `resolveWebviewView` until `activate()` resolves.

### Known issue

- The scanner's `_sessionBundleCache` / `_debugLogCache` are module-level Maps,
  so they are discarded on every extension-host restart and each window reload
  pays a full cold scan (90.7 s on a 910-session profile; ~2 s warm). A
  persistent on-disk cache keyed by path + mtime is the real fix and is
  deliberately not attempted here.

## [1.10.95] - 2026-08-15

### Fixed

- **The sidebar was still blank after 1.10.93 — `activate()` blocked on a
  90-second scan.** Moving `registerWebviewViewProvider` ahead of the awaits was
  necessary but not sufficient: VS Code does not dispatch `resolveWebviewView`
  until the activation promise itself resolves, so an early registration inside
  a still-pending `activate()` changes nothing.

  The extension host log made it unambiguous — the extension activated via
  `onView:copilotUsage.panel`, created its output channel, then wrote **zero
  bytes** for the rest of the session, where a healthy session writes ~41 KB.
  The previous session's log gave the reason:

  ```
  Scan: 910 sessions, 15388 turns, 62774 tools (90701ms)
        | Agent: Pi=34 (16764ms) | CLI: (13368ms)
  ```

  `await runScan()` held activation for ~91 s on a cold cache, so the sidebar
  stayed blank that entire time — and permanently for anyone reloading more
  often than that.

  The initial scan is now kicked off rather than awaited, and `activate()` has
  no top-level `await` left at all. The v1.9.14 concern that motivated the
  blocking call (a dashboard rendering all zeros) is preserved by an
  `initialScan` promise: `buildData()` already falls back to an empty scan, so
  the sidebar paints its placeholder state immediately, and status bar, sidebar
  and any open dashboard repaint when the scan settles. Both `openDashboard`
  commands show the panel right away and refresh once `initialScan` resolves.

### Added

- `tests/verify-sidebar-registration-order.js` now also asserts the cold-start
  scan is kicked off rather than awaited, and that the provider is registered
  before the scan starts. Verified to fail against the blocking version.

### Known issue

- The 90.7 s cold scan is itself unreasonable and is not addressed here — it no
  longer blocks the UI, but first-paint data on a large profile still takes that
  long to arrive. Worth profiling separately.

## [1.10.94] - 2026-08-15

### Fixed

- **Agent calls with no recorded `usage.cost.total` were dropped when other
  calls to the same model had one.** The agent credit path gated on the
  per-model sum — `stats.costCredits > 0 ? stats.costCredits : rateEstimate(…)`
  — so a model with 47 calls where only 1 carried a cost reported that single
  call and never priced the other 46. Agents populate `usage.cost` on a minority
  of messages (1,417 of 11,032 — 12.8% — across the observed Pi history), so
  partial coverage is the normal case, not an edge case. Identical bug class to
  the per-turn `debugAicCredits > 0` gate fixed for VS Code in 1.10.91.

  `AgentModelTokens` now carries an `unpriced` bucket of the tokens whose calls
  recorded no cost, and Copilot-routed rows are priced as
  `ledger + rateEstimate(unpriced)`. Third-party providers are unchanged — they
  still get no rate estimate, since GitHub's rate card does not price
  Azure/Anthropic-direct traffic.

- **`modelBreakdown` keyed by model name and latched the first provider seen.**
  A model served by two providers within one session billed entirely to
  whichever appeared first. No session in the observed data does this, so the
  old code was incidentally correct rather than structurally safe — but
  `claude-opus-5` does run on both Copilot and Azure Foundry. Rows are now keyed
  by provider + model, with the bare name carried in `stats.model`. Primary-model
  selection aggregates back across providers so a split model is not beaten by a
  single-provider one.

### Added

- `tests/verify-agent-cost-coverage.js` — covers partial cost coverage on
  Copilot-routed rows, no rate estimate for third-party rows, no double-count
  when coverage is complete, and provider-split keying for one model served by
  two providers in a single session.

## [1.10.93] - 2026-08-15

### Fixed

- **The "Copilot Usage" Activity Bar sidebar rendered permanently blank.**
  `registerWebviewViewProvider("copilotUsage.panel", …)` sat ~180 lines into
  `async activate()`, behind `await runScan()` (a full scan of every
  workspaceStorage chat session — 909 of them on the reporting profile),
  `await receiver.start()`, and up to four `await config.update(…)` global
  settings writes.

  VS Code resolves a `type: "webview"` view as soon as the window restores a
  pinned sidebar. With no provider registered yet the view paints empty, and
  a provider arriving after that point does not repaint it — so the panel
  stayed blank for the whole session, with nothing surfaced in the UI or the
  output channel to explain why. Reinstalling could not help; the ordering was
  the same in every build.

  The provider, its two title-bar commands and the `setOnReady` hook are now
  wired synchronously at the top of `activate()`, before anything is awaited.
  Nothing there needs scan data: the view serves static HTML and requests a
  snapshot via its existing `ready` ping, which `pushSidebarSnapshot()` answers
  safely whether or not a scan has finished.

### Added

- `tests/verify-sidebar-registration-order.js` — parses the compiled
  `activate()` (skipping strings and comments, and ignoring awaits nested in
  callbacks) and fails if the provider or `setOnReady` is wired after the first
  top-level `await`. Verified to fail against the pre-fix ordering.
- `tests/verify-sidebar-html.js` — parses the sidebar webview's inline script
  and checks the CSP nonce matches. `verify-webview-html.js` only ever covered
  `dashboardPanel.js`, so a syntax error in the sidebar produced a silent blank
  panel with no test coverage.

## [1.10.92] - 2026-08-15

### Fixed

- **OMP / Pi agent sessions written directly into the sessions root were never
  scanned.** `scanDirectory` enumerated `~/.pi/agent/sessions` (and the OMP
  equivalent), `stat`-ed each entry and returned early for anything that wasn't
  a directory — so it only ever read `<root>/<project>/*.jsonl`. Both agents
  also write loose `<root>/*.jsonl` files when a session has no project context,
  and every one of those was dropped silently.

  On the reporting profile that hid 9 Pi sessions worth 57 LLM calls and
  **908.50 credits** of `github-copilot` traffic, so the dashboard's Pi column
  read 3,435.91 credits where the session files say 4,344.41. Loose root files
  are now read alongside the per-project ones; non-`.jsonl` and unparseable
  files at the root are ignored as before.

  `tests/verify-agent-root-sessions.js` builds a synthetic sessions tree with
  one nested and one loose session (plus a `.txt` and a malformed `.jsonl`) and
  asserts both are scanned exactly once.

## [1.10.91] - 2026-08-15

### Fixed

- **"Usage by Model" TOTAL disagreed with the hero "AI Credits Spent" tile**
  (102,462.90 vs 98,450.30 on a reported cycle). The two numbers were computed
  by two independent passes over the same scan:
  - The hero sums `aicSummary.byDay`, which is built from `creditEntries` —
    one entry per `llm_request`, carrying that request's own
    `copilotUsageNanoAiu`, its own date, and a billable classification.
  - The table summed `SessionView.aicCredits`, a separate per-*turn* loop that
    (a) used `turn.debugAicCredits` whenever it was non-zero, silently dropping
    every rate-estimated request inside turns where only *some* requests
    reported `copilotUsageNanoAiu`, (b) rate-estimated at the parent turn's
    model instead of per sub-model (title-gen, subagents), (c) applied no
    billable filter, and (d) pinned the whole session's lifetime spend to
    `session.lastDate`, so a session spanning a month boundary reported all of
    its credits inside whichever month it last ran in.

  `SessionView` now carries `aicByDay` — a per-request-day credit split derived
  from the *same* `creditEntries` list the headline total is computed from — and
  `aicCredits` is its sum. Every consumer (Usage-by-Model, the Sessions table
  and its Cost column, the AIC per-model split, the project cost chart, the
  sidebar session list) range-filters on that split instead of on `lastDate`.
  `AICDashboardData.unattributedByDay` exposes the billable credits that belong
  to no chat session (in-flight OTel requests, OMP / Pi / CLI agent usage), which
  the table renders as an explicit "Other sources & live" row so its TOTAL equals
  the hero exactly rather than approximately.

  `tests/verify-model-table-reconciles.js` asserts TOTAL == hero across All
  Time / This Month / Prev Month / Last 7 days, plus the invariant that the sum
  of in-cycle session credits never exceeds `aicSummary.totalCredits`.

## [1.10.90] - 2026-08-07

### Fixed

- Re-audit of billing-era display. The AIC section still rendered the
  "Usage-Based Billing" title, PROMO tag, credit budget bar and USD
  overage cards for pre-AIC ranges (April / May 2026), even though
  GitHub billed premium requests against a per-plan allowance in that
  era, not credits. That was a real regression: users looking at May
  saw a "$951 overage" computed against a 3000-credit budget that
  didn't exist yet.

### Added

- Pre-AIC ranges now render a dedicated **Premium Request Billing**
  panel at the top of the AIC section: premium-requests-used bar
  vs. the plan's `includedPremiumRequests` allowance (300 for Business,
  1000 Enterprise, 1500 Pro+, 3000 Max) and an overage card at the
  historical rate of $0.04 per premium request over the allowance.
  The AIC credit reconstruction is still shown below, but now clearly
  labelled "rate-table reconstruction" so it is not mistaken for the
  invoice amount. Section title changes to "Billing Detail (Pre-AIC)".
- `AICDashboardData.includedPremiumRequests` plumbed from
  `PLAN_SPECS` through `buildDashboardData()` to the webview so the
  panel doesn't have to hardcode plan allowances.

### Verified

- `tests/audit-billing-era-split.js` confirms every era renders the
  right headline: May → "Premium Requests" hero + premium-request
  panel; July → "AI Credits Spent" hero + credit budget bar; August
  → same as July (current cycle, live projections).

## [1.10.89] - 2026-08-07

### Fixed

- "AI Credits by Model" input/output/cached columns rendered em-dash for
  every historical range (June, July, all pre-AIC months). The webview
  had per-request credit splits only for the current billing cycle and
  fell back to session totals, which don't carry a credit-side split.
  The historical fallback now aggregates session-level token counts
  (`actualPrompt`, `actualOutput`, `actualCached`) per model and
  apportions each row's credit total by the input / output / cached
  token ratio. Result: the split columns populate for every range,
  totals still reconcile with the hero and the calendar month total.

## [1.10.88] - 2026-08-07

### Fixed

- Hero "AI Credits Spent" tile and the AIC section's "Total Credits" card
  disagreed for historical months (July: hero 38,050 vs section 98,135, both
  from the same data). The hero's per-day accumulation was guarded by
  `!(lastDate in map)`, so the first session on any day set the entry and
  every other session on that day was silently dropped. Both surfaces now
  share a single `buildRangeDayMap()` helper that accumulates all sessions
  per day, guaranteeing hero ≡ section ≡ calendar total for every range.

### Changed

- Ranges ending before 2026-06-01 now show "Premium Requests" (turns ×
  multiplier) as the hero metric instead of "AI Credits Spent". Pre-AIC
  GitHub billed premium requests, not credits — the credit reconstruction
  is still available under the AIC section with its estimate banner, but
  the headline number now reflects what actually appeared on the invoice.
- Pre-AIC overage card shows "Overage (n/a)" with an explanatory sub-line
  instead of computing a credit overage against a budget that didn't exist.

## [1.10.87] - 2026-08-07

### Fixed

- Historical ranges (any month before 2026-06-01) showed `0.0` AI Credits and
  an empty model table despite reporting full session, turn and prompt-token
  counts. `computeSessionViews()` skipped every turn dated before the AIC
  effective date when building per-session credits — and that field is the
  only credit source the dashboard has for closed periods, since
  `aicSummary.byDay` is clipped to the current billing cycle.
- The rate-table estimate used for turns without API-reported credits now
  accounts for cache-read tokens instead of billing the entire prompt at full
  input price. May 2026 dropped from an implausible 866k credits to 271k.
- "All Time" and multi-month ranges rendered the current cycle's per-model
  breakdown, silently dropping every historical credit from the table.
- The AI Credits section no longer disappears for a past month when the
  current billing cycle happens to be empty.

### Added

- Ranges that end before 2026-06-01 now carry a "Pre-AIC estimate" note so
  reconstructed credits are never mistaken for GitHub-billed actuals. Budget,
  overage and projection math remain scoped to the AIC era.

## [1.10.86] - 2026-08-05

### Changed

- The status bar tooltip's active-model legend (under the DAILY / WEEKLY /
  THIS MONTH donuts) now lists one model per line instead of a single
  dot-separated row. With multiple concurrent sessions the model list keeps
  growing, and the run-on row was becoming hard to scan.

## [1.10.85] - 2026-08-04

### Changed

- The AIC billing section's "Total Credits" card now shows a "$X gross value"
  sub-line (credits × $/credit, no budget subtracted) next to the Overage
  cards, which bill only credits above the plan's included allowance. The two
  numbers look similar but mean different things, and showing just the
  overage figure repeatedly read as "wrong" compared to the naive
  credits × rate math.

## [1.10.84] - 2026-08-04

### Fixed

- **Cold-start AIC totals could briefly read too high when Copilot Chat was
  mid-write to a session/debug-log file at the exact moment the extension's
  initial scan ran** — most visible with two VS Code windows open on the
  same PC, since each window's own scan covers all of `workspaceStorage` and
  there were twice as many concurrently-active Copilot processes to catch
  mid-write. The existing `turnByKey` dedupe can only collapse duplicate rows
  that have already landed on disk, so a still-settling turn could be counted
  once too many until the next scan. Sending a message already fixed this
  (the debug-log watcher forces a full rescan), but now a one-shot rescan
  fires automatically ~5s after activation so the dashboard self-corrects
  without needing user action.

## [1.10.83] - 2026-08-04

### Fixed

- **A model id served by both Copilot and your own API key was billed for
  every call, including the ones your key paid for.** `claude-opus-5` and
  `claude-sonnet-5` are sold by Copilot *and* declared in this user's
  `chatLanguageModels.json` against an Azure Foundry endpoint. v1.10.81 only
  demotes ids that Copilot's CAPI does not serve at all, so a colliding id was
  deliberately left billable — correct for the whole row, wrong for the BYOK
  half of it. No amount of model-name matching can separate them, because the
  name is genuinely the same on both routes.

  Classification is now per request. Copilot Chat stamps
  `debugName: "copilotLanguageModelWrapper"` on calls dispatched through
  VS Code's public `LanguageModelChat` API — the path a BYOK provider is
  reached by — while its own routes name the calling feature
  (`panel/editAgent`, `summarizeConversationHistory`, `title`). The scanner
  now records that marker, and a request carrying it is non-billable when the
  model is declared under a non-Copilot vendor. Requests GitHub actually
  billed still short-circuit to billable first, so no real charge can be
  hidden, and the marker alone cannot demote a model you never configured as
  BYOK.

  Verified against the full debug-log history: the marker appears on exactly
  the two BYOK models and nothing else, and all 357 such requests reported
  zero credits, while the same models' 564 Copilot-routed requests are
  untouched.

- The live "today" panel hardcoded `hasActualCredits: true` on every model
  row, which forced a row to billable before any of the above could apply. It
  is now false for rows made up entirely of unbilled BYOK calls.

- **The catalog refresh crashed before it could write the vendor map, so
  v1.10.82's schema-version fix retried forever and never completed.** A
  diagnostic log line called `JSON.stringify(m.billing).slice(...)`, but CAPI
  has since dropped `billing` — `JSON.stringify(undefined)` returns
  `undefined`, and `.slice` on it throws. The throw escaped to the top-level
  handler, which logged `refresh failed silently` and abandoned the whole
  refresh, including the `chatLanguageModels.json` parse. Every activation
  re-detected the stale v1 map, re-refreshed, and crashed at the same point.

  The log line no longer assumes that field exists, and CAPI parsing is now
  isolated in its own try/catch so a future schema change degrades to "no
  rates" instead of taking the third-party vendor map down with it.

- **BYOK classification could not fire for the very ids it targets.**
  `classifyByCatalog` resolves an id served by both Copilot and a BYOK key in
  favour of CAPI, returning `source: "capi"` — so the new per-request rule,
  which tested `source === "user-config"`, was unreachable for exactly the
  colliding case. Entries now carry a separate `userThirdParty` flag that
  survives the CAPI branch, and the classifier keys off that. The unit tests
  mocked the lookup and so could not catch this; the suite now also drives the
  real `classifyByCatalog` end to end.

- **A rate-less CAPI response would have wiped out all billing data.** CAPI is
  currently returning 40 models with no `billing` block at all, so every entry
  parses as non-billable. The existing "keep previous cache" guard only trips
  when *every* source is empty, which 40 entries is not — so once the crash
  above was fixed, the first successful refresh would have persisted a catalog
  in which no Copilot model is billable, collapsing all cost reporting to
  zero. A refresh that returns models but not a single priced one now keeps
  the previously-priced entries and takes only the third-party map from that
  round.

- `onDidChangeChatModels` fired seven times during a single activation, each
  triggering a full network refresh. It is now debounced by 5s, which also
  resolves the race where the registry was enumerated mid-population and
  reported 0 non-Copilot ids from 58 registered models.

## [1.10.82] - 2026-08-03

### Fixed

- **The v1.10.81 BYOK fix could stay dormant for up to 24 hours after upgrade.**
  The third-party vendor map is cached in `globalState` and hydrated on
  activation, and a snapshot inside the 24h TTL short-circuits the network
  refresh entirely. A map written by v1.10.80's parser therefore had no BYOK
  `models[]` ids in it, so the new classifier had nothing to act on and those
  models kept counting as billable until the TTL happened to expire.

  The map now carries a `vendorMapVersion`. When it predates the running
  build's parser, the TTL short-circuit is bypassed and
  `chatLanguageModels.json` is re-parsed on the next activation. Cached
  entries still hydrate and classify while that refresh is in flight — a v1
  entry is always a valid v2 entry, only incomplete — so there is no window
  where previously-known third-party models read as billable. The new version
  is stamped only when the config file was actually re-read, so an unreadable
  file cannot mark the map current and permanently suppress the retry.

- Covered by new cases in `tests/verify-catalog-sync-split.js`. That suite's
  refresh assertions now run serially and drain the module-level in-flight
  guard between cases, which was masking whether a refresh had been triggered.

## [1.10.81] - 2026-08-03

### Fixed

- **BYOK models were billed as Copilot usage.** Models added through the
  documented Bring-Your-Own-Key flow (built-in providers and Custom Endpoint)
  were counted against AI Credits, inflating the headline total and projected
  spend. Two independent defects had to line up for this:

  1. **The `models[]` array was never parsed.** `chatLanguageModels.json`
     carries model ids in two shapes — `settings` (per-model *option*
     overrides, in practice only used by the Copilot entry) and `models[]`
     (the documented BYOK declaration array). The parser only read `settings`,
     so a BYOK provider's ids never entered the third-party map at all.
     `models[].id` is now read alongside `settings`.

  2. **A rate-table name collision promoted them back to billable.** Even once
     parsed, ids like `claude-opus-5` and `claude-sonnet-5` exist verbatim in
     the built-in rate table because Copilot ships models with the same names.
     `isKnownGHCModel()` matched first and short-circuited to billable before
     the third-party signal was ever consulted. The catalog now emits an
     `exclusiveThirdParty` verdict — set only when the user declared a
     non-Copilot vendor for the id *and* a successfully-loaded CAPI snapshot
     does not serve it — which lets the classifier skip the rate-table
     promotion. Pure alias collisions, where CAPI *does* serve the id, keep the
     v1.10.15 behaviour and stay billable, so OMP / Pi / CLI totals are
     unaffected.

- **One model reached through two BYOK providers fell back to billable.** An id
  declared under two non-Copilot vendors (e.g. the same model via both `azure`
  and `customendpoint`, which the docs actively encourage) was dropped as
  "ambiguous" and handed back to the rate table. Ambiguity only matters for
  *billability*, so it now hinges solely on whether `copilot` is one of the
  vendors: multiple third-party vendors resolve to `"multiple"` and stay
  non-billable, while a genuine Copilot/BYOK collision is still deferred to
  CAPI. Same rule applied to `mergeThirdPartyMaps()`, where a file-vs-runtime
  vendor disagreement previously dropped the id.

- Covered by `tests/verify-byok-custom-endpoint.js` (built from a real user
  config) plus updated cases in `tests/verify-catalog-lookup.ts`.

## [1.10.80] - 2026-08-03

### Added

- **Cost column in the Systems table.** Each system now shows its credits
  converted to money at the configured `overageCostPerCredit` rate, with a
  combined cost in the footer.
- **Combined overage.** A footer row converts the *combined* credits above the
  account allowance into dollars. The credit budget is an account allowance
  rather than a per-machine one, so this is the only chargeable figure in the
  table — the per-system amounts are gross value at the same rate, and the
  panel note says so.

## [1.10.79] - 2026-08-03

### Added

- **Cross-machine usage — "Systems" table.** Every machine signed into the same
  account now publishes a compact rollup of its own usage (credits by day and
  by model, session/turn counts, token totals) over Settings Sync. A new
  **Systems — Combined Usage** table under the AI Credits section lists each
  contributing machine as *System 1*, *System 2*, … with its host name, credits
  for the cycle, counters, and a **last seen** timestamp, plus a combined total.
  Only rollups are shared — sessions, prompts, tool calls and log contents never
  leave the machine that produced them.
- **Dormant-system warning.** A machine with no update in over 7 days is
  labelled `dormant`, so a laptop that has been switched off cannot quietly
  distort the combined figure. Rollups reported against a different billing
  cycle are marked `other cycle` and excluded from the total.

### Changed

- **Headline tiles stay this-machine-only.** *AI Credits Spent*, the budget bar
  and the projection continue to describe the local machine, so they remain
  reconcilable against local data. The cross-machine figure is shown
  explicitly in the Systems table rather than silently folded into the
  headline.
- **Settings Sync keys are declared from one place.** `setKeysForSync` replaces
  an extension's whole declared-key list rather than appending to it, so a
  second caller would have silently dropped the first one's key. Registration
  moved out of `modelCatalog` into `machineSync.registerSyncKeys()`, which
  declares both the catalog and usage keys together on every activation.

### Technical

- Usage is stored as a map keyed by `vscode.env.machineId`, and each machine
  re-reads that map before overlaying **only its own slot**. VS Code applies
  incoming extension state per key with a plain replace and offers no merge or
  conflict resolution, so a single flat usage blob would let whichever machine
  synced last erase the others.
- Daily history is trimmed to 120 days per machine and writes are throttled to
  one per 5 minutes (and skipped entirely when nothing changed) — repeated
  `globalState` writes can trip the sync service's `LocalTooManyRequests`
  guard, which suspends auto-sync until VS Code restarts.
- New `tests/verify-machine-usage-sync.js` (21 checks) pins the invariants:
  foreign slots are byte-identical after a local publish, System numbering is
  derived from `firstSeen` so it is the same on every machine, dormant
  detection, cycle-matched totals, retention trimming, and the write throttle.

## [1.10.78] - 2026-08-03

### Added

- **Model catalog now syncs across machines.** The CAPI rate card and CDN
  provider lists are stored under a dedicated `globalState` key that is
  declared to VS Code Settings Sync, so every machine signed into the same
  account converges on one catalog snapshot instead of each rebuilding its
  own. Requires Settings Sync to be on with **Extensions** included in the
  synced resources.

### Changed

- The catalog cache is split in two. `userVendorByModelId` — derived from this
  machine's `chatLanguageModels.json` and its live `vscode.lm` registry — stays
  machine-local and is never synced. Syncing it would tag a model as
  third-party on a machine where no such provider is configured, flipping rows
  between billable and non-billable.
- A catalog snapshot stamped in the future (clock skew between synced machines)
  is now treated as expired rather than permanently fresh.

## [1.10.77] - 2026-08-02

### Fixed

- **Non-billable usage invented spend for third-party models that report no cost.** The "Non-billable models (informational)" panel showed 333.42 credits for August against a real agent-ledger total of 238.22. The extra 95.20 was a single row — `kimi-azure/Kimi-K2.5` — that has no `usage.cost.total` in its session log, so the agent block fell through to `calculator.calculateCredits(...)` and priced 1.16M Azure-hosted Kimi tokens with GitHub's Copilot rate card. That fallback exists for Copilot-routed sessions that predate the cost field; applying it to a third-party provider produces a number with no referent.
  - Agent-session credits are now sourced by provider: anything not routed through GitHub uses the provider's own cost ledger and nothing else. A third-party model with no ledger entry contributes no credits and no row, rather than a fabricated estimate.
  - The rate-card fallback is unchanged for `github-copilot` traffic, where GitHub's rates are by definition the correct ones.
  - Worth noting that the rate card was not merely unavailable for these rows, it was wrong where it *could* be checked: on the same day it estimated 141.12 credits for a Claude Opus row whose ledger says 178.97, and 33.20 against a ledger of 43.34. A plausible-looking number is not a correct one.
  - Covered by `tests/verify-thirdparty-no-rate-estimate.js`.

- **The non-billable panel described itself inaccurately.** Its blurb claimed every number was a "rate-table estimate of what the equivalent Copilot traffic would cost", and every column was suffixed `(est)`. That has not been true for agent sessions since the change above: those totals are the cost the provider actually billed. The copy now states that the values are AI credits rather than tokens, that agent totals come from the provider's own ledger with the rate table used only as a fallback, and that the input/output/cached split is apportioned from token counts.

- **Every agent row attributed 100% of its credits to Input.** Agent credit entries were pushed with `inputTokens: 0, outputTokens: 0, cachedTokens: 0`, which sends `computeSummary()` down its all-input fallback — so a Claude Opus row built from 27 input tokens and 1.13M cache reads rendered as Input 178.97 / Output 0.00 / Cached 0.00. The real token counts are now carried through, and since the split is scaled to `actualCredits` the total is unaffected. Vendor-prefixed ids resolve for this purpose (`azure-anthropic-foundry/claude-opus-4-7` → `claude-opus-4.7`); ids with no rate match keep the old fallback.

## [1.10.76] - 2026-08-02

### Fixed

- **The model catalog refreshed on a timer instead of on evidence of change.** The catalog is already a persistent, update-only-on-success store — it lives in `globalState`, hydrates synchronously at activation, survives restarts, and a refresh that returns nothing is discarded rather than overwriting the previous snapshot. What was missing is that `CATALOG_TTL_MS` drove refreshes purely by *age*: a snapshot taken at 09:00 counts as fresh all day, so a model GitHub enables at 14:00 stays unresolvable until tomorrow. That window is precisely where the v1.10.74 `claude-opus-5` mispricing came from, and no amount of caching can close it, because the cache is a snapshot of a set that grows without notice.
  - `notifyUnknownModel()` now forces an out-of-band refresh when `findModelRate()` reaches the family-fallback stage — i.e. when neither the live snapshot nor the static rate table could resolve an id. A miss is the only direct signal available that the snapshot predates a shipped model.
  - Debounced three ways so this cannot become a fetch storm: each id reports at most once per session, only one refresh runs at a time (`runRefresh()` now guards the activation path too), and a snapshot younger than 15 minutes is trusted as-is. The age guard is also what keeps permanently-unresolvable local/BYOK ids (`ollama/…`, `local-…`) from retriggering fetches — they are never in CAPI, so a refetch would never resolve them.
  - Respects the `copilotUsage.aic.useOnlineModelCatalog` kill switch: disabling it clears the stored context, so misses trigger nothing at all.

### Added

- `tests/verify-catalog-miss-refresh.js` — pins the debounce rules with a counting `fetch` stub and no network: no refresh before load, none against a fresh snapshot, none for an unresolvable local id, one forced refresh against a 20-minute snapshot, no second refresh for a repeat id, previous rates surviving a failed refresh, and no refresh at all when the kill switch is off.

## [1.10.74] - 2026-08-02

### Fixed

- **"Non-billable models (informational)" panel ignored the selected date range.** Every other table in the AIC card is filtered by the range picker (`byDay` for the calendar, session aggregation for the model breakdown), but the non-billable panel rendered `aic.nonBillable.byModel` verbatim — a whole-billing-cycle aggregate. Selecting *Last 7 days*, *Yesterday*, or a past month left the panel (and its "Non-billable total") showing full-cycle numbers next to range-filtered billable numbers, so the two tables silently disagreed about the window they covered.
  - `CreditSummary.nonBillable` now carries `byDay` (day → model → `CreditUsage`), populated in the same `computeSummary` loop that fills `nonBillable.byModel`, so the two reconcile exactly by construction.
  - `AICDashboardData.nonBillable.byDay` flattens it to serializable `{ day, model, tier, …credits }` rows, and `renderAIC` re-aggregates them against the active `bounds` — same filter the calendar and daily totals use. `byModel` is kept as a back-compat fallback for cached payloads that predate `byDay`.
- **`claude-opus-5` was misclassified as a non-billable model, priced with the wrong rate, and badged `base`.** It was missing from `DEFAULT_MODEL_COSTS`, so whenever the live CAPI catalog was unavailable (kill switch off, stale 24h cache, failed refresh, or a model newer than the last catalog fetch) `findModelRate()` returned `null`. Three separate things then went wrong at once: `calculateCredits()` fell back to gpt-4.1 rates (200/800 instead of 500/2500), the tier defaulted to `base` instead of `premium`, and — worst — `isKnownGHCModel()` returned `false`, which sent every `claude-opus-5` request lacking a `copilotUsageNanoAiu` field into the "Non-billable models (informational)" panel. That is where the `claude-opus-5 — base — 0.00` row came from, sitting directly beneath a `claude-opus-5 — premium — 1394.53` row in the billed table.
  - Added the models the live catalog lists but the offline table lacked: `claude-opus-5` (500/2500, premium) and `grok-4.5` (200/600, base).
  - **Family fallback in `findModelRate()`** — a hardcoded table cannot keep pace with GitHub's release cadence, so an unmatched id now inherits the newest rate from its own family before being declared unknown: `claude-opus-6` → `claude-opus-5`, `gpt-5.7-codex` → `gpt-5.3-codex`, `gemini-4.0-flash` → `gemini-3.6-flash`, `gpt-5.9-mini` → `gpt-5.4-mini`. The observed id is preserved for display, only the rates and tier are borrowed. Every model GitHub ships between extension releases is therefore priced approximately right and, critically, stays *billable* instead of being dumped into the informational panel.
  - The fallback requires a version tail, and permits a bare integer tail only when the family has two or more segments — so short BYOK aliases (`gpt-4`, `gpt-5`, `claude`) and local ids (`ollama/qwen2.5-coder:7b`, `local-llama-13b-q4`) still resolve to `null`, preserving the provider guard from v1.10.x.
- **Zero-credit rows in the non-billable table.** With the resolution bug above fixed, a genuinely zero row can still occur (a cancelled turn that reports no tokens). Rows below `0.005` credits are now dropped from display; they remain in the underlying data so totals are unaffected.

### Added

- **`tests/verify-nonbillable-range.js`** — pins `sum(nonBillable.byDay) === nonBillable.totalCredits`, that a single-day range yields a strict subset of the cycle total, that an unbounded range reproduces it, and that zero-credit rows stay in the data but out of the rendered table.
- **`tests/verify-model-family-fallback.js`** — pins that `claude-opus-5` / `grok-4.5` resolve from the offline table, that six unseen point releases inherit the right family rate and tier while keeping their own display name, that the five short-alias/local ids still fail to resolve, that an unseen release classifies as billable while `ollama/*` does not, and that family rates (not gpt-4.1 defaults) are what price real traffic.

## [1.10.73] - 2026-08-02

### Changed

- **All Sessions table — new `Cost` column and compressed `Summary` cell.** Each session now shows its cost as `$X.XX` (computed from `aicCredits × overageCostPerCredit`, same rate the hero uses), placed right after `AI Credits`. Summary cell was capped at `max-width: 260px` with single-line ellipsis on both title (≤60 chars) and prompt preview (≤80 chars); the full untruncated text is preserved on the cell's `title` attribute, so hovering still reveals everything. Font sizes dropped to 12/11 px and margins tightened to keep rows visually compact.

## [1.10.72] - 2026-08-02

### Changed

- **Legend under the period donuts is now a single currently-active model.** The 1.10.70 last-ditch fallback seeded the legend from every entry in `data.ranges.daily.byModel`, so idle-OTel + unbuilt-cs sessions listed historical models like `claude-haiku-4.5` / `gpt-5.6-sol` alongside `claude-opus-4.7`. Fallback now takes only the top model from the daily range; everything else folds into the neutral "other" grey, matching the same "currently active" scope the OTel and cs paths already use.

## [1.10.71] - 2026-08-02

### Fixed

- **Model legend under the period donuts overflowed the tooltip width.** The cells were joined with `&nbsp;·&nbsp;` (non-breaking) so nothing in the row could wrap; long legends stretched the hover well past 220 px. Each cell is now wrapped in a `white-space:nowrap` span (keeps the colored bullet glued to its model name), and the separators are plain ` · ` so the row can break between cells and flow onto multiple lines when needed.

## [1.10.70] - 2026-08-02

### Fixed

- **Period donuts (DAILY / WEEKLY / THIS MONTH) rendered as solid grey with no legend when OTel was silent and the debug-log `currentSession` had not built yet.** `buildActiveModelLegend` had two sources (`otel.byModel`, `cs.model`); with both empty the legend was empty, so every slice folded into the neutral "other" grey and no color-key was shown. Added a last-ditch fallback that seeds the legend from `data.ranges.daily.byModel`, so the donuts stay colored (and a legend row appears) whenever there is any period activity to show.

## [1.10.69] - 2026-08-02

### Fixed

- **Status-bar item stuck on the idle `$(dashboard)` icon even when the sidebar showed a live Session AIC for this window.** The idle-vs-active gate in `updateStatus` only checked `otel.requests > 0` and `currentSession`. When the OTLP receiver on port 14318 is held by another VS Code window (see the dashboard's Live OpenTelemetry warning), `otel` is empty here; if the debug-log-derived `currentSession` metadata also hasn't finished building yet, the item fell through to the idle branch even though `data.currentSessionAIC` was non-zero. Gate now also lets `currentSessionAIC > 0` promote to active, so the item renders `$(zap) $X.XX` in lock-step with the sidebar.

## [1.10.68] - 2026-08-02

### Fixed

- **Status-bar Snapshot `Tool calls` was hardcoded to 0.** Both the OTel path and the debug-log fallback in `updateStatusBar` set `toolCalls: 0` inline. Now the count is derived from `scan.toolCalls` filtered by the `(sessionId, turnIndex)` pairs of turns active in this VS Code window (post-activation, on-or-after AIC start) — the same instance-scope rule used for tokens and credits — and shared between both paths so the value never depends on which data source rendered first.

## [1.10.67] - 2026-08-02

### Changed

- **Status-bar hover width tuned to 220 px.** Progress bars shrunk from 280 → 220 px so the hover matches the Snapshot table's natural content width. The right-aligned value column now reads flush with the tooltip's right edge instead of floating mid-card. Snapshot itself is a single-pair-per-row native Markdown table (`|:--|--:|`) — no HTML, CSS, or fixed padding.

## [1.10.66] - 2026-08-02

### Added

- **Rich status-bar hover — full visual redesign.** The hover tooltip is now a `vscode.MarkdownString` with `supportThemeIcons` + `supportHtml` + `isTrusted` rather than the plain-text `\n`-joined string it used to be. Layout is dashboard-style: headline (`Copilot Usage · Session $X.XX`) with adaptive stage badge, three side-by-side **SVG donut charts** for DAILY / WEEKLY / THIS MONTH periods with a shared model→color legend under them, progress-bar cards for **Daily limit / Requests / Cache reuse**, and a responsive native Markdown Snapshot table containing session AIC / last request / cache hit (session) / cache hit (cycle) / model / turns · duration / tool calls / session id / workspace total. Every existing datum from the old text tooltip is preserved. Idle state gets the same treatment.
- **Cache hit rate as a first-class metric across four surfaces.** New `src/cache.ts` module owns the formula and tier thresholds so every UI can never disagree again (see refactor note below). The metric now appears in: (1) dashboard hero row — new green `Cache Hit` KPI card between `Overage` and `Daily Pace` with sub-text `X.XM cached / Y.YM prompt`; (2) dashboard `Live OpenTelemetry` stats-row — new `Cache Hit · X.X%` KPI + new `Hit %` column in the by-model table; (3) dashboard `All Sessions` table — new `Cache %` column per session; (4) status-bar tooltip — new `Cache reuse` bar card + `Cache hit (session)` / `Cache hit (cycle)` rows in the Snapshot table; (5) sidebar Breakdown — new prominent `Cache Hit Rate (cycle)` card right after `Total Credits (cycle)`, using the same `.big` bold styling as Total Credits.
- **Model context-window plumbed from CAPI.** `ModelCatalogEntry.contextMax` now captures the model's true input ceiling from CAPI's `billing.token_prices.long_context.context_max ?? default.context_max`. Exported `getContextMaxFor(modelId)` lookup helper. Not yet wired into any UI (deferred pending user decision on utilization-bar design) but the data is now available.
- **`Tool calls` row** back in the tooltip's Snapshot table (was in v1 plain-text tooltip, dropped during first redesign).
- **`Session AIC (session)` vs `Cache hit (cycle)` disambiguation.** Header now reads `Copilot Usage · Session $X.XX` with an explicit muted `· Session` scope tag so the headline dollar amount can't be confused with the workspace-wide DAILY / WEEKLY / THIS MONTH donut totals below.
- **"Resets in Xh Ym" caption on the daily-limit progress bar.** Computed from local midnight so users see how long until the daily counter clears.

### Changed

- **Cache-hit-rate formula centralized in `src/cache.ts`.** Rationale: between v1.10.53 and v1.10.58 we shipped two consecutive cache-hit bugs caused by the formula and its data source living in 5+ places. `computeCacheHit(prompt, cached)` and `tierLabel()` are now the single source of truth. Extension-host callers import it directly; the webview (sandboxed, can't `import`) receives **pre-computed** `cacheHitPct` fields on `LiveOtelData`, `LiveOtelData.byModel[i]`, and `SessionView` so it never touches the arithmetic. Only exception: dashboard hero range-aggregate is user-selectable at render time and stays inline with a big pointer comment to `cache.ts`.
- **"THIS MONTH" is now the current calendar month**, not a 30-day rolling window. Aggregator switched from `today − 29 days` to `new Date(year, month, 1)` for the period start so on Aug 2 the donut shows Aug 1 → Aug 2, not Jul 4 → Aug 2. Matches user expectation for the label.
- **Snapshot uses Copilot's native responsive table pattern.** Two label/value pairs per row give the table enough intrinsic content to use the hover width, while Markdown `--:` alignment right-aligns both value columns. No fixed pixel width, padding characters, or sanitizer-sensitive layout CSS is used.
- **Section separators in tooltip.** Horizontal rules (`---`) separate the logical groups (donut row + legend, Daily limit, Requests, Cache reuse, Snapshot).
- **Compact Requests card.** Header now reads `$(zap) Requests · N · X.YM tok · $(database) log`, then a slate progress bar, then `in X.YM · out X.XK` on the third line. Was previously a long ragged one-liner that wrapped inline with the SVG bar.
- **Debug-log fallback for tooltip cards.** When OTel is silent (port 14318 held by another window), the Cost-by-model donut and Requests card synthesize from `cs.model / cs.turns / cs.prompt / cs.output` so the tooltip still renders meaningfully. Cache-reuse card intentionally stays OTel-only — debug logs don't carry cached-token counts.
- **Sidebar cycle scope aligned to billing cycle.** Was filtered by `AIC_EFFECTIVE_DATE` (all-time since AIC launched); now filtered by `dashData.aicSummary.billingCycleStart..billingCycleEnd`, matching the dashboard hero's cycle window and the tooltip's `Cache hit (cycle)` row.
- **Sidebar cache aggregation switched to per-session.** Was iterating `scanTurns` and summing `debugPromptTokens/debugCachedTokens` per turn — drifted ~0.3 % from the dashboard because sessions spanning the cycle boundary were counted whole by the dashboard but only partially by the sidebar. Now iterates `dashData.sessionsAll` and sums `actualPrompt / actualCached`, matching the dashboard hero and `computeCycleCacheHit()` exactly.

### Fixed

- **Cache-hit formula was under-reporting by ~2x** (bug shipped in 1.10.53, fixed in 1.10.56). Was `cached / (prompt + cached)` — but Copilot's `prompt_tokens` counter already includes cached reads as a subset (see [aicCredits.ts:452](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/aicCredits.ts)), so the naive form double-counted the denominator. Users seeing "49.9%" when their actual reuse was 99.5% traced the bug for us. All five surfaces corrected to `cached / prompt`.
- **Three surfaces showing three different cache-hit numbers for the same conceptual metric** (bug shipped in 1.10.57, fixed in 1.10.58 + 1.10.61). Dashboard read `dashData.liveOtel.prompt/cached`; tooltip read `receiver.getStats()` (raw OTel — missing debug-log overlay when port 14318 held by another window); sidebar filtered by `AIC_EFFECTIVE_DATE` (all-time). Threaded `liveSessionPrompt / liveSessionCached` from `dashData.liveOtel` into `StatusBarData` so the tooltip's `Cache hit (session)` matches the dashboard's `Live OTel Cache Hit` KPI; switched sidebar to cycle-scoped per-session aggregation matching the dashboard hero and `computeCycleCacheHit()`.
- **Dashboard "Live OTel by Model" table overflowed and clipped the AIC column.** Shortened four column headers (`Requests → Reqs`, `Trace Cache → Trace`, `Metric Cache → Metric`, `Effective Cache → Cached`), wrapped the table in a new `.table-scroll` container with `overflow-x:auto`, and added `white-space:nowrap` on `th` and `.num` cells. AIC column is now always reachable — either directly (headers small enough) or via inline horizontal scroll.
- **`Session` short-id row was missing from Snapshot** after the markdown → HTML table conversion. Restored (`<code>instance…</code>`).
- **Duplicate work in tooltip render:** `computeCacheHit()` was called twice with identical inputs (once for the Cache reuse card, once for the Snapshot row). Hoisted so it runs once and both surfaces consume the same result.
- **Requests card no longer overflows the tooltip width.** Blank paragraph breaks now separate header, SVG bar, and in/out footer so the bar doesn't flow inline with adjacent text and the "out N.NK" no longer wraps below awkwardly.
- **Model legend under period donuts lists only currently-active models.** Was showing stale historical models (e.g., `claude-opus-4.6 · claude-haiku-4.5`) pulled from the 30-day byModel union. Now derives from OTel `byModel` first, `cs.model` fallback; historical-only models still show as slices in the donuts but fold into a neutral grey "other" slice the legend names explicitly.
- **Bottom hint text no longer forces the tooltip wider.** Shortened from `Dashboard AIC cards show billing-cycle totals across sessions.` (66 chars) to `Cards = billing cycle totals` (28 chars).
- **Snapshot spacing no longer depends on stripped HTML/CSS.** Replaced the collapsing two-column layout with the same native multi-column Markdown table approach used by Copilot's own status hover.

### Removed

- **Two dead helpers** in [src/statusBar.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/statusBar.ts): `topModels()` and `csFallbackModel()`. Left over from the abandoned single-donut "Cost by model" card that got replaced by the DAILY / WEEKLY / THIS MONTH donut row (~40 lines).

## [1.10.47] - 2026-07-31

### Changed

- **Daily AI Credit Limit Guard is now OFF by default.** `copilotUsage.dailyLimit.enabled` default flipped from `true` to `false`. Fresh installs no longer show the status-bar countdown, mascot overlay, or install `~/.copilot/hooks/` unless the user explicitly opts in via Settings. Existing users' saved preference is preserved.
- **Dashboard bento layout.** AI Credits billing card (with its inner `AI Credits By Model` + `Daily Credits` calendar) now occupies an 8-column right tile, with the secondary meters (`More Details`, `Live OpenTelemetry`) stacked in a 4-column side rail on the left. Below 1100px viewport the row collapses to a single stacked column. Zero data drift — same section IDs, same JS rendering.
- **Filter bar inline with title.** Title and filter dropdowns share one top row instead of stacking vertically. Body top padding tightened so the dashboard reads higher on first paint.
- **Hero and stat card layout unified.** Every tiled KPI (hero row, `More Details`, `Live OpenTelemetry`, AI Credits KPIs, overage row) uses the same 2-column grid: label + sub on the left, number centered in a reserved right column with `minmax(140px, 42%)` for hero and `minmax(120px, 40%)` for stat cards. Numbers no longer clip; labels no longer truncate with `...`.
- **Typography audit — Space Grotesk sitewide.** Space Grotesk (Google Fonts, weights 400/500/600/700) applied to `body` with tabular numerals and stylistic set 1 enabled. Chart.js `defaults.font.family` also set so every chart tick, label, legend, and tooltip renders in the same font — By Project, By Tool, By Subagent, By Model, Daily Token Usage, and Hourly Distribution.
- **Font-size and font-weight bump across the whole dashboard.** Root cause of "faint" text: dark-theme `--muted` was `#8b949e` on `#0d1117` — low contrast. Brightened to `#a8b1bb` (dark) and darkened to `#5a544f` (light). Sizes bumped 1–2px on labels, subs, table cells, insight captions, notes, expander summaries, chart headings; weights bumped from 400/600 to 500/700 on labels. Section titles and chart headings promoted from muted → `--fg` for proper heading contrast.
- **README trimmed** from 159 lines to 27 lines. Install, open command, five essential settings, license.

### Added

- **[ARCHITECTURE.md](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/ARCHITECTURE.md).** New file containing the full technical reference previously buried in the README: data source paths per platform, JSONL parsing internals for `kind=0/1/2`, `main.jsonl` / `runSubagent-*.jsonl` / `title-*.jsonl` handling, Oh My Pi + Pi source integration, OTel auto-config, AIC configuration + plan defaults + custom model costs + credit formulas, Daily Limit Guard complete settings reference, agent-hooks section, features summary. Linked from README under `Configure`.
- **Per-project cost in Breakdown → By Project.** Each project bar now shows its dollar cost `$XX.XX` in orange bold at the right edge of the chart, painted by a Chart.js `afterDatasetsDraw` plugin with `layout.padding.right: 82` reserved so it never overlaps the bar. Tooltip footer shows `Credits: X.X · $Y.YY` on hover. A summary insight strip below the chart lists total spend for the range plus the top 3 projects by cost, using the same `overageCostPerCredit` rate as the AIC billing card.

### Fixed

- **Sidebar Breakdown value overflow.** `.bar-row` grid was `90px 1fr auto` — the fixed 90px label + `min-width: 60px` value column together pushed numbers past the sidebar right edge on narrow sidebars, clipping values like `23,712` to `23,7`. Changed to `minmax(0, 1fr) minmax(16px, 56px) auto` with `min-width: 0` on labels/tracks/card and `white-space: nowrap` + `padding-left: 4px` on values. Numbers now show fully at any sidebar width; labels truncate cleanly with existing ellipsis.

## [1.10.33] - 2026-07-29

### Fixed

- **`Usage by Source` table now reconciles with the hero total.** After v1.10.32 aligned the hero with the sidebar via `aic.byDay`, the per-source table's `VS Code (range)` cell still used the old session-only sum, so VS Code + OMP + Pi + CLI came out ~1,600 credits below the hero (that gap = today's live OTel overlay credits, which aren't tied to any single chat session). VS Code cell now shows the residual `rangeAicTotal − OMP − Pi − CLI` — same definition as `agentSummary.vscodeAicCredits` in [dashboardData.ts:1506](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/dashboardData.ts). Applied only when the range is cycle-aligned (`This Month` / `All Time`) so it doesn't over-subtract cycle-scoped agent totals from a shorter window.
- **`Total` column of `Usage by Source` now shows a number instead of em-dash on `This Month`.** The mixing concern only applied when VS Code was range-scoped and agents were all-time-scoped; with the residual VS Code definition on cycle-aligned ranges, the sum is well-defined and matches the hero.

## [1.10.32] - 2026-07-29

### Fixed

- **Sidebar and dashboard totals now reconcile.** The dashboard hero `AI Credits Spent` card and the `AI Credits (AIC) → Total Credits` tile were both computing their number as `sessions.reduce(aicCredits)` from `sessionsAll`, which contains only VS Code chat sessions. That silently dropped every credit sourced from live OTel overlay, OMP, Pi, and Copilot CLI — while the sidebar was already summing the authoritative all-source `aicSummary.totalCredits`. Result: the two panels showed different cycle totals (e.g. sidebar 83,014 vs dashboard 81,273.5) even though they receive the identical `DashboardData` payload in the same tick.
- **Dashboard `Projected` cards now match the sidebar's pace projection** for the default `This Month` range. Previously they used a mixed-basis formula (`aic.totalCredits + rangeDailyAvg × daysRemaining` where `rangeDailyAvg` was derived from VS Code sessions only). On the `tm` range they now use `aic.projectedTotal` directly, same as the sidebar.

### Notes

- Fix uses `aicSummary.byDay` (already all-source: VS Code turns + live OTel overlay + OMP + Pi + CLI) as the authoritative per-range credit map, with session aggregation as a fallback for closed periods where `byDay` is empty (past months). The per-day calendar, daily-token chart, and sidebar sparkline are unchanged — only the totals on top of them.

## [1.10.31] - 2026-07-29

### Fixed

- **Modernized CAPI request headers.** v1.10.30 correctly parsed `billing.token_prices.default.*_price` but was still seeing 0/38 rates in production. Root cause: our request advertised `Editor-Version: vscode/1.85.0` (Dec 2023), and GitHub CAPI serves a legacy `/models` schema without `token_prices` to old clients. Updated to `vscode/1.95.0` + added `Editor-Plugin-Version`, `X-GitHub-Api-Version`, `OpenAI-Intent` headers so we get the same modern response the built-in Copilot Chat receives.
- **Added targeted rate-miss diagnostic.** If rates still can't be parsed, one log line dumps the raw `billing` block of a sample model — makes any future schema drift instantly visible.

## [1.10.30] - 2026-07-29

### Fixed

- **CAPI pricing schema corrected.** v1.10.28's rate parser guessed the field path (`billing.price`) but the real CAPI response nests rates under `billing.token_prices.default.{input_price,output_price,cache_price,cache_write_price}`. Result: `parsed per-1M rates for 0/38 CAPI models` in production. Now reads the real path and picks up rates for every model that has a `default` price block.
- **Billability signal rebuilt.** CAPI dropped `billing.multiplier` and `billing.is_premium` entirely. The old `billable = multiplier > 0` check was silently marking every model non-billable. Now derives billability from `token_prices.default.input_price > 0` and premium tier from `model_picker_price_category` (`high` / `very_high` → premium).
- **Live-estimate multiplier derived from rates.** Since CAPI no longer publishes a per-prompt multiplier, `ModelCatalogEntry.multiplier` is now computed as `max(0.25, input_price / 250)` (gpt-4o baseline = 1×). CLI ledger's `session.shutdown.modelMetrics` remains authoritative when present — the multiplier only estimates in-flight sessions.

### Removed

- v1.10.29's schema-probe diagnostic (its job is done — real schema is now hardcoded).

## [1.10.29] - 2026-07-29

### Changed

- **Improved CAPI schema diagnostic.** v1.10.28's probe only fired when at least one entry had a `billing` field. Real-world CAPI responses (business plan, `api.business.githubcopilot.com`) return 38 models with `billing` completely absent, so the log stayed silent. The probe now dumps the first entry unconditionally and reports how many entries carry a `billing` block — giving us the raw shape needed to locate whatever pricing field CAPI actually uses.

## [1.10.28] - 2026-07-29

### Added

- **Dynamic per-model pricing from the Copilot CAPI catalog.** The extension already fetches `/models` from the Copilot API to determine billability; it now also parses `billing.price` (with defensive fallbacks for `rates` / `pricing` and multiple field-name spellings) into per-1M input / output / cache-read / cache-write rates. `AICCalculator.findModelRate()` consults the live catalog first and falls back to `DEFAULT_MODEL_COSTS` only when the catalog is unreachable or missing rates for a model. Any new model GitHub adds to CAPI is now priced correctly at the next 24 h refresh with zero code changes.
- **Six missing models added to the static fallback table:** `claude-sonnet-5`, `gpt-5.6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gemini-3.6-flash`, `mai-code-1-flash`. Previously these fell through to the GPT-4.1 default rate (200 in / 800 out per 1M), silently misestimating credits.
- **Diagnostic CAPI schema probe** — one log line in `fetchCapiModels()` dumps the first entry's `billing` block on refresh so we can confirm the real field names.

### Changed

- **`FALLBACK_MULTIPLIERS` in `cliScanner.ts` removed** (18 hardcoded entries). `multiplierFor()` is now: live catalog multiplier → rate-derived multiplier → 1.
- **`KNOWN_MULT` constant in the webview removed.** The dashboard now reads `DATA.modelMultipliers`, a live snapshot pushed from the extension side via `buildDashboardData()`.
- **Hyphen↔dot key normalization in `classifyByCatalog()`** — CAPI publishes `claude-haiku-4.5` but OTel and CLI logs report `claude-haiku-4-5`. Both forms now resolve.

## [1.10.27] - 2026-07-04

### Fixed

- **CRITICAL: v1.10.26 dashboard rendered completely blank.** The `Usage by Source` column-header title attributes added in v1.10.26 contained `doesn\'t` — a backslash-single-quote sequence that TypeScript's template-literal processor stripped to `doesn't`, producing literal `'...doesn't...'` in the emitted webview JS. The unescaped apostrophe terminated the string, syntax-erroring the entire script and leaving the dashboard blank. Replaced with `does not`. Extension activation, scanning, and sidebar continued to work throughout — only the main dashboard webview was affected.

## [1.10.26] - 2026-07-04

### Changed

- **Redesigned hero cards** — replaced the duplicate `Tokens Processed` and `Activity` cards (which mirrored More Details tiles) with money-focused KPIs: `AI Credits Spent`, `Overage`, `Daily Pace`, `Projected`. Every value is range-scoped and consistent with the rest of the page. Sessions/turns/tokens folded into subtitles or the Usage-by-Model TOTAL row.
- **Usage-by-Model TOTAL row** — new bottom row sums all per-model rows. Its `AI Credits` cell MUST equal the hero `AI Credits Spent`; the two are computed from the same `Σ session.aicCredits` formula. Any future divergence between them signals a bug.
- **Usage by Source column headers annotated** — each source column now shows `(range)` or `(all time)` inline so users can see at a glance which columns respect the Range filter and which don't (VS Code is range-filtered; OMP / Pi / CLI are all-time until those scanners expose per-date data).
- **Mirrors / Transcripts labeled as diagnostics** — kept in More Details but sub-text now says "diagnostic" so users know these are internal scanner metrics, not user-actionable KPIs.

## [1.10.25] - 2026-07-04

### Fixed

- **Usage by Model table showed wrong AI Credits** — the AI Credits column joined session-primary-model rows against `aicSummary.byModel` (which keys on API-called model, not session-primary-model), so credits from cross-model activity within a session (title generation on gpt-4o-mini, subagents on claude-haiku, model-change turns) were displayed against the wrong row (~83-credit visible drift in the user's report). Now sums `session.aicCredits` per session-primary-model — the column reconciles exactly with the hero "AI Credits Spent" total. Rows now sort by credits descending.

## [1.10.24] - 2026-07-04

### Added

- **Range-aware dashboard** — all AIC metrics, calendar, model breakdown, and Usage-by-Source cards now recompute when the Range dropdown changes (previously the KPIs updated but the AIC billing section stayed pinned to the full billing cycle). Default range is now `This Month`.
- **Month picker (Jan–Dec)** — new option group in the Range dropdown lets users jump straight to any calendar month; auto-detects year (current year, or previous if month hasn't occurred yet).
- **Session-derived daily heatmap** — calendar now aggregates per-day credits from filtered sessions so historical months (June, Prev Month, etc.) display real activity instead of an empty grid. The current cycle still prefers the authoritative per-request `aic.byDay` when present.
- **Range-scoped overage** — overage dollar amounts (with promo / without promo / promo savings) are recalculated from the range-filtered credit total instead of the static current-cycle values.

### Fixed

- **Scanner missing `session_start` fallback** — debug-logs that continue across a VS Code reload no longer re-emit `session_start`, which previously caused `parseDebugLogLines()` to drop the entire log (silently under-counting by up to ~50% in one real-world sample: 6,135 credits lost from a single 244 MB log). The parser now extracts `sid` from any entry type when `session_start` is missing.
- **Historical-range daily average** — was computed from `aic.byDay` (current cycle only), which for past months made `rangeDaysCount` collapse to 1 and inflated Daily Avg to equal the full-period total. Now derived from a per-session day map keyed by `lastDate`.
- **Projection & runway on closed periods** — hidden (or labeled `closed period`) when the selected range doesn't include today. Previously "Prev Month" would show nonsensical projections based on the closed period's pace applied to remaining current-cycle days.
- **AIC model table split columns** — historical ranges render `—` for input/output/cached credit split cells (that per-request split only exists in the current cycle's `aic.byModel`) instead of misleading `0.00` alongside real totals.
- **Misleading "Input Credits" KPI** — replaced with **Prompt Tokens** (exact from sessions) instead of the previous `rangeTotal × (aic.inputCredits / aic.totalCredits)` ratio approximation.
- **Range boundaries used UTC ISO dates** — `getRangeBounds` now formats dates in local time, matching the calendar's existing local-Y-M-D convention and preventing off-by-one shifts for users east of UTC.
- **Usage by Source `Total` column** — showed a misleading total mixing range-filtered VS Code data with all-time OMP/Pi/CLI data. Now displays `—` with an explanatory tooltip when any range other than All Time is selected.

### Changed

- **VSIX slimmed** — `.vscodeignore` now excludes `tests/`, `.agents/`, `.claude/`, `.fallow/`, `from_Chris/`, `eslint.config.mjs`, `repo.config.json`, and `apply-repo-config.js`. Published VSIX is 349 KB (28 files) — no dev artifacts, no analysis scripts, no auxiliary workspaces.

## [1.10.16] - 2026-06-26

### Fixed

- Copilot-routed opaque resolved IDs such as `capi-*` and `capui-*` are now treated as billable unless explicitly excluded or marked non-billable by CAPI.

## [1.10.15] - 2026-06-24

### Fixed

- OMP and Pi AIC now use `usage.cost.total` when present, with token-rate fallback for older sessions.
- Known Copilot model names are no longer demoted by BYOK/user-config aliases.
- Non-Copilot OMP/Pi providers remain non-billable and display with provider-qualified names such as `azure-foundry/claude-sonnet-4-6`.
- Short local model names such as `gpt-4`, `gpt-5`, and `claude` no longer match longer Copilot rate-table ids.
- Copilot CLI shutdown `totalNanoAiu` is now the authoritative AIC source; `requests.cost` is only a legacy fallback.
- Copilot CLI source totals recover from zeroed live multipliers and no longer show `0.00` when billable prompts or shutdown AIC exist.
- Model aliases such as `gpt-5.5` and `gpt-5.5-2026-04-23` now merge into one billing-model row.
- Usage by Source table text is slightly larger for readability.

### Added

- Regression coverage for CLI `totalNanoAiu`, BYOK alias demotion, provider-qualified non-billable rows, model alias merging, and CLI zero-AIC recovery.

### Changed

- `CatalogLookup` can report `source: "capi" | "user-config"` so CAPI verdicts and BYOK alias hints can be handled separately.

## [1.10.14] - 2026-06-23

### Fixed

- **`AIC (SESS)` no longer drops to `0.00` when GitHub-billed models also have a BYOK alias** — the `dashboardData.ts` post-processor was passing a hardcoded `hasActualCredits=false` to `classifyModelBillability()` for every live OTel byModel row, so when a user's `chatLanguageModels.json` listed an id under a third-party vendor (e.g. Copilot Chat itself surfacing its Anthropic-backed routed models with `vendor: "anthropic"`, or a real BYOK Anthropic key for `claude-opus-4.7`), the classifier demoted the Copilot-billed row to non-billable and the headline session total was stripped to zero — even though the per-model table right below it kept showing real billed credits (e.g. screenshot reported `gpt-5.3-codex` = 12.07 AIC and `claude-opus-4.7` = 58.89 AIC summing to 70.96, but `AIC (SESS)` rendered as 0.00). Now every byModel row carries a `hasActualCredits` provenance flag (`true` iff at least one contributing request supplied a `copilotUsageNanoAiu` or `debugAicCredits` value) and the classifier uses it as the strong "GitHub already billed it" signal that overrides BYOK / third-party catalog demotions. Complements the `classifyByCatalog()` precedence fix in `src/modelCatalog.ts` (CAPI `billable: true` wins over BYOK alias) — either signal is sufficient to keep a billed row counted.
- **Status bar tooltip always shows the session AIC line** — previously `if (data?.currentSessionAIC) { ... }` hid the `AI Credits (session total)` row whenever the value was exactly `0.00`, which made the demotion bug above invisible (users only saw `last request` and concluded the dashboard was broken). The line now renders unconditionally with `.toFixed(2)`, and when any byModel rows were classified informational the tooltip appends `(+X.XX informational excluded)` so the gap between the session total and the per-model table sum is explicit instead of mysterious.
- **Dashboard `AIC (sess)` tile annotates informational exclusions** — mirrors the status-bar tooltip: when `liveOtel.informationalAIC > 0`, the tile's subtitle reads `session total · +X.XX informational` instead of just `session total`, so the discrepancy with the byModel table below is visible without reading the tooltip.

### Added

- **`tests/verify-byok-billable-regression.js`** — 7 assertions pinning the v1.10.14 behavior: simulates the user's screenshot scenario (`claude-opus-4.7` + `gpt-5.3-codex` with BYOK Anthropic in `chatLanguageModels.json`) and asserts `sessionAIC === 70.96` after reclassification (was `0.00` in v1.10.13). Also pins the inverse: `hasActualCredits=false` rows still get demoted by BYOK catalog, Ollama stays non-billable, and `excludeModels` still wins even over `hasActualCredits=true` (user's explicit override).
- **`LiveOtelData.informationalAIC`** — new top-level field exposing the sum of `aicCredits` across byModel rows the classifier marked non-billable. Consumed by `dashboardPanel.ts` and `statusBar.ts` to render the "informational excluded" annotation. Internal-only data shape change — the wire format with downstream consumers is unchanged.

## [1.10.13] - 2026-06-23

### Added

- **GitHub Copilot CLI (`@github/copilot`) usage tracking** — new `cliScanner.ts` walks every session under `${COPILOT_HOME ?? ~/.copilot}/session-state/` (both new `<uuid>/events.jsonl` and legacy flat `<uuid>.jsonl` formats) and contributes to the shared AIC budget. Uses a hybrid live-walk + ledger strategy because **neither signal alone is sufficient**:
  - **Live walk** — counts `user.message` events attributed to the current model (`assistant.message.data.model` is treated as the source of truth, not `selectedModel`, because the diagnostic in `tests/diagnose-copilot-cli.mjs` found two sessions where the user selected `claude-haiku-4-5` but `session.shutdown` showed `claude-sonnet-4.6` was actually billed). Slash commands (`/usage`, `/chronicle`, …) are filtered via a strict regex that rejects filesystem paths.
  - **Ledger fallback** — when the session emitted `session.shutdown`, the per-model `requests.cost` field is treated as authoritative and overrides the live estimate. Drift between the two signals is surfaced in the dashboard for diagnostics.
  - **Why both** — empirically, **4 of 8** sampled sessions had no `session.shutdown` event (crash, Ctrl-C, still-open) — a ledger-only implementation would silently lose ~50% of CLI activity. Live-only would miss `~5%` precision on clean sessions because it uses prompt-counts × multiplier rather than the CLI's actual billed cost.
- **CLI column in Usage by Source** (`dashboardPanel.renderAgentSessions`) — the per-source breakdown is now 5 columns (VS Code / Oh My Pi / Pi / Copilot CLI / Total) with reconciliation diagnostics shown below the table when CLI data is present (`N ledger-reconciled · M live-only · drift ±X.XX AIC`). `vscodeAicCredits` is now `summary.totalCredits − ompCredits − piCredits − cliCredits` so the columns always sum to the billing total.
- **Settings** — `copilotUsage.cli.enabled` (default `true`, kill switch) and `copilotUsage.cli.homePath` (override resolution; falls back to `$COPILOT_HOME` then `~/.copilot`).
- **Audit test suite** — `tests/verify-cli-scanner.js` (67 assertions, 4 parts: parser unit tests with synthetic events, de-dup regression against a tmpdir fixture, integration against the real `~/.copilot`, and cross-check against the independent `diagnose-copilot-cli.mjs` walk). Run via `C:\nodejs\node.exe tests\verify-cli-scanner.js`. The audit exercises 23 real sessions / 51 prompts / 8 ledger-reconciled / 15 live-only and verifies the scanner's all-time aggregates byte-for-byte against an independent re-walk.

### Fixed

- **Slash-command filter no longer drops filesystem paths** — `isSlashCommand` was `^\/[A-Za-z][\w-]*\b`, which matched `/usr/local/bin/node` because `\b` fires between `r` and `/`, causing user prompts that started with a path to be incorrectly skipped from billable counts. Now requires whitespace or end-of-string after the first token: `^\/[A-Za-z][\w-]*(?:\s|$)`. Found by `tests/verify-cli-scanner.js` A.1.
- **`session.model_change` now actually re-attributes the next prompt** — previously only updated `uiSelectedModel`, which is the *fallback* in the attribution chain. Because `lastAssistantModel` (set by the prior `assistant.message`) still won, an explicit user model switch had no effect until the *next* assistant response landed. Now `session.model_change` updates both signals so the very next `user.message` attributes to the new model — matching the user's intent. Found by `tests/verify-cli-scanner.js` A.3.
- **De-duplication of paired session formats** — `enumerateSessionFiles` now does mtime-based de-dup with a `Map<sessionId, Candidate>` and skips zero-byte legacy `.jsonl` siblings (real-world: 9 of 14 active session IDs in the audited vault existed in both forms). Latent double-count bug found during the audit pass; never reached production because all paired sessions had empty new-format files, but would have triggered the next time the CLI emitted to both.

### Notes

- The CLI scanner deliberately does **not** read `~/.copilot/usage.db` (it indexes VS Code chatSessions — the same source `scanner.ts` already reads, would cause double-counting) or `~/.copilot/session-store.db` (lazily populated by `/chronicle reindex`, carries no AIC field not already in `events.jsonl`).
- CLI credits flow through `creditEntries[].actualCredits` directly — bypassing the token-rate calculator — because GitHub Copilot CLI bills per *prompt × multiplier*, not per token. The same path OMP/Pi take when they already have a known credit value.
- **Hybrid totalAic semantics**: per-model, ledger wins where present, live fills the gap. A model that has live prompts but is NOT in the shutdown ledger (e.g. user picked haiku, GitHub silently re-routed to sonnet for billing) keeps its live estimate in the total — this *may slightly over-count* in silent-reroute scenarios. The `driftAic` field surfaces the delta so users can see when this happens; the choice favors visibility over silent absorption.

## [1.10.12] - 2026-06-23

### Added

- **Authoritative GitHub model catalog (CDN + per-plan CAPI).** New `modelCatalog.ts` fetches the same two Microsoft-published sources `vscode-copilot-chat` itself reads: the BYOK known-models manifest at `main.vscode-cdn.net/extensions/copilotChat.json` (informational) and the Copilot CAPI `/models` endpoint (authoritative billing). Cached for 24h in `globalState`; failures fall back silently to the existing rate-table heuristic. New hidden setting `copilotUsage.aic.useOnlineModelCatalog` (default `true`) as a kill switch.
- **Per-plan CAPI host resolution — no more hardcoded individual-tier endpoint.** The token response from `/copilot_internal/v2/token` already includes `endpoints.api` keyed to the user's SKU (`api.individual.…`, `api.business.…`, `api.enterprise.…` per `microsoft/vscode-copilot-chat`'s `TokenEnvelope`). The model-catalog refresh now reads that field instead of hardcoding the host, so Business and Enterprise users automatically hit the right CAPI without configuration. The refresh also walks the same scope-candidate list as `planDetector.ts` so any pre-existing silent GitHub session is reused.
- **Refresh on GitHub session change.** Subscribed to `vscode.authentication.onDidChangeSessions` (provider=github) — signing in, signing out, or switching between individual/business/enterprise accounts immediately re-fetches the catalog against the new account's CAPI host.
- **Third-party / BYOK / Ollama detection from the user's own VS Code config.** New `chatLanguageModelsParser.ts` (pure, no `vscode` import) parses `<UserDir>/chatLanguageModels.json`. Any model id whose `vendor` is **unambiguously** non-`copilot` (Anthropic BYOK key, OpenAI BYOK key, Ollama, LM Studio, …) is treated as non-billable by the classifier. Same id under multiple vendors → dropped (safe).
- **Runtime BYOK detection via `vscode.lm.selectChatModels()`.** Complements the JSON-file reader by enumerating every chat model currently registered with VS Code — catches BYOK API-key providers as soon as the user pastes a key, plus dynamically-discovered Ollama models that never make it into the persisted JSON file. Merged with the file source via `mergeThirdPartyMaps` (conflict-aware: same vendor in both → keep; disagree → drop). Subscribed to `vscode.lm.onDidChangeChatModels` so adding/removing a BYOK key triggers an immediate refresh — no window reload needed.

### Changed

- **CDN manifest is now informational-only.** Earlier work briefly used the CDN's `"copilot"` provider entry to mark models billable — but verification (`tests/verify-online-catalog.ts`) confirmed the CDN file lists **only** BYOK providers (OpenAI, Anthropic, Gemini, Groq, xAI). The classifier now ignores CDN-derived data for billability decisions and uses CAPI `/models` exclusively. Same id appearing in both BYOK list and Copilot billable set (e.g. `claude-opus-4-7`) no longer causes wrongful demotion.
- **`tests/verify-online-catalog.ts` simplified to CDN-only smoke test** with live HTTP headers (`date`, `last-modified`, `etag`, `x-azure-ref`, `x-cache`) and SHA-256 body hash so each run can be visibly proven to be a real network round-trip. CAPI verification is documented to happen in the "Copilot Usage" output channel inside the running extension — `gh` CLI's OAuth app is not in Copilot's allowed-OAuth-app list (returns 404 from `/copilot_internal/v2/token`), so standalone Node cannot reach CAPI.

### Tests

- `tests/verify-billable-classification.ts`: **8/8** (unchanged).
- `tests/verify-catalog-lookup.ts`: expanded from **9 → 19 assertions** — added coverage for parser, ambiguous-id rejection, runtime↔file merge agreement, and disagreement-drop.

## [1.10.11] - 2026-06-22

### Fixed

- **Per-plan monthly AI Credits corrected against official GitHub docs.** The defaults previously assumed every individual user gets a similar credit pool; this caused incorrect budget / overage / projection numbers for non-Business plans.
  - **Copilot Pro**: `1,000` → **`1,500`** (1,000 base + 500 flex).
  - **Copilot Pro+**: `7,500` → **`7,000`** (3,900 base + 3,100 flex).
  - **Copilot Max** (new, $100/mo): **`20,000`** (10,000 base + 10,000 flex). Added to plan defaults, settings enum, SKU detector, and manual picker.
  - **Copilot Free**: `250` retained as conservative placeholder (GitHub does not publish a specific credit allowance for Free; primary inclusion is 2,000 completions/month).
  - **Copilot Business / Enterprise** unchanged: `1,900` / `3,900` per user (pooled).

### Clarified

- **Promotional uplift scope.** The June 1 – September 1, 2026 promotional bump (Business `3,000`, Enterprise `7,000`) applies **only to existing Copilot Business and Copilot Enterprise customers**. Individual plans (Free, Pro, Pro+, Max) get no promotional bump. Settings descriptions, picker descriptions, and source-of-truth comments updated accordingly.

## [1.10.10] - 2026-06-15

### Fixed

- **Sidebar AIC dollars now match the dashboard under active PROMO budgets.** The sidebar breakdown now displays cycle overage dollars from the shared dashboard AIC summary instead of converting all consumed credits at face value.
- **Sidebar pace now uses projected cycle credits.** The pace badge, over-budget state, and projected overage amount now follow the same projected-budget logic as the full dashboard.

## [1.10.9] - 2026-06-15

### Fixed

- **`liveOtel.sessionAIC` can no longer exceed `aicSummary.totalCredits`.** The v1.10.7 combination of `Math.max(otelEstimate, debugTruth)` and `_sessionAICRatchet` (monotonic high-water mark) caused `sessionAIC` to permanently lock in over-estimated values, violating the invariant that session credits ≤ cycle credits (visible as `AIC (sess) 12.96 > AI Credits Spent 11.9`).
  - Removed `applySessionAICRatchet` and the `_sessionAICRatchet` map entirely.
  - Removed `Math.max(sessionAIC, debugSessionAIC)` — session AIC is now computed additively from authoritative sources only.
  - `sessionAIC` = Σ flushed debug-log `copilotUsageNanoAiu` + Σ rate-table estimates for unflushed OTel requests only.

- **OTel↔debug-log reconciliation rewritten with count-based per-model-family matching.** The previous per-model overlay (`exactByModelAiu` map summing `nanoAiu` per model key) was replaced with request-level deduplication via `unflushedOtelRequests()`:
  - Groups both OTel and debug-log requests by model family (via `modelFamily()` which strips version suffixes like `.6`/`.7` and date suffixes like `-2024.07.18`).
  - For each family: if debug log has N requests and OTel has M, the newest (M − N) OTel requests are "pending" — all others are considered already flushed.
  - Handles model version aliasing (OTel reports request model `claude-opus-4.6`, debug-log records response model `claude-opus-4.7`) without false double-counting.

- **Per-model `byModel` array in `liveOtel` now merges all three sources** (live OTel aggregates, exact debug-log per-request data, pending OTel estimates) instead of only iterating `liveStats.byModel.values()`. Models that appear only in debug logs or only in pending OTel now surface correctly.

- **`lastRequestAIC` uses individual request nanoAiu** instead of turn-total `debugAicCredits`. A 15-tool-call turn no longer shows the sum of all 15 API calls as "last request" — it shows the single most recent `llm_request`.

- **Child-log merging now accumulates `cachedTotal`** into the parent turn (was previously omitted, causing cache token under-count for subagent/title child logs).

- **Child-log requests update parent turn timestamps** (`lastRequestTs`, `lastRequestNanoAiu`, `timestamp`) so the parent turn correctly reflects the most recent API call across all child logs.

- **Credit entries iterate individual `debugRequests`** when available, attributing each `llm_request` to its own timestamp/date. Fixes UTC day-boundary drift where a multi-request turn spanning midnight would attribute all credits to the turn's latest timestamp.

- **OTel→credit-entry deduplication uses `unflushedOtelRequests()`** instead of the old model-set exclusion (`scanModelsToday`), preventing double-counting when the same model appears in both debug logs and live OTel.

- **`verify-dashboard-vs-api.js` assertions account for rate-table fallback turns** (turns with chatSession token counts but no debug-log `nanoAiu`). Previously these caused false assertion failures; now tracked separately as `fallbackCredits` and included in truth totals.

### Added

- **`DebugRequest` interface** (`src/scanner.ts`) — captures individual `llm_request` fields: `timestamp`, `model`, `prompt`, `output`, `cached`, `nanoAiu`.
- **`Turn.debugRequests?: DebugRequest[]`** — per-turn array of individual API calls, populated from debug-log parsing and child-log merging.
- **`LiveStats.requestLog: readonly OTelRequest[]`** (`src/otelReceiver.ts`) — full retained OTel request array exposed for request-level reconciliation.
- **`unflushedOtelRequests()`** — count-based per-model-family reconciliation function.
- **`modelFamily()`** — normalizes model names for fuzzy matching (strips versions/dates).
- **`debugRequestsFromTurns()` / `debugRequestsInWindow()` / `latestDebugRequest()`** — helper functions for extracting and filtering debug requests across turns.
- **`tests/verify-live-aic-reconciliation.js`** — unit test covering: basic debug+pending reconciliation, count-based matching with 2 flushed + 1 pending, and model version aliasing (4.6 vs 4.7).

## [1.10.7] - 2026-06-14

### Fixed

- **Scanner now has ZERO drift against raw debug-log `.jsonl` files.** New cross-validator [tests/verify-no-drift.js](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/tests/verify-no-drift.js) independently parses every `main.jsonl` / `title-*.jsonl` / `runSubagent-*.jsonl` under `workspaceStorage` and asserts that the scanner's per-turn aggregates (`debugLlmCalls`, `debugPromptTokens`, `debugOutputTokens`, `debugCachedTokens`, `debugAicCredits`) match the raw `llm_request` events exactly. Initial runs caught two real silent-corruption bugs in [src/scanner.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/scanner.ts):
  - **Duplicate `(sessionId, turnIndex)` rows in chat-session files were double-counting in every downstream consumer.** Chat-session files routinely contain multiple `Turn` rows for the same `turnIndex` — an empty initial row at turn-start plus the fully-populated row when the turn settles. The per-`(sid, turnIndex)` debug-log enrichment loop attached the same `debugAicCredits` / `debugLlmCalls` payload to every duplicate row, so any consumer that summed `scan.turns[*].debugAicCredits` (dashboard `aicSummary.totalCredits`, `liveOtel.sessionAIC`, sidebar breakdown, status-bar dollars) silently double-counted. In the user's workspace this was **114 duplicate keys → +704 phantom `llm_calls` / +1,869 phantom credits**. **Fix:** dedupe `canonical.turns` by `(sessionId, turnIndex)` before the enrichment loop, keeping the row with the highest filled-in token count (then latest timestamp as tiebreaker).
  - **Errored `llm_request` events past the chat-session's last turn were silently dropped.** An `llm_request` with `status:"error"` (timeout, abort, server-side failure) has NO `inputTokens` / `outputTokens` / `copilotUsageNanoAiu` fields. The scanner still counted it in `dt.llmCalls`, but the synthetic-turn-creation branch only fired when prompt or output was non-zero, so an errored call in a turn the chat-session hadn't flushed yet vanished from the request count. **Fix:** broaden the predicate to `dt.promptTotal > 0 || dt.outputTotal > 0 || dt.llmCalls > 0`.

- **Status bar / sidebar / dashboard AIC now match by construction.** The status bar was reading from its own independent reimplementation of session/last-request AIC in [src/extension.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/extension.ts) `updateStatusBar()`, which had drifted from `dashboardData.liveOtel` repeatedly (v1.9.17: bar 8025.8 vs dashboard 111.2; v1.10.2: sidebar 214.1 vs dashboard 129.3; before the fix today: bar `$1.53` / 153.3 AIC vs dashboard 90.3 AIC). Root cause: the status-bar path summed per-model rate-table estimates only and never applied the per-model `copilotUsageNanoAiu` overlay that the dashboard uses for API-exact billing.
  - **Fix:** `updateStatusBar()` now sources `currentSessionAIC` and `lastRequestAIC` directly from `buildData().liveOtel.sessionAIC` / `.lastRequestAIC` — the same producer the dashboard and sidebar consume. Deletes ~80 lines of duplicate AIC math; the local block now only builds metadata (model name, turn count, prompt/output token sums, duration).
  - **Perf:** `pushSidebarSnapshot()` accepts an optional precomputed `DashboardData` so the status-update tick builds dashboard data exactly once (was twice).

- **`liveOtel.sessionAIC` no longer ticks DOWN between requests.** Once the live-tick path was wired in, a long-standing flicker became visible: when a request finished, the rate-table estimate landed first (e.g. `147` for an Opus 4.7 turn — over-counts because OTel traces are missing cache attributes for Anthropic models), then ~2s later the debounced scan read `copilotUsageNanoAiu` from the debug log and the per-model overlay in [src/dashboardData.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/dashboardData.ts) **replaced** the estimate with the exact API-billed value (e.g. `138`), so `sessionAIC` visibly dropped 147 → 138.
  - **Fix:** added a per-activation high-water ratchet `_sessionAICRatchet` in [src/dashboardData.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/dashboardData.ts). Once `liveOtel.sessionAIC` reports a value for a given `activationTime`, subsequent ticks can only equal or exceed it — never decrease. Applied to both the OTel branch and the debug-log-only fallback branch. Keyed by `activationTime` so a VS Code window reload resets the ratchet automatically. Per-model breakdown table still shows the API-exact corrected values — the ratchet only locks the rolled-up `sessionAIC` number.

- **Drift validator no longer cries wolf during active Copilot use.** [tests/verify-no-drift.js](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/tests/verify-no-drift.js) used to read raw `.jsonl` files first (~4s) then run the scanner (~25s); any `llm_request` that landed during that window appeared in scanner but not raw, producing false-positive `Δ=-1 call` FAILs.
  - **Fix:** flipped read order to scanner-first, raw-second (with a 500ms settle window) so the invariant becomes `scanner ⊆ raw`. Added RACE-vs-DRIFT classification: `truth > scanner` is tagged `RACE` (writes during scan, exits 0 with warning), `scanner > truth` is tagged `DRIFT` (real bug, exits 1). Test now passes 9/9 even while Copilot Chat is actively streaming new requests.

### Changed

- **Reimagined status bar — dollars-first, glanceable, transient feedback.** The status-bar text collapsed from `$(zap) In:256.9K Out:3.9K Cache:191.5K | AIC(sess):59.1 Req:8.4` (~52 chars) down to `$(zap) $0.59` (~10 chars) with a 5-second `+8.4¢` flash badge after each new request. Every datum previously on the bar (In/Out/Cache, model, turns, session id, workspace total, both AIC numbers) is preserved in the tooltip. Idle text is now icon-only `$(dashboard)`. See [src/statusBar.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/statusBar.ts).
  - **Daily-limit visuals integrated into the body, not appended.** Warn/Brace render as `<walker> $0.59 / $5.00`; Limit hit renders as `<stop> $5.00 LIMIT`; snoozed/resumed states drop the `LIMIT` tag. The legacy ` | $used/$limit (pct%)` suffix is gone.
  - **Per-request `+X¢` flash.** A new `fmtDelta()` helper formats the last-request AIC delta as `+<1¢`, `+8.4¢`, or `+$1.20` depending on magnitude. Triggered by a `lastRequestAIC` change between updates and auto-cleared by a one-shot 5-second timer.
  - **Wiring:** [src/extension.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/extension.ts) passes `dollarPerCredit` from `getAICConfig().overageCostPerCredit` into `StatusBarData` so the bar and the dashboard share one conversion rate.

- **Live updates are actually live now — all three surfaces tick within ~ms of a Copilot request finishing.** The OTel handler used to hold every UI update behind `OTEL_DEBOUNCE_MS = 2000ms`. Split into a live path (status bar + dashboard refresh fire immediately on every OTel batch, cheap — in-memory OTel + cached scan) and a debounced path (`runScan()` still coalesces disk re-scans for the `copilotUsageNanoAiu` overlay). End-to-end latency from `notify()` → status-bar repaint dropped from ~2000ms to ~ms.

- **Dashboard Live-OTel AIC tiles now display 2dp instead of 1dp.** The `AIC (sess)`, `AIC (last req)`, and per-model AIC column in [src/dashboardPanel.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/dashboardPanel.ts) used `.toFixed(1)`, which silently hid cents — a `7.22`-credit request rendered as `7.2`. Storage was always exact (`copilotUsageNanoAiu / 1e9` rounded to 2dp); only the display was throwing away precision. Now matches the storage layer.

## [1.10.3] - 2026-06-12

### Changed

- **Sidebar layout polish.** Three small fixes to the "Copilot Usage" Activity Bar sidebar:
  - **`THIS WEEK` KPI no longer overflows the card on narrow widths.** `.kpi-grid` now uses `minmax(0, 1fr) minmax(0, 1fr)` instead of `1fr 1fr` so grid tracks can shrink below their intrinsic content width. `.kpi`, `.kpi .value`, and `.kpi .sub` got `min-width: 0` + `overflow-wrap: anywhere` so long numbers wrap instead of clipping. Below 220px the two KPIs stack vertically. See [src/sidebarView.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/sidebarView.ts).
  - **Removed the SESSIONS section from the sidebar.** The full dashboard already lists top sessions; mirroring the table in the sidebar was duplicate surface area. Sidebar is now a 2-section accordion (USAGE & PACE + BREAKDOWN). Dropped the `#sec-sessions` panel, the `renderSessions()` webview function, the `openSession` message handler, and the `.sess-head` / `.sess-row` CSS block (~38 lines).
  - **BREAKDOWN · BY MODEL now lists all models, not just the top 5.** Removed the `.slice(0, 5)` in [src/sidebarSnapshot.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/sidebarSnapshot.ts) so every billable model appears in the sidebar bars. The "+N more in dashboard ⤢" overflow footer disappears naturally (`modelsMore` is always `0`).

## [1.10.2] - 2026-06-12

### Added

- **New "Copilot Usage" Activity Bar sidebar.** A persistent webview view (`copilotUsage.panel`) lives in its own Activity Bar container alongside the full dashboard. Three-section accordion: **USAGE & PACE** (Last Request + Session (this window) side-by-side, Today/Week KPIs, projected-overage Pace card with traffic-light progress bar), **BREAKDOWN** (cycle total, 14-day daily sparkline with peak highlight, top-5 By Model bars with tier chips, By Day of Week bars, Tokens in/out/cache), **SESSIONS** (top 30 by credits with click-through to the full dashboard, active-window glyph). Sections have brighter outer borders so each reads as a distinct card against the side bar background.
  - New files: [src/sidebarView.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/sidebarView.ts) (`WebviewViewProvider` with strict CSP + per-render nonce, expanded-state persistence via `vscode.setState`), [src/sidebarSnapshot.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/sidebarSnapshot.ts) (pure projection of existing `DashboardData` + scanner turns + live OTel into a slim DTO — zero new computation, all numbers come from the existing pipeline).
  - Snapshot pushes happen on every status-bar tick, on `webviewView.onDidChangeVisibility`, and on a `ready` ping from the webview script — eliminates the post-before-listener race and avoids stale "Waiting…" placeholders when re-opening the sidebar.
  - All scanner-driven values respect `activationTime` scoping (same contract as v1.9.16/17), so the sparkline, "Session (this window)", and active-session glyph never leak prior windows' turns.
  - New commands: `copilotUsage.sidebar.refresh` (toolbar `$(refresh)`) and `copilotUsage.sidebar.openDashboard` (toolbar `$(link-external)`).

### Fixed

- **`Session (this window)` no longer permanently reads `0 min`.** Both branches of `updateStatusBar()` in [src/extension.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/extension.ts) that build `CurrentSessionInfo` were hard-coding `durationMin: 0`, so the sidebar's session card always showed `… · N turns · 0 min`. Added `computeWindowDurationMin()` (minutes since `activationTime`) and wired both branches to it. Status-bar consumers were unaffected — they never read the field.

### Changed

- **`AIC_EFFECTIVE_DATE = "2026-06-01"` is now exported from [src/dashboardData.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/dashboardData.ts).** Was duplicated as three separate string literals (`dashboardData.ts`, `extension.ts`, the new `sidebarSnapshot.ts`); `aicCredits.ts` keeps its `PROMO_START` since that's a semantically different date. Per the `.agents/agents.md` "three consumers must stay in sync" contract, consolidating to a single import removes one drift surface.

## [1.9.21] - 2026-06-11

### Fixed

- **"Usage by Model" AI Credits column now joins on `modelFamily`, not display-label normalization.** The v1.9.19 fix tried to normalize `s.modelName` (display label, e.g. `"Claude Opus 4.6"`) into the API family form (`"claude-opus-4.6"`) by collapsing whitespace to hyphens. Confirmed in the wild that this still didn't connect for real Anthropic rows in some sessions — the display label coming from VS Code's `metadata.name` is not always a clean `<vendor> <product> <version>` triple, and even small punctuation differences broke the lookup. `SessionView` in [src/dashboardData.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/dashboardData.ts) already carries **both** `modelName` (display) and `model` (= `modelFamily` from `metadata.family`, which is **literally the same string** `aicSummary.byModel` uses), so `renderModelTable()` in [src/dashboardPanel.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/dashboardPanel.ts) now joins on family directly. The aggregator preserves both fields per row (`{model: displayLabel, family: modelFamily}`); the AIC lookup tries family first, falls back to the label-normalization path only when family is empty (very old sessions where `metadata.family` was absent). No more guessing.

## [1.9.20] - 2026-06-11

### Fixed

- **"AI Credits by Model" `Output` and `Cached` columns no longer report 0 for every post-June-1 model.** `AICCalculator.computeSummary()` in [src/aicCredits.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/aicCredits.ts) had a long-standing shortcut: whenever a credit entry carried `actualCredits` (the API-reported `copilotUsageNanoAiu` overlaid by [src/dashboardData.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/dashboardData.ts) since v1.9.17), it stuffed the **entire** authoritative value into `inputCredits` and zeroed `outputCredits` / `cachedCredits` — the comment even acknowledged it (`// attribute all to "input" for simplicity`). That was harmless when only the `Total` column existed, but the per-model table now shows all four buckets, so every Anthropic/GPT row read `Input ≈ Total`, `Output = 0`, `Cached = 0`. Now: when `actualCredits` is available, the calculator computes the rate-based input/output/cached breakdown from the entry's tokens, then **scales each component proportionally** so the three sum to the exact API-billed `actualCredits`. The displayed total stays API-authoritative (no drift vs the budget bar / `byDay` calendar) and the breakdown is finally meaningful. Edge cases: entries with no matching rate, or zero token counts (e.g. OMP/Pi agent entries that don't carry per-bucket tokens), still fall back to all-input — unchanged behaviour for those.

## [1.9.19] - 2026-06-11

### Fixed

- **"Usage by Model" table now shows AI Credits for every post-June-1 model, not just `GPT-5.4`.** `renderModelTable()` in [src/dashboardPanel.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/dashboardPanel.ts) joined session rows against `DATA.aicSummary.byModel` using a plain `.toLowerCase()` key, but the two sides use different naming conventions: the session aggregator keys on `s.modelName` — the **display label** from VS Code's `selectedModel.metadata.name` (e.g. `"Claude Opus 4.6"`, spaces preserved) — while `aicSummary.byModel[].model` keys on the **API family** emitted by the debug-log / OTel pipeline (e.g. `"claude-opus-4.6"`, hyphens; sometimes `"claude-opus-4-6"` from OTel attributes where dots were stripped). The two never matched, so every Anthropic row, `GPT-5.5`, `Auto`, etc. rendered `—` in the AI Credits column. `GPT-5.4` coincidentally worked because its display string equals its API family string. Added a small `normModelKey()` helper applied to both sides of the join: lowercase → collapse whitespace/underscores to `-` → restore version dots (`\d-\d` → `\d.\d`). After normalization `"Claude Opus 4.6"` / `"claude-opus-4-6"` / `"claude-opus-4.6"` all map to the same key. Models with usage only **before** `AIC_EFFECTIVE_DATE = 2026-06-01` (filtered out of `aicSummary.byModel` by design in [src/dashboardData.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/dashboardData.ts)) and the `Auto` router (never appears in AIC byModel) still correctly show `—`.

### Changed

- **Filter bar redesigned: Models / Range / Refresh are now compact dropdowns instead of inline button rows.** `buildFilterBar()` in [src/dashboardPanel.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/dashboardPanel.ts) was rewritten to render three grouped controls with `UPPERCASE` micro-labels:
  - **Models** — a custom button (`.model-dd-btn`) that opens a checkbox panel (`.model-dd-panel`) on click. The button label summarises selection state (`All Models (N)` / `K of N selected` / `No models`). Includes `All` / `None` quick actions inside the panel. A document-level click handler closes the panel on outside-click and `event.stopPropagation()` keeps clicks inside the panel from closing it.
  - **Range** — a native `<select class="filter-select">` populated from the existing `RANGE_LABELS` map, so option text reads `"Last 7 Days"` / `"This Week"` etc. instead of the old `7d` / `tw` button chips. `setRangeDD()` preserves the existing auto-refresh-on-range-change behaviour (turn refresh off for historical ranges, restore 2 m default when returning to today).
  - **Refresh** — a native `<select>` with `Off` / `Every 30s` / `Every 1m` / `Every 2m` / `Every 5m`. The manual refresh `↻` button is restyled (slightly larger, rounded, green-on-hover border).
  - New helpers `updateModelDDLabel()` / `syncRefreshSelect()` keep the dropdown labels in sync after programmatic state changes (e.g. range-change auto-toggling refresh). Old per-button active-class fiddling (`updateRefreshButtons`, `setRange(btn, r)`, `setRefresh(btn, secs)`) is gone — `<select>` elements handle their own selection state.
  - CSS adds `.filter-group` / `.filter-label` / `.filter-select` / `.model-dd*` rules; obsolete `.range-btns` / `.range-btn` / `.refresh-btns` / `.refresh-label` rules removed.

## [1.9.18] - 2026-06-11

### Added

- **New `AIC` column in the "Live OTel by Model" table.** Each model row now shows its API-billed credits alongside Requests / Prompt / Output / Cache, so it's immediately obvious which model is driving spend in the current session without cross-referencing the AIC section below.
  - **OTel branch** ([src/dashboardData.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/dashboardData.ts) `buildDashboardData()`): a rate-table estimate is computed per row, then **overlaid with the exact per-llm_request `copilotUsageNanoAiu`** from today's debug-log per-model breakdown (`turn.debugByModel[*].nanoAiu`) when available. Overlay is scoped to today + `activationTime` — same scope `sessionAIC` uses since v1.9.16 — so prior VS Code windows' debug-log turns can't leak in. Model names are matched case-insensitively.
  - **Debug-log fallback branch**: per-row credits are summed directly from `mt.nanoAiu / 1e9`; legacy turns without per-model AIU fall back to `calculator.calculateCredits()`. Rounding to 2 decimals happens only at finalize, so intermediate sums keep precision.
  - **`sessionAIC` is now derived from the same per-row credits the user sees in the table**, instead of an independent rate-table sum — the displayed grand total always matches the column.
  - **Renderer** ([src/dashboardPanel.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/dashboardPanel.ts) `renderOtel()`): adds an `AIC` `<th>` and renders `m.aicCredits.toFixed(1)` in the existing `.orange` style, matching the other AIC columns in the dashboard.

## [1.9.17] - 2026-06-11

### Fixed

- **Picked up orphan `title-*.jsonl` and `runSubagent-*.jsonl` debug logs that were missing a `child_session_ref` in `main.jsonl`.** The scanner only opened child files that `main.jsonl` explicitly referenced. An audit across 295 real workspaceStorage sessions found 16 child files on disk with no matching ref (3 `title-*.jsonl`, 13 `runSubagent-*.jsonl`) containing 137 unaccounted `llm_request` events — mostly subagent `claude-haiku-4.5` rounds plus a handful of `gpt-4o-mini` title calls and `claude-opus-4.6` requests from older Copilot versions (`copilotVersion` 0.47.x). `parseDebugLogDir` in [src/scanner.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/scanner.ts) now enumerates `title-*.jsonl` / `runSubagent-*.jsonl` siblings of `main.jsonl` after parsing and attaches any unreferenced ones as orphans (`parentTurn = -1` → attributed to turn 0, the same fallback path used for pre-turn title entries). [tests/audit-orphan-children.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/tests/audit-orphan-children.ts) is a new audit/regression-guard script that quantifies how many orphan child files would be dropped if this fallback regressed.
- **Restored per-model AIC attribution for auxiliary calls (title generation, subagent rounds) in the debug-log path.** Until v1.9.6 the dashboard's per-model breakdown was driven primarily by the OTel receiver, which exports each `llm_request` span with its own `gen_ai.request.model`. When v1.9.12 made the debug-log path equally authoritative for windows that don't hold OTLP port 14318, those small-model calls effectively disappeared from the per-model rows: the scanner read `title-*.jsonl` (gpt-4o-mini) and `runSubagent-*.jsonl` (claude-haiku-4.5) for the session total, but every `llm_request` was stamped with the **parent turn's** `modelFamily` (e.g. `claude-opus-4.7`), collapsing all child credits into one row.
  - `parseDebugLogLines` in [src/scanner.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/scanner.ts) now captures `attrs.model` on every `llm_request` and accumulates per-model totals at both the per-turn and per-session level.
  - `parseDebugLogDir` merges each child session's per-model totals into the parent turn that spawned it. `title-*.jsonl` fires before any `turn_start` (parent turn index = -1) — those credits are now attached to turn 0 instead of being silently dropped from per-model views.
  - New `debugByModel?: Record<string, DebugModelTotals>` on `Turn` exposes the per-model breakdown to consumers.
  - `dashboardData.ts` uses `t.debugByModel` (when present) in three places: the AIC `creditEntries` builder, `computeDaily` (daily-by-model view), and the debug-log fallback's `byModel` rows. All three previously grouped only by `turn.modelFamily`.
- Verified on a real workspace session where the cost was actually billed across 3 distinct models (`gpt-5.4` ×23, `claude-haiku-4.5` ×38, `gpt-4o-mini-2024-07-18` ×1): per-model AIC now sums to the API's exact total to 6 decimal places (was off by the orphaned title's AIC before this fix). Existing `tests/scan-june-workspace.ts` cross-validation still shows 0.0% drift across all sessions.
- **Status bar `AIC(sess)` no longer inherits prior VS Code windows' totals.** The v1.9.16 fix scoped the dashboard's `AIC (sess)` to `activationTime`, but the equivalent overlay inside [src/extension.ts](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/src/extension.ts) `updateStatusBar()` was missed — the status bar's `AIC(sess):...` value was still summing every today turn from shared `workspaceStorage` debug-logs, so opening a new window mid-day showed (for example) `AIC(sess):8025.8` next to a dashboard reading `AIC (sess) 111.2`. Same root cause as v1.9.16, same fix: the OTel-branch overlay now filters on `t.timestamp >= activationTime` (and `>= AIC_START`).
- **Status bar `Req:` now uses per-request timestamp + value, matching the dashboard.** The debug-log overlay for `lastRequestAIC` in `updateStatusBar()` was keyed on `t.timestamp` (turn-start time) and `t.debugAicCredits` (whole-turn total). A long turn with 15 tool-call `llm_request` entries would therefore show `Req:` = the entire turn's AIC, and any prior-window turn whose start time was newer than this window's last OTel request could leak in. Now uses `debugLastRequestTs` / `debugLastRequestAic` with the same `activationTime` filter as the session value, matching `dashboardData.ts` `liveOtel.lastRequestAIC` exactly.

## [1.9.16] - 2026-06-10

### Fixed

- **`AIC (sess)` no longer inherits prior sessions' totals on a fresh VS Code window.** The debug-log overlay that backstops the OTel `sessionAIC` was filtering by calendar day only — so opening a brand-new VS Code window mid-day picked up every turn from every prior reload/session in `main.jsonl` and `Math.max`'d that into `AIC (sess)`. The dashboard would then show e.g. `AIC (LAST REQ) 7.2` (correct — just this session's one request) next to `AIC (SESS) 6174.5` (wrong — all of today's prior sessions). `buildDashboardData` now takes `activationTime` and the debug-log overlay scopes turns to `t.timestamp >= activationTime` on both the OTel-present and OTel-absent paths. Same activation-scoping the status-bar `AIC(cur)` has used since v1.8.x.

## [1.9.15] - 2026-06-10

### Fixed

- **Reverted the v1.9.14 fire-and-forget initial scan.** With the initial scan running in the background, opening the dashboard on cold start showed all zeros (`0.0 AIC / 0 sessions / 0 turns`) until the scan finished — sometimes seconds later, sometimes never if the watcher fired first and overwrote a partial cache. Activation now awaits the first scan again so the dashboard, status bar, and any subsequent commands always see populated data on cold start. The watcher + 30 s safety-net handle every update after that.

### Kept from v1.9.14

- `deactivate()` cleanup of the v1.9.13 cooldown timer and the recursive `fs.watch` handle — this part was a real fix and stays.

## [1.9.14] - 2026-06-10

### Fixed

- **Extension activation no longer blocks on the initial scan.** Previously `activate()` did `await runScan()`, which on a large `workspaceStorage` (hundreds of debug-log sessions) could keep VS Code in the "activating" state for several seconds and delay every extension that depends on us. The first scan now runs fire-and-forget; the status bar and dashboard refresh as soon as it completes, and the `fs.watch` + 30 s safety-net timer take over for live updates.
- **`deactivate()` now cleans up the v1.9.13 cooldown timer and the recursive `fs.watch` handle.** Previously these could outlive the extension host on reload and leak a watcher per reload cycle.

## [1.9.13] - 2026-06-10

### Fixed

- **`AIC (last req)` now shows ONE API call's bill, not the entire turn's sum.** A turn that fires many tool-call rounds writes one `llm_request` entry to `main.jsonl` per call (10–20 is common for agent turns). We were summing them and labelling the sum `AIC (last req)` — so a turn that actually billed ~8 AIC per call showed up as `132.0` on the dashboard. The scanner now tracks `lastRequestNanoAiu` and `lastRequestTs` per turn (the single most recent llm_request, not the cumulative total), and the dashboard's `AIC (last req)` widget uses those.
- **Pure event-driven live updates — dashboard reacts within ~10 ms of a `main.jsonl` write.** Replaced trailing-edge debounce (every event waited 500–2000 ms before scanning) with leading-edge fire + 500 ms cooldown + serialized trailing coalesce. Result: first event fires the scan immediately; bursts during one in-flight request are coalesced into a single trailing scan after the cooldown so the final totals are correct. Scans are also serialized so two watcher events never race two scans.
- **Safety-net periodic timer dropped from 120 s to 30 s.** The watcher is the primary live path; the timer is only a backstop for cases where `fs.watch` misses an event (e.g. network shares).

## [1.9.12] - 2026-06-10

### Added

- **Real-time `main.jsonl` file watcher.** The extension now sets up a recursive `fs.watch` on the workspaceStorage root and triggers a debounced rescan whenever any `<wsRoot>/<wsId>/GitHub.copilot-chat/debug-logs/<sid>/main.jsonl` is written. This makes the dashboard live within ~1–2 seconds of every Copilot request — even in the secondary window that doesn't own OTLP port 14318. Replaces the previous behaviour where this window could be up to 120 seconds behind.

### Changed

- **Rebranded the debug-log path.** When the OTLP receiver port is held by another VS Code window, the Live OpenTelemetry panel previously labeled itself `Local debug-log fallback` with a note implying degraded data. In reality `main.jsonl` carries the API-exact `copilotUsageNanoAiu` — the same value the API bills you for. New label: `Live (debug-log stream • API-exact)` with a note that explains it's authoritative, not a fallback.

## [1.9.11] - 2026-06-10

### Fixed

- **AIC (last req) now reflects the turn with the most recent `llm_request`, not the most recent `turn_start`.** In the debug-log fallback, a long-running turn that fired many `llm_request` calls had an older `turn_start` timestamp than a freshly-started short turn — so the "most recent turn" picker would prefer the wrong one and show a stale AIC value (e.g. the dashboard displayed `8.4` while the actual just-finished request was `9.26`). The scanner now bumps `DebugLogTurnTokens.timestamp` to each `llm_request`'s own `ts` as they arrive, so "most recent" reflects real last activity.
- **Fallback note now explains why OTLP is unavailable.** Previous wording said "OTLP export is unavailable" which sounded like Copilot wasn't exporting at all. The real cause is that only one VS Code window's extension instance can bind port 14318 — others fall back to debug-log parsing. Note now says so.
- **Fallback request-count label renamed to `LLM Requests`.** In fallback mode the receiver isn't running, so labelling the debug-log `llm_request` count as `OTel Requests` was confusing.

### Refactored

- No behavior change. Cross-validation (`tests/scan-june-workspace.ts`) still shows 0.0% drift vs API ground truth across all sessions, including the now-correct most-recent-turn pick.

## [1.9.10] - 2026-06-10

### Fixed

- **Debug-log fallback now surfaces cache-read tokens.** When OTLP export is unavailable, the _Live OpenTelemetry_ panel was hard-coding `LIVE CACHED`, `TRACE CACHE`, and `METRIC CACHE` to `0` even though `attrs.cachedTokens` is present on Anthropic Opus/Sonnet `llm_request` entries in `main.jsonl`. The scanner now reads it (`Turn.debugCachedTokens`), the fallback path sums it into `live.cached` / `live.traceCached`, and the per-model breakdown reports it under _Trace Cache_. Subtitle updated.
- **AIC (last req) no longer appears frozen on refresh in the debug-log fallback.** It was previously set to whichever turn happened to be iterated last — `scan.turns` is append-order (across sessions and synthetic debug-log turns), not timestamp-sorted, so the value was order-dependent and could stay the same across refreshes even as new requests came in. It now picks the turn with the most recent timestamp.
- **AIC computation in the debug-log fallback now passes cache-read tokens to the calculator.** Previously cached tokens were passed as `0`, which silently overestimated AIC for any turn that lacked an exact `copilotUsageNanoAiu` value (cache reads were billed at the full input rate instead of the discounted cache-read rate).

## [1.9.9] - 2026-06-10

### Fixed

- **Calendar heatmap month header now matches the user's local calendar** ([#2](https://github.com/pvjagtap/github-copilot-usage-dashboard/issues/2)). For users in timezones east of UTC (e.g. IST / UTC+05:30), the "Daily Credits" calendar could render the previous month — e.g. `May 2026` on June 10 local — even with `billingCycleStartDay = 1`. Root cause: `_getBillingCycle()` in `aicCredits.ts` built `cycleStart` / `cycleEnd` in local time but serialized them with `toISOString().slice(0, 10)` (UTC), shifting June 1 00:00 IST back to `2026-05-31`. The webview then derived the calendar header from that shifted string.
  - Added local-date helpers (`formatLocalYMD` / `parseLocalYMD`) in `aicCredits.ts`; `_getBillingCycle` and `_getDaysElapsed` now serialize / parse in the user's local calendar.
  - The today-marker in `buildCreditCalendar` (`dashboardPanel.ts`) now also uses local `YYYY-MM-DD` so day comparisons stay consistent with the cycle dates.
  - New regression test `tests/issue-2-calendar-tz.ts` pins `TZ=Asia/Kolkata`, freezes `Date.now()` to 2026-06-10 IST, drives the real `AICCalculator`, and asserts the cycle start is `2026-06-01` and the calendar header is `June 2026`.

## [1.9.8] - 2026-06-10

### Changed

- **Internal refactor only — no behavior change.** Eliminated 9 code-duplication clusters flagged by the Fallow static analyzer across `scanner.ts`, `agentScanner.ts`, `otelReceiver.ts`, `extension.ts` and `planDetector.ts`.
  - New `src/util.ts` module exports `isObj`, `isArr`, `utcNow`, and `mapConcurrent`. Local copies in three files now import from it.
  - `scanner.ts` gained four private helpers: `normalizeFileUri` (collapses two file:// URI decoders), `extractSubagentArgs` (collapses two runSubagent argument parsers), `emitTurnAndToolCalls` (collapses the 25-line turn + tool-call emission block used by both the `kind=0 v.requests[]` and `kind=1 ...result` parse paths), and `listWorkspaceDirsSorted` (collapses the 8-line workspaceStorage subdirectory listing used by `discoverSessionFiles`, `discoverTranscriptFiles`, and `discoverDebugLogsCached`).
  - `extension.ts` gained `summarizeSnapshot` (collapses two identical `DailyLimitSnapshot` projection objects).
  - `planDetector.ts` gained `persistDetectedPlan` and `runQuickPickAndPersist` (collapse the persist + manual-picker blocks shared by the silent and consent detection paths).
- Verified by `tsc` (clean), `eslint src` (only pre-existing warnings), and the existing `tests/scan-june-workspace.ts` cross-validation script.

## [1.9.7] - 2026-06-10

### Fixed

- **Scanner no longer silently returns zero sessions on Linux, macOS, dev containers, WSL, or Remote-SSH.** `getWorkspaceStoragePath` was Windows-only — it joined `process.env.APPDATA ?? ~/AppData/Roaming` with `Code/User/workspaceStorage`, producing a path that does not exist on any non-Windows platform. The dashboard would render but show nothing. Resolver now probes a platform-aware candidate list and picks the first one that exists.

### Added

- **Cross-platform workspaceStorage resolution** — auto-detects across Windows (`%APPDATA%/Code`), macOS (`~/Library/Application Support/Code`), Linux (`~/.config/Code`), VS Code Insiders variants of each, dev container / Remote-SSH / WSL (`~/.vscode-server[-insiders]/data/User/workspaceStorage`), and Portable installs (`$VSCODE_PORTABLE/user-data/User/workspaceStorage`). Builds on community PR [#1](https://github.com/pvjagtap/github-copilot-usage-dashboard/pull/1) by @josteinaj.
- New setting **`copilotUsage.workspaceStoragePath`** — optional absolute path to point the scanner at a specific install. Useful for forks, portable installs, or running multiple parallel VS Code installations.
- Env override **`COPILOT_USAGE_WORKSPACE_STORAGE`** — same purpose for tests, CI, and non-VS Code execution.
- Exported `getWorkspaceStorageCandidates(override?)` from `scanner.ts` so the cross-validation test (`tests/scan-june-workspace.ts`) consumes the same resolver as the runtime.

### Changed

- `getWorkspaceStoragePath` is now `async` and uses `fsp.stat` instead of `fs.existsSync`/`fs.statSync`, matching the "fully async with concurrent file I/O" contract stated in the scanner's file header.
- When no candidate exists yet, the fallback is platform-appropriate (Windows → `%APPDATA%/Code/...`, macOS → `~/Library/...`, otherwise → `~/.config/Code/...`) instead of unconditionally returning a Linux path.
- README "Data Sources" section rewritten as a cross-platform table covering all supported layouts plus the new override setting.

## [1.9.6] - 2026-06-07

### Fixed

- **Picker now always offers the one-click "Detect via GitHub" button.** v1.9.5 hid the button behind a `getAccounts('github')` check — but VS Code's auth API is scoped per extension, so `getAccounts` returns `[]` until our extension has been granted access at least once. Net effect: the button was effectively never shown on first run. The button is now unconditional; clicking it triggers VS Code's standard "Allow Copilot Usage Dashboard to use GitHub?" consent dialog, then queries the SKU and writes the plan automatically.

## [1.9.5] - 2026-06-07

### Fixed

- **Silent plan detection now actually succeeds for most users.** v1.9.4 only asked VS Code for a GitHub session scoped to `['read:user']` — VS Code caches one session per unique scope tuple, so Copilot's existing session (typically `['repo','workflow','read:user']`) didn't match and detection silently fell through to the picker. The detector now tries multiple known scope variants in order and uses whichever one returns a cached session, with zero prompts.
- When no silent session matches but a GitHub account exists, the picker fallback now offers a **"Detect via GitHub"** button that triggers VS Code's one-click consent dialog ("Allow Copilot Usage Dashboard to use GitHub?") — a single click instead of a manual plan pick.

## [1.9.4] - 2026-06-07

### Fixed

- **Plan no longer hard-defaults to Business.** Pro / Pro+ / Free / Enterprise users were silently shown the Business budget (1,900 credits) because `copilotUsage.aic.plan` shipped a `business` default and was never auto-detected. The dashboard now reads the user's actual SKU via their existing VS Code GitHub session — no extra sign-in — by calling GitHub's `/copilot_internal/v2/token` (the same call the official Copilot extension makes) and maps the returned SKU to the correct plan key. If detection fails or returns an unknown SKU, a one-time picker is shown so the user can choose explicitly. A plan the user has set manually is never overwritten.

### Added

- New setting `copilotUsage.aic.autoDetectPlan` (default `true`) — set to `false` to disable silent detection and rely on the manual `copilotUsage.aic.plan` value only.
- New command **Copilot Usage: Detect My Copilot Plan** — re-runs detection on demand (useful after upgrading from Pro to Pro+ or moving to a Business seat).

## [1.9.0] - 2026-06-03

### Added

- **GitHub Copilot agent hooks integration** — the daily limit now denies tool calls in Copilot CLI, local custom agents, and the cloud agent (when opted in). On activation, the extension installs a `PreToolUse` hook at `~/.copilot/hooks/copilot-usage-limit.json` plus PowerShell/bash scripts at `~/.copilot-usage/`. A live state file is rewritten on every snapshot so snooze/resume/end-override take effect on the very next tool call.
- New setting `copilotUsage.dailyLimit.installAgentHooks` (default `true`) — flip off to remove hooks immediately.
- New commands `Copilot Usage: Install Agent Hooks` and `Copilot Usage: Uninstall Agent Hooks`.

### Notes

- Plain Copilot Chat (Ask mode) in the sidebar is **not** covered by hooks — no hook surface exists for it. Use `strict` enforcement (extension disable + reload) if you need to lock it down too.
- Hooks are fail-OPEN by design: a broken script will never block Copilot. Only a successful read of the state file with `blocked == true` produces a deny.

## [1.7.7] - 2026-06-02

### Documentation

- README now links to the upstream agent projects: [Oh My Pi](https://github.com/can1357/oh-my-pi) and [Pi](https://github.com/earendil-works/pi), making the source attribution explicit in both the Features bullet and the Data Sources section.

## [1.7.6] - 2026-06-02

### Changed

- **Dashboard UI redesign — better hierarchy & scannability**:
  - Replaced 9-card KPI strip with **4 hero cards** featuring colored accent stripes, large headline values, and contextual delta badges (runway days, turns/session, tokens/turn).
  - Secondary KPIs (Prompt, Output, Tool Calls, Subagents, Mirrors, Transcripts) moved into a collapsible **"More details"** expander.
  - **Breakdown section is now tabbed** (By Model · By Project · By Tool · By Subagent) — reclaims ~60% vertical space and gives each chart full width.
  - **Trends section** places Daily Token Usage and Average Hourly Distribution side-by-side on wide screens.
  - **Auto-generated insight captions** under each trend chart (peak day, % of period, peak hour with timezone, ±3h concentration).
  - **All Sessions** and **Live OpenTelemetry** sections now collapsible expanders with count badges; OTel moved above AIC for quicker diagnostic visibility.
- **AIC budget panel** softened — calmer color thresholds (blue → green → amber → red, only red when actually past budget) and a new "~N days runway at current pace" indicator.
- **Budget percentage now uncapped** — previously the % was capped at 100%, hiding the true severity of overage. Now displays the actual ratio (e.g. `494% (+394% over)`) in red with a tooltip showing the overage in credits.

### Added

- New CSS components: `.hero-card`, `.tabs`/`.tab-panel`, `.expander` (native `<details>`), `.insight` caption box, `.budget-bar`.

## [1.7.3] - 2026-06-02

### Fixed

- **Calendar heatmap colors inverted** — green shades now indicate higher usage, red indicates lower usage. Legend updated to match.

## [1.7.2] - 2026-06-02

### Fixed

- **Model multiplier accuracy**: `scanner.ts` now defaults missing `multiplierNumeric` metadata to `0` instead of `1`, allowing `KNOWN_MULT` fallbacks to apply correctly (e.g. Claude Opus → 3x). The model table now tracks the max multiplier seen across all sessions per model rather than locking in the first session's value. Added explicit `gpt-5.5: 7.5` and `gpt-5.4: 1` entries to `KNOWN_MULT` so GPT-5.5 is no longer under-counted by the generic `gpt-5: 1` fallback.

## [1.7.1] - 2026-06-03

### Fixed

- **Agent scan failure no longer stales workspace scan**: `scanAgentSessions()` is now isolated inside its own `.catch()` before `Promise.all` resolves. Previously, if the agent scan threw, the destructuring assignment never executed and `lastScan` retained its previous stale value even though `scanWorkspaceStorage()` had succeeded.
- **`fileCache` eviction on every scan**: After each scan, entries for files no longer present on disk are removed from the module-level `fileCache` Map. Previously, deleted session files accumulated as stale entries for the extension process lifetime.
- **Empty-string phantom key in `modelBreakdown`**: When the very first assistant message in a session lacks a `model` field, the fallback is now `"unknown"` instead of `""` (empty string), preventing a spurious `""` key from appearing in the per-model breakdown.
- **Duplicate `new Date()` in billing-start computation**: `billingStart` now binds `new Date()` once and reuses it for both `.getUTCFullYear()` and `.getUTCMonth()` calls.
- **Token row time-window ambiguity**: The "Tokens — prompt + output" row in the Usage by Source table now labels its scope as "VS Code: workspace storage · OMP/Pi: all time". Each cell carries a `title` tooltip and the Total cell notes that it sums across differing retention windows.

## [1.7.0] - 2026-06-02

### Added

- **Per-source AIC breakdown (VS Code · OMP · Pi)**: New "Usage by Source" table in the dashboard shows Sessions, Turns/LLM Calls, Tokens, and AIC Credits split across VS Code Copilot Chat, Oh My Pi agent sessions (`~/.omp/agent/sessions`), and Pi coding-agent sessions (`~/.pi/agent/sessions`). All three sources feed into the shared AIC billing total above the table.
- **All-time token counts for OMP and Pi**: The Tokens row uses historical all-time token totals for agent sources (not filtered to the current billing period), clearly labelled to distinguish from the billing-period AIC Credits row.
- **AIC Credits scoped to Jun 1+**: The AIC Credits row is labelled "(Jun 1+ only)" to reflect that usage-based billing began June 1, 2026.
- **`agentScanner.ts`**: New module that scans OMP and Pi JSONL session files concurrently with mtime caching. Exposes `scanAgentSessions()` returning `AgentScanResult` with per-source session counts, token breakdowns by model, billing-period totals, and all-time totals.
- **`AgentUsageSummary` in `dashboardData.ts`**: Extended with full per-source fields (`vscodeSessions/Turns/TotalTokens/AicCredits`, `ompSessions/LlmCalls/TotalTokens/TotalCredits/AllTimeLlmCalls/AllTimeTokens`, `piSessions/LlmCalls/TotalTokens/TotalCredits/AllTimeLlmCalls/AllTimeTokens`, `totalSessions/totalCredits/scanMs`).

## [1.6.0] - 2026-06-02

### Fixed

- **Cache write credits now included in OTel AIC calculation**: The credit formula was missing `cache_creation_input_tokens × cacheWriteCreditsPerMillion` (625/1M for Anthropic models). This caused the live OTel credit display to under-report by the cache-write component, explaining the gap between VS Code's native credit display and our extension's AIC numbers.
- **OTel now captures `cache_creation_input_tokens`**: Added extraction of `gen_ai.usage.cache_creation.input_tokens` from OTel trace spans, threaded through to `calculateCredits()` at all call sites.

## [1.5.9] - 2026-06-02

### Fixed

- **OTel model name matching**: `findModelRate()` now normalizes version-number hyphens to dots before lookup. OTel reports models as `claude-opus-4-6` (hyphens) while the rate table uses `claude-opus-4.6` (dots) — previously caused fallback to wrong rates and ~47% drift in live OTel credit display.

## [1.5.8] - 2026-06-02

### Fixed

- **Child credits now in turn-level data**: subagent/child LLM credits are merged into the parent turn that spawned them (via `child_session_ref` turn context). Previously, child credits were only reflected in session-level totals but missing from per-turn AIC calculations, daily analytics, and current-session debug-log fallback.
- **OTel totals remain cumulative**: added separate cumulative counters (`cumulativeRequests`, `cumulativePrompt`, `cumulativeCompletion`, `cumulativeCached`) that are never affected by the 10K retention pruning. `getStats()` now reports true session-lifetime totals. The request array is still pruned for deduplication detail, but reported totals are accurate regardless of session length.

## [1.5.7] - 2026-06-02

### Fixed

- **Subagent credits now included**: debug-log parser follows `child_session_ref` entries and aggregates LLM usage from `runSubagent-*.jsonl` and `title-*.jsonl` child logs. Previously only `main.jsonl` was read, missing up to 46% of session credits when subagents (Explore, Plan, etc.) were used.
- **OTel memory bounded**: added 10,000-request retention cap to prevent unbounded memory growth in long-running VS Code sessions.
- **NaN guard in debug-log parser**: `parseInt(turnId)` result is now validated with `Number.isNaN()`; token fields use strict `typeof === "number"` checks instead of `Number()` coercion.
- **Estimation note corrected**: fallback credit estimate note now accurately states "~5-10% undercount for Anthropic models" instead of the incorrect "upper-bound estimate".
- **README date typo**: fixed "June 2025" → "June 2026" to match actual AIC billing launch date.

### Changed

- **Fully async scanner**: all synchronous `fs.*Sync` calls replaced with `fs/promises` async I/O. File discovery and parsing run with 16-worker concurrent pools. Extension host thread is never blocked.
- **Zero `any` types**: entire codebase (`scanner.ts`, `otelReceiver.ts`, `extension.ts`) rewritten with `unknown` and proper type narrowing. No implicit or explicit `any` remains.
- **`Promise.withResolvers`**: replaced `new Promise((resolve, reject) => ...)` pattern with modern `Promise.withResolvers()` API.
- **ESLint async rules**: added `no-floating-promises`, `no-misused-promises`, `require-await` to prevent async regressions.
- **README updated**: Data Sources section now documents debug-logs directory structure including subagent files.

## [1.5.5] - 2026-06-01

### Changed

- Added `.history/` and `copilot_all_tools.jsonl` to `.gitignore`

## [1.5.4] - 2026-06-01

### Added

- **Per-request AIC display**: status bar now shows `AIC(sess):X Req:Y` — session total and last request credits side by side
- **Live OTel AIC cards**: dashboard Live OTel section shows "AIC (sess)" and "AIC (last req)" stat cards
- `sessionAIC` and `lastRequestAIC` fields added to `LiveOtelData` for both OTel and debug-log fallback paths
- `lastRequest` exposed on `LiveStats` from the OTel receiver for per-request credit calculation

### Fixed

- **Performance regression — mtime-based file cache**: scanner now skips re-parsing unchanged session and debug-log files (mtime check). First scan is full-cost; subsequent scans near-instant for unchanged files
- **Performance — dashboard data caching**: `buildData()` returns cached result if neither scan nor OTel request count changed
- **Performance — OTel debounce (2s)**: rapid-fire span arrivals no longer trigger per-span full rebuilds; updates batched into 2-second throttled cycles
- **Performance — turnsAll capped at 500**: webview payload reduced from 8000+ turn rows to 500 most recent — faster initial HTML render and `postMessage` transfers
- **Missing model rate for gpt-4o-mini**: added explicit `gpt-4o-mini` (15/60/7.5 per M) and `gpt-4o` (250/1000/125 per M) rate entries so OTel-only fallback uses correct cheap rates instead of expensive GPT-4.1 default

### Changed

- Removed "Output Credits", "Cache Savings", and "Remaining" cards from AIC section (always showed 0 without per-request cache data from API)
- Status bar tooltip labels clarified: "AI Credits (session total)" and "AI Credits (last request)"
- Scan logging now includes elapsed time in ms for profiling

## [1.5.3] - 2026-06-01

### Fixed

- **`AIC(cur)` now scoped to the active VS Code instance only**: previously showed the most-recent session from all workspaces (shared storage scan). Now records `activationTime` on extension start and counts only turns/credits that arrived after that point — so opening a different repo in a new window shows its own independent `AIC(cur)`.
- **Live OTel takes priority for `AIC(cur)`**: when the OTLP receiver has data it is used directly (already instance-scoped, in-memory). Debug-log fallback uses the `activationTime` filter.

## [1.5.2] - 2026-06-01

### Fixed

- **Credits by Model missing OTel-only models**: when the scanner had any turns for today, all live OTel data was silently skipped even for models the scanner never saw. Now only models already in today's scanner data are excluded (to prevent double-counting); OTel models not present in scanner data are always included.

## [1.5.1] - 2026-06-01

### Added

- OTel receiver startup self-test: after binding, GETs `/healthz` and logs reachability result to the "Copilot Usage" output channel
- Diagnostic config summary logged on activation: `enabled`, `exporterType`, `otlpEndpoint`, `captureContent`, `dbSpanExporter` state with actionable tips
- Dropped-span diagnostics: traces filtered out due to missing token data now log their `gen_ai.operation.name` and full attribute key list for format debugging

### Fixed

- Widened child-span token search: previously only `panel/*` child spans were checked for `promptTokens`/`completionTokens`; now all child spans are searched — handles cases where Copilot places token data on a non-root span
- `promptTokens` and `completionTokens` changed from `const` to `let` to allow child-span enrichment

## [1.5.0] - 2026-06-01

### Added

- Parse `copilotUsageNanoAiu` from debug-log `llm_request` entries — the exact billing amount GitHub's API reports per call
- `debugAicCredits` per turn and `debugTotalAicCredits` per session populated from actual API data
- Dashboard badge: green "✓ Actual billing data" when using API values, yellow "⚠️ Upper-bound estimate" when falling back to computed rates
- `AIC-PROCESSING-PIPELINE.md` explainer documenting the full 6-step credit pipeline

### Changed

- Credit calculation now prioritizes actual API billing data (`nanoAiu / 1e9`) over computed per-model rates
- Computed rates (500/M input) are now fallback-only — used when debug-log data is unavailable
- `computeSummary()` accepts optional `actualCredits` field to bypass rate computation entirely

### Fixed

- **77% over-estimation eliminated**: previous versions treated all input tokens at 500 credits/M, ignoring that ~98% are cache_read tokens billed at 50 credits/M
- Verified result: 3,098 actual credits vs 13,500 previously computed for same session
- AIC under-counting (~30%) when chatSession JSONL hasn't flushed all turn results to disk
- Scanner now creates synthetic turns from debug-log data for unflushed entries

## [1.4.0] - 2026-06-01

### Added

- AI Credits (AIC) calculation engine (`aicCredits.ts`) with all 22 official model rates
- Auto-detect promotional period (June 1 – September 1, 2026) with dual overage display
- Per-session AI Credits column in sessions table
- Calendar heatmap for daily credit usage in current billing cycle month
- Status bar now shows current active session only (model, tokens, AIC credits)
- Configurable AIC settings: `copilotUsage.aic.plan`, `.billingCycleStartDay`, `.monthlyCreditsIncluded`, `.overageCostPerCredit`, `.customModelCosts`
- Upper-bound estimation warning when cached token data is unavailable
- OTel + scanner double-counting prevention guard

### Changed

- AIC calculations only include data on or after June 1, 2026 (AIC effective date)
- Status bar displays current session details instead of all-session aggregate
- Dashboard Overage section shows both "With Promo" and "Without Promo" costs during promotional window

### Fixed

- Potential double-counting of tokens when both OTel live data and scanner data exist for the same day

## [1.2.0] - 2026-05-25

### Added

- Show all tools and projects instead of limiting to top 10

### Changed

- Charts rendered in scrollable frames to prevent stretching after filter clicks, refreshes, and webview visibility changes
- Build instructions updated in README

### Fixed

- Dashboard charts no longer stretch after filter clicks, refreshes, or status-bar opens (stale canvas dimensions reset)

## [1.1.0] - 2026-05-20

### Added

- Debug-log integration: scanner now parses `debug-logs/main.jsonl` for actual per-API-call token counts
- Sessions enriched with `debugTotalPrompt`, `debugTotalOutput`, `debugLogPath`
- Turns enriched with `debugPromptTokens`, `debugOutputTokens`
- `debugLogSessions` stat added to ScanStats

### Changed

- Dashboard prefers actual debug-log tokens over chatSession snapshot estimates
- Timestamps default to local timezone (hourly chart, generatedAt, lastSeen)

## [1.0.9] - 2026-04-15

### Added

- OTel receiver diagnostic logging via Output channel
- Protobuf content-type detection with graceful fallback
- Automatic `outfile` conflict resolution — removes outfile setting that overrides HTTP export

### Fixed

- OTel settings now correctly detect and clear `outfile` conflicts that prevent live telemetry

## [0.1.7] - 2026-04-10

### Changed

- Repository branding and configuration
- Added `repo.config.json` and `apply-repo-config.js` for repo-independent configuration

## [0.1.6] - 2026-04-10

### Added

- Light theme support with warm beige palette
- Date range filters (Today / 7d / 30d / All)
- Hourly distribution chart
- Dual-axis daily usage chart (tokens + sessions)

### Changed

- In-place data updates via `postMessage` to eliminate refresh flash
- Install docs now point to VS Code Marketplace

### Fixed

- Subagent card size now matches Top Tools chart-card layout
- Removed duplicate `});` in `renderDaily` that broke all chart rendering
- Lint warnings cleaned up

## [0.1.4] - 2026-03-01

### Changed

- Version bump for Marketplace release

## [0.1.3] - 2026-02-15

### Added

- Initial VS Code Marketplace listing
- Extension icon with Copilot goggles and gradient bars

### Fixed

- Persist range/refresh/model selections across dashboard refreshes

### Changed

- README header restored with icon, tagline, and badges

## [0.1.2] - 2026-01-15

### Added

- Token counts (prompt, output, cached) per session, model, project, and day
- Session browser with title, preview, duration, tools, and subagent usage
- Clickable links to session log and transcript JSONL files
- Model breakdown across Claude, GPT, Gemini families
- Daily usage trends (stacked bar chart)
- Tool and subagent call tracking
- Live OpenTelemetry receiver (OTLP HTTP on port 14318)
- Premium usage estimation with model multipliers
- Auto-refresh (30s / 1m / 2m / 5m / Off) and manual refresh
- Status bar with session count and token totals
- Multi-root workspace support

[Unreleased]: https://github.com/pvjagtap/github-copilot-usage-dashboard/compare/v1.10.2...HEAD
[1.10.2]: https://github.com/pvjagtap/github-copilot-usage-dashboard/compare/v1.9.21...v1.10.2
[1.9.21]: https://github.com/pvjagtap/github-copilot-usage-dashboard/compare/v1.5.8...v1.9.21
[1.5.8]: https://github.com/pvjagtap/github-copilot-usage-dashboard/compare/v1.5.7...v1.5.8
[1.5.7]: https://github.com/pvjagtap/github-copilot-usage-dashboard/compare/v1.5.5...v1.5.7
[1.5.5]: https://github.com/pvjagtap/github-copilot-usage-dashboard/compare/v1.5.4...v1.5.5
[1.5.4]: https://github.com/pvjagtap/github-copilot-usage-dashboard/compare/v1.5.3...v1.5.4
[1.5.3]: https://github.com/pvjagtap/github-copilot-usage-dashboard/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/pvjagtap/github-copilot-usage-dashboard/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/pvjagtap/github-copilot-usage-dashboard/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/pvjagtap/github-copilot-usage-dashboard/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/pvjagtap/github-copilot-usage-dashboard/compare/v1.2.0...v1.4.0
[1.2.0]: https://github.com/pvjagtap/github-copilot-usage-dashboard/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/pvjagtap/github-copilot-usage-dashboard/compare/v1.0.9...v1.1.0
[1.0.9]: https://github.com/pvjagtap/github-copilot-usage-dashboard/compare/v0.1.7...v1.0.9
[0.1.7]: https://github.com/pvjagtap/github-copilot-usage-dashboard/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/pvjagtap/github-copilot-usage-dashboard/compare/v0.1.4...v0.1.6
[0.1.4]: https://github.com/pvjagtap/github-copilot-usage-dashboard/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/pvjagtap/github-copilot-usage-dashboard/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/pvjagtap/github-copilot-usage-dashboard/releases/tag/v0.1.2

