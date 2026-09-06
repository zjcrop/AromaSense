# Cross-project Stage 0 baseline — AromaSense / Yingxiang

Date: 2026-09-06
Base branch: `main`
Validated source SHA for this audit: `dfbdfca0c683c74dbcc053cd46fd98e3c824c020`
AromaSense product baseline: `B0.2.a` (alpha)
Yingxiang module baseline: `B0.1` (test)

This document is a pre-integration control point. It changes no runtime behavior and must not be treated as a release by itself.

## 1. Product/repository boundary confirmed

Yingxiang is already an active module inside the AromaSense repository. It is not a future standalone project. It reuses AromaSense Session / Sample / Stage, recognition, local persistence and sensory workflow, then adds event publishing, temporary participant identity, invitation, calibration mapping, aggregation and host operations.

Recent `main` already includes Yingxiang sample-code intake by photo/table/paste and host recovery work. Later plans must therefore integrate shared foundations into existing Yingxiang code rather than re-create the module.

## 2. Local-first and data-safety freeze boundary

The following are non-negotiable and must not regress:

- local SQLite is authoritative during active cupping;
- network failure cannot block or erase sensory recording;
- only the active sample/stage slice should be required in the editing context;
- immutable revision/hash upload semantics remain idempotent;
- Yingxiang event binding does not replace the local Session repository;
- stable sample identity cannot be derived from rail/display order;
- schema changes require numbered migrations and old production migrations are never edited in place.

## 3. Recognition dependency mismatch discovered in Stage 0

AromaSense currently depends on:

`luckybean-static-app#ff2db954a27aba1adc882e0f0c5392af0cd082f3`

LuckyBean current audited baseline is newer (`115e5d7f509ee777166a296eefee203451121458`). Therefore AromaSense is still building recognition against an older LuckyBean/Foundation snapshot and does not automatically inherit the later LuckyBean startup, WebKit, OCR-reuse and Android Native preprocessing fixes.

This is a likely contributor to AromaSense still exhibiting recognition performance similar to older LuckyBean behavior.

Do **not** simply bump the dependency. `scripts/harden-recognition-runtime.mjs` currently asserts an older provider contract including `workerOnly === true`, while current LuckyBean supports a WebKit direct-WASM/no-SIMD compatibility path and does not expose a worker-only provider contract. Upgrade requires an explicit compatibility reconciliation and regression tests.

## 4. Recognition work that remains high value

Prioritize:

1. measure where AromaSense multi-item recognition time is spent;
2. repair item/group association so fields from different coffees cannot be incorrectly combined;
3. reuse the stabilized LuckyBean/Coffee Foundation semantics instead of maintaining parallel coffee-field logic;
4. improve Chinese/other date normalization and continuous flavor-token segmentation at the shared semantic layer;
5. keep re-recognition on the recognition/review screen, with all fields reorganized for review, rather than automatically handing off into form entry;
6. use AI selectively for ambiguous multi-item structure/low-confidence cases, not as a mandatory OCR pass.

Automatic full-image cropping is not a required normal path. Capture-quality feedback should first warn when the photographed information occupies too little of the frame. ROI remains a recovery tool.

## 5. Cupping timing/editability gap

Current domain documentation states that browsing should not start a Session and that the first meaningful sensory edit activates it. Current `CuppingScreenController.initialize()` still activates draft sessions on entry, so implementation and documented interaction semantics are not fully aligned.

The newly approved product rule should be implemented in a later AromaSense session stage as an explicit independent timing mode:

- `timed`: running timer locks sample structure; add/delete/reorder are blocked;
- requesting structural edit while timed requires explicit confirmation, ends/interupts timing, then unlocks editing;
- `untimed`: the user may leave the cupping flow and later add/delete/reorder samples, then re-enter and continue;
- lifecycle status and timing status must remain separate concepts;
- deleting a sample with existing observations must preserve history (soft-remove/archive semantics rather than destructive loss).

Do not bolt this onto one UI button; treat it as a Session policy plus project-editing capability.

## 6. Cross-project interfaces to stabilize

Stabilize interface contracts before attempting a shared package:

- Overlay / Navigation / Back / Exit;
- RecognitionDocument / RecognitionSession / RecognitionIssue;
- multi-item RecordGroup / RecordCandidate;
- BatchInput source-to-record contract;
- SortableList behavior;
- long-task status contract, with visible progress reserved for expected >5 s work;
- AI advisory and AI sensory-summary contracts.

A shared npm/package extraction is intentionally deferred until both repositories pass acceptance against these contracts.

## 7. Third-party/license consistency warning

`THIRD_PARTY_NOTICES.md` still describes PaddleOCR / PP-OCR as planned/under evaluation, while the build hardening pipeline copies LuckyBean/Foundation PP-OCR runtime/model assets into AromaSense output. Before a release that relies on those assets, the notice must be reconciled with the exact bundled source/version/model/license/attribution state.

This is a release/legal bookkeeping issue, not a reason to replace the OCR implementation.

## 8. Performance guardrails

Before later stages are merged, compare at least:

- AromaSense startup and first actionable UI;
- single-item scan;
- representative multi-item scan;
- time spent in image preparation, OCR, layout grouping, canonicalization, persistence and UI rendering;
- Web vs Android behavior;
- repeated recognition entry and memory stability.

