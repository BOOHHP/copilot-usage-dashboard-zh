# Copilot Usage Dashboard 中文版

> **中文汉化版（Community Chinese Localization）**
>
> 本扩展是 [Copilot Usage Dashboard](https://github.com/pvjagtap/github-copilot-usage-dashboard)（作者 pvjagtap，MIT 许可）的**中文汉化分支**，功能与原版一致，并新增：
>
> - 🌐 **中英双语切换**：主仪表盘、左侧侧边栏、状态栏 tooltip 三处界面统一，点击右上角「中文 / EN」按钮即时切换，选择自动记忆。
> - 📤 **用量导出**：命令面板 `Copilot Usage: Export Stats` 或仪表盘「⤓ 导出」按钮，按 Dashboard 分类导出 Markdown / JSON 统计报告。
>
> 汉化与新增功能均为增量实现，不改动原版数据逻辑。感谢原作者的开源贡献。

<p align="center">
  <img src="https://github.com/pvjagtap/github-copilot-usage-dashboard/raw/HEAD/images/Dashboard_With_AIC.png" alt="Copilot Usage Dashboard">
</p>

A VS Code extension that shows token usage, AI Credits, and cost across GitHub Copilot Chat, [Oh My Pi](https://github.com/can1357/oh-my-pi), and [Pi](https://github.com/earendil-works/pi) sessions. Fully localized to Simplified Chinese with an in-app EN/中文 toggle.

## Install

```
npm install
npm run compile
npx @vscode/vsce package --allow-missing-repository
code --install-extension copilot-usage-dashboard-*.vsix
```

## Open

Command Palette → `Copilot Usage: Open Dashboard`

## Prompt-cache TTL

A cached prompt prefix is re-read at a fraction of the input rate, but providers
expire it after a few minutes of inactivity — and once it lapses the whole
conversation is re-billed in full. On a long agent session that is the
difference between a few credits and a few hundred.

Enable `copilotUsage.cacheTtl.enabled` to get a live countdown of how long each
session's cache stays warm, in the status bar, its tooltip, the sidebar, and the
sessions table. Sessions still generating show `HOT` instead of a countdown.

Lifetimes are per-provider under `copilotUsage.cacheTtl.ttl`. Only Anthropic
documents a TTL (~5 min), so treat the rest as tunable estimates rather than
billing guarantees.

## BYOK provider cost

Requests through your own endpoint — Azure AI Foundry, Anthropic, OpenAI, a
local Ollama — are not billed by GitHub. They appear in the non-billable panel,
where the credit columns show only what the traffic *would* have cost on
Copilot: a figure on no invoice you actually receive.

The **Provider cost** column applies your provider's real per-token rates to the
same traffic and reports USD. It is a different vendor's bill, so it is reported
separately and never added to your AI credits.

Anthropic-family rates ship as defaults at published Claude API prices, which
Anthropic documents as also being the Microsoft Foundry rate card. Override
anything under `copilotUsage.byokPricing`, including `regionMultiplier` for
Azure US Data Zone deployments (`1.1x`; Global Standard is `1.0x`).

Two limits worth knowing:

- A model with **no configured rate shows `—`, never `$0.00`.** An unpriced
  Azure deployment and a genuinely free local model must not look identical.
- The total is a **lower bound.** Anthropic charges `0.1x` for cache reads and
  `1.25x`–`2.0x` for cache writes, but VS Code records one undifferentiated
  `cached` count. Cached tokens are priced as reads;
  `copilotUsage.byokPricing.cacheWriteRatio` shifts the split if your workload
  writes more than it reads.

## Configure

Settings → search `copilotUsage`.

Common settings:

| Setting                                 | Default    | Purpose                                |
| --------------------------------------- | ---------- | -------------------------------------- |
| `copilotUsage.aic.plan`                 | `business` | Copilot plan for credit budget         |
| `copilotUsage.aic.overageCostPerCredit` | `0.01`     | USD per AI credit                      |
| `copilotUsage.dailyLimit.enabled`       | `false`    | Opt in to the daily spend guard        |
| `copilotUsage.dailyLimit.dollars`       | `0`        | Daily USD cap (0 = use credit cap)     |
| `copilotUsage.cacheTtl.enabled`         | `false`    | Opt in to the prompt-cache countdown   |
| `copilotUsage.byokPricing`              | built-ins  | Your own provider's per-token rates    |
| `copilotUsage.workspaceStoragePath`     | auto       | Override VS Code workspaceStorage root |

Full configuration reference, data sources, and internals: [ARCHITECTURE.md](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/ARCHITECTURE.md)

## License

MIT. Portions of the prompt-cache TTL feature are derived from
[cache-timer](https://github.com/sukumarp2022/cache-timer) (MIT © 2026
sukumarp2022) — see [NOTICE](https://github.com/pvjagtap/github-copilot-usage-dashboard/blob/HEAD/NOTICE).
