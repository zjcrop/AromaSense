# AromaSense 云端记录下载与跨设备恢复

## 目标

云端记录不是独立的导入格式，而是 record-level 双向同步的人工选择入口。

任何已经创建并产生有效本地数据的杯测 Session，包括 `draft`、`active`、`completed` 和 `archived`，都可以进入记录级云同步。下载时继续使用原 `sessionId`，不得复制生成新的 Session 身份。

## 用户入口

杯测记录工具栏增加 `云端记录`。页面沿用现有 AromaSense 表单设计语言，并提供三种范围：

- `最近记录`：最近 3 / 5 / 10 / 20 场；
- `按时间`：按杯测日期起止范围下载；
- `选择下载`：先读取云端轻量列表，再逐场勾选。

云端列表仅展示识别记录所需的摘要信息：

- 杯测日期；
- 组织方；
- 杯测会名称；
- 轻量状态标识（进行中 / 已完成）。

列表请求不得为了展示摘要而把所有完整 observation 数据传到客户端。

## API

### `GET /api/v1/records/index`

读取当前登录账户的非删除云端记录摘要。

查询参数：

- `offset`：非负整数，默认 0；
- `limit`：1–500，默认 200。

返回每条记录：

```text
recordId
date
organizer
eventName
status
updatedAt
serverChangedAt
```

响应同时返回 `nextOffset` 与 `hasMore`。客户端可以分页读取完整索引，但不会因此下载完整杯测内容。

### `GET /api/v1/records/:recordId`

读取当前登录账户拥有的单条完整 record envelope。不存在时返回 `404 RECORD_NOT_FOUND`。

### `PUT /api/v1/records/:recordId`

保持既有 record-level 上传协议不变。

### `GET /api/v1/records?cursor=...`

保持既有增量 change feed 不变，继续用于自动双向同步。

## 下载合并规则

人工下载与自动同步共用 `RecordSyncService.applyRemote()` 的时间戳、删除 tombstone 和同一 `sessionId` 合并规则。

因此：

- 本机没有该记录：按原 `sessionId` 写入；
- 云端版本较新：更新本地同一记录；
- 本地版本较新：保留本地，人工下载不得静默覆盖；
- 云端已经删除：按 tombstone 规则删除本地；
- 后续自动 change feed 再遇到同一版本时会自然跳过，不生成重复记录。

## Local-first 约束

云端下载不改变 Local-first 原则：

- 活跃杯测仍首先写本地 SQLite；
- 网络失败不会阻止本地记录；
- 下载只是恢复/同步入口，不是杯测编辑的数据源；
- 未完成记录下载后保留原 stage、observation、started/completed 状态，可在另一设备继续。
