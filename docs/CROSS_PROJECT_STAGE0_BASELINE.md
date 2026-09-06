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

## 9. Stage 0 execution note

Static repository/dependency/contract audit is complete for this control point. The GitHub connector exposes no completed status checks for the current merge SHA, and this chat runtime cannot clone GitHub directly for local benchmark execution. Therefore **runtime benchmark numbers are not claimed here**. Capture them in the execution environment before Stage 1 acceptance.

## 10. Stage 1 entry condition

Proceed to the Global Interaction Foundation only after:

- this cross-project boundary is accepted;
- current AromaSense/Yingxiang startup and core cupping path are manually confirmed as a usable baseline;
- benchmark commands/data are recorded;
- the LuckyBean dependency mismatch is recorded as a later Recognition-stage task, not silently upgraded during navigation work.

Stage 1 must not modify recognition semantics, local database schema, Session lifecycle policy, or Yingxiang event protocol.
