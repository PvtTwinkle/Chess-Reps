-- 0000_create_tables.sql
-- Consolidated schema for PostgreSQL.
-- Creates all 12 tables with indexes and constraints.

-- ── Shared book tables (read-only seed data) ────────────────────────────────

CREATE TABLE book_position (
  fen TEXT PRIMARY KEY
);
--> statement-breakpoint

CREATE TABLE book_move (
  id          SERIAL PRIMARY KEY,
  from_fen    TEXT NOT NULL,
  to_fen      TEXT NOT NULL,
  san         TEXT NOT NULL,
  annotation  TEXT,
  contributor TEXT,
  UNIQUE(from_fen, san)
);
--> statement-breakpoint

CREATE INDEX idx_book_move_from_fen ON book_move(from_fen);
--> statement-breakpoint

CREATE TABLE eco_opening (
  fen  TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL
);
--> statement-breakpoint

-- ── Cache tables ────────────────────────────────────────────────────────────

CREATE TABLE masters_cache (
  fen           TEXT PRIMARY KEY,
  response_json TEXT NOT NULL,
  fetched_at    INTEGER NOT NULL
);
--> statement-breakpoint

-- ── User tables ─────────────────────────────────────────────────────────────

CREATE TABLE "user" (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMP NOT NULL
);
--> statement-breakpoint

CREATE TABLE session (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES "user"(id),
  expires_at TIMESTAMP NOT NULL
);
--> statement-breakpoint

CREATE INDEX idx_session_user_id ON session(user_id);
--> statement-breakpoint

CREATE TABLE user_settings (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES "user"(id),
  stockfish_depth   INTEGER NOT NULL DEFAULT 15,
  stockfish_timeout INTEGER NOT NULL DEFAULT 10,
  board_theme      TEXT NOT NULL DEFAULT 'blue',
  piece_set        TEXT NOT NULL DEFAULT 'cburnett',
  sound_enabled    BOOLEAN NOT NULL DEFAULT true,
  updated_at       TIMESTAMP NOT NULL
);
--> statement-breakpoint

CREATE TABLE repertoire (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES "user"(id),
  name       TEXT NOT NULL,
  color      TEXT NOT NULL,
  start_fen  TEXT,
  created_at TIMESTAMP NOT NULL
);
--> statement-breakpoint

CREATE TABLE user_move (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES "user"(id),
  repertoire_id INTEGER NOT NULL REFERENCES repertoire(id),
  from_fen      TEXT NOT NULL,
  to_fen        TEXT NOT NULL,
  san           TEXT NOT NULL,
  source        TEXT NOT NULL,
  notes         TEXT,
  created_at    TIMESTAMP NOT NULL
);
--> statement-breakpoint

CREATE INDEX idx_user_move_repertoire_id ON user_move(repertoire_id);
--> statement-breakpoint
CREATE INDEX idx_user_move_from_fen ON user_move(from_fen);
--> statement-breakpoint

CREATE TABLE user_repertoire_move (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES "user"(id),
  repertoire_id  INTEGER NOT NULL REFERENCES repertoire(id),
  from_fen       TEXT NOT NULL,
  san            TEXT NOT NULL,
  due            TIMESTAMP,
  stability      DOUBLE PRECISION,
  difficulty     DOUBLE PRECISION,
  elapsed_days   INTEGER,
  scheduled_days INTEGER,
  reps           INTEGER,
  lapses         INTEGER,
  state          INTEGER,
  last_review    TIMESTAMP,
  learning_steps INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint

CREATE INDEX idx_user_repertoire_move_repertoire_id ON user_repertoire_move(repertoire_id);
--> statement-breakpoint
CREATE INDEX idx_user_repertoire_move_from_fen ON user_repertoire_move(from_fen);
--> statement-breakpoint
CREATE INDEX idx_user_repertoire_move_due ON user_repertoire_move(due);
--> statement-breakpoint

CREATE TABLE reviewed_game (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES "user"(id),
  repertoire_id   INTEGER NOT NULL REFERENCES repertoire(id),
  pgn             TEXT NOT NULL,
  source          TEXT NOT NULL,
  lichess_game_id TEXT,
  deviation_fen   TEXT,
  played_at       TIMESTAMP,
  reviewed_at     TIMESTAMP NOT NULL,
  notes           TEXT
);
--> statement-breakpoint

CREATE INDEX idx_reviewed_game_repertoire_id ON reviewed_game(repertoire_id);
--> statement-breakpoint

CREATE TABLE drill_session (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES "user"(id),
  repertoire_id  INTEGER NOT NULL REFERENCES repertoire(id),
  cards_reviewed INTEGER NOT NULL DEFAULT 0,
  cards_correct  INTEGER NOT NULL DEFAULT 0,
  started_at     TIMESTAMP NOT NULL,
  completed_at   TIMESTAMP
);
--> statement-breakpoint

CREATE INDEX idx_drill_session_repertoire_id ON drill_session(repertoire_id);
