-- Submission revisions describe this participant's exported content, independently
-- of the organizer's Event revision. Existing sessions/observations are untouched.
CREATE TABLE submission_revisions (
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
  created_at TEXT NOT NULL,
  PRIMARY KEY(session_id, revision)
);