No performance change is accepted solely on theoretical benefit. Multi-item accuracy and record association are primary correctness gates.

## 9. Stage 0 execution record

Execution time: `2026-09-06T09:31:02Z`

Environment: Linux, Node `v24.19.0`, npm `11.9.0`. Tests were executed from
`stage0-cross-project-baseline-20260906` at the pre-record commit
`8d76a634d185039fdcbe24fbbcf0310685de8c9d`, whose only change from the audited
source SHA is this control document.

| Command | Observed result | Wall time |
| --- | --- | ---: |
| `npm ci` | pass; 39 packages installed | 104.73 s |
| `npm run typecheck` | pass | 2.81 s |
| `npm test` | pass; 163/163 | 4.45 s |
| `npm run check` | pass; typecheck plus a second 163/163 test run | 7.18 s |
| `npm run bundle:web` | first run failed on the 12 s remote data timeout; unchanged retry passed | 22.65 s (passing retry) |

The successful bundle verified the executable LuckyBean recognition core,
same-origin PP-OCR/ROI Worker assets, lazy serialized recognition cache,
Coffee Knowledge `1.0.0-alpha.7`, 75 aliases, 5 blocked ambiguous entities,
16 knowledge-only varieties and unchanged QR indexes for both Pages and Android
WebView artifacts.

The first bundle attempt did not obtain the remote BrewIon data before the
hard-coded 12 s timeout, so no recognition bootstrap was emitted and the
hardening step correctly rejected the artifact. After the same URLs became
warm in the network cache, the exact same command passed without any source
change. This is a reproducible build-network flake risk, not a valid successful
fallback path.

## 10. Data-integrity and phase-level proxy measurements

The Node test run exercised the real domain/storage implementations and
reported these representative single-run durations:

| Covered path | Observed duration |
| --- | ---: |
| dense one-row-per-sample grouping | 13.66 ms |
| roast-grouped menu grouping | 19.21 ms |
| coffee-table column grouping | 42.60 ms |
| session plus samples atomic create/restart slice | 13.57 ms |
| 100-sample slice-scoped rail path | 54.38 ms |
| offline session then sync recovery | 52.34 ms |
| immutable event cloud guards | 47.22 ms |

These are regression-test timings, not image-recognition benchmarks. They show
that grouping, local transactions, large-session slicing, offline recovery and
immutable cloud rules execute without integrity failures in the Node runtime.

The requested end-to-end image phases have the following honest status:

| Recognition phase | Stage 0 status |
| --- | --- |
| image preparation | unmeasured; no representative image fixture and no executable browser/Android image runtime |
| OCR | unmeasured for the same reason |
| layout/group | exercised by real grouping tests; durations above, but without OCR/image preparation |
| canonical | exercised by Foundation field/date/i18n/conflict tests; no isolated end-to-end image timing |
| persistence | exercised by the real SQL.js repository and migration tests; representative timings above |
| UI render | contract-tested only; no local browser render timing |

The public Pages artifact tied to the audited `main` SHA was also opened in a
cloud Chromium smoke session. It reached the logged-out homepage with an empty
sample list and no visible error. The first observation was 2.946 s after
navigation but intentionally included a fixed 2.5 s settling wait; a same-tab
reload-to-visible-`开始杯测` reading was 0.942 s. The browser did not expose a
navigation performance trace, so these readings are observational smoke data,
not a repeatable performance baseline.

GitHub reported eight completed-success checks for
`dfbdfca0c683c74dbcc053cd46fd98e3c824c020` on 2026-09-06, including
`core-persistence`, `android-debug`, connected Web/Android builds,
`browser-refresh`, Cloudflare deployment verification and Pages publishing.
This confirms those CI jobs completed on the exact audited source; it does not
replace a physical-device OCR or launch measurement.

## 11. Current Stage 0 risks

- Red: no representative single-sample or multi-sample image OCR timing, and no
  six-phase end-to-end trace, exists yet.
- Red: the old LuckyBean pin/provider mismatch remains deliberately unchanged.
- Red: the documented "browsing does not activate a session" rule still differs
  from the current controller/tested timing behavior; this remains reserved for
  the later Session/timed-mode stage.
- Yellow: the 12 s remote BrewIon fetch timeout can make a clean bundle fail on
  a slow but otherwise successful connection.
- Yellow: PaddleOCR third-party notices remain inaccurate for the assets that
  are actually bundled.
- Green: type safety, 163 domain/storage tests, migrations, Local-first recovery,
  immutable revisions, event identity and both Web/Android bundle hardening
  passed without business-code or schema changes.

Stage 0 is therefore recorded accurately but is **not fully validated**. Stage 1
must not begin until representative photos are run through an executable
Chromium/WebKit or Android path and the six phase timings are captured.

## 12. Stage 1 entry condition

Proceed to the Global Interaction Foundation only after:

- this cross-project boundary is accepted;
- current AromaSense/Yingxiang startup and core cupping path are manually confirmed as a usable baseline;
- benchmark commands/data are recorded;
- the LuckyBean dependency mismatch is recorded as a later Recognition-stage task, not silently upgraded during navigation work.

Stage 1 must not modify recognition semantics, local database schema, Session lifecycle policy, or Yingxiang event protocol.
