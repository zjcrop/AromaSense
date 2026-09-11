CREATE TABLE IF NOT EXISTS record_sync_failures (
  record_id TEXT PRIMARY KEY,
  error_message TEXT NOT NULL,
  failed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_record_sync_failures_failed_at
  ON record_sync_failures(failed_at);
