-- Add learning_steps to user_repertoire_move.
--
-- ts-fsrs v5 introduced a learning_steps field that tracks which step within
-- the (re)learning phase a card is on. Without it the algorithm cannot properly
-- schedule cards that are in the Learning or Relearning states between sessions.
-- All existing cards start at 0 (the default for New/unreviewed cards).

ALTER TABLE user_repertoire_move ADD COLUMN learning_steps INTEGER NOT NULL DEFAULT 0;
