# Cloudflare Deployment Baseline

## Goal

Validate the infrastructure in two independent stages:

1. deploy the Worker and verify `/health` without any database dependency;
2. create/bind D1, apply migration, then verify database write/read.

This separation prevents a D1 configuration error from being mistaken for a Worker deployment error.

## Stage A — first Worker deployment

In Cloudflare Dashboard:

1. Open **Workers & Pages**.
2. Create/import from GitHub repository `zjcrop/AromaSense`.
3. Configure the Worker project root as `cloud/worker` if the dashboard requests a root directory.
4. Build/install command: `npm install` (or the dashboard default for Node projects).
5. Deploy command: `npm run deploy` / `npx wrangler deploy` as supported by the selected Git integration flow.
6. Worker name must remain `aromasense-api` to match `wrangler.jsonc`.

After deployment, request:

```text
GET https://<worker-host>/health
```

Expected behavior before D1 is configured:

```json
{
  "ok": true,
  "service": "aromasense-api",
  "version": "0.1.0",
  "database": "not-configured"
}
```

The timestamp field is also returned and is intentionally dynamic.

## Stage B — create D1

From an authenticated Wrangler environment in `cloud/worker`:

```bash
npx wrangler d1 create aromasense-db --location=apac --binding=DB --update-config
```

Cloudflare returns/records the D1 database UUID and updates the Wrangler configuration with the D1 binding. Review the diff before committing it.

The resulting binding must be equivalent to:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "aromasense-db",
    "database_id": "<REAL-D1-UUID>",
    "migrations_dir": "../../migrations"
  }
]
```

Do not invent or commit a fake production UUID.

## Stage C — apply migration

From `cloud/worker`:

```bash
npx wrangler d1 migrations apply aromasense-db --remote
```

The initial migration creates only `infrastructure_test`. It is intentionally separate from future cupping-domain tables.

## Stage D — validate D1 write/read

Write:

```http
POST /api/v1/test/records
Content-Type: application/json

{"value":"aromasense-d1-ok"}
```

Expected HTTP status: `201`.

Read:

```http
GET /api/v1/test/records
```

The newly inserted test record should appear in the returned records array.

## Failure expectations

Before D1 is configured, database test routes must return:

- HTTP `503`
- error code `DB_NOT_CONFIGURED`

`GET /health` must continue to return HTTP `200`.

## Security

Do not place Cloudflare API tokens, account secrets, JWT signing keys, or user credentials in repository files or Wrangler plaintext vars intended for secrets. Use Cloudflare Secrets / appropriately scoped deployment credentials.

## Next milestone after validation

Only after the above checks pass should the repository add:

- production session/sample/revision schema;
- authentication;
- revision hash validation;
- idempotency rules;
- client SyncAdapter contract;
- R2 attachment support, if actually needed.
