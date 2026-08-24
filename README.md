# AromaSense

**香迹：数字化咖啡杯测与感官评价系统**

当前产品版本：**B0.1.a**（测试版）

AromaSense（香迹）是一个面向咖啡杯测与感官评价场景的 Local-first 数字化工具。杯测过程中数据优先写入本地 SQLite；网络中断不会阻止记录，完成后的 checkpoint / final revision 再进入云端同步队列。

## 网页测试版

**网页地址：<https://zjcrop.github.io/AromaSense/>**

网页版本与 Android 版本复用同一套杯测 UI、业务 controller、schema 与 migration：

- Android：系统 `SQLiteDatabase`；
- Web：`sql.js` WebAssembly SQLite + IndexedDB 持久化；
- 两端均遵循 Local-first，不以网络请求作为杯测记录前置条件。

> 发布说明：网页由 `.github/workflows/pages.yml` 从 `main` 自动构建并发布。当前仓库为 private，GitHub Pages 的实际公开可访问性仍取决于账户/仓库 Pages 权限与最新 Pages workflow 是否成功。只有页面实际返回成功并完成交互验收后，才视为“网页已验证发布”。

## 当前架构

1. GitHub：唯一源码与版本管理源；
2. 客户端 SQLite：杯测过程本地主数据源；
3. Cloudflare Workers：轻量 API / 同步入口；
4. Cloudflare D1：云端 revision 备份与跨设备恢复基础；
5. revision + SHA-256 hash：保证幂等上传与冲突检测；
6. Session / Sample / Stage 切片：只加载当前样品和阶段的感官记录，避免多样品杯测时一次加载全部 observation。

## 核心原则

- **Local-first**：关键编辑先写入本地数据库。
- **云端不是实时主库**：云端负责同步、备份、恢复和后续聚合分析。
- **数据不可静默覆盖**：同步采用 immutable revision、hash 和幂等键。
- **Schema 必须版本化**：生产结构变化通过 migration 演进。
- **最小权限**：密钥、Token、用户凭据不得提交到仓库。
- **闭源项目**：AromaSense 自有代码与业务知识默认 proprietary；第三方开源组件遵守各自许可证。

## 杯测流程

- 批量建立样品并自动编号；
- 左侧样品 rail 快速切换并查看阶段进度；
- 准备 / 香气 / 高温 / 中温 / 低温 / Final 分阶段记录；
- 感官字段落地即写本地数据库；
- 风味分组和标签支持折叠与顺序调整；
- Final 阶段显示描述性雷达汇总，并将描述性强度与情感/质量评价分区；
- 全样品完成后生成 final revision，并在有有效云账户时尝试同步。

## 感官数据原则

AromaSense 将描述性（Descriptive）与情感/质量评价（Affective）分开保存：

- 描述性强度使用 0–15 强度量表；
- Final 情感/质量评价使用独立 1–9 量表；
- 高 / 中 / 低温重复记录是 AromaSense 的工作流扩展，不等同于 SCA 官方表单结构。

## API 基础接口

Cloudflare Worker 部署后：

- `GET /health`：Worker 健康状态；
- `POST /api/v1/auth/register`：注册；
- `POST /api/v1/auth/login`：登录；
- `POST /api/v1/revisions`：写入不可变 revision；
- `GET /api/v1/revisions/:revisionId`：读取当前账户自己的 revision。

## 版本策略

正式版定型前：

- 产品版本始终带 `B` 前缀；
- 主版本号保持 `< 1`；
- 当前版本为 **B0.1.a**；
- 普通修复和单次提交不递增产品版本号；
- 仅在完成一个完整开发/验收阶段后升级版本。

详见 `docs/VERSIONING.md`。

## License

AromaSense is proprietary software. All rights reserved unless explicitly stated otherwise for individual third-party components.
