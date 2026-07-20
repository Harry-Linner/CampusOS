# Issue tracker: GitHub

Issues 和 PRD 存放在本仓库的 GitHub Issues 中。所有操作使用 `gh` CLI。

## 操作约定

- **创建 issue**：`gh issue create --title "..." --body "..."`。多行正文用 heredoc。
- **查看 issue**：`gh issue view <number> --comments`，用 `jq` 过滤评论，同时获取标签。
- **列出 issue**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，配合 `--label` 和 `--state` 过滤。
- **评论 issue**：`gh issue comment <number> --body "..."`
- **添加/移除标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭**：`gh issue close <number> --comment "..."`

仓库信息从 `git remote -v` 推断——`gh` 在仓库内运行时会自动识别。

## 当技能说"发布到 issue tracker"

创建一个 GitHub Issue。

## 当技能说"获取相关 ticket"

运行 `gh issue view <number> --comments`。
