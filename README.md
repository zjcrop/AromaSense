# AromaSense

**香迹 · AromaSense：数字化咖啡杯测与感官评价系统**

当前香迹产品版本：**B0.2.a（测试版）**  
迎香活动模块：**B0.1（测试版）**

AromaSense 采用 Local-first 架构：杯测过程首先写入本地 SQLite，网络中断不会阻止感官记录；云端负责身份验证、不可变 revision 备份、跨设备恢复基础以及迎香多人活动协作。

迎香不是第二套杯测软件。它与香迹位于同一仓库、共享同一套 Session / Sample / Stage、识别、感官记录和本地持久化能力；迎香只增加活动发布、临时参与身份、邀请、多人协作和后续汇总层。

## 网页测试版

网页地址：<https://zjcrop.github.io/AromaSense/>

生产网页由 GitHub Actions 在 `main` 通过 CI 后构建，并连接当前 Cloudflare Worker、D1 与 Firebase。网页与 Android 复用同一套杯测 UI、业务 controller、schema 和 migration：

- Android：系统 `SQLiteDatabase`；
- Web：`sql.js` WebAssembly SQLite + IndexedDB 持久化；
- 两端都遵循 Local-first，网络不是杯测记录的前置条件。

如果页面仍显示旧构建，应以 GitHub Actions 中与当前 `main` 同 SHA 且成功完成的 connected web deployment 为验收基准。

## 项目结构

```text
AromaSense repository
├─ 香迹 / AromaSense
│  ├─ Session / Sample / Stage
│  ├─ 感官记录与评价
│  ├─ OCR / 多样品识别
│  ├─ Local-first SQLite
│  ├─ revision / sync / record export
│  └─ Web + Android
│
└─ 迎香 / Yingxiang
   ├─ 活动发布
   ├─ Event Manifest
   ├─ 邀请与临时参与身份
   ├─ 活动规则
   ├─ 重复样品校准映射
   └─ 复用香迹 Session 完成实际杯测
```

## 香迹 B0.2.a 当前能力

### 1. 杯测流程

- 批量建立样品并自动编号；
- 左侧样品 rail 快速切换并查看阶段进度；
- 香气 / 高温 / 中温 / 低温 / 风味 / 综评 / 评分分阶段记录；
- 感官字段落地即写本地数据库；
- 风味分组和标签支持折叠、选择和顺序调整；
- 综评与评分显示描述性雷达汇总，并将描述性强度与情感/质量评价分区；
- Session metadata 支持日期、时间、组织方、参与者、活动名、公开/盲测/半盲模式、`eventId` 与 `eventRevision`；
- 全样品完成后生成 final revision，并在存在有效云账户和网络时进入同步队列。

### 2. 样品识别

当前识别链包括：

- 相机和多图相册导入；
- Android ML Kit 中文 / 拉丁文字原图识别桥；
- 浏览器同源 PP-OCRv5 Worker；
- OCR 行坐标、图像尺寸和 polygon 几何；
- 一图多样品版面分割；
- 国家、产区、处理法、海拔、烘焙日期等字段的语义判定和冲突复核；
- 低置信度分区人工复核：合并、拆分、调整边界并重新归属 OCR 文字；
- 人工调整后重新调用共享 LuckyBean / Coffee Foundation 语义解析，不在 AromaSense 内维护第二套咖啡字段规则；
- `recognition-roi/1.0` 局部二次 OCR；
- ROI 坐标回映到整页归一化几何，并保存 provenance；
- 调整边界、重新归属、合并、拆分或删除分区后旧 ROI 结果失效；
- 识别结果必须经过确认后才建立正式 Session。

分区复核识别元数据使用 `aromasense-recognition/3.4`。高分辨率原图的方向处理、裁剪和 Blob 生成不在 UI 主线程执行。

### 3. 感官数据原则

AromaSense 将描述性（Descriptive）与情感/质量评价（Affective）分开保存：

- 描述性强度：0–15；
- Final 情感/质量评价：独立 1–9；
- 高 / 中 / 低温重复记录属于 AromaSense 工作流扩展，不等同于 SCA 官方表单结构。

