CREATE TABLE IF NOT EXISTS yingxiang_events (
  event_id TEXT PRIMARY KEY,
  event_revision INTEGER NOT NULL CHECK (event_revision >= 1),
  host_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','published','active','completed','cancelled')),
  policy_json TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_yingxiang_events_host_status
  ON yingxiang_events(host_user_id, status, updated_at);

CREATE TABLE IF NOT EXISTS yingxiang_event_contexts (
  event_id TEXT PRIMARY KEY,
  event_revision INTEGER NOT NULL CHECK (event_revision >= 1),
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','published','active','completed','cancelled')),
  policy_json TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cached_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_yingxiang_event_contexts_status
  ON yingxiang_event_contexts(status, cached_at);

CREATE TABLE IF NOT EXISTS yingxiang_event_principals (
  principal_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES yingxiang_event_contexts(event_id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL,
  identity_kind TEXT NOT NULL CHECK (identity_kind IN ('guest','account')),
  account_user_id TEXT,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','released')),
  bound_at TEXT NOT NULL,
  released_at TEXT,
  UNIQUE(event_id, participant_id),
  CHECK ((identity_kind = 'account' AND account_user_id IS NOT NULL) OR (identity_kind = 'guest' AND account_user_id IS NULL)),
  CHECK ((status = 'active' AND released_at IS NULL) OR status = 'released')
);

CREATE INDEX IF NOT EXISTS idx_yingxiang_principals_event_status
  ON yingxiang_event_principals(event_id, status, bound_at);
CREATE INDEX IF NOT EXISTS idx_yingxiang_principals_account
  ON yingxiang_event_principals(account_user_id, event_id, status);

CREATE TABLE IF NOT EXISTS yingxiang_calibration_groups (
  group_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES yingxiang_event_contexts(event_id) ON DELETE CASCADE,
  canonical_sample_id TEXT NOT NULL,
  event_sample_ids_json TEXT NOT NULL,
  reveal_policy TEXT NOT NULL CHECK (reveal_policy IN ('after_event','organizer_only')),
  created_at TEXT NOT NULL,
  UNIQUE(event_id, canonical_sample_id, event_sample_ids_json)
);

CREATE INDEX IF NOT EXISTS idx_yingxiang_calibration_event
  ON yingxiang_calibration_groups(event_id, created_at);
