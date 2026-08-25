# AromaSense Implementation Status

Updated: 2026-08-25

> This file records **observed product capability**, not merely the existence of a model, interface, or renderer. Automated acceptance and physical/runtime acceptance are distinguished explicitly. A feature that depends on external infrastructure is not treated as complete until that infrastructure has been exercised.

## Phase 0 — Project baseline
- [x] Repository and development rules
- [x] Project context and architecture
- [x] Third-party license governance
- [x] Sync protocol `aromasense-sync/1.0`
- [x] Stage identifier contract `sensory-stage/1.0`
- [x] Repository is currently public for GitHub Pages / open access testing

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
- [x] Node SQLite rows normalized to plain objects for adapter parity
- [x] serialized field-write / context-switch controller
- [x] transaction rollback test coverage
- [x] close/reopen recovery test coverage
- [x] browser SQLite adapter using sql.js + IndexedDB persistence
- [x] migration-forward compatibility automated test
- [x] full CI and Android debug build observed passing on `9a254ad9dd496aabecb769fe6238c25f366ee8ba`
- [ ] real process-kill recovery acceptance test on Android

## Phase 3 — Account and cloud synchronization
- [x] Worker health endpoint code
- [x] D1 immutable revision schema/migrations in repository
- [x] idempotent revision POST contract
- [x] revision conflict detection
- [x] revision GET endpoint
- [x] register/login/logout client and Worker-side auth code
- [x] email verification / resend / verify-link code
- [x] pending-registration local persistence
- [x] local auth-session storage
- [x] account/sync product entry remains visible when cloud URL is absent
- [x] local sync-queue counts shown in account panel
- [x] registration client contract tests: pending verification, missing email service, verified login
- [x] Pages workflow refuses to publish a connected-account build when `AROMASENSE_CLOUD_URL` is absent
- [x] Cloud deploy workflow validates D1, Email Service sender and public URLs before deployment
- [ ] Cloudflare D1 binding verified in the real environment
- [ ] D1 migrations executed remotely and verified
- [ ] Cloudflare Email Service sender/domain verified and `EMAIL` binding active
- [ ] production `AROMASENSE_CLOUD_URL` configured in GitHub repository variables
- [ ] production `AROMASENSE_EMAIL_FROM` and `AROMASENSE_PUBLIC_APP_URL` configured
- [ ] real register → email receipt → verify → login acceptance test
- [ ] real authenticated revision write/read/idempotency/conflict acceptance test
- [ ] cross-device restore acceptance test

## Phase 4 — Cupping product UI

### Session setup and sample intake
- [x] manual multi-sample setup and automatic numbering
- [x] camera input and multi-image gallery input wired into setup UI
- [x] serial batch recognition service with native/TextDetector/Tesseract fallback chain
- [x] OCR layout model with line polygons and image geometry
- [x] multi-sample OCR layout segmentation tests
- [x] semantic field-decision tests for roast date, altitude, country leakage and conflicting values
- [x] OCR original text and parsed sample metadata stored in `samples.metadata_json`
- [x] recognition result remains editable before Session creation
- [x] Android native ML Kit Chinese/Latin OCR bridge ported and build-validated
- [ ] batch photo recognition runtime acceptance on current GitHub Pages build
- [ ] Android native OCR real-device acceptance with camera and gallery originals
- [ ] synonym/field-resolution coverage brought to LuckyBean production parity
- [ ] OCR segmentation manual merge / split / region-adjust interaction
- [ ] segmented ROI second-pass OCR refinement

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
- [x] bottom action bar `退出 / 上一步 / 下一步`
- [x] Next completes the current stage before moving forward
- [x] Exit flushes pending writes instead of deleting the Session
- [x] setup screen lists unfinished local Sessions for resume
- [ ] exit/resume runtime acceptance after browser refresh
- [ ] Android process-kill resume acceptance
- [ ] small-screen scrolling acceptance

### Product shell
- [x] Account / Sync entry on setup screen
- [x] Account / Sync actions available from the cupping rail
- [x] cloud-not-configured state shown explicitly instead of hiding account UI
- [x] local sync-queue counts shown in account panel
- [ ] full navigation shell acceptance on phone/tablet/desktop

## Phase 5 — Release validation
- [x] offline-only full session — automated SQLite integration test
- [ ] browser refresh recovery — real browser acceptance
- [ ] Android process-kill recovery — real device acceptance
- [x] network reconnection synchronization — automated integration test
- [x] duplicate/idempotent upload handling — automated test
- [x] conflicting revision protection — automated test
- [x] interrupted upload recovery — automated test
- [x] multi-sample stress test — 100 samples, slice-scoped observation loading
- [x] schema migration compatibility — automated close/reopen/forward migration test
- [ ] camera/gallery recognition stress and cancellation handling
- [ ] real Cloudflare authenticated round-trip

## Current release gate

The Local-first core is no longer the primary blocker. On 2026-08-25 the TypeScript strict-mode failures, Node 24 test discovery issue, Node SQLite row-shape mismatch and invalid sync-test fixtures were corrected. CI run #171 completed successfully, including TypeScript/tests, WebView bundle, Worker typecheck and Android `assembleDebug`.

The registration failure found during manual testing is now isolated to production infrastructure. The Worker intentionally rejects registration when Email Service is not configured, and the Pages workflow now intentionally rejects a deployment when `AROMASENSE_CLOUD_URL` is missing. This prevents a visually complete but non-functional account UI from being published as an accepted build.

The next hard gate is therefore external-cloud acceptance: configure the real Worker URL, D1 database, verified Email Service sender, apply migrations, then exercise `register → email → verify → login → revision upload/read → restore`. Until that chain passes, account/cloud synchronization remains incomplete.

LuckyBean remains a reference implementation for recognition vocabulary, account/sync UX and wizard navigation patterns. AromaSense retains its own Session/Sample Local-first storage model and does not import LuckyBean inventory/business logic wholesale.
