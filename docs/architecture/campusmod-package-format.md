# `.campusmod` 本地插件包格式与安装边界

**状态：** 安装与审查链路、受限 renderer sandbox v1 已实现；第三方 headless/main 执行未开放  
**日期：** 2026-07-19  
**关联决策：** [ADR-0001：能力驱动的 Plugin Runtime v2](../adr/0001-capability-driven-plugin-runtime.md)

## 1. 当前能力边界

`.campusmod` 是 ZIP 归档。当前版本支持通过扩展页文件选择器检查、确认、原子安装、升级、持久注册、损坏隔离和卸载。安装成功的第三方插件默认停用。只有符合 renderer sandbox v1 严格 profile、且用户明确授予 `storage:local` 的单活动视图插件可以启用；其他包继续保持 install-only，主进程不会执行其 `main`，renderer 也不会直接 `import()` 其代码。

安装器会显示 `unsigned`、`verified` 或 `invalid`。当 manifest 同时提供 `contentHash`、`developerSignature` 和 `developerPublicKey` 时，主进程使用 Ed25519 验证规范载荷：载荷包含移除签名字段后的完整 manifest（包括 entrypoint）以及所有非 manifest 文件的路径和 SHA-256。检查、安装和每次重载都会重算；部分签名字段会被拒绝，签名状态与安装记录不一致的目录会被隔离。签名只证明该包由对应私钥签发，不建立开发者信任目录，也不自动授权或开放第三方 headless 执行。

## 2. 归档结构

`manifest.json` 必须位于归档根目录。代码入口必须是归档内已有的 `.js` 或 `.mjs` 文件；声明 `syncJobs` 必须提供 `main`，声明 `views` 必须提供 `renderer`。

```text
example.campusmod
├── manifest.json
├── dist/
│   ├── main.js
│   └── renderer.js
└── assets/
    └── icon.svg
```

```json
{
  "id": "dev.example.countdown",
  "name": "countdown",
  "displayName": "考试倒计时",
  "version": "1.0.0",
  "apiVersion": 2,
  "kind": "feature",
  "description": "显示考试倒计时。",
  "icon": "Clock",
  "permissions": ["storage:local"],
  "sourceScope": ["local"],
  "releaseStage": "ready",
  "provides": [],
  "requires": [],
  "optionalRequires": [],
  "contributes": {
    "views": [
      {
        "id": "countdown-main",
        "title": "倒计时",
        "icon": "Clock",
        "location": "activity",
          "activityTarget": "mod-dev-example-countdown"
      }
    ]
  },
  "entrypoints": {
    "renderer": "dist/renderer.js"
  }
}
```

第三方 ID 必须使用小写反向域名格式，不能使用保留的 `org.campusos.*` 官方命名空间；版本必须是 SemVer，`placeholder` 包不能安装。`credential` 永远不是合法权限，网络与认证权限必须声明精确 HTTPS origin。

## 3. 安装事务

1. renderer 请求主进程打开原生 `.campusmod` 文件选择器。
2. 主进程读取并校验 ZIP，只向 renderer 返回清单、权限、大小、文件数、摘要和 10 分钟有效的一次性确认 token；源码正文和源文件路径不进入 IPC。
3. 用户明确确认后，主进程重新读取源文件并核对完整归档 SHA-256，防止检查与安装之间换包。
4. 文件先写入同一插件根目录下的随机 staging 目录，再通过目标目录与 backup 目录换位完成安装或升级；失败时恢复旧版本。
5. 新进程首次扫描会清理中断的 staging/trash，并在目标缺失时恢复带插件 ID 的 backup。
6. 注册表重新验证文件集合、逐文件摘要、`manifest.json`、entrypoint 和安装记录；损坏目录单独报告，不影响其他插件。
7. 注册成功后运行时动态发现清单并保持停用。符合 renderer sandbox v1 的包可在用户逐项授权后激活；其他包加载时强制停用。卸载采用先改名到 trash、再递归删除的事务边界。

## 4. Renderer sandbox v1

当前只允许以下 profile：`kind=feature`、恰好声明 `storage:local`、不提供或依赖 capability、不贡献 sync job/settings/search/command、恰好一个 activity view，且 `activityTarget` 必须是 `mod-` 加插件 ID 的点号/连字符归一化结果。这个命名规则防止第三方视图抢占核心或其他插件导航目标。

