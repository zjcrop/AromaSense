ALTER TABLE users ADD COLUMN display_name TEXT;

CREATE INDEX IF NOT EXISTS idx_users_display_name
  ON users(display_name)
  WHERE display_name IS NOT NULL;
