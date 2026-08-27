# 全局搜索 → 跳转定位 → 滚动聚焦 → 高亮 调研

**日期:** 2026-08-25
**定位:** #3a（搜索课程 → 课表定位）与 #3b（搜索资料 → 资料定位）调研结论（不改代码，待与用户确认后实施）。当前 CampusOS 全局搜索点击结果只做"切换视图"，不做定位/滚动/高亮。
**来源:** 均为 web_search 实际返回链接；未确认处已明确标注。

---

## 1. 各产品实现模式

### VS Code：命令面板 / Quick Open / 符号跳转
- **分层定位**：Ctrl+P 开文件 → Ctrl+Shift+O 文件内符号 → 跳转符号所在行（[Rune Hub](https://rune.codes/hub/vscode/how-to-find-files-and-symbols-fast-with-quick-open-in-vs-code)）。"文件级 → 符号级 → 行级"由浅入深。
- **滚动机制**：`TextEditor.revealRange` 把 range 滚入视野（RevealType 控制居中/仅可见），且**会强制把焦点移到编辑器**——跳转是"焦点提交型"动作（[revealRange API](https://jsr.io/@narumincho/vscode@1.98.0/doc/~/TextEditor.revealRange)、[issue #160953](https://github.com/microsoft/vscode/issues/160953)）。
- **高亮**：全局搜索（Ctrl+Shift+F）点击命中行 → 打开文件 + 光标定位 + **编辑器 decoration 高亮**（颜色走 `editor.findMatch*` 主题项）；高亮与"搜索会话"生命周期绑定，关闭搜索视图即消失（[SO](https://stackoverflow.com/posts/75849925/revisions)）。

### Obsidian / Logseq（块级笔记）
- **Obsidian**：全局搜索点击结果 → 打开笔记并滚动到命中文本，但目前**只在编辑模式生效**；预览模式不滚动也不高亮（两个功能请求帖证实该边界：[scroll-to-match](https://forum.obsidian.md/t/onclick-on-search-result-scroll-to-matched-text-also-in-preview-mode/9328)、[preview-mode-highlight](https://forum.obsidian.md/t/enhance-the-preview-mode-to-support-search-result-link-highlighting-in-line-level-granularity/9604/2)）；社区要求**保留搜索词**以便反复定位（[retain query](https://forum.obsidian.md/t/retain-search-query-on-focus-0-8-0/3482/3)）。
- **Logseq**：以"块（block）"为最小定位单位，第三方插件演示按块 ID 定位（[jump-to-block](https://github.com/freder/logseq-plugin-jump-to-block)）。
- **Roam**：未找到可靠来源描述完整链路，不下结论。

### Notion / 语雀 / 飞书
- **Notion**：全局搜索（Ctrl/Cmd+P）覆盖页面与块内容，点击打开页面（[官方](https://www.notion.com/en-gb/help/search)）；"打开后是否自动滚动到命中块并高亮"未找到可靠来源。
- **飞书**：官方文档把"**定位**"定义为全局搜索核心价值——搜索后跳转到对应文档位置（[飞书官方](https://bytedance.larkoffice.com/docx/doxcnF8VuuCbKr5RsDdLsN8LhJg)）。
- **语雀**：有全局搜索并打开文档（[指南](https://www.php.cn/faq/2359111.html)）；页内滚动+高亮未找到可靠来源。

### Google Docs / 浏览器 find-in-page
- Ctrl+F 高亮**所有**命中，当前命中不同色，回车/方向键切换，视图自动跟随（[指南](https://www.aboutchromebooks.com/how-to-search-for-keywords-on-google-docs/)）。
- "find 应滚动到当前匹配"是引擎层行为（[WebKit bug 304174](https://wiki.webkit.org/show_bug.cgi?id=304174)、[whatwg#6694](https://github.com/whatwg/html/issues/6694)）。
- 高亮：原生高亮 + CSS 伪元素 `::search-text` 等（[CSS-Tricks](https://css-tricks.com/how-to-style-the-new-search-text-and-other-highlight-pseudo-elements/)）；折叠/懒加载区先展开再滚动用 [beforematch 事件](https://raw.githubusercontent.com/WICG/display-locking/main/explainers/beforematch-spec-draft.md)——长列表"先展开目标区段再滚动"的标准参照。

### IDE：IntelliJ Search Everywhere
- 双击 Shift：单框搜类/文件/符号/动作/设置，回车即跳转（打开文件+光标定位）（[官方](https://www.jetbrains.com/help/idea/searching-everywhere.html)、[导航](https://www.jetbrains.com/help/idea/navigation-in-groovy.html)）。
- 启示：目标视图必须提供"按实体 ID 挂载后定位渲染"的编程接口，不能靠 DOM 全局搜索硬找。

### Spotlight / Alfred / Raycast
- 打开动作普遍**委托给默认应用**，"定位到文件内部"取决于目标应用是否暴露"打开并定位"入口（URL scheme/命令行参数/脚本）（[The Verge](https://on.theverge.com/23170431/raycast-how-to-macos-search-extensions-alfred-spotlight)、[Alfred 论坛](https://www.alfredforum.com/topic/19943-a-workflow-that-search-a-given-folder-for-files-with-a-particular-content/)）。
- **推论**：定位深度由目标应用决定 → CampusOS 必须自建"路由携带实体参数 + 视图定位"，否则外部入口只能停在视图级。

## 2. 共性设计原则

1. **搜索词保留在发起搜索的 UI**，目标页用高亮表达命中；目标页不渲染搜索词本身。建议：全局搜索框关闭后保留最近查询。
2. **高亮分三档**（均不写数据）：会话级持久（浏览器 find/IDE decoration）、Flash 型（跳转后短暂高亮淡出，[SO](https://stackoverflow.com/posts/76448842/edit)）、静态锚点型（`::target-text`）。建议两级：**跳转瞬间 flash + 本次导航会话内持续淡高亮**，离开视图自动清除。
3. **打开即定位是主流**（Obsidian 编辑模式、IntelliJ、文档 find 均无二次确认）。需要"再一步"的场景只有：定位深度分层（VS Code 先开文件再跳符号）、命中歧义（多个命中时回车切换）。CampusOS 应做到点击结果 → 视图打开即定位，多命中提供切换，无二次确认弹层。
4. **滚动实现**：`element.scrollIntoView({ behavior: 'smooth', block: 'center' })`（[MDN](https://developer.mozilla.org/zh-CN/docs/Web/API/Element/scrollIntoView)）；有固定头部用 `scroll-margin-top` 抵消（[SO](https://stackoverflow.com/posts/55683966/revisions)、[SO](https://stackoverflow.com/questions/79655256/scroll-margin-top-fails-to-offset-anchor-scroll-in-angular-app)）；长列表先展开目标区段再滚动（beforematch 模式）；**滚动时机必须是目标 DOM 已渲染之后**。

## 3. 深链接 / 路由参数注入：成熟实践

- **桌面深链接**：VS Code `vscode://file/<path>:<line>:<col>` 打开即定位到行列（[SO](https://stackoverflow.com/questions/70660122/how-can-i-get-the-application-url-of-a-line-of-code-in-visual-studio-code/70660381)、[deep-link-matrix](https://github.com/composio-community/awesome-codex-skills/blob/master/agent-deep-links/references/deep-link-matrix.md)）。
- **Web 标准 Text Fragments**：`#:~:text=关键词` 让浏览器自动滚动到命中文本并高亮，`::target-text` 定制样式（[MDN ::target-text](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/::target-text)、[URL Fragment Text Directives](http://developer.typescripts.org/en-US/docs/Web/API/URL_Fragment_Text_Directives)）。**"URL 即定位指令 + 原生高亮"的标准化实现**，SPA 可复用同一思想（内部路由参数化）。
- **SPA 路由**：query/hash 参数驱动"导航后滚动+激活高亮"是成熟模式（[svelte-spa-router link actions](https://svelte-spa-router.keenmate.dev/features/link-actions)）；深链接"稳定可寻址"原则（[DEEP_LINKING_PHILOSOPHY](https://github.com/ofri-peretz/eslint/blob/771ef7c949456d2e44c0d60dbfd41dfad4789b10/DEEP_LINKING_PHILOSOPHY.md)）。
- **Electron/Tauri**：Electron 用自定义协议 + `setAsDefaultProtocolClient`；Tauri 有官方 deep-linking 插件（[中文镜像](https://tauri.ubitools.com/zh-cn/plugin/deep-linking/)、[WebdriverIO 测试](https://webdriver.io/docs/desktop-testing/tauri/deeplink-testing/)）。
- **对 CampusOS 映射建议**：搜索结果点击 → 内部路由携带 `{view, semester, courseId/materialId}` → 目标视图读取参数、确保目标区块数据就绪并展开 → `scrollIntoView({block:'center'})`（配 scroll-margin-top）→ 临时高亮（flash + 会话级淡高亮）。

## 4. 来源

- [Rune Hub: Quick Open 指南](https://rune.codes/hub/vscode/how-to-find-files-and-symbols-fast-with-quick-open-in-vscode)
- [microsoft/vscode#160953（revealRange 强制焦点）](https://github.com/microsoft/vscode/issues/160953)
- [Obsidian: scroll to matched text（预览模式缺失）](https://forum.obsidian.md/t/onclick-on-search-result-scroll-to-matched-text-also-in-preview-mode/9328)
- [WebKit 304174: find-in-page scroll to matches](https://wiki.webkit.org/show_bug.cgi?id=304174)
- [JetBrains: Search Everywhere](https://www.jetbrains.com/help/idea/searching-everywhere.html)
- [SO: 平滑滚动到目标并高亮](https://stackoverflow.com/posts/76448842/edit)
- [MDN: URL Fragment Text Directives](http://developer.typescripts.org/en-US/docs/Web/API/URL_Fragment_Text_Directives)
- [SO: VS Code application URL（行列定位）](https://stackoverflow.com/questions/70660122/how-can-i-get-the-application-url-of-a-line-of-code-in-visual-studio-code/70660381)
