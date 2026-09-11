ALTER TABLE sync_records ADD COLUMN record_date TEXT;
ALTER TABLE sync_records ADD COLUMN organizer TEXT;
ALTER TABLE sync_records ADD COLUMN event_name TEXT;
ALTER TABLE sync_records ADD COLUMN record_status TEXT;

UPDATE sync_records
SET
  record_date = COALESCE(
    NULLIF(json_extract(payload_json, '$.session.metadata.date'), ''),
    substr(COALESCE(json_extract(payload_json, '$.session.createdAt'), updated_at), 1, 10)
  ),
  organizer = COALESCE(json_extract(payload_json, '$.session.metadata.organizer'), ''),
  event_name = COALESCE(
    NULLIF(json_extract(payload_json, '$.session.metadata.eventName'), ''),
    COALESCE(json_extract(payload_json, '$.session.title'), '')
  ),
  record_status = COALESCE(
    NULLIF(json_extract(payload_json, '$.session.status'), ''),
    'draft'
  )
WHERE payload_json IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sync_records_owner_index
  ON sync_records(owner_user_id, deleted_at, updated_at DESC);
