# CampusOS

CampusOS 是一个面向浙江大学学生的桌面校园工作台。当前处于 **MVP Phase 2（核心链路实现与验收）**：Phase 1 插件工作台地基已完成；本科真实账号已脱敏跑通统一认证、教务、素拓、学在浙大作业与完整课件目录，但多设备、桌面提醒、私有课件实体下载和全新 Windows 安装仍待现场验收，因此尚不可作为可发布 MVP。当前唯一的发布前门槛见[私有 Alpha 验收清单](docs/alpha-acceptance.md)。

项目采用 [MIT License](LICENSE)，贡献约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

- Electron + React 桌面骨架
- 四个固定核心入口 + 由已激活 feature view 动态生成的插件入口；视图不再靠手工菜单注册
- 月历、周视图、线性日程与单日时间线的课程、作业与考试聚合视图
- Plugin Runtime v2 内置插件路径：Manifest v2、能力依赖解析、逐项授权、持久化、主进程无头生命周期与刷新协调
- `.campusmod` 本地包管理：真实 ZIP 流式校验、一次性确认、原子安装/升级、崩溃恢复、逐文件完整性检查、持久注册与卸载；符合严格本地单视图 profile 的包可在 Electron 43 Chromium 沙箱、独立 origin、无 Node/网络/IPC 的 iframe 中运行，其他第三方包保持 install-only，详见 [包格式与安装边界](docs/architecture/campusmod-package-format.md)
- 统一日历事件能力：`calendar.events@1` 支持多个独立 provider；考试与 DDL 功能插件按刷新依赖顺序把可信绝对时间转换为事件，核心工作区不依赖具体连接器 ID
- 本科教务连接器：通过核心不透明业务 Session 读取当前与下一学年课表、考试及成绩，逐条容错并持久化 provenance；有明确日期时间的考试进入工作台，只有相对考试周描述的记录保留原文、不猜测日期
- 研究生教务连接器：设置页可显式选择研究生路径，核心消费研究生院 CAS ticket、验证认证后成绩结构并仅在主进程内保管 `X-Access-Token`；插件通过固定操作读取课表、考试和成绩，精确周次原样保留，缺少明确时间的考试不伪造起止时间。自动化协议 fixture 已通过但真实研究生账号尚未验收
- 成绩功能插件：通过主进程鉴权的只读 capability IPC 获取当前已验证账号的 `academic.grades@1`；旧账号缓存不可见，加权绩点只使用教务明确返回的绩点和学分，不推测缺失映射
- 官方校历连接器：只读取浙江大学官方 HTTPS 页面中的学季边界和开课日，动态计算当前/下一学季；尚无可信节次钟点源，因此不伪造课程日期事件
- 学在浙大连接器：核心完整消费登录跳转并保管业务 `session`；每轮刷新读取 `/api/todos`、学期、全部课程分页及逐课 activities/uploads，分别发布 `learning.assignments@1` 和 `learning.materials@1`。作业更新或移除会替换旧 DDL/提醒；课件目录每 60–120 秒全量重取，并以本地文件缺失或大小不符判断是否需要重新下载
- 学在浙大课件下载：主进程携带当前业务 `session`，固定按 reference blob → preview blob 请求，最多 5 次指数退避；下载队列保留 HTTP Range 断点续传、`.part` 临时文件和最终大小校验。真实目录链已通过，私有课件实体下载仍需用户手动验收
- 诊断与测试：真实刷新结果由主进程持久化，可在设置页查看、清空并导出自动脱敏的 TXT
- 首批信息源范围：
  - 教务处网站
  - 学在浙大
  - 计算机学院院网
  - 云峰学院院网
  - ETA 三全育人平台
- 钉钉登录 / 消息导入入口占位
- 已验证的 Windows x64 NSIS 安装包构建（发布和全新 Windows 验收仍待完成）

## 本地开发

1. 安装依赖：`pnpm install`
2. 为 Electron 重建 SQLite native binding：`pnpm --filter @campusos/core rebuild:electron`
3. 启动开发：`pnpm dev`
4. 类型检查：`pnpm typecheck`
5. 单测：`pnpm test`
6. Electron E2E：`pnpm --filter @campusos/core test:e2e`
7. 构建：`pnpm build`
8. 本科真实链路脱敏验证：`pnpm verify:zju-auth`（凭据只从已忽略的本地环境文件注入）
