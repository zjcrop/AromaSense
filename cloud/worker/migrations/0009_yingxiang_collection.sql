CREATE TABLE yingxiang_participant_access (
  participant_id TEXT PRIMARY KEY REFERENCES yingxiang_participants(participant_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  event_revision INTEGER NOT NULL CHECK (event_revision >= 1)
);

CREATE TABLE yingxiang_progress (
  participant_id TEXT PRIMARY KEY REFERENCES yingxiang_participants(participant_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  completed_samples INTEGER NOT NULL CHECK (completed_samples >= 0),
  total_samples INTEGER NOT NULL CHECK (total_samples > 0),
  updated_at TEXT NOT NULL,
  CHECK (completed_samples <= total_samples)
);

CREATE TABLE yingxiang_submissions (
  participant_id TEXT NOT NULL REFERENCES yingxiang_participants(participant_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  event_revision INTEGER NOT NULL CHECK (event_revision >= 1),
  session_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  bundle_json TEXT NOT NULL CHECK (json_valid(bundle_json)),
  received_at TEXT NOT NULL,
  PRIMARY KEY (participant_id, revision)
);

CREATE TRIGGER trg_yingxiang_submission_immutable
BEFORE UPDATE ON yingxiang_submissions
BEGIN
  SELECT RAISE(ABORT, 'YINGXIANG_SUBMISSION_IMMUTABLE');
END;

CREATE TRIGGER trg_yingxiang_submission_guard
BEFORE INSERT ON yingxiang_submissions
WHEN NOT EXISTS (
  SELECT 1 FROM yingxiang_participants p
  JOIN yingxiang_events e ON e.event_id = p.event_id
  JOIN yingxiang_participant_access a ON a.participant_id = p.participant_id
  WHERE p.participant_id = NEW.participant_id AND p.status = 'active'
    AND e.status IN ('published','active') AND a.event_revision = NEW.event_revision
)
BEGIN
  SELECT RAISE(ABORT, 'YINGXIANG_PARTICIPANT_RELEASED');
END;

CREATE TRIGGER trg_yingxiang_submission_session_guard
BEFORE INSERT ON yingxiang_submissions
WHEN EXISTS (
  SELECT 1 FROM yingxiang_submissions s WHERE s.participant_id = NEW.participant_id AND s.session_id <> NEW.session_id
) OR EXISTS (
  SELECT 1 FROM yingxiang_progress p WHERE p.participant_id = NEW.participant_id AND p.session_id <> NEW.session_id
)
BEGIN
  SELECT RAISE(ABORT, 'YINGXIANG_SESSION_CONFLICT');
END;

CREATE TRIGGER trg_yingxiang_event_edit_guard
BEFORE UPDATE OF policy_json, manifest_json ON yingxiang_events
WHEN (NEW.policy_json <> OLD.policy_json OR NEW.manifest_json <> OLD.manifest_json)
AND EXISTS (SELECT 1 FROM yingxiang_participants p WHERE p.event_id = OLD.event_id)
BEGIN
  SELECT RAISE(ABORT, 'YINGXIANG_EVENT_STRUCTURE_LOCKED');
END;

CREATE TRIGGER trg_yingxiang_calibration_overlap_guard
BEFORE INSERT ON yingxiang_calibration_groups
WHEN EXISTS (
  SELECT 1 FROM yingxiang_calibration_groups g, json_each(g.event_sample_ids_json) old_slot,
    json_each(NEW.event_sample_ids_json) new_slot
  WHERE g.event_id = NEW.event_id AND old_slot.value = new_slot.value
)
BEGIN
  SELECT RAISE(ABORT, 'YINGXIANG_CALIBRATION_SLOT_ASSIGNED');
END;

CREATE TRIGGER trg_yingxiang_progress_session_guard
BEFORE INSERT ON yingxiang_progress
WHEN EXISTS (
  SELECT 1 FROM yingxiang_submissions s WHERE s.participant_id = NEW.participant_id AND s.session_id <> NEW.session_id
)
BEGIN
  SELECT RAISE(ABORT, 'YINGXIANG_SESSION_CONFLICT');
END;