宿主不会把入口导入 CampusOS renderer，而是生成 `<iframe sandbox="allow-scripts allow-same-origin">`，从 `campusmod://<plugin-id>/` 独立 secure origin 加载。Electron 43 主 renderer 开启 Chromium OS sandbox、关闭 Node integration 和 webview；主进程拒绝所有网页权限、新窗口和插件发起的跨 origin frame 导航。协议逐请求确认插件仍为 active、安装记录仍完整，并施加 `default-src 'none'`、`connect-src 'none'`、无 `unsafe-eval` 的 CSP。插件 origin 没有 preload、CampusOS IPC、凭据、`process`、`require` 或 `fs`。

renderer entrypoint 必须导出：

```js
export async function mount(root, host) {
  root.textContent = `${host.pluginId} 已启动`;
  return () => {
    root.replaceChildren();
  };
}
```

`host` 当前只包含冻结的 `apiVersion: 1` 和 `pluginId`。隔离本地存储由每个 `campusmod://<plugin-id>` origin 的 Web Storage 提供。当前没有网络或 capability 代理。

## 5. Headless isolate POC

第三方 headless 内层选用 QuickJS/WASM。当前 POC 只接受不含模块导入的同步 ESM，入口导出 `run(input)`，输入和输出都必须是 JSON；QuickJS realm 不提供 `process`、`require`、`Buffer`、`fetch` 或 `WebSocket`。默认限制为源码 1 MiB、输入/输出各 256 KiB、执行 100 ms、普通 JS 堆 16 MiB、栈 512 KiB。测试已覆盖死循环中断、4 MiB 堆压力、导入拒绝、异步拒绝和非 JSON 输出拒绝。

该内核尚未由插件 lifecycle 调用，第三方 headless 仍不能启用。QuickJS 的 JS 堆限制不能代替整个宿主进程限制，尤其是 TypedArray 等外部内存；接入前还必须把内核放入 utility process，完成进程超时、总内存、崩溃回收和严格消息协议。

```js
export function run(input) {
  return { received: input };
}
```

## 6. 拒绝规则与限制

| 项目 | 当前限制 |
| --- | --- |
| 归档大小 | 10 MiB |
| 文件数 | 256 |
| 单文件解压大小 | 5 MiB |
| 总解压大小 | 30 MiB |
| `manifest.json` | 256 KiB，严格 UTF-8 JSON |
| 压缩算法 | ZIP store 或 deflate |
| 路径 | 禁止绝对路径、盘符、反斜杠、控制字符、`..`、Windows 保留名、尾随点/空格、大小写冲突和文件/目录父级冲突 |
| 特殊文件 | 不提取符号链接或非常规文件；安装目录扫描发现后隔离 |
| 安装确认 | 最多保留 8 个，10 分钟过期，一次使用 |

## 7. 后续开放条件

renderer sandbox v1 已能承载无网络的本地单视图，但不等于完整第三方执行平台。自动化测试已使用真实 ZIP 完成“安装 → 持久授权 → 协议读取 → 实际 mount/dispose”链路；这不替代 Electron 窗口内的进程隔离验收。开放 headless/main、capability 或网络权限前必须完成并验证：独立 worker/isolate、受控 capability API、精确 origin 网络代理、资源与超时限制、崩溃回收和恶意插件测试。还需验证跨 origin frame 是否稳定落入独立 renderer 进程，并增加 CPU/内存失控恢复。包签名验证已实现，但信任目录和签名密钥连续性仍属于后续工作。

实现采用 Electron 官方安全基线与自定义协议生命周期：scheme 在 `ready` 前注册，handler 在 `ready` 后安装；BrowserWindow 显式启用 OS sandbox、context isolation 与 web security，并禁用 Node integration、webview、新窗口和网页权限。依赖安装只允许固定版本 Electron 与 esbuild 执行生命周期脚本，未审查的新增脚本会使安装失败。

参考：[Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)、[Electron Protocol API](https://www.electronjs.org/docs/latest/api/protocol)、[Electron Process Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox)、[Electron Utility Process](https://www.electronjs.org/docs/latest/api/utility-process)、[quickjs-emscripten](https://github.com/justjake/quickjs-emscripten)、[pnpm Build Settings](https://pnpm.io/10.x/settings#onlybuiltdependencies)。
