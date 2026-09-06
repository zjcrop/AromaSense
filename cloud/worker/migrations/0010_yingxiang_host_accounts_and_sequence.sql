CREATE TABLE IF NOT EXISTS yingxiang_host_accounts (
  account_id TEXT PRIMARY KEY,
  account_key TEXT NOT NULL UNIQUE,
  account_name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
  device_secret_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_yingxiang_host_accounts_name
  ON yingxiang_host_accounts(account_key, updated_at);

CREATE TABLE IF NOT EXISTS yingxiang_host_tokens (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES yingxiang_host_accounts(account_id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_yingxiang_host_tokens_account
  ON yingxiang_host_tokens(account_id, expires_at);

ALTER TABLE yingxiang_participants ADD COLUMN participant_ordinal INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_yingxiang_participant_ordinal
  ON yingxiang_participants(event_id, participant_ordinal)
  WHERE participant_ordinal IS NOT NULL;
