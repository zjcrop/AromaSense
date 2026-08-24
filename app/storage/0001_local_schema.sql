PRAGMA foreign_keys = ON;

CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  title TEXT,
  status TEXT NOT NULL CHECK(status IN ('draft','active','completed','archived')),
  taxonomy_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE samples (
  sample_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  display_number INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  label TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(session_id, display_number),
  UNIQUE(session_id, sort_order)
);
CREATE INDEX idx_samples_session_sort ON samples(session_id, sort_order);

CREATE TABLE stage_state (
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  sample_id TEXT NOT NULL REFERENCES samples(sample_id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('not_started','active','completed')),
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(sample_id, stage_id)
);

CREATE TABLE observations (
  observation_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  sample_id TEXT NOT NULL REFERENCES samples(sample_id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  dictionary_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(sample_id, stage_id, field_key)
);
CREATE INDEX idx_observations_slice ON observations(sample_id, stage_id);

CREATE TABLE revisions (
  revision_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  sample_id TEXT,
  stage_id TEXT,
  revision_kind TEXT NOT NULL CHECK(revision_kind IN ('checkpoint','final')),
  sequence INTEGER NOT NULL,
  protocol_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(session_id, sequence),
  UNIQUE(revision_id, content_hash)
);
CREATE INDEX idx_revisions_session ON revisions(session_id, sequence);

CREATE TABLE sync_queue (
  queue_id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('pending','uploading','synced','failed','conflict')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(revision_id)
);
CREATE INDEX idx_sync_queue_pending ON sync_queue(status, next_attempt_at);

CREATE TABLE user_preferences (
  preference_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
