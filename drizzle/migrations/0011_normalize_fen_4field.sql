-- Normalize all FEN columns from 6-field to 4-field format.
-- Strips the halfmove clock (field 5) and fullmove counter (field 6) which
-- are irrelevant for identifying a chess position in a repertoire trainer.
-- This fixes transposition mismatches where the same board position was
-- stored with different counter values depending on the move order.
--
-- PostgreSQL array slicing: (string_to_array(fen, ' '))[1:4] keeps fields 1-4.

-- 1. User tables (most important — personal data)

UPDATE user_move SET
  from_fen = array_to_string((string_to_array(from_fen, ' '))[1:4], ' '),
  to_fen = array_to_string((string_to_array(to_fen, ' '))[1:4], ' ')
WHERE array_length(string_to_array(from_fen, ' '), 1) > 4;
--> statement-breakpoint

UPDATE user_repertoire_move SET
  from_fen = array_to_string((string_to_array(from_fen, ' '))[1:4], ' ')
WHERE array_length(string_to_array(from_fen, ' '), 1) > 4;
--> statement-breakpoint

UPDATE reviewed_game SET
  deviation_fen = array_to_string((string_to_array(deviation_fen, ' '))[1:4], ' ')
WHERE deviation_fen IS NOT NULL
  AND array_length(string_to_array(deviation_fen, ' '), 1) > 4;
--> statement-breakpoint

UPDATE repertoire SET
  start_fen = array_to_string((string_to_array(start_fen, ' '))[1:4], ' ')
WHERE start_fen IS NOT NULL
  AND array_length(string_to_array(start_fen, ' '), 1) > 4;
--> statement-breakpoint

-- 2. Book moves — has UNIQUE(from_fen, san) constraint that may collide after normalization.
-- Strategy: recreate the table with deduplicated 4-field FENs to avoid constraint name issues.

CREATE TABLE book_move_new (
  id SERIAL PRIMARY KEY,
  from_fen TEXT NOT NULL,
  to_fen TEXT NOT NULL,
  san TEXT NOT NULL,
  annotation TEXT,
  contributor TEXT,
  UNIQUE (from_fen, san)
);
--> statement-breakpoint

INSERT INTO book_move_new (from_fen, to_fen, san, annotation, contributor)
  SELECT DISTINCT ON (array_to_string((string_to_array(from_fen, ' '))[1:4], ' '), san)
    array_to_string((string_to_array(from_fen, ' '))[1:4], ' '),
    array_to_string((string_to_array(to_fen, ' '))[1:4], ' '),
    san, annotation, contributor
  FROM book_move;
--> statement-breakpoint

DROP TABLE book_move;
--> statement-breakpoint

ALTER TABLE book_move_new RENAME TO book_move;
--> statement-breakpoint

CREATE INDEX idx_book_move_from_fen ON book_move(from_fen);
--> statement-breakpoint

-- 3. Book positions — FEN is the primary key. Recreate with 4-field PKs.

CREATE TABLE book_position_new (fen TEXT PRIMARY KEY);
--> statement-breakpoint

INSERT INTO book_position_new (fen)
  SELECT DISTINCT array_to_string((string_to_array(fen, ' '))[1:4], ' ')
  FROM book_position;
--> statement-breakpoint

DROP TABLE book_position;
--> statement-breakpoint

ALTER TABLE book_position_new RENAME TO book_position;
--> statement-breakpoint

-- 4. ECO openings — FEN is the primary key. Recreate with 4-field PKs.
-- DISTINCT ON keeps one row per normalized FEN (arbitrary but deterministic by code).

CREATE TABLE eco_opening_new (
  fen TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL
);
--> statement-breakpoint

INSERT INTO eco_opening_new (fen, code, name)
  SELECT DISTINCT ON (array_to_string((string_to_array(fen, ' '))[1:4], ' '))
    array_to_string((string_to_array(fen, ' '))[1:4], ' '),
    code, name
  FROM eco_opening;
--> statement-breakpoint

DROP TABLE eco_opening;
--> statement-breakpoint

ALTER TABLE eco_opening_new RENAME TO eco_opening;
--> statement-breakpoint

-- 5. Puzzles — simple UPDATE, no constraints to worry about.

UPDATE puzzle SET
  fen = array_to_string((string_to_array(fen, ' '))[1:4], ' ')
WHERE array_length(string_to_array(fen, ' '), 1) > 4