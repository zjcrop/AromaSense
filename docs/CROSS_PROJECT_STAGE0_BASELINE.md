# Cross-project Stage 0 baseline — AromaSense / Yingxiang

Date: 2026-09-06
Base branch: `main`
Original audited source SHA: `dfbdfca0c683c74dbcc053cd46fd98e3c824c020`
Stage 0 validated branch head before this record update: `884598b006f752cda9193fc5b6fcca60f1a7c8ee`
AromaSense product baseline: `B0.2.a` (alpha)
Yingxiang module baseline: `B0.1` (test)

This document is the Stage 0 control point. Stage 0 changes no AromaSense/Yingxiang production business behavior. Executable additions are test/CI instrumentation only.

## 1. Product/repository boundary confirmed

Yingxiang is an active module inside the AromaSense repository. It reuses AromaSense Session / Sample / Stage, recognition, local persistence and sensory workflow, then adds event publishing, temporary participant identity, invitation, calibration mapping, aggregation and host operations.

Later work must integrate shared foundations into the existing module rather than re-create it.

## 2. Local-first and data-safety freeze boundary

The following are non-negotiable:

- local SQLite remains authoritative during active cupping;
- network failure cannot block or erase sensory recording;
- only the active sample/stage slice should be required in the editing context;
- immutable revision/hash upload semantics remain idempotent;
- Yingxiang event binding does not replace the local Session repository;
- stable sample identity cannot be derived from rail/display order;
- schema changes require numbered migrations and old production migrations are never edited in place.

Stage 1 must not change these rules.

## 3. Recognition dependency mismatch recorded

AromaSense currently depends on:

`luckybean-static-app#ff2db954a27aba1adc882e0f0c5392af0cd082f3`

That is older than the current LuckyBean Stage 0 baseline. AromaSense therefore does not automatically inherit later LuckyBean startup, WebKit, OCR-reuse and Android Native preprocessing changes.

Do **not** silently bump this dependency during Stage 1. Recognition-provider reconciliation belongs to the later Recognition integration stage with explicit compatibility tests.

## 4. Recognition work retained for later stages

Prioritize later, not during Stage 1:

1. multi-item record association robustness;
2. shared LuckyBean/Coffee Foundation semantic reuse;
3. Chinese/other date normalization and continuous flavor-token segmentation;
4. recognition/review screen behavior and direct editing;
5. selective AI use for ambiguous structure/low-confidence cases;
6. performance work only where the six-phase baseline identifies a real bottleneck.

Automatic full-image cropping remains a recovery tool rather than the default path.

## 5. Cupping timing/editability gap retained for later Session work

Current documentation says browsing should not start a Session while current controller behavior can activate draft sessions on entry. The approved timed/untimed rule remains a later Session-policy task:

- `timed`: structural edit is locked during active timing;
- structural edit requires explicit confirmation and timing interruption;
- `untimed`: leave/re-enter and add/delete/reorder remain available;
- lifecycle and timing status stay independent;
- deleting samples with observations preserves history.

Stage 1 must not modify Session lifecycle or timing policy.

## 6. Cross-project interfaces to stabilize

Stage 1 should stabilize:

- Overlay / Navigation / Back / Exit;
- route/history semantics;
- flow step navigation boundary;
- platform back-gesture adapter;
- root exit guard.

RecognitionDocument, RecordGroup, BatchInput, SortableList and long-task contracts remain later stages unless needed only as unchanged interface dependencies.

A shared npm package remains deferred until both applications prove the interfaces in production-shaped tests.

## 7. Third-party/license warning retained

`THIRD_PARTY_NOTICES.md` still needs reconciliation with the PP-OCR assets actually bundled by the build. This is a release/legal bookkeeping item and is not a reason to replace the OCR implementation.

## 8. Final Stage 0 execution record

The final Stage 0 branch validation includes:

- Firebase auth configuration checks;
- TypeScript typecheck and domain/storage tests;
- browser bundle and recognition hardening;
- Cloudflare Worker typecheck;
- browser startup/refresh acceptance;
- Stage 0 six-phase Recognition benchmark;
- Android debug build.

Both `AromaSense browser refresh acceptance` and the complete `AromaSense CI` completed successfully for branch head `884598b006f752cda9193fc5b6fcca60f1a7c8ee` before this documentation-only update.

The first benchmark instrumentation attempt failed because the production `LuckyBeanRecognitionCore` is deliberately `Object.freeze()` and a JavaScript Proxy cannot replace frozen non-configurable methods. The benchmark was corrected to use a plain timed wrapper and restore the original global object afterwards; production code was not modified.

A subsequent run completed the actual recognition pipeline but treated ONNX Runtime `CleanUnusedInitializersAndNodeArgs` optimizer warnings as fatal browser errors. The test now filters only that known warning class while retaining true Recognition/Paddle/ONNX/SQLite failures as blockers.

## 9. Six-phase Recognition performance baseline

The benchmark uses deterministic camera-like JPEG fixtures for **performance/regression measurement**, not as a claim of real coffee-label accuracy. It executes the existing `SampleRecognitionService`, production LuckyBean Recognition Core, real `BrowserSQLiteDriver` / `LocalCuppingRepository` persistence and the real batch review dialog.

Observed GitHub Actions Chromium result:

| Phase | Single sample | Two-entry table |
| --- | ---: | ---: |
| image preparation | 0.1 ms | 0.0 ms |
| OCR | **3809.4 ms** | **3037.6 ms** |
| layout / group | 14.6 ms | 10.9 ms |
| canonical | 23.8 ms | 23.7 ms |
| recognition total | **3847.9 ms** | **3072.2 ms** |
| persistence | — | **6.2 ms** for 2 samples |
| Review UI render | **26.6 ms** | — |

Recognition result details:

- engine: `PP-OCRv5-browser-0.4.4-self-hosted-worker`;
- single fixture: 1 sample, `layoutType=single`, no segmentation review;
- multi-entry fixture: **2 samples**, `layoutType=table`, no segmentation review;
- Review UI rendered 7 recognized fields in the measured single-sample case.

The engineering conclusion is explicit: OCR accounts for about 99% of recognition wall time in these fixtures. Layout/group, canonicalization, SQLite persistence and UI rendering are not the current primary bottlenecks. Stage 1 must not optimize or alter this recognition path.

## 10. Earlier domain/storage timing context

The pre-browser Node baseline also showed representative durations such as:

- dense one-row-per-sample grouping: 13.66 ms;
- roast-grouped menu grouping: 19.21 ms;
- coffee-table column grouping: 42.60 ms;
- session plus samples atomic create/restart slice: 13.57 ms;
- 100-sample slice-scoped rail path: 54.38 ms;
- offline session then sync recovery: 52.34 ms;
- immutable event cloud guards: 47.22 ms.

These remain supporting regression context, not substitutes for the six-phase browser trace above.

## 11. Stage 0 risk disposition

- Green: six-phase end-to-end recognition timing now exists.
- Green: a multi-entry camera-like table is correctly separated into 2 samples in the benchmark.
- Green: Browser acceptance, core/persistence, Worker checks and Android debug CI pass.
- Green: local-first storage, immutable revisions and migrations remain untouched.
- Yellow: the old LuckyBean dependency/provider mismatch remains intentionally unresolved for the later Recognition stage.
- Yellow: clean browser builds still depend on remote BrewIon/Coffee Knowledge inputs and can experience transient network timeout risk.
- Yellow: PP-OCR third-party notice text remains to be reconciled before release.
- Yellow: real physical coffee-label accuracy remains a later Recognition/manual-device acceptance item.
- Red/deferred: documented Session activation semantics still differ from current controller behavior; reserved for the Session/timed-mode stage, not Stage 1.

Stage 0 is **validated for entry to Stage 1**.

## 12. Stage 1 entry condition

The Global Interaction Foundation may proceed under these constraints:

- do not modify Recognition semantics or the LuckyBean dependency pin;
- do not modify local database schema, Session lifecycle policy or Yingxiang event protocol;
- preserve current startup, account and local-first behavior;
- introduce one authoritative interaction boundary for overlay/navigation/back/exit behavior;
- prove browser and Android behavior through regression tests before Stage 1 merge.
