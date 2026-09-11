CREATE TABLE IF NOT EXISTS record_sync_state (
  record_id TEXT PRIMARY KEY,
  last_pushed_at TEXT,
  deleted_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_record_sync_state_deleted
  ON record_sync_state(deleted_at);

CREATE TABLE IF NOT EXISTS record_sync_meta (
  meta_key TEXT PRIMARY KEY,
  meta_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
