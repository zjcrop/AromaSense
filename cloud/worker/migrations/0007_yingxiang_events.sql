CREATE TABLE IF NOT EXISTS yingxiang_events (
  event_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  event_revision INTEGER NOT NULL CHECK (event_revision >= 1),
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','published','active','completed','cancelled')),
  policy_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_yingxiang_events_owner
  ON yingxiang_events(owner_user_id, status, updated_at);

CREATE TABLE IF NOT EXISTS yingxiang_invites (
  invite_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES yingxiang_events(event_id) ON DELETE CASCADE,
  event_revision INTEGER NOT NULL CHECK (event_revision >= 1),
  token_hash TEXT NOT NULL UNIQUE,
  assigned_name TEXT,
  expires_at TEXT NOT NULL,
  max_uses INTEGER CHECK (max_uses IS NULL OR max_uses >= 1),
  use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_yingxiang_invites_event
  ON yingxiang_invites(event_id, expires_at, revoked_at);

CREATE TABLE IF NOT EXISTS yingxiang_participants (
  participant_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES yingxiang_events(event_id) ON DELETE CASCADE,
  invite_id TEXT NOT NULL REFERENCES yingxiang_invites(invite_id) ON DELETE RESTRICT,
  account_user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  identity_kind TEXT NOT NULL CHECK (identity_kind IN ('guest','account')),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','released')),
  joined_at TEXT NOT NULL,
  released_at TEXT,
  CHECK ((identity_kind = 'account' AND account_user_id IS NOT NULL) OR (identity_kind = 'guest' AND account_user_id IS NULL)),
  CHECK ((status = 'active' AND released_at IS NULL) OR status = 'released')
);

CREATE INDEX IF NOT EXISTS idx_yingxiang_participants_event
  ON yingxiang_participants(event_id, status, joined_at);
CREATE INDEX IF NOT EXISTS idx_yingxiang_participants_account
  ON yingxiang_participants(account_user_id, event_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_yingxiang_active_name_unique
  ON yingxiang_participants(event_id, display_name) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_yingxiang_active_account_unique
  ON yingxiang_participants(event_id, account_user_id)
  WHERE status = 'active' AND account_user_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_yingxiang_participant_invite_guard
BEFORE INSERT ON yingxiang_participants
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM yingxiang_invites i
    WHERE i.invite_id = NEW.invite_id
      AND i.event_id = NEW.event_id
      AND i.revoked_at IS NULL
      AND i.expires_at > NEW.joined_at
      AND (i.max_uses IS NULL OR i.use_count < i.max_uses)
      AND i.event_revision = (SELECT e.event_revision FROM yingxiang_events e WHERE e.event_id = NEW.event_id)
  ) THEN RAISE(ABORT, 'YINGXIANG_INVITE_UNAVAILABLE') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_yingxiang_participant_invite_consume
AFTER INSERT ON yingxiang_participants
BEGIN
  UPDATE yingxiang_invites SET use_count = use_count + 1 WHERE invite_id = NEW.invite_id;
END;

CREATE TABLE IF NOT EXISTS yingxiang_calibration_groups (
  group_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES yingxiang_events(event_id) ON DELETE CASCADE,
  canonical_sample_id TEXT NOT NULL,
  event_sample_ids_json TEXT NOT NULL,
  reveal_policy TEXT NOT NULL CHECK (reveal_policy IN ('after_event','organizer_only')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(event_id, canonical_sample_id, event_sample_ids_json)
);

CREATE INDEX IF NOT EXISTS idx_yingxiang_calibration_event
  ON yingxiang_calibration_groups(event_id, created_at);
