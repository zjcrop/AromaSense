-- 0.1C -> sensory-flow/2.0 compatibility. Legacy rows remain readable; the
-- new flow receives copied observations/states without destructive rewrites.
INSERT OR IGNORE INTO observations (
  observation_id, session_id, sample_id, stage_id, field_key, value_json,
  dictionary_version, created_at, updated_at
)
SELECT observation_id || ':flow-aroma', session_id, sample_id, 'aroma', field_key,
       value_json, dictionary_version, created_at, updated_at
FROM observations WHERE stage_id = 'preparation';

INSERT OR IGNORE INTO observations (
  observation_id, session_id, sample_id, stage_id, field_key, value_json,
  dictionary_version, created_at, updated_at
)
SELECT observation_id || ':flow-flavor', session_id, sample_id, 'flavor', field_key,
       value_json, dictionary_version, created_at, updated_at
FROM observations WHERE stage_id = 'final' AND field_key IN ('flavor_tags','notes');

INSERT OR IGNORE INTO observations (
  observation_id, session_id, sample_id, stage_id, field_key, value_json,
  dictionary_version, created_at, updated_at
)
SELECT observation_id || ':flow-overall', session_id, sample_id, 'overall', field_key,
       value_json, dictionary_version, created_at, updated_at
FROM observations
WHERE stage_id = 'final' AND (
  field_key LIKE 'profile_%' OR field_key LIKE 'quality_%' OR
  field_key LIKE 'defect_%' OR field_key LIKE 'off_flavor_%' OR
  field_key LIKE 'overall_%'
);

INSERT OR IGNORE INTO stage_state (session_id, sample_id, stage_id, status, started_at, completed_at, updated_at)
SELECT session_id, sample_id, 'aroma', status, started_at, completed_at, updated_at
FROM stage_state WHERE stage_id = 'preparation';

INSERT OR IGNORE INTO stage_state (session_id, sample_id, stage_id, status, started_at, completed_at, updated_at)
SELECT session_id, sample_id, 'flavor', status, started_at, completed_at, updated_at
FROM stage_state WHERE stage_id = 'final';

INSERT OR IGNORE INTO stage_state (session_id, sample_id, stage_id, status, started_at, completed_at, updated_at)
SELECT session_id, sample_id, 'overall', status, started_at, completed_at, updated_at
FROM stage_state WHERE stage_id = 'final';

INSERT OR IGNORE INTO stage_state (session_id, sample_id, stage_id, status, started_at, completed_at, updated_at)
SELECT session_id, sample_id, 'scoring', status, started_at, completed_at, updated_at
FROM stage_state WHERE stage_id = 'final';

CREATE TABLE IF NOT EXISTS event_cache (
  event_id TEXT PRIMARY KEY,
  event_revision INTEGER NOT NULL,
  event_manifest_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(event_id, event_revision, content_hash)
);

CREATE TABLE IF NOT EXISTS comparison_mappings (
  mapping_id TEXT PRIMARY KEY,
  local_session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  comparison_subject_id TEXT NOT NULL,
  mapping_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(local_session_id, comparison_subject_id)
);

CREATE INDEX IF NOT EXISTS idx_comparison_local_session ON comparison_mappings(local_session_id, updated_at);
