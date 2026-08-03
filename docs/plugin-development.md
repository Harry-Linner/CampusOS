# CampusOS 插件开发文档

## 概览

CampusOS 插件是 `.campusmod` 格式的 ZIP 包。插件是用户可在扩展页启用、禁用和卸载，并在左侧栏贡献一个完整功能模块的产品单元。

数据连接器、同步作业、事件投影、排程算法、搜索索引、通知策略和系统导出由 Core 托管，不属于第三方插件类型。插件可以读取已授权的版本化 capability，但不能提供纯后台入口或绕过 Core 访问数据源。

## 产品约束

每个插件必须：

1. `kind` 为 `feature`。
2. 恰好声明一个 `location: "activity"` 的视图。
3. 使用由插件 ID 推导出的唯一 `activityTarget`。
4. 为该入口提供完整、可独立理解的工作区。
5. 把子功能放在页面内部标签或二级路由中，不再注册一级入口。
6. 在禁用、卸载或依赖阻塞后移除其左侧栏入口。

纯后台包、零视图包、多活动视图包和 connector 包均不属于支持的 `.campusmod` 产品形态。

## 最小 manifest.json

```json
{
  "id": "org.example.study-tools",
  "name": "study-tools",
  "displayName": "学习工具",
  "version": "1.0.0",
  "apiVersion": 2,
  "kind": "feature",
  "description": "一个带完整工作区的示例插件。",
  "icon": "BookOpen",
  "permissions": ["storage:local"],
  "sourceScope": ["workspace:local"],
  "releaseStage": "ready",
  "provides": [],
  "requires": [],
  "optionalRequires": [],
  "contributes": {
    "views": [
      {
        "id": "study-tools-main",
        "title": "学习工具",
        "icon": "BookOpen",
        "location": "activity",
        "activityTarget": "mod-org-example-study-tools",
        "order": 100
      }
    ]
  }
}
```

## renderer.js 入口

第三方 renderer 在独立 `campusmod://` origin iframe 中运行。当前 host contract 只提供冻结的 `apiVersion` 和 `pluginId`；不要假设可以访问 CampusOS React 树、Node、Electron IPC、文件系统或网络。

```javascript
const root = document.querySelector("#app");

if (root) {
  root.textContent = "学习工具已启动";
}
```

## 打包与安装

```text
zip study-tools.campusmod manifest.json renderer.js
```

通过扩展页文件选择器安装 `.campusmod`。安装成功后默认停用，用户确认权限并启用后，插件的唯一入口才会显示在左侧栏。

## Manifest v2 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 反向域名格式，如 `org.example.study-tools` |
| `name` | string | 简短标识 |
| `displayName` | string | 用户可见模块名 |
| `version` | string | SemVer 版本号 |
| `apiVersion` | 2 | 固定为 2 |
| `kind` | `"feature"` | 当前可执行插件只支持用户功能模块 |
| `description` | string | 功能描述 |
| `icon` | string | 左侧栏图标名 |
| `permissions` | `CampusPermission[]` | 安装时逐项确认的权限 |
| `sourceScope` | `string[]` | 数据使用范围 |
| `releaseStage` | `"ready"` \| `"placeholder"` | 发布状态；placeholder 不可作为可用模块 |
| `provides` | `PluginCapability[]` | 对外提供的版本化能力 |
| `requires` | `PluginCapability[]` | 启用所需能力 |
| `optionalRequires` | `PluginCapability[]` | 缺失时仍可工作的增强能力 |
| `contributes.views` | 单元素数组 | 恰好一个一级活动视图 |
| `contentHash` | string | 可选 SHA-256 内容摘要 |
| `developerSignature` | string | 可选 Ed25519 签名 |
| `developerPublicKey` | string | 可选开发者公钥 |

`contributes.syncJobs`、`contributes.settings`、`contributes.searchProviders` 和 `contributes.commands` 当前不对第三方包开放。

## 权限与能力

当前第三方插件只开放 `storage:local`。网络、认证、通知、领域存储和 Core IPC 均未开放，manifest 中声明也不会获得执行权。

能力使用 `{name}@{version}` 格式。官方模块与 Core 连接器的能力边界见 [Celechron 对照的模块设计](design/celechron-inspired-plugin-suite.md)。插件不得按 provider ID 调用或直接 import 其他插件。

## 安全模型

- 插件不能读取密码、Cookie、Session、ticket、token 或原始响应。
- iframe 使用独立 secure origin、严格 CSP、无 preload、无 Node、无通用网络。
- 安装、升级、损坏隔离和卸载遵循 [`.campusmod` 包格式](architecture/campusmod-package-format.md)。
- `contentHash`、`developerSignature` 和 `developerPublicKey` 必须同时出现；签名不授予额外权限。
- 第三方 headless/main 执行不在支持范围内。

## 验证

插件作者至少验证：

1. manifest 只有一个 activity view。
2. 启用时出现一个入口，禁用和卸载后入口消失。
3. iframe 无法访问 Node、Electron IPC、宿主文档和网络。
4. 空态、错误态、键盘焦点和窄窗口布局可用。
5. 包内不含凭据、私有数据、构建缓存或未声明文件。
