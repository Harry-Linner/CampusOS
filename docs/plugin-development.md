# CampusOS 插件开发文档

## 概览

CampusOS 插件是 `.campusmod` 格式的 ZIP 包，包含 `manifest.json`、入口代码与资源文件。插件通过 Manifest v2 声明能力依赖、权限与贡献点，由 Plugin Runtime v2 进行生命周期管理。

## 快速开始

### 1. 最小 manifest.json

```json
{
  "id": "org.example.hello-world",
  "name": "hello-world",
  "displayName": "Hello World",
  "version": "1.0.0",
  "apiVersion": 2,
  "kind": "feature",
  "description": "一个示例插件。",
  "icon": "Extensions",
  "permissions": ["storage:local"],
  "sourceScope": ["workspace:calendar"],
  "releaseStage": "ready",
  "provides": [],
  "requires": [],
  "optionalRequires": [],
  "contributes": {
    "views": [
      {
        "id": "hello-main",
        "title": "Hello",
        "icon": "Extensions",
        "location": "activity",
        "activityTarget": "mod-org-example-hello-world",
        "order": 10
      }
    ]
  }
}
```

### 2. renderer.js 入口

```javascript
// 接收 PluginComponentProps
export function Component({ snapshot, capabilities, onRefresh, loading }) {
  const div = document.createElement("div");
  div.innerHTML = "<h1>Hello CampusOS</h1>";
  return div;
}
```

### 3. 打包与安装

```
zip hello-world.campusmod manifest.json renderer.js
```

拖入 `.campusmod` 文件到扩展面板，或通过文件选择器安装。

## Manifest v2 字段参考

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 反向域名格式，如 `org.example.my-plugin` |
| `name` | string | 简短标识 |
| `displayName` | string | 用户可见名称 |
| `version` | string | SemVer 版本号 |
| `apiVersion` | 2 | 固定为 2 |
| `kind` | `"connector"` \| `"feature"` | connector 提供能力，feature 消费能力 |
| `description` | string | 功能描述 |
| `icon` | string | 图标名称 |
| `permissions` | `CampusPermission[]` | 权限声明 |
| `sourceScope` | `string[]` | 数据源范围 |
| `releaseStage` | `"ready"` \| `"placeholder"` | 发布状态 |
| `provides` | `PluginCapability[]` | 提供的能力，如 `"calendar.events@1"` |
| `requires` | `PluginCapability[]` | 必需的能力 |
| `optionalRequires` | `PluginCapability[]` | 可选的能力 |
| `contributes.views` | `PluginActivityView[]` | UI 视图贡献 |
| `contributes.syncJobs` | `string[]` | 后台同步任务 |
| `contributes.settings` | `string[]` | 设置页面贡献 |
| `contentHash` | string | 可选：SHA-256 内容哈希 |
| `developerSignature` | string | 可选：Ed25519 签名 |
| `developerPublicKey` | string | 可选：开发者公钥 |

## 权限模型

| 权限 | 说明 |
|------|------|
| `storage:local` | 本地存储（唯一对第三方开放的权限） |
| `storage:domain:{name}` | 按命名空间隔离的持久化存储 |
| `notification` | 桌面通知 |
| `network:https://host` | 网络请求到指定 origin |
| `auth:service:https://host` | 认证代理到指定服务 |

## 能力契约

能力通过 `{name}@{version}` 格式声明。当前可用能力见 [插件集设计](design/celechron-inspired-plugin-suite.md)。

## 安全模型

- **凭据不落地**：插件不能直接读写密码、Cookie 或 Session
- **沙箱隔离**：第三方 renderer 运行在独立 `campusmod://` origin iframe，无 Node/网络全局
- **headless 沙箱**：第三方 headless 代码在 QuickJS/WASM 内执行，CPU/内存/堆栈受限
- **权限最小化**：manifest 中声明的权限在安装时逐项确认
- **官方与第三方边界**：内置 `org.campusos.*` 插件首次启用时只获得自身 manifest 已声明的权限；第三方 `.campusmod` 始终需要安装时逐项确认，不能继承官方默认授权
- **包签名**：`contentHash`、`developerSignature` 与 `developerPublicKey` 必须同时出现；它们对移除自身后的 manifest 和所有其他文件摘要构成的规范载荷执行 Ed25519 验证。`verified` 仅证明签发密钥，不授予额外权限或 headless 执行权。

## 调试方法

1. 设置页 → 诊断与测试 → 查看各连接器刷新状态
2. 导出 TXT 诊断日志用于问题排查
3. `pnpm --filter @campusos/core verify:zju-auth` 运行脱敏认证测试
