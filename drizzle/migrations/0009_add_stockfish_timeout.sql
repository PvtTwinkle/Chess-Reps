-- Add user-configurable Stockfish analysis timeout (seconds).
-- Default 10s matches the previous hardcoded timeout. Range: 3–30s.
ALTER TABLE user_settings ADD COLUMN stockfish_timeout INTEGER NOT NULL DEFAULT 10;