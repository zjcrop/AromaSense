# AromaSense AI / Automation Development Rules

These rules apply to AI-assisted and automated changes in this repository.

## 1. Read before modifying

Before changing architecture, persistence, synchronization, or data contracts, read:

- `README.md`
- `docs/PROJECT_CONTEXT.md`
- relevant migration files
- `THIRD_PARTY_NOTICES.md`

## 2. Non-negotiable product constraints

- AromaSense is Local-first.
- The local database is the source of truth during active cupping.
- Network failure must not block recording or destroy completed local data.
- Completed cloud uploads must use immutable revision identities.
- Repeated uploads of the same revision must be idempotent.
- Never silently overwrite a conflicting revision with different content.
- Only the current sample/stage should need to be loaded into the active editing context.

## 3. Database rules

- Do not create one physical database table per coffee sample.
- Use stable shared tables and logical partition keys such as `session_id`, `sample_id`, and `stage_id`.
- Every production schema change requires a numbered migration.
- Never edit an already-applied production migration; add a new migration instead.
- Foreign keys, uniqueness constraints, and indexes must be explicit where required for integrity.

## 4. Cloud rules

- Cloudflare Workers are an API/synchronization layer, not the active cupping state engine.
- D1 is a cloud backup/synchronization store, not a substitute for local transactional persistence.
- Keep cloud provider access behind a repository/service abstraction so a future provider migration does not rewrite domain logic.
- R2 must only be introduced for binary/object storage when needed.

## 5. Security rules

Never commit:

- API tokens
- private keys
- Cloudflare secrets
- production JWT signing secrets
- user credentials
- raw personal data exports

Use Cloudflare Secrets or GitHub Actions Secrets where appropriate.

## 6. Third-party dependency policy

Preferred licenses:

- Apache-2.0
- MIT
- BSD-2-Clause / BSD-3-Clause

LGPL, GPL, AGPL, SSPL, source-available, non-commercial, model-specific, data-specific, or custom licenses require explicit review before adoption.

For every third-party component, record:

- project name
- version
- upstream URL
- license
- whether source was modified
- required attribution/NOTICE obligations

in `THIRD_PARTY_NOTICES.md`.

## 7. Testing rules

Every infrastructure change must preserve:

- `/health` availability independent of D1 availability;
- explicit errors rather than silent fallback;
- deterministic validation of request payloads;
- database write/read tests before production sync endpoints are enabled.

Do not claim deployment, database migration, or CI success unless the corresponding real environment result has been observed.

## 8. Change discipline

Prefer small coherent changes over unrelated patches. If a change modifies a protocol, schema, or persisted structure, update the corresponding documentation in the same change.
