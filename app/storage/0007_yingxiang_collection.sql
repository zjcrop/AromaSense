CREATE TABLE yingxiang_delivery (
  session_id TEXT PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  progress_sequence INTEGER NOT NULL DEFAULT 0,
  ack_revision INTEGER,
  ack_hash TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL
);