### 4. Local-first 与数据安全

- SQLite 是杯测过程主数据源；
- 当前编辑只加载必要的 Session / Sample / Stage 数据；
- checkpoint / final 使用 immutable revision；
- revision 使用 SHA-256 hash 做幂等和冲突检测；
- 已完成 revision 不允许静默覆盖；
- 同步失败不会回滚或删除已完成的本地杯测；
- Schema 变化必须通过 migration 演进；
- 密钥、Token 和用户凭据不得提交到仓库。

## 云端账户与同步

当前身份链使用 **Firebase Authentication + Cloudflare Worker exchange**，不是旧版自建邮件验证流程。

主要接口包括：

- `GET /health`：Worker / D1 / Firebase 配置健康检查；
- `POST /api/v1/auth/exchange`：校验 Firebase ID token 并换取 AromaSense 云端 token；
- `POST /api/v1/auth/logout`：撤销当前云端 token；
- `GET /api/v1/auth/me`：读取当前已验证账户；
- `POST /api/v1/revisions`：写入不可变 revision；
- `GET /api/v1/revisions/:revisionId`：读取当前账户自己的 revision；
- `POST /api/v1/share`：生成服务器分享记录；
- `GET /api/v1/share/:token`：读取有效分享；
- `POST /api/v1/ai/enrich-samples`：调用共享 Coffee Foundation / 智谱免费 AI Adapter 做需要 AI 的样品增强解析。

本地杯测不依赖登录；只有云同步、服务器分享以及迎香主办方发布等云功能要求对应账户状态。

## 迎香 B0.1 测试版

### 1. 主办方与活动

发布迎香杯测的主办方必须登录注册账户。活动所有权绑定长期 `user_id`，但参与者与主办方之间**不会建立永久父子账户关系**。

主办方当前可设置：

- 活动名称；
- 对参与者公开的组织方名称；
- 公开 / 盲测 / 半盲模式；
- 一行一个样品编号；
- 参与者自定义名称或主办方分配名称；
- 是否允许主动采用个人账户显示名称；
- 活动内名称是否唯一；
- 名称最大长度和可选固定前缀；
- 是否启用同一只咖啡重复出现的校准机制；
- 邀请有效时间与最大使用次数。

### 2. Event Manifest

迎香发布 `yingxiang-event-manifest/0.1`，参与端只获得杯测所需的公开信息：

```text
organizerName
cuppingMode
samples[]
  ├─ eventSampleId
  ├─ sampleCode
  ├─ order
  └─ participant-safe label (optional)
```

盲测时真实咖啡身份不会进入公开 Manifest。

### 3. 临时参与身份

参与者可以：

- 不注册，以 guest 身份加入；
- 使用自己的 AromaSense 账户加入；
- 在主办方允许时使用个人账户显示名称；
- 或只为本次活动生成新的参与名称。

已登录用户加入活动后同时存在 Personal Account 和 Event Principal。活动期间 Event Principal 优先，个人账户称呼不会自动暴露；活动结束或释放后恢复长期账户身份。

个人账户显示名称必须先写入并由服务器读取验证，客户端不能通过 `nameSource=account` 自报任意名称冒充账户身份。

### 4. 邀请

迎香邀请 token：

- 明文只在创建邀请时返回；
- D1 只保存 SHA-256 token hash；
- 与 `eventId + eventRevision` 绑定；
- 支持到期时间、最大使用次数、累计使用次数和撤销；
- D1 trigger 原子校验邀请有效性并消费 `use_count`；
- 活动 revision 改变后旧邀请自动失效；
- 活动完成后统一撤销邀请。

加入接口使用客户端生成并持久化的 `joinRequestId` 做幂等。服务器已经成功加入但客户端在响应途中断网时，同一个请求可以安全重放，不会再次消耗邀请。

### 5. 邀请进入香迹 Session

网页邀请使用：

```text
https://zjcrop.github.io/AromaSense/?yingxiangInvite=<token>
```

