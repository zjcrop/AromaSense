-- 0.1C -> sensory-flow/2.0 compatibility. Legacy rows remain readable; the
-- new flow receives copied observations/states without destructive rewrites.
--
-- Historical browser databases may contain orphan child rows from builds that
-- wrote with foreign-key enforcement disabled. INSERT OR IGNORE does not ignore
-- SQLite foreign-key violations, so only copy rows whose complete parent chain
-- still exists. The orphan source rows themselves are intentionally preserved.
INSERT OR IGNORE INTO observations (
  observation_id, session_id, sample_id, stage_id, field_key, value_json,
  dictionary_version, created_at, updated_at
)
SELECT legacy.observation_id || ':flow-aroma', legacy.session_id, legacy.sample_id, 'aroma', legacy.field_key,
       legacy.value_json, legacy.dictionary_version, legacy.created_at, legacy.updated_at
FROM observations AS legacy
WHERE legacy.stage_id = 'preparation'
  AND EXISTS (
    SELECT 1 FROM sessions AS parent_session
    WHERE parent_session.session_id = legacy.session_id
  )
  AND EXISTS (
    SELECT 1 FROM samples AS parent_sample
    WHERE parent_sample.sample_id = legacy.sample_id
      AND parent_sample.session_id = legacy.session_id
  );

INSERT OR IGNORE INTO observations (
  observation_id, session_id, sample_id, stage_id, field_key, value_json,
  dictionary_version, created_at, updated_at
)
SELECT legacy.observation_id || ':flow-flavor', legacy.session_id, legacy.sample_id, 'flavor', legacy.field_key,
       legacy.value_json, legacy.dictionary_version, legacy.created_at, legacy.updated_at
FROM observations AS legacy
WHERE legacy.stage_id = 'final'
  AND legacy.field_key IN ('flavor_tags','notes')
  AND EXISTS (
    SELECT 1 FROM sessions AS parent_session
    WHERE parent_session.session_id = legacy.session_id
  )
  AND EXISTS (
    SELECT 1 FROM samples AS parent_sample
    WHERE parent_sample.sample_id = legacy.sample_id
      AND parent_sample.session_id = legacy.session_id
  );

INSERT OR IGNORE INTO observations (
  observation_id, session_id, sample_id, stage_id, field_key, value_json,
  dictionary_version, created_at, updated_at
)
SELECT legacy.observation_id || ':flow-overall', legacy.session_id, legacy.sample_id, 'overall', legacy.field_key,
       legacy.value_json, legacy.dictionary_version, legacy.created_at, legacy.updated_at
FROM observations AS legacy
WHERE legacy.stage_id = 'final'
  AND (
    legacy.field_key LIKE 'profile_%' OR legacy.field_key LIKE 'quality_%' OR
    legacy.field_key LIKE 'defect_%' OR legacy.field_key LIKE 'off_flavor_%' OR
    legacy.field_key LIKE 'overall_%'
  )
  AND EXISTS (
    SELECT 1 FROM sessions AS parent_session
    WHERE parent_session.session_id = legacy.session_id
  )
  AND EXISTS (
    SELECT 1 FROM samples AS parent_sample
    WHERE parent_sample.sample_id = legacy.sample_id
      AND parent_sample.session_id = legacy.session_id
  );

INSERT OR IGNORE INTO stage_state (session_id, sample_id, stage_id, status, started_at, completed_at, updated_at)
SELECT legacy.session_id, legacy.sample_id, 'aroma', legacy.status, legacy.started_at, legacy.completed_at, legacy.updated_at
FROM stage_state AS legacy
WHERE legacy.stage_id = 'preparation'
  AND EXISTS (
    SELECT 1 FROM sessions AS parent_session
    WHERE parent_session.session_id = legacy.session_id
  )
  AND EXISTS (
    SELECT 1 FROM samples AS parent_sample
    WHERE parent_sample.sample_id = legacy.sample_id
      AND parent_sample.session_id = legacy.session_id
  );

INSERT OR IGNORE INTO stage_state (session_id, sample_id, stage_id, status, started_at, completed_at, updated_at)
SELECT legacy.session_id, legacy.sample_id, 'flavor', legacy.status, legacy.started_at, legacy.completed_at, legacy.updated_at
FROM stage_state AS legacy
WHERE legacy.stage_id = 'final'
  AND EXISTS (
    SELECT 1 FROM sessions AS parent_session
    WHERE parent_session.session_id = legacy.session_id
  )
  AND EXISTS (
    SELECT 1 FROM samples AS parent_sample
    WHERE parent_sample.sample_id = legacy.sample_id
      AND parent_sample.session_id = legacy.session_id
  );

INSERT OR IGNORE INTO stage_state (session_id, sample_id, stage_id, status, started_at, completed_at, updated_at)
SELECT legacy.session_id, legacy.sample_id, 'overall', legacy.status, legacy.started_at, legacy.completed_at, legacy.updated_at
FROM stage_state AS legacy
WHERE legacy.stage_id = 'final'
  AND EXISTS (
    SELECT 1 FROM sessions AS parent_session
    WHERE parent_session.session_id = legacy.session_id
  )
  AND EXISTS (
    SELECT 1 FROM samples AS parent_sample
    WHERE parent_sample.sample_id = legacy.sample_id
      AND parent_sample.session_id = legacy.session_id
  );

INSERT OR IGNORE INTO stage_state (session_id, sample_id, stage_id, status, started_at, completed_at, updated_at)
SELECT legacy.session_id, legacy.sample_id, 'scoring', legacy.status, legacy.started_at, legacy.completed_at, legacy.updated_at
FROM stage_state AS legacy
WHERE legacy.stage_id = 'final'
  AND EXISTS (
    SELECT 1 FROM sessions AS parent_session
    WHERE parent_session.session_id = legacy.session_id
  )
  AND EXISTS (
    SELECT 1 FROM samples AS parent_sample
    WHERE parent_sample.sample_id = legacy.sample_id
      AND parent_sample.session_id = legacy.session_id
  );

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
