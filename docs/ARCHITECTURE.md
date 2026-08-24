# AromaSense Architecture

## Delivery phases

### Phase 0 — contracts and invariants
- Freeze protocol v1 identifiers and stage semantics.
- Define local/cloud data ownership and revision rules.
- Define third-party license policy and schema migration rules.

### Phase 1 — local-first domain core
- One reusable cupping UI.
- One active `sample_id + stage_id` editing context.
- Every confirmed edit is committed locally in a short transaction.
- Network state never gates sensory recording.

### Phase 2 — persistence and revision engine
- SQLite is the active-session source of truth.
- Shared physical tables; no dynamic per-sample tables.
- Stage completion creates checkpoints; session completion creates an immutable final revision.
- Canonical serialization + SHA-256 content hash.
- Pending uploads live in `sync_queue` and are retried idempotently.

### Phase 3 — cloud synchronization
- Cloudflare Worker exposes revision/session APIs.
- D1 stores immutable revisions and query projections.
- Existing `revision_id` + same hash => ACK; same ID + different hash => conflict.
- Cloud provider code remains behind a SyncAdapter boundary.

### Phase 4 — interaction layer
- Batch sample import, auto numbering, manual ordering.
- Left sample rail activates one sample at a time.
- Shared sensory editor is reused across samples and stages.
- Stage progress uses preparation/high/mid/low/completed states.
- Flavor groups default collapsed; user ordering is persisted separately from canonical taxonomy.
- Voice prompts are event driven and never own workflow state.

### Phase 5 — validation and release
- Crash/restart recovery tests.
- Offline/full-network-loss tests.
- Multi-sample switching tests.
- Duplicate revision and hash-conflict tests.
- Migration tests and backward-compatible protocol checks.

## Layering

```text
UI
  -> Application / State machine
      -> Local repository (SQLite)
      -> Revision builder
      -> Sync repository interface
          -> Cloudflare adapter
              -> Worker API -> D1
```

The UI never writes directly to D1 and cloud failures must not mutate completed local data.
