-- AromaSense infrastructure validation table.
-- This table is temporary infrastructure scaffolding and not part of the final cupping domain schema.

CREATE TABLE IF NOT EXISTS infrastructure_test (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK (length(value) BETWEEN 1 AND 200),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_infrastructure_test_created_at
  ON infrastructure_test(created_at DESC);
