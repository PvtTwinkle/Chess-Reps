-- Add indexes to avoid full-table scans on common query patterns.
-- Columns filtered by repertoire_id and from_fen appear in nearly every
-- runtime query. due is needed for FSRS card scheduling lookups.
-- session.user_id is hit on every authenticated request.

CREATE INDEX IF NOT EXISTS idx_user_move_repertoire_id ON user_move(repertoire_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_user_move_from_fen ON user_move(from_fen);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_user_repertoire_move_repertoire_id ON user_repertoire_move(repertoire_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_user_repertoire_move_from_fen ON user_repertoire_move(from_fen);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_user_repertoire_move_due ON user_repertoire_move(due);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_reviewed_game_repertoire_id ON reviewed_game(repertoire_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_book_move_from_fen ON book_move(from_fen);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_session_user_id ON session(user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_drill_session_repertoire_id ON drill_session(repertoire_id);
