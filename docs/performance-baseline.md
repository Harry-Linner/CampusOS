# CampusOS 性能基线

**Date:** 2026-08-15
**Measured by:** `pnpm measure:performance`（`scripts/measure-performance.mjs`）
**Machine:** Windows x64 / Node v24（开发机，非发布基准机）
**Mode:** `CAMPUSOS_E2E_FIXTURE=1`（无真实账号、无网络）

> **状态（2026-09）：** 2026-08-15 开发机单机单次测量，此后未复测，非发布基准。NFR"后台内存 <200MB"的口径修订或内存优化方向尚未由产品决策（PRD 文件头"当前范围口径"未改该 NFR，本文为决策输入）；正式基准应在固定硬件 + 打包版（asar）上重测后再更新本表。

## NFR 对照

| 指标 | NFR 承诺 | 实测（3 次平均） | 状态 |
| --- | --- | --- | --- |
| 冷启动（launch → shell 渲染） | < 3000 ms | **1402 ms** | ✅ 达标 |
| 后台内存（working set 总和） | < 200 MB | **376 MB** | ❌ 超出承诺 |

## 分项明细（round 3）

| 进程 | working set |
| --- | --- |
| main (Browser) | ~133 MB |
| renderer (Tab) | ~95 MB |
| GPU | ~97 MB |
| utility (Network Service) | ~48 MB |
| **合计** | **~376 MB** |

## 测量方法

- 构建正式输出（`pnpm --filter @campusos/core build`）后由 Playwright `_electron` 启动。
- 冷启动 = launch → firstWindow → domcontentloaded → `.onboarding-shell/.app-shell` 渲染完成的时间总和。
- 内存 = `app.getAppMetrics()` 各进程 `workingSetSize`（Electron 单位 KB）之和，在后台刷新与提醒调度稳定后采样。
- 结果 JSON 记录在 `.tmp/performance-baseline.json`（git-ignored，不入库）。

## 结论与待办

1. **冷启动达标**，无需立即优化。
2. **内存超出 NFR 承诺约 1.9 倍**。主要构成是 Electron 固有进程组（main + renderer + GPU + network utility），其中 GPU 进程约 97MB 并非 CampusOS 业务代码。
3. 选项（开发期未定，需产品决策）：
   - 调整 NFR 口径：将"后台内存 < 200MB"修订为与 Electron 实际构成一致的合理值（如 < 400MB），并注明测量口径（含/不含 GPU）；
   - 或启动内存优化（如关闭不需要的 GPU 特性、renderer 惰性加载、utility 进程回收），以实测数据跟踪收敛。
4. 本基线为开发机单机数据，不是发布基准；正式基准应在固定硬件 + 打包版（asar）上重测。
