ALTER TABLE sessions ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_sessions_status_updated ON sessions(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_stage_state_session_status ON stage_state(session_id, status);
