# AromaSense

**香迹：数字化咖啡杯测与感官评价系统**

AromaSense（香迹）是一个面向咖啡杯测与感官评价场景的 Local-first 数字化工具。

## 当前阶段

项目处于基础设施验证阶段。第一阶段目标是验证：

1. GitHub 作为唯一源码与版本管理源；
2. Cloudflare Workers 作为轻量 API 层；
3. Cloudflare D1 作为云端结构化备份数据库；
4. 客户端 SQLite 作为杯测过程中的本地主数据源；
5. 网络异常不影响杯测，恢复后通过 revision/checkpoint 机制同步。

## 核心原则

- **Local-first**：杯测过程中所有关键编辑先原子写入本地数据库。
- **云端不是实时主库**：云端负责同步、备份、跨设备恢复和后续聚合分析。
- **数据不可静默覆盖**：同步采用 revision、hash 和幂等键。
- **Schema 必须版本化**：任何生产数据结构变化必须通过 migration。
- **最小权限**：密钥、Token、用户凭据不得提交到仓库。
- **闭源项目**：AromaSense 自有代码与业务知识默认 proprietary；第三方开源组件遵守各自许可证。

## 计划中的目录

```text
AromaSense/
├── app/                    # 客户端（后续）
├── cloud/
│   └── worker/             # Cloudflare Workers API
├── migrations/             # D1 schema migrations
├── docs/                   # 架构与项目知识
├── third_party/            # 第三方许可证与声明
├── tests/                  # 测试
├── AGENTS.md               # AI/自动化开发约束
└── THIRD_PARTY_NOTICES.md  # 第三方依赖清单
```

## 第一阶段测试接口

在 Cloudflare Worker 首次部署后：

- `GET /health`：验证 Worker 可用性；
- `GET /api/v1/test/records`：D1 绑定完成后验证读取；
- `POST /api/v1/test/records`：D1 绑定完成后验证写入。

D1 未绑定时，`/health` 仍应正常工作，数据库测试接口返回明确的 `503 DB_NOT_CONFIGURED`，以便把 Worker 部署问题和数据库绑定问题分开诊断。

## License

AromaSense is proprietary software. All rights reserved unless explicitly stated otherwise for individual third-party components.
