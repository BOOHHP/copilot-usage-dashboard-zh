const fs = require("fs");
const path = require("path");
const changelog = path.join("C:\\Users\\junfeng\\cud-zh-build", "changelog.md");
let t = fs.readFileSync(changelog, "utf8");
if (t.includes("1.11.4-zh")) { console.log("already inserted"); process.exit(0); }
const entry = [
  "## [1.11.4-zh] - 2026-09-18 (Chinese localization fork)",
  "",
  "### Added",
  "",
  "- 🌐 中英双语切换：主仪表盘、侧边栏、状态栏 tooltip 三处界面统一，右上角「中文 / EN」即时切换，选择跨重开保持。",
  "- 📤 用量导出：命令面板 `Copilot Usage: Export Stats` 或仪表盘「⤓ 导出」按钮，按 Dashboard 分类导出 Markdown / JSON 统计。",
  "- ↺ 「重置」按钮：刷新不再重置筛选视图；显式点击「↺ 重置」才恢复默认（保留当前语言）。",
  "",
  "### Fixed",
  "",
  "- 刷新（含自动刷新）不再冲掉模型筛选 / 时间范围 / 时区选择。",
  "- 语言与筛选状态持久化到 globalState：关闭并重开仪表盘后保持上次的中文与筛选。",
  "",
  "---",
  "",
  "",
].join("\n");
const i = t.indexOf("### ");
if (i < 0) { console.log("NO ANCHOR"); process.exit(1); }
t = t.slice(0, i) + entry + t.slice(i);
fs.writeFileSync(changelog, t, "utf8");
console.log("changelog updated at", i);
