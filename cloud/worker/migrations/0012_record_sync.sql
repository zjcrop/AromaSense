PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sync_records (
  owner_user_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  payload_json TEXT,
  device_id TEXT,
  server_changed_at TEXT NOT NULL,
  PRIMARY KEY(owner_user_id, record_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_records_owner_updated
  ON sync_records(owner_user_id, updated_at);

CREATE TABLE IF NOT EXISTS sync_record_changes (
  change_id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  changed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_record_changes_owner_cursor
  ON sync_record_changes(owner_user_id, change_id);
