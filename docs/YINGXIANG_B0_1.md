# 迎香 B0.1 测试版架构

迎香是 AromaSense 仓库内的**活动组织 / 多人参与层**，不是第二套杯测引擎。底层继续复用香迹现有 Session / Sample / Stage、Local-first SQLite、revision、识别与感官记录能力。

## 1. 账户与活动所有权

- 发布杯测的主办方必须是已注册并已登录的 AromaSense 用户。
- `yingxiang_events.owner_user_id` 是活动唯一主账户所有权键。
- 参与者可以登录自己的长期账户，也可以不注册，以访客身份加入。
- 参与关系不写入 `users` 的永久父子关系；活动参与者使用 `yingxiang_participants` 形成 event-scoped principal。
- 未来迎香收费 / 授权应挂在活动 owner / entitlement 层，不改变参与者数据模型；B0.1 不引入任何付费服务或计费依赖。

## 2. 双重身份与临时子账户

已登录用户通过迎香分享链接加入活动时，同时可以存在：

1. Personal Account：用户自己的长期 AromaSense 身份；
2. Event Principal：当前活动中的临时参与身份。

活动进行中 Event Principal 优先：

- UI 使用活动 `display_name`；
- 个人账户昵称不会自动带入活动；
- 只有主办方允许且参与者主动选择时，个人账户显示名称才可成为活动名称；
- 个人账户显示名称由服务器保存并验证，客户端不能以 `nameSource=account` 自报任意文本；
- `account_user_id` 用于账户绑定和数据归属，不作为活动公开称呼。

活动结束、退出或被释放后，Event Principal 进入 `released`。临时从属关系仅限对应 `event_id`。

## 3. Event Policy 与 Event Manifest

活动规则使用 `yingxiang-event-policy/0.1`：

- `organizer_assigned` / `participant_choice`；
- `allowAccountDisplayName`；
- `uniqueWithinEvent`；
- `minLength` / `maxLength`；
- `requiredPrefix`；
- `revealSampleIdentity`；
- `calibrationRepeatEnabled`。

参与端公开杯测数据使用 `yingxiang-event-manifest/0.1`：

```text
organizerName
cuppingMode
samples[]
  ├─ eventSampleId
  ├─ sampleCode
  ├─ order
  └─ participant-safe label (optional)
```

`eventSampleId` 是活动范围内稳定槽位 ID，不等同于真实咖啡身份。盲测 Manifest 不包含 `canonicalSampleId`。

## 4. 分享链接与邀请

- D1 只保存 invite token 的 SHA-256 hash；
- invite 绑定 `event_id + event_revision`；
- 支持过期、最大使用次数、累计使用次数和统一撤销；
- D1 trigger 原子校验活动归属、revision、有效期和剩余次数；
- 成功插入 participant 后才递增 `use_count`；
- 未注册参与者可作为 guest principal 加入；
- 已登录账户可形成 account principal；
- 活动 revision 改变后旧邀请失效；
- 活动完成后邀请统一撤销。

加入接口要求客户端提交持久化的 `joinRequestId`。相同请求重复提交时返回原 participant，不再次消耗 invite，用于覆盖“服务器成功写入但响应途中断网”的现场网络故障。

当前 Worker 路由：

- `POST /api/v1/yingxiang/events`
- `POST /api/v1/yingxiang/events/:eventId/invites`
- `GET /api/v1/yingxiang/invites/:token`
- `POST /api/v1/yingxiang/invites/:token/join`
- `POST /api/v1/yingxiang/account-display-name`
- `POST /api/v1/yingxiang/events/:eventId/calibration-groups`
- `POST /api/v1/yingxiang/events/:eventId/complete`

## 5. 邀请进入香迹 Session：已实现

网页邀请形式：

```text
https://zjcrop.github.io/AromaSense/?yingxiangInvite=<token>
```

进入流程：

```text
读取公开 invite / event manifest
→ 显示组织方、模式和样品编号
→ 按 policy 建立参与名称
→ 服务器创建或恢复 Event Principal
→ 本地缓存 participant-safe Event Context
→ 本地保存 Event Principal
→ 根据 Manifest 创建 AromaSense Session + Sample records
→ 建立 event / participant / session 唯一绑定
→ 打开香迹原有杯测 UI
```

本地 `yingxiang_event_contexts` 不保存主办方 `owner_user_id`，参与者无需获得主办方账户身份信息。

Event Context、Principal、Session 和 `yingxiang_session_bindings` 在 SQLite 事务中写入。服务端已经加入但本地落盘中断时，可以使用同一 `joinRequestId` 重放服务器结果；本地已经存在绑定时直接恢复原 Session，不重复创建杯测记录。

## 6. 同一只豆子的重复校准

重复校准使用 `yingxiang_calibration_groups`：

- `canonical_sample_id` 指向真实咖啡身份；
- `event_sample_ids_json` 保存两个或以上活动样品槽位；
- 参与侧不读取 `canonical_sample_id`；
- 本地和 D1 都验证引用槽位存在于 Event Manifest；
- 揭示策略为 `after_event` 或 `organizer_only`；
- 不复制豆卡、不改写原始 observation。

后续比较引擎可以据此计算重复性、离散程度和系统性偏差。

## 7. Local-first 与同步边界

- 活动感官编辑仍然首先写本地 SQLite；
- 断网不能阻断已经建立的本地杯测；
- 迎香只增加 event scope，不替代 Session / Sample / Stage；
- 云端保存活动所有权、邀请、participant 和多人汇总所需关系；
- 活动 revision 与 Submission revision 独立；
- revision 不允许静默覆盖。

## 8. B0.1 当前落地文件

- `app/core/yingxiang-event.ts`
- `app/core/yingxiang-client.ts`
- `app/core/yingxiang-participation-service.ts`
- `app/storage/0006_yingxiang_event_context.sql`
- `app/storage/yingxiang-event-store.ts`
- `app/runtime/yingxiang-browser-bootstrap.ts`
- `app/ui/dom/yingxiang-host-renderer.ts`
- `app/ui/dom/yingxiang-join-renderer.ts`
- `cloud/worker/migrations/0007_yingxiang_events.sql`
- `cloud/worker/migrations/0008_account_display_name.sql`
- `cloud/worker/src/yingxiang-api.ts`
- `cloud/worker/src/index.ts`
- `tests/yingxiang-event.test.ts`
- `tests/yingxiang-event-store.test.ts`
- `tests/yingxiang-client.test.ts`
- `tests/yingxiang-participation-service.test.ts`

Web / Android 共用启动迁移链已加入本地 migration 6。

## 9. 下一开发范围

当前 B0.1 已形成“发布 → 邀请 → 加入 → 香迹 Session”的测试闭环。下一层继续包括：

1. 活动编辑与 revision 再发布；
2. 单个参与者释放；
3. 主办方参与进度读取；
4. SubmissionBundle 回收；
5. 多参与者结果汇总；
6. 重复校准统计与偏差分析；
7. 主办方看板。

页面仍以功能、系统兼容性和信息密度优先；移动与网页端保持同一业务流程，以响应式布局适配显示差异。
