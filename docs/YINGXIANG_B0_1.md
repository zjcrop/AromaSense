# 迎香 B0.1 测试版架构

迎香是 AromaSense 仓库内的**活动组织 / 多人参与层**，不是第二套杯测引擎。底层继续复用香迹现有 Session / Sample / Stage、Local-first SQLite、revision、识别与感官记录能力。

## 1. 账户与活动所有权

- 发布杯测的主办方必须是已注册并已登录的 AromaSense 用户。
- `yingxiang_events.owner_user_id` 是活动唯一主账户所有权键。
- 参与者可以登录自己的长期账户，也可以不注册，以访客身份加入。
- 参与关系不写入 `users` 的永久父子关系；活动参与者使用 `yingxiang_participants` 表形成 event-scoped principal。
- 未来迎香收费/授权应挂在活动 owner / entitlement 层，不改变参与者数据模型；B0.1 不引入任何付费服务或计费依赖。

## 2. 双重身份与临时子账户

已登录用户通过迎香分享链接加入活动时，可以同时存在：

1. Personal Account：用户自己的长期 AromaSense 身份；
2. Event Principal：当前活动中的临时参与身份。

活动进行中，Event Principal 的显示优先级高于 Personal Account：

- UI 只显示活动 `display_name`；
- 个人账户昵称不会被自动带入活动；
- 只有主办方分享策略允许，并且参与者明确选择使用个人账户名时，个人名称才可以成为活动 `display_name`；
- `account_user_id` 只用于账户绑定、同步和后续数据归属，不作为活动公开称呼。

活动结束、退出或被主办方释放后，Event Principal 进入 `released`，界面恢复 Personal Account 身份。临时从属关系仅限该 `event_id`。

## 3. 参与名称规则

分享/发布活动时写入 `yingxiang-event-policy/0.1`：

- `organizer_assigned`：只能使用主办方预先分配的参与名称；
- `participant_choice`：参与者可在规则内填写活动名称；
- `allowAccountDisplayName`：是否允许参与者主动选择个人账户名作为活动名称；
- `uniqueWithinEvent`：活动内参与名称是否唯一；
- `minLength` / `maxLength`：长度约束；
- `requiredPrefix`：可选固定前缀。

B0.1 不允许主办方下发任意正则表达式作为命名规则，避免客户端正则拒绝服务和多端实现差异。云端名称唯一性由 D1 trigger 按活动 policy 原子校验，避免并发加入绕过客户端检查。

## 4. 分享链接与邀请

云端 `yingxiang_invites` 与第一批 Worker API 已接入：

- 分享链接携带活动 invite token；
- D1 只保存 token 的 SHA-256 hash，不保存明文 token；
- invite 绑定 `event_id + event_revision`；
- 支持过期、最大使用次数、累计使用次数以及活动完成后的统一撤销；
- D1 trigger 在写入 participant 前原子检查 invite 的活动归属、revision、有效期和剩余使用次数，并在成功加入后递增 `use_count`；
- 参与者打开链接后可先读取活动公开 manifest / policy，再建立 Event Principal；
- 未注册参与者允许以 guest principal 加入，不被注册流程阻断；
- 已登录账户可形成 account principal，但活动显示名仍由活动规则决定；个人账户名不能被隐式暴露。

当前 Worker 路由：

- `POST /api/v1/yingxiang/events`：主账户创建并默认发布活动；显式 `publish=false` 可创建草稿；
- `POST /api/v1/yingxiang/events/:eventId/invites`：活动所有者生成邀请；
- `GET /api/v1/yingxiang/invites/:token`：公开读取有效邀请与活动规则；
- `POST /api/v1/yingxiang/invites/:token/join`：游客或已登录账户加入；
- `POST /api/v1/yingxiang/events/:eventId/calibration-groups`：主办方建立重复校准映射；
- `POST /api/v1/yingxiang/events/:eventId/complete`：完成活动、递增 event revision、释放全部 active principal 并撤销邀请。

B0.1 后续仍需补齐活动编辑/再次发布、单个参与者释放、主办方参与进度读取和 Submission 汇总 API。

## 5. 同一只豆子的重复校准

重复校准采用 `yingxiang_calibration_groups`：

- `canonical_sample_id` 指向真实咖啡身份；
- `event_sample_ids_json` 保存两个或以上活动样品槽位；
- 多个槽位可以在盲测中呈现为不同样品，但实际指向同一只咖啡；
- 参与侧不读取 `canonical_sample_id`，避免破盲；
- 揭示策略为 `after_event` 或 `organizer_only`；
- 校准组不复制豆卡、不复制长期样品实体。

后续比较引擎以校准组计算同一参与者的重复性、离散程度和系统性偏差，但原始 observation 保持不变。

## 6. Local-first 与同步边界

迎香必须继续遵循 AromaSense 的既有原则：

- 活动中的感官编辑仍然先写本地 SQLite；
- 断网不能阻断杯测记录；
- 迎香活动身份只提供 event scope，不替代 Session / Sample / Stage 主数据；
- 云端保存活动所有权、邀请和多人汇总所需关系；
- 已完成 revision 不可静默覆盖；
- 活动 revision 与个人 Submission revision 相互独立。

## 7. B0.1 当前落地文件

- `app/core/yingxiang-event.ts`
- `app/storage/0006_yingxiang_event_context.sql`
- `app/storage/yingxiang-event-store.ts`
- `cloud/worker/migrations/0007_yingxiang_events.sql`
- `cloud/worker/src/yingxiang-api.ts`
- `cloud/worker/src/index.ts` 路由接入
- `tests/yingxiang-event.test.ts`
- `tests/yingxiang-event-store.test.ts`

Web / Android 启动迁移链已加入本地 migration 6。

## 8. 后续连续开发顺序

1. 客户端：迎香入口与“发布杯测”页；
2. 分享策略页：名称规则、盲测策略、校准重复设置、二维码/链接；
3. 参与端：链接进入 → Event Principal → 活动名称 → 本地 Session；
4. 活动 API 补齐：编辑/发布、单人释放、参与进度与 Submission 汇总；
5. 活动结束：SubmissionBundle 回收与主办方汇总；
6. 主办方看板：参与进度、回收结果、重复校准统计；
7. Web/Android 响应式统一验收。

页面以功能、兼容性和信息密度优先；移动端与网页端保持同一交互逻辑，使用响应式布局而不是两套业务流程。