PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sync_revisions (
  revision_id TEXT PRIMARY KEY,
  protocol_version TEXT NOT NULL,
  revision_kind TEXT NOT NULL CHECK(revision_kind IN ('checkpoint','final')),
  session_id TEXT NOT NULL,
  sample_id TEXT,
  stage_id TEXT,
  sequence INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_sync_revisions_session
  ON sync_revisions(session_id, sequence);

CREATE INDEX IF NOT EXISTS idx_sync_revisions_sample_stage
  ON sync_revisions(sample_id, stage_id);
