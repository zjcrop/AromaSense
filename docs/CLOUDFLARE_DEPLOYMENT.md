# Cloudflare Deployment and Acceptance

## Purpose

AromaSense cloud infrastructure is **not** part of the live cupping write path. The client remains Local-first; Cloudflare provides account verification, immutable revision synchronization, backup and restore.

A cloud release is accepted only when all three dependencies are real and observable:

1. Cloudflare Worker `aromasense-api`;
2. Cloudflare D1 database with current migrations;
3. Cloudflare Email Service with a verified sender used for account activation.

A Worker that responds to `/health` but lacks D1 or Email Service is not an accepted account backend.

## Required GitHub Actions configuration

### Secrets

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The API token must be scoped only to the resources required for Worker/D1 deployment. Do not commit API tokens, account credentials or mail credentials to repository files.

### Repository variables

- `AROMASENSE_D1_DATABASE_ID` — real D1 UUID
- `AROMASENSE_D1_DATABASE_NAME` — normally `aromasense-db`
- `AROMASENSE_EMAIL_FROM` — sender address on the verified Cloudflare email domain
- `AROMASENSE_PUBLIC_APP_URL` — e.g. `https://zjcrop.github.io/AromaSense/`
- `AROMASENSE_CLOUD_URL` — deployed HTTPS Worker origin, without an API path

`AROMASENSE_CLOUD_URL` is consumed by both the Pages build and Android build. The Pages workflow intentionally fails when it is empty, so a disconnected account UI cannot silently replace the accepted web build.

## Worker bindings

The deployment workflow generates the production Wrangler configuration. Its effective bindings must be equivalent to:

```jsonc
{
  "name": "aromasense-api",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "aromasense-db",
      "database_id": "<REAL-D1-UUID>",
      "migrations_dir": "migrations"
    }
  ],
  "send_email": [
    {
      "name": "EMAIL"
    }
  ],
  "vars": {
    "EMAIL_FROM": "verified-sender@example.com",
    "PUBLIC_APP_URL": "https://zjcrop.github.io/AromaSense/"
  }
}
```

Do not insert placeholder database UUIDs or unverified sender addresses into production configuration.

## D1 migrations

Current Worker migrations are located in `cloud/worker/migrations`:

1. `0002_sync_core.sql` — immutable synchronized revisions;
2. `0003_auth_and_ownership.sql` — users, auth tokens and revision ownership;
3. `0004_email_verification.sql` — verification state and single-use verification tokens.

The deploy workflow applies migrations remotely before deploying the Worker:

```bash
npx wrangler d1 migrations apply "$AROMASENSE_D1_DATABASE_NAME" --remote --config wrangler.deploy.jsonc
```

Do not mark the database complete merely because the SQL files exist in Git. Remote migration execution must be observed.

## Health acceptance

After deployment:

```http
GET /health
```

The accepted response must include the following states:

```json
{
  "ok": true,
  "service": "aromasense-api",
  "version": "B0.1.a",
  "protocol": "aromasense-sync/1.0",
  "database": "configured",
  "email": "configured"
}
```

The timestamp is dynamic.

The deployment workflow fails if either `database` or `email` is not `configured`.

## Account acceptance sequence

A real production registration test must exercise the complete chain, not only the POST response:

1. `POST /api/v1/auth/register` with a new test email and password of at least 10 characters;
2. expect HTTP `202`, `status=verification_required`;
3. confirm the verification email is actually delivered;
4. open its single-use `/api/v1/auth/verify?token=...` link;
5. confirm the Worker records `email_verified_at`;
6. `POST /api/v1/auth/login` with the same credentials;
7. confirm the returned token is accepted by `GET /api/v1/auth/me`;
8. `POST /api/v1/auth/logout` and confirm local session cleanup.

If `EMAIL` or `EMAIL_FROM` is absent, registration intentionally returns:

- HTTP `503`
- `EMAIL_SERVICE_NOT_CONFIGURED`

This behavior is preferable to creating accounts that can never be activated.

## Synchronization acceptance sequence

With an authenticated test account:

1. create a local checkpoint revision;
2. upload it with `POST /api/v1/revisions`;
3. repeat the same revision and verify idempotent acknowledgement;
4. attempt the same `revisionId` with a different content hash and verify conflict rejection;
5. retrieve the original revision with `GET /api/v1/revisions/:revisionId`;
6. confirm another account cannot read the revision;
7. complete a final revision;
8. restore the Session on a second device/browser profile and compare the reconstructed payload/hash.

Only after this round trip is observed may cross-device cloud synchronization be marked complete.

## Pages acceptance

The Pages workflow injects the repository variable `AROMASENSE_CLOUD_URL` into `web/index.template.html` during bundling. It verifies that:

- the URL is non-empty;
- the URL uses HTTPS;
- `__CLOUD_BASE_URL__` no longer exists in the artifact;
- the final HTML contains exactly the configured Worker origin.

A successful historical Pages deployment is not enough. The accepted browser build must be produced from the intended current `main` SHA with this connected configuration.

## Android acceptance

CI builds the same web bundle into the Android application and runs `assembleDebug`. A successful APK build proves compile/package compatibility, not runtime cloud or OCR behavior.

Physical-device acceptance still requires:

- account registration and verification over the real Worker;
- camera/gallery original-image OCR;
- process-kill and Session resume;
- touch/long-press/scroll conflict checks;
- network loss and reconnection while a real revision queue exists.

## Security constraints

- Never commit Cloudflare API tokens, user credentials or other deployment secrets.
- Keep revision ownership server-side; never trust a client-provided owner ID.
- Keep verification tokens single-use and time limited.
- Do not weaken local SQLite foreign keys to make tests pass; test fixtures must satisfy production invariants.
- Cloud account availability must never be a prerequisite for recording a cupping Session locally.
