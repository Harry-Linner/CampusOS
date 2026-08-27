# 全局搜索热键（Ctrl+F + 可自定义）调研

**日期:** 2026-08-25
**定位:** #3d 调研结论（不改代码，待与用户确认后实施）。背景：当前全局搜索用 Ctrl+K 打开、无快捷键设置入口；拟改为默认 Ctrl+F 并在全局设置中提供修改入口。
**来源:** 均为 web_search 实际返回链接；未确认处已明确标注。

---

## 1. 主流应用如何实现可自定义搜索热键

### VS Code：keybindings.json + Keyboard Shortcuts 编辑器 + when 子句
- 三层机制（[Keybindings 官方文档](https://code.visualstudio.com/docs/configure/keybindings)）：可视化编辑器（Ctrl+K Ctrl+S）可搜索命令、逐条录制、冲突标红；`keybindings.json` 支持 `key`/`command`/`when` 字段；**`when` 是上下文条件**（如 `!inputFocus` = 焦点不在输入框时才生效）——这是"焦点在输入框里要不要触发"的标准解法。
- 默认键位（[参考](https://code.visualstudio.com/docs/reference/default-keybindings)）：**Ctrl+F = 页内查找，Ctrl+Shift+F = 全局搜索**，是最主流双键位先例。注意 VS Code 命令面板默认是 Ctrl+Shift+P/F1，Ctrl+K 是"和弦前缀"，不是命令面板——Ctrl+K 心智主要来自 Slack/Discord/Obsidian。

### Obsidian：Hotkeys 面板（可搜索、可点击录制）
- 设置 → Hotkeys 面板列出全部命令、点击录制、按命令名搜索、恢复默认（[官方帮助](https://obsidian.md/help/hotkeys)、[中文版](https://obsidian.md/zh/help/hotkeys)）。
- 默认键位也是 Ctrl+F 页内 / Ctrl+Shift+F 全库；中文论坛有真实反馈"编辑状态下 Ctrl+Shift+F 调不出库搜索"（[帖子](https://forum-zh.obsidian.md/t/topic/7759/7)）——正是"焦点在编辑器里全局快捷键被吃掉"的实测反面教材。

### Notion / 语雀
- **Notion**：Quick Find 用 **Cmd/Ctrl+P**，刻意避开 Ctrl+F（页内）和 Ctrl+K（[官方快捷键](https://www.notion.com/help/keyboard-shortcuts)、[搜索文档](https://www.notion.com/en-gb/help/search)）；未提供官方自定义入口。
- **语雀**：提供快捷键设置能力（[官方帮助](https://www.yuque.com/yuque/vecyyc/bvul2q)）；全局搜索默认键位未找到可靠来源，不下结论。

### Slack / Discord：把"全局跳转/搜索"绑在 Ctrl+K
- Slack：官方确认 **Ctrl+K / Ctrl+T = Quick Switcher（全局跳转）**（[官方帮助](https://slack.com/intl/zh-cn/help/articles/115003340723-使用键盘浏览-Slack)）；Ctrl+F 列为打开搜索仅见于第三方汇总，官方正文未直接确认。
- Discord：第三方汇总一致确认 Ctrl+K = 快速切换器（[keyboardista](https://www.keyboardista.com/en/shortcuts/discord-app/)、[guidingtech](https://www.guidingtech.com/discord-keyboard-shortcuts/)）。
- 启示：当前 CampusOS 用 Ctrl+K 的依据正是 Slack/Discord 心智；改到 Ctrl+F 后可在设置里把 Ctrl+K 保留为可选项。

### Alfred / Raycast / PowerToys Run：启动器把"唤起"绑 Space 系，均可改
- Raycast：命令级 alias/hotkey 配置 + 冲突提示（[官方手册](https://manual.raycast.com/v1/command-aliases-and-hotkeys)）。
- Alfred：热键在 Preferences 配置，默认 ⌥Space（[官方文档](https://www.alfredapp.com/help/getting-started/preferences-search/)）。
- PowerToys Run：默认 Alt+Space 可改（[微软官方](https://learn.microsoft.com/windows/powertoys/run)）。
- 启示：**系统级全局唤起方向是 Space 系组合，不是 Ctrl+F**；Ctrl+F 留给应用内。

## 2. Ctrl+F：全局搜索 vs 页内查找的取舍

- **浏览器扩展无法覆盖 Ctrl+F**（Chromium 硬限制，[SO](https://stackoverflow.com/questions/66701875/which-chrome-shortcuts-cant-be-overwritten?rq=1)）。
- **编辑器/IDE 惯例**：Ctrl+F 页内、Ctrl+Shift+F 全局（VS Code、[Sublime](https://tms-outsource.com/blog/posts/sublime-text-keyboard-shortcuts/)、JetBrains 一致）。
- **用 Ctrl+F 做全局搜索的产品**（无页内查找概念时成立）：Windows 资源管理器（[联想知识库](https://iknow.lenovo.com.cn/spider/detail/kd/126089)）、Slack（第三方汇总）。
- **结论**：CampusOS 没有页内查找 → Ctrl+F = 全局搜索完全成立，且符合用户直觉；若未来做页内查找，用 Ctrl+Shift+F（"范围更大"的通用组合），勿把 Ctrl+F 让给页内。

## 3. Electron 中捕获 Ctrl+F 的正确方式

**关键事实**：Electron 无内建"浏览器默认查找"会自动弹出——find-in-page 是 `webContents.findInPage()` API，需应用自己调用并提供 UI（[SO](https://stackoverflow.com/questions/33837760)、[SO](https://stackoverflow.com/questions/76213701)）。所谓"冲突"是①应用自己的 find 绑定、②主进程菜单 accelerator 与 before-input-event 互相吞键。

三种拦截途径：
1. **主进程 `before-input-event`**（[commit a3b65ad](https://github.com/electron/electron/commit/a3b65ad48157e5f50f056de1fc05e9c1a507e3c3)）：监听 `keyDown + key==='f' + control && !alt && !meta` → `preventDefault()` → IPC 打开搜索。官方推荐。
2. **菜单 accelerator**：把"全局搜索"注册为菜单项（[globalShortcut](https://www.electronjs.org/docs/latest/api/global-shortcut)），应用聚焦时生效。
3. 渲染进程 keydown + preventDefault：最简单，但覆盖不了主进程菜单快捷键。

**关键坑**：Electron issue [#19279](https://github.com/electron/electron/issues/19279) 明确——**before-input-event 里 preventDefault 会连菜单 accelerator 一起吞掉**。必须把 Ctrl+F 的消费方定为单一通道，避免双通道打架。

**推荐**：主进程 `before-input-event` 单一通道拦截 Ctrl+F（preventDefault + IPC）；若未来做页内查找用 Ctrl+Shift+F；"一个键只有一个消费方"。

## 4. 冲突处理最佳实践

- **焦点在输入框**：行业标准是上下文条件（VS Code when 子句）。建议：无页内查找时，焦点在输入框里 Ctrl+F 仍触发全局搜索；设置里提供"焦点在输入框时仍打开全局搜索"开关（默认开）。Obsidian 反例说明不做上下文管理会静默失效。
- **输入法冲突**：启动器普遍避开 Ctrl+Space（中文输入法切换中英文占用）；Ctrl+F 与常见中文输入法无直接冲突，但建议中文输入法开启状态做真机验收。"Ctrl+Space 与输入法冲突"未找到权威来源，按行业惯例处理。
- **设置入口 UI 形态**（复杂度递增）：Obsidian 录制式列表 / VS Code 键位表+JSON / Raycast 命令级配置 / 独立录制控件（[Shortcut Recorder](https://fwdtools.com/ui-snippets/shortcut-recorder/)）。
- **推荐**：设置页新增"快捷键"分组，Obsidian 式列表+点击录制，含"打开全局搜索"（可扩展多条），冲突检测+恢复默认，键位改动即时生效并持久化（JSON 存储）。

## 5. 对 CampusOS 的落地建议

1. 默认 Ctrl+F 打开全局搜索，Ctrl+K 保留为可选绑定（习惯 Slack/Discord 的用户可切回）。
2. 拦截通道定单一处：主进程 before-input-event + preventDefault + IPC；不在渲染进程 keydown 和菜单 accelerator 同时注册。
3. 页内查找（未来）用 Ctrl+Shift+F，Ctrl+F 保持全局搜索。
4. 焦点在输入框时默认仍触发；提供开关。
5. 设置页"快捷键"分组：点击录制 + 冲突提示 + 恢复默认 + JSON 持久化。
6. 验收：中文输入法开启状态下实测；焦点在搜索框内实测无意外行为。

## 6. 来源

- [Keybindings - VS Code](https://code.visualstudio.com/docs/configure/keybindings)
- [Default keyboard shortcuts - VS Code](https://code.visualstudio.com/docs/reference/default-keybindings)
- [Hotkeys - Obsidian](https://obsidian.md/help/hotkeys) / [中文](https://obsidian.md/zh/help/hotkeys)
- [Notion Keyboard shortcuts](https://www.notion.com/help/keyboard-shortcuts) / [Search](https://www.notion.com/en-gb/help/search)
- [Slack 键盘导航](https://slack.com/intl/zh-cn/help/articles/115003340723-使用键盘浏览-Slack)
- [Raycast Command Aliases and Hotkeys](https://manual.raycast.com/v1/command-aliases-and-hotkeys)
- [PowerToys Run](https://learn.microsoft.com/windows/powertoys/run)
- [globalShortcut - Electron](https://www.electronjs.org/docs/latest/api/global-shortcut)
- [electron/electron#19279](https://github.com/electron/electron/issues/19279)
- [Chrome 快捷键不可覆盖 - SO](https://stackoverflow.com/questions/66701875/which-chrome-shortcuts-cant-be-overwritten?rq=1)
- [Electron find-in-page - SO](https://stackoverflow.com/questions/33837760)
- [before-input-event commit](https://github.com/electron/electron/commit/a3b65ad48157e5f50f056de1fc05e9c1a507e3c3)
- [Obsidian 中文论坛：编辑态 Ctrl+Shift+F 失效](https://forum-zh.obsidian.md/t/topic/7759/7)
- [Shortcut Recorder UI](https://fwdtools.com/ui-snippets/shortcut-recorder/)
- [联想知识库：资源管理器快捷键](https://iknow.lenovo.com.cn/spider/detail/kd/126089)
