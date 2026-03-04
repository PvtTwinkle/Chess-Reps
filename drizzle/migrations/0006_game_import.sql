-- 0006_game_import.sql
-- Add external platform usernames to user_settings and create the imported_game
-- table for the Lichess / Chess.com game import queue.

ALTER TABLE user_settings ADD COLUMN lichess_username TEXT;
--> statement-breakpoint

ALTER TABLE user_settings ADD COLUMN chesscom_username TEXT;
--> statement-breakpoint

ALTER TABLE user_settings ADD COLUMN last_lichess_import TIMESTAMP;
--> statement-breakpoint

ALTER TABLE user_settings ADD COLUMN last_chesscom_import TIMESTAMP;
--> statement-breakpoint

CREATE TABLE imported_game (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES "user"(id),
  pgn               TEXT NOT NULL,
  source            TEXT NOT NULL,
  external_game_id  TEXT NOT NULL,
  player_color      TEXT NOT NULL,
  opponent_name     TEXT,
  opponent_rating   INTEGER,
  player_rating     INTEGER,
  time_control      TEXT,
  result            TEXT,
  played_at         TIMESTAMP,
  imported_at       TIMESTAMP NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  reviewed_game_id  INTEGER REFERENCES reviewed_game(id),
  UNIQUE(user_id, source, external_game_id)
);
--> statement-breakpoint

CREATE INDEX idx_imported_game_user_status ON imported_game(user_id, status);
--> statement-breakpoint

CREATE INDEX idx_imported_game_user_played_at ON imported_game(user_id, played_at)