流程：

```text
读取邀请
→ 显示活动 / 组织方 / 杯测模式 / 样品编号
→ 建立本次活动参与名称
→ 服务器创建或恢复 Event Principal
→ 本地缓存 participant-safe Event Context
→ 本地保存 Event Principal
→ 根据 Event Manifest 创建 AromaSense Session + Samples
→ 建立 event / participant / session 唯一绑定
→ 进入香迹原有杯测 UI
```

Event Context、Principal、Session 和绑定关系在本地事务中落盘。已经建立过的参与身份重新进入时会恢复原 Session，不重复创建杯测记录。

### 6. 同豆重复校准

重复校准不复制豆卡。主办方建立：

```text
canonical coffee
├─ event sample slot A
├─ event sample slot B
└─ event sample slot C
```

参与端只看到不同活动槽位，不读取 `canonicalSampleId`。本地和 D1 都会校验校准组引用的 `eventSampleId` 必须真实存在于 Event Manifest。

该结构为后续计算参与者重复性、离散程度和系统性偏差提供基础，同时保持原始 observation 不变。

### 7. 当前 Worker 路由

- `POST /api/v1/yingxiang/events`：创建 / 发布活动；
- `POST /api/v1/yingxiang/events/:eventId/invites`：生成邀请；
- `GET /api/v1/yingxiang/invites/:token`：读取有效邀请与公开活动规则；
- `POST /api/v1/yingxiang/invites/:token/join`：guest / account 加入；
- `POST /api/v1/yingxiang/account-display-name`：设置服务器可验证的账户显示名称；
- `POST /api/v1/yingxiang/events/:eventId/calibration-groups`：建立重复校准映射；
- `POST /api/v1/yingxiang/events/:eventId/complete`：完成活动、释放临时身份并撤销邀请。

### 8. 迎香后续范围

B0.1 当前重点是可测试的“发布 → 邀请 → 加入 → 香迹 Session”闭环。后续继续扩展：

- 活动编辑与 revision 再发布；
- 单个参与者释放；
- 主办方实时进度；
- SubmissionBundle 回收；
- 多参与者结果汇总；
- 重复校准统计与偏差分析；
- 主办方看板。

## 自动化验收

当前 CI 覆盖：

- TypeScript strict typecheck；
- Local-first persistence / migration / revision / sync tests；
- 离线完整 Session + 恢复网络后同步；
- revision 幂等、冲突和中断恢复；
- 100 样品压力测试；
- OCR 版面分割、字段语义决策、人工分区和 ROI 测试；
- Web bundle 与 runtime smoke；
- Worker typecheck；
- Firebase 配置探针；
- Android `assembleDebug`；
- 迎香 Event / Principal / Manifest / calibration / invite client contract；
- 迎香公开 Event Context；
- 迎香 event → participant → AromaSense Session 本地恢复与去重。

真实设备相机 / 相册 OCR、移动端触控、跨设备同步和多人现场网络条件仍需要物理设备或真实部署验收。

## 构建与部署

生产发布链：

1. PR / `main` 运行 CI；
2. Cloudflare D1 migrations；
3. Cloudflare Worker 部署与 `/health` 校验；
4. connected Web 构建；
5. GitHub Pages 发布；
6. Android connected debug 构建；
7. 正式签名发布流程单独验证 APK 包名、版本、云端配置、识别 pipeline 和签名证书。

## 版本策略

正式版定型前：

- 产品版本带 `B` 前缀；
- 主版本号保持 `< 1`；
- 香迹当前版本：**B0.2.a**；
- 迎香当前模块版本：**B0.1 test**；
- 普通修复和单次提交不递增产品版本；
- 完成完整开发 / 验收阶段后再升级版本。

详见 `docs/VERSIONING.md` 和 `docs/YINGXIANG_B0_1.md`。

## License

AromaSense 自有代码与业务知识为 proprietary software。除单独注明的第三方组件外，保留全部权利。仓库处于公开测试状态不等同于授予开源许可证。
