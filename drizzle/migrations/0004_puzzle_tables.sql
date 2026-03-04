-- 0004_puzzle_tables.sql
-- Adds puzzle and puzzle_attempt tables for the puzzle training feature.
--
-- The puzzle table holds Lichess puzzles imported by the puzzle-import script.
-- It is shared/read-only data (like chessmont_moves) — the app never writes to it.
-- The puzzle_attempt table tracks user puzzle-solving history.

CREATE TABLE puzzle (
  puzzle_id         TEXT PRIMARY KEY,
  fen               TEXT NOT NULL,
  moves             TEXT NOT NULL,
  rating            INTEGER NOT NULL,
  rating_deviation  INTEGER NOT NULL,
  popularity        INTEGER NOT NULL,
  nb_plays          INTEGER NOT NULL,
  themes            TEXT,
  game_url          TEXT,
  opening_tags      TEXT NOT NULL,
  opening_family    TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_puzzle_opening_family ON puzzle(opening_family);
--> statement-breakpoint
CREATE INDEX idx_puzzle_rating ON puzzle(rating);
--> statement-breakpoint
CREATE TABLE puzzle_attempt (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES "user"(id),
  puzzle_id     TEXT NOT NULL REFERENCES puzzle(puzzle_id),
  solved        BOOLEAN NOT NULL,
  time_ms       INTEGER,
  attempted_at  TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_puzzle_attempt_user_puzzle ON puzzle_attempt(user_id, puzzle_id)
