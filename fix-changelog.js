const fs = require("fs");
const changelog = "C:\\Users\\junfeng\\cud-zh-build\\changelog.md";
let t = fs.readFileSync(changelog, "utf8");
t = t.replace(
  "## [1.11.4-zh] - 2026-09-18 (Chinese localization fork)",
  "## [1.11.5-zh] - 2026-09-18 (Chinese localization fork)"
);
t = t.replace(
  "- ↺ 「重置」按钮：刷新不再重置筛选视图；显式点击「↺ 重置」才恢复默认（保留当前语言）。",
  [
    "- ↺ 「重置」按钮：显式恢复默认筛选（保留当前语言）。",
    "",
    "### Fixed",
    "",
    "- 每日积分日历/图表不再把 GitHub 与本地的对账差额摊到最近一天——此前某一天的数值会接近整个周期总量。每日现在只显示本地可见的真实逐日消耗；差额作为独立「未归属用量」口径对账，hero 总数仍与 GitHub 一致。",
  ].join("\n")
);
fs.writeFileSync(changelog, t, "utf8");
console.log("has 1.11.5-zh:", t.includes("1.11.5-zh"));
console.log("has daily fix:", t.includes("未归属用量"));
console.log("still has 1.11.4-zh:", t.includes("1.11.4-zh"));
