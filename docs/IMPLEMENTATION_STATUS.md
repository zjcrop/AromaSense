# AromaSense Implementation Status

Updated: 2026-08-24

> This file records **observed product capability**, not merely the existence of a model, interface, or renderer. A feature is not treated as accepted until its complete user path has been exercised.

## Phase 0 — Project baseline
- [x] Repository and development rules
- [x] Project context and architecture
- [x] Third-party license governance
- [x] Sync protocol `aromasense-sync/1.0`
- [x] Stage identifier contract `sensory-stage/1.0`
- [x] Repository changed to public for GitHub Pages / open access testing

## Phase 1 — Domain core
- [x] Single active `sample + stage` editing context model
- [x] Deterministic stage state transitions
- [x] Provider-neutral SyncRepository boundary
- [x] Sensory dictionary v1
- [x] Sample batch import/reorder domain service
- [x] Session lifecycle service

## Phase 2 — Local-first persistence
- [x] SQLite production schema v1
- [x] observations / stage state / revisions / sync queue
- [x] deterministic canonical revision serializer
- [x] SHA-256 revision hashing
- [x] transactional local cupping repository over SQLite driver contract
- [x] Node 24 built-in SQLite runtime/reference adapter
- [x] serialized field-write / context-switch controller
- [x] transaction rollback test coverage added
- [x] close/reopen recovery test coverage added
- [x] browser SQLite adapter using sql.js + IndexedDB persistence
- [ ] latest CI execution observed and passing after product-shell changes
- [ ] real process-kill recovery acceptance test on Android

## Phase 3 — Account and cloud synchronization
- [x] Worker health endpoint code
- [x] D1 immutable revision schema/migrations in repository
- [x] idempotent revision POST contract
- [x] revision conflict detection
- [x] revision GET endpoint
- [x] register/login/logout client and Worker-side auth code exists
- [x] local auth-session storage exists
- [x] account/sync product entry remains visible even when cloud URL is not configured
- [ ] D1 binding verified in real Cloudflare environment
- [ ] migrations executed remotely
- [ ] production `AROMASENSE_CLOUD_URL` configured in web/Android build
- [ ] real register/login/logout acceptance test
- [ ] real write/read/idempotency/conflict acceptance test
- [ ] cross-device restore acceptance test

## Phase 4 — Cupping product UI

### Session setup and sample intake
- [x] manual multi-sample setup and automatic numbering
- [x] camera input and multi-image gallery input wired into setup UI
- [x] serial batch recognition service with native/TextDetector/Tesseract fallback chain
- [x] OCR original text and parsed sample metadata stored in `samples.metadata_json`
- [x] recognition result remains editable before Session creation
- [ ] batch photo recognition runtime acceptance on GitHub Pages
- [ ] Android native OCR bridge ported from LuckyBean and validated
- [ ] synonym/field-resolution coverage brought to LuckyBean production parity

### Left sample sticky-note rail
- [x] sample rail state model
- [x] sample card compact/expanded states
- [x] active sample automatically expands
- [x] stage progress color indicators
- [x] individual sample note expand/collapse action
- [x] whole left rail compact/expand action
- [x] sample and stage direct selection
- [x] drag reorder path retained in expanded mode
- [ ] visual/touch acceptance against the agreed sticky-note animation specification
- [ ] physical-device long-press / scroll conflict validation

### Cupping flow and interruption safety
- [x] reusable screen/controller orchestration
- [x] dictionary-driven slider/score/toggle/text/tag controls
- [x] persistent flavor group collapse/order
- [x] persistent descriptor/tag ordering
- [x] preparation/aroma/high/mid/low/final workflow
- [x] browser voice prompt adapter
- [x] final radar summary
- [x] bottom action bar changed to `退出 / 上一步 / 下一步`
- [x] Next completes the current stage before moving forward
- [x] Exit flushes pending writes instead of deleting the Session
- [x] setup screen lists unfinished local Sessions for resume
- [ ] exit/resume runtime acceptance after browser refresh and process restart
- [ ] small-screen scrolling acceptance

### Product shell
- [x] Account / Sync entry on setup screen
- [x] Account / Sync actions available from the cupping rail
- [x] cloud-not-configured state shown explicitly instead of hiding account UI
- [x] local sync-queue counts shown in account panel
- [ ] full navigation shell acceptance on phone/tablet/desktop

## Phase 5 — Release validation
- [ ] offline-only full session
- [ ] browser refresh recovery
- [ ] Android process-kill recovery
- [ ] network reconnection synchronization
- [ ] duplicate upload handling
- [ ] conflicting revision protection
- [ ] multi-sample stress test (50–100 samples)
- [ ] schema migration compatibility
- [ ] camera/gallery recognition stress and cancellation handling

## Current gate

The earlier statement that Phase 4 was “assembled end-to-end” was too broad. The repository had the recording core, persistence and several renderers, but the user-facing product shell and several development-manual flows were missing or hidden. That status claim has been withdrawn.

The current `main` now contains the first structural correction: batch camera/gallery recognition intake, editable OCR-derived sample metadata, unfinished-session resume, safe exit, collapsible sticky-note sample rail, and always-visible account/sync entry. These are **implemented code paths but not yet accepted runtime features**. They must remain below release gate until the new CI/Pages build and actual browser/device interaction are observed.

LuckyBean is used as the reference implementation for capture/recognition, account/sync UX and wizard navigation patterns, but AromaSense keeps its own Session/Sample local-first storage and does not import LuckyBean inventory/business logic wholesale.

Do not mark cloud synchronization complete until a real Worker URL, D1 binding, migrations and authenticated round-trip tests are observed.
