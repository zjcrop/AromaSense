# AromaSense Project Context

## Product identity

- Chinese name: 香迹
- English name: AromaSense
- Positioning: digital coffee cupping and sensory evaluation system

## Product objective

Replace fragile paper/spreadsheet-style multi-sample cupping records with a structured, recoverable, analyzable workflow while preserving the speed and freedom required during real cupping sessions.

The system is intended to improve process consistency, data integrity, recoverability, and later analysis. It must not claim to improve a cupper's intrinsic sensory acuity.

## Core workflow

A session may contain multiple coffee samples. Samples are imported/created, automatically numbered, and can be manually reordered. The operator works through a single reusable cupping UI while selecting the active sample from a compact sample list.

Each new sample progresses through seven formal sensory steps: aroma, high temperature, mid temperature, low temperature, flavor, overall assessment, and scoring. `preparation` and the combined legacy `final` stage remain readable only through versioned compatibility paths; neither is a formal step for new sessions. The exact stage taxonomy remains versioned and must not be hard-coded into database table names.

## Cupping target and blind modes

`cuppingMode` is the canonical Session-level cup-test target. It is also the source of truth for visibility and score-profile routing. The setup UI exposes exactly three choices:

- `open` — **公开杯测** (default): sample information is entered first; clicking Start uses the number of confirmed imported samples and does not ask for a second quantity.
- `blind` — **盲测**: sample information is not required before starting. Clicking Start asks for the cup-test quantity and creates that many empty Sample records/processes. Empty blind samples have no fake label or placeholder bean metadata; the active UI shows the derived anonymous `Sample NN` code only.
- `semi_blind` — **半盲测**: the normal photo/batch/manual import path remains available and incomplete bean metadata is allowed. Clicking Start asks for the total cup-test quantity. The total may equal or exceed the number of confirmed imported samples; any difference is filled with true empty Sample records. A total smaller than the imported sample count is rejected.

The old setup combination of free-text target plus a second independent blind-mode selector is deprecated. New Session writes use `cuppingMode`. Legacy `blindMode` values in existing metadata are read only for migration compatibility and normalize into the canonical mode.

Blindness remains a Session-level visibility rule, not a separate storage model. The underlying imported sample label and metadata remain stored locally so that one observation history can be revealed and reviewed later without copying or rewriting sample records.

During active cupping:

- `open`: show sample label and all recorded sample metadata;
- `semi_blind`: hide the sample label/direct identity and expose only the limited metadata whitelist. The default whitelist is country, region, process and roast level;
- `blind`: expose no sample metadata and derive only `Sample NN` from display order.

For blind/semi-blind Sessions, reveal occurs at the whole-Session completion boundary rather than per sample. `revealedAt` is written into Session metadata when the active Session becomes completed; completed/archived records then render any original label and metadata that exists. Starting a new Session from imported or historical metadata clears any stale reveal timestamp.

These fields live in the existing `sessions.metadata_json` document. This does not add a physical table or schema column and therefore does not require a new SQLite migration.

## Submission and comparison identity

New samples persist their capture `sampleIndex` before any display reordering. Event bindings use explicit event identifiers/codes or that stable capture index; legacy samples with no recorded index keep `sampleIndex` absent and use a local-ID fallback in exports. Neither array order, `sortOrder` nor `displayNumber` may supply an identity match. Blind and semi-blind comparison never invent a missing index.

Matching applies each priority across the whole sample set, reserves exact event matches before weaker matches, and leaves ambiguous candidates unmatched. Observation comparison keys include both the normalized FlowStep and field key, so repeated temperature observations cannot cross-match. Legacy preparation/final fields map to their corresponding current flow. Progress controls, confirmation flags and display state are excluded from comparison and local observations remain unchanged.

Submission `revision` is independent of Event `eventRevision`. Migration `0004_submission_revisions.sql` records each Session's immutable export revision/hash in local SQLite. Re-exporting unchanged content reuses the latest revision; changed content increments it, including when reverting to an older content state. The transaction and uniqueness constraint prevent revision reuse with different hashes. Export time does not change the content hash. Web and Android apply the same numbered migration before enabling exports.

## Score-profile routing

The sensory workflow, raw observations, flavor tags, radar data and defect observations remain shared across all three cupping modes. At the final scoring stage the Session mode routes to one explicit score profile:

- `open` -> `OpenCuppingScoreProfile`
- `blind` -> `BlindCuppingScoreProfile`
- `semi_blind` -> `SemiBlindCuppingScoreProfile`

The profile owns the scoring label, metadata policy and calculator version. The current 0.1C profiles all use the existing `aromasense-quality-0.1c` sensory-quality calculator because no separate mode-specific numerical weighting has been formally defined in product requirements. Blind and semi-blind profiles explicitly exclude hidden sample identity/bean metadata from the calculation. Do not invent an identification-hit percentage or new weighting without a separately approved scoring specification.

## Interaction principles

- One reusable editing UI for all samples.
- One active sample/stage editing context at a time.
- Switching samples must not discard unfinished local edits.
- Completed/recorded stages have clear visual progress states.
- Browsing samples or workflow steps leaves both the Session and sensory stages unstarted. Empty edits, identity edits and legacy phase navigation do not start a Session. The first meaningful saved sensory input activates the Session; the first meaningful stage input records its start time. Completion still requires the stage's explicit criteria.
- Voice prompts may signal preparation, high-temperature, mid-temperature, low-temperature, and completion stages.
- Flavor labels can be grouped/collapsed and may support user ordering where defined by product requirements.
- Blind visibility must be enforced by shared view/domain helpers rather than isolated CSS hiding, so web and Android use the same rule.

## Persistence architecture

### Local

The client will use SQLite or an equivalent transactional local database.

Every meaningful confirmed edit should be persisted locally in a short atomic transaction. The application should not rely on a large in-memory session object that is only persisted at the end.

Logical isolation uses stable identifiers rather than dynamic physical tables:

- `session_id`
- `sample_id`
- `stage_id`

The active UI loads only the required logical slice.

### Cloud

Cloud synchronization occurs after local persistence. Cloudflare Workers is the initial API layer; D1 is the initial structured cloud store. R2 is reserved for future binary attachments/exports.

Cloud synchronization uses revision/checkpoint semantics:

1. local edits are committed;
2. a checkpoint or completed revision is serialized deterministically;
3. a content hash is generated;
4. upload is attempted;
5. the server rejects conflicting content for an existing immutable revision identity;
6. retrying the same revision is safe and returns an ACK;
7. failed uploads remain pending locally for retry.

## Data modeling principles

Do not create a separate physical database table for each bean/sample. Use normalized or intentionally denormalized shared tables with logical keys and indexes.

The long-term sensory model should preserve separable layers, for example:

- descriptive observations;
- affective/quality impression;
- extrinsic/sample metadata;
- derived metrics.

This separation is intended to keep raw sensory observations distinguishable from calculated or preference-oriented results.

## Cloud provider boundary

Application/domain code should call a synchronization abstraction rather than Cloudflare-specific APIs directly. A future Tencent or other provider adapter should be possible without rewriting cupping domain logic.

## Initial infrastructure milestone

Before implementing the full cupping UI, verify in order:

1. GitHub repository write access;
2. Worker deployment and `GET /health`;
3. D1 creation and binding;
4. D1 migration application;
5. test write/read API;
6. error behavior when DB is absent/unavailable;
7. deployment reproducibility from repository source.

Only after this baseline is stable should production synchronization endpoints and application data be introduced.
