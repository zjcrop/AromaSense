# AromaSense

**香迹：数字化咖啡杯测与感官评价系统**

当前产品版本：**B0.2.a**（测试版）

AromaSense（香迹）是一个面向咖啡杯测与感官评价场景的 Local-first 数字化工具。杯测过程中数据优先写入本地 SQLite；网络中断不会阻止记录，完成后的 checkpoint / final revision 再进入云端同步队列。

## 网页测试版

网页地址：<https://zjcrop.github.io/AromaSense/>

GitHub Pages 部署基础设施已经启用。当前发布流程要求仓库变量 `AROMASENSE_CLOUD_URL` 指向真实 HTTPS Worker；如果该变量缺失，Pages workflow 会主动失败，避免发布一个账户界面可见但无法注册/同步的连接版。

因此，若网页地址仍显示较旧构建，它只能视为历史测试构建；**只有与当前 `main` 同 SHA、且通过 Cloud URL 校验的 Pages 构建才视为当前可验收版本。**

网页版本与 Android 版本复用同一套杯测 UI、业务 controller、schema 与 migration：

- Android：系统 `SQLiteDatabase`；
- Web：`sql.js` WebAssembly SQLite + IndexedDB 持久化；
- 两端均遵循 Local-first，不以网络请求作为杯测记录前置条件。

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
- **闭源代码策略**：AromaSense 自有代码与业务知识默认 proprietary；第三方开源组件遵守各自许可证。当前仓库因公开测试暂处于 public 状态，不等同于授予开源许可证。

## 杯测流程

- 批量建立样品并自动编号；
- 左侧样品 rail 快速切换并查看阶段进度；
- 香气 / 高温 / 中温 / 低温 / 风味 / 综评 / 评分分阶段记录；
- 感官字段落地即写本地数据库；
- 风味分组和标签支持折叠与顺序调整；
- 综评与评分步骤显示描述性雷达汇总，并将描述性强度与情感/质量评价分区；
- 全样品完成后生成 final revision，并在存在有效云账户和网络时进入同步队列。

## 样品识别

当前识别链已经包含：

- 相机和多图相册导入；
- Android ML Kit 中文 / 拉丁文字原图识别桥；
- OCR 行坐标、图像尺寸和 polygon 结构；
- 多样品版面分割；
- 国家、处理法、海拔、烘焙日期等字段的语义决策与冲突复核；
- 识别结果人工确认后再建立 Session。

真实设备 OCR、复杂标签手工分区调整、分区后二次 ROI OCR 仍处于验收/开发阶段。

## 感官数据原则

AromaSense 将描述性（Descriptive）与情感/质量评价（Affective）分开保存：

- 描述性强度使用 0–15 强度量表；
- Final 情感/质量评价使用独立 1–9 量表；
- 高 / 中 / 低温重复记录是 AromaSense 的工作流扩展，不等同于 SCA 官方表单结构。

## 云端账户与同步

Worker 代码支持：

- `GET /health`：Worker、D1、Email Service 状态；
- `POST /api/v1/auth/register`：注册并发送验证邮件；
- `POST /api/v1/auth/resend-verification`：重发验证邮件；
- `GET /api/v1/auth/verify`：验证邮箱；
- `POST /api/v1/auth/login`：登录；
- `POST /api/v1/auth/logout`：退出登录；
- `GET /api/v1/auth/me`：读取当前用户；
- `POST /api/v1/revisions`：写入不可变 revision；
- `GET /api/v1/revisions/:revisionId`：读取当前账户自己的 revision。

注册要求真实 Cloudflare D1 和 Email Service 均完成配置。邮件服务未配置时，Worker 会明确拒绝创建一个无法验证的账户；本地杯测功能不受影响。

## 构建与验收

B0.2.a 已建立以下自动化验收：

- TypeScript strict typecheck；
- Local-first persistence / migration / revision / sync tests；
- 离线完整 Session + 恢复网络后同步；
- revision 幂等、冲突和中断恢复；
- 100 样品压力测试；
- OCR 版面分割和字段语义决策测试；
- Worker typecheck；
- Android `assembleDebug`。

真实 Cloudflare 注册链、跨设备恢复、Android 进程杀死恢复和真实设备触控/OCR仍必须单独验收。

## 版本策略

正式版定型前：

- 产品版本始终带 `B` 前缀；
- 主版本号保持 `< 1`；
- 当前版本为 **B0.2.a**；
- 普通修复和单次提交不递增产品版本号；
- 仅在完成一个完整开发/验收阶段后升级版本。

详见 `docs/VERSIONING.md`。

## License

AromaSense is proprietary software. All rights reserved unless explicitly stated otherwise for individual third-party components.
