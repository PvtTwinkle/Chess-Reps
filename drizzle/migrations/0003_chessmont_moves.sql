-- 0003_chessmont_moves.sql
-- Adds the chessmont_moves table for local master game statistics.
-- Replaces the masters_cache table (Lichess API proxy cache).
--
-- Data is populated by the chessmont-import script (separate Docker container),
-- NOT by this migration. The table starts empty and the app handles that
-- gracefully ("No master games from this position").
--
-- FENs are stored in 4-field normalized format (pieces, side-to-move, castling,
-- en-passant) to handle transpositions correctly.

CREATE TABLE chessmont_moves (
  position_fen  TEXT NOT NULL,
  move_san      TEXT NOT NULL,
  resulting_fen TEXT NOT NULL,
  games_played  INTEGER NOT NULL DEFAULT 0,
  white_wins    INTEGER NOT NULL DEFAULT 0,
  black_wins    INTEGER NOT NULL DEFAULT 0,
  draws         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (position_fen, move_san)
);
--> statement-breakpoint
DROP TABLE IF EXISTS masters_cache;
