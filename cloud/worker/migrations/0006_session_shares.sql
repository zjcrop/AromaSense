CREATE TABLE IF NOT EXISTS session_shares (
  share_token TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_session_shares_owner_session
  ON session_shares(owner_user_id, session_id, created_at DESC);
