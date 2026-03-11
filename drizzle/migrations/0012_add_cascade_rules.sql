-- Add ON DELETE CASCADE / SET NULL to all foreign keys.
-- PostgreSQL names anonymous inline REFERENCES constraints as {table}_{column}_fkey.
-- Each constraint is dropped and re-added with the appropriate cascade rule.

-- session.user_id → user(id) ON DELETE CASCADE
ALTER TABLE session DROP CONSTRAINT session_user_id_fkey;
--> statement-breakpoint
ALTER TABLE session ADD CONSTRAINT session_user_id_fkey FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;
--> statement-breakpoint

-- user_settings.user_id → user(id) ON DELETE CASCADE
ALTER TABLE user_settings DROP CONSTRAINT user_settings_user_id_fkey;
--> statement-breakpoint
ALTER TABLE user_settings ADD CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;
--> statement-breakpoint

-- repertoire.user_id → user(id) ON DELETE CASCADE
ALTER TABLE repertoire DROP CONSTRAINT repertoire_user_id_fkey;
--> statement-breakpoint
ALTER TABLE repertoire ADD CONSTRAINT repertoire_user_id_fkey FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;
--> statement-breakpoint

-- user_move.user_id → user(id) ON DELETE CASCADE
ALTER TABLE user_move DROP CONSTRAINT user_move_user_id_fkey;
--> statement-breakpoint
ALTER TABLE user_move ADD CONSTRAINT user_move_user_id_fkey FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;
--> statement-breakpoint

-- user_move.repertoire_id → repertoire(id) ON DELETE CASCADE
ALTER TABLE user_move DROP CONSTRAINT user_move_repertoire_id_fkey;
--> statement-breakpoint
ALTER TABLE user_move ADD CONSTRAINT user_move_repertoire_id_fkey FOREIGN KEY (repertoire_id) REFERENCES repertoire(id) ON DELETE CASCADE;
--> statement-breakpoint

-- user_repertoire_move.user_id → user(id) ON DELETE CASCADE
ALTER TABLE user_repertoire_move DROP CONSTRAINT user_repertoire_move_user_id_fkey;
--> statement-breakpoint
ALTER TABLE user_repertoire_move ADD CONSTRAINT user_repertoire_move_user_id_fkey FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;
--> statement-breakpoint

-- user_repertoire_move.repertoire_id → repertoire(id) ON DELETE CASCADE
ALTER TABLE user_repertoire_move DROP CONSTRAINT user_repertoire_move_repertoire_id_fkey;
--> statement-breakpoint
ALTER TABLE user_repertoire_move ADD CONSTRAINT user_repertoire_move_repertoire_id_fkey FOREIGN KEY (repertoire_id) REFERENCES repertoire(id) ON DELETE CASCADE;
--> statement-breakpoint

-- reviewed_game.user_id → user(id) ON DELETE CASCADE
ALTER TABLE reviewed_game DROP CONSTRAINT reviewed_game_user_id_fkey;
--> statement-breakpoint
ALTER TABLE reviewed_game ADD CONSTRAINT reviewed_game_user_id_fkey FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;
--> statement-breakpoint

-- reviewed_game.repertoire_id → repertoire(id) ON DELETE CASCADE
ALTER TABLE reviewed_game DROP CONSTRAINT reviewed_game_repertoire_id_fkey;
--> statement-breakpoint
ALTER TABLE reviewed_game ADD CONSTRAINT reviewed_game_repertoire_id_fkey FOREIGN KEY (repertoire_id) REFERENCES repertoire(id) ON DELETE CASCADE;
--> statement-breakpoint

-- drill_session.user_id → user(id) ON DELETE CASCADE
ALTER TABLE drill_session DROP CONSTRAINT drill_session_user_id_fkey;
--> statement-breakpoint
ALTER TABLE drill_session ADD CONSTRAINT drill_session_user_id_fkey FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;
--> statement-breakpoint

-- drill_session.repertoire_id → repertoire(id) ON DELETE CASCADE
ALTER TABLE drill_session DROP CONSTRAINT drill_session_repertoire_id_fkey;
--> statement-breakpoint
ALTER TABLE drill_session ADD CONSTRAINT drill_session_repertoire_id_fkey FOREIGN KEY (repertoire_id) REFERENCES repertoire(id) ON DELETE CASCADE;
--> statement-breakpoint

-- imported_game.user_id → user(id) ON DELETE CASCADE
ALTER TABLE imported_game DROP CONSTRAINT imported_game_user_id_fkey;
--> statement-breakpoint
ALTER TABLE imported_game ADD CONSTRAINT imported_game_user_id_fkey FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;
--> statement-breakpoint

-- imported_game.reviewed_game_id → reviewed_game(id) ON DELETE SET NULL
-- When a reviewed game is deleted (e.g. repertoire deletion), the imported
-- game record is preserved but its link to the review is cleared.
ALTER TABLE imported_game DROP CONSTRAINT imported_game_reviewed_game_id_fkey;
--> statement-breakpoint
ALTER TABLE imported_game ADD CONSTRAINT imported_game_reviewed_game_id_fkey FOREIGN KEY (reviewed_game_id) REFERENCES reviewed_game(id) ON DELETE SET NULL;
--> statement-breakpoint

-- puzzle_attempt.user_id → user(id) ON DELETE CASCADE
ALTER TABLE puzzle_attempt DROP CONSTRAINT puzzle_attempt_user_id_fkey;
--> statement-breakpoint
ALTER TABLE puzzle_attempt ADD CONSTRAINT puzzle_attempt_user_id_fkey FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;
--> statement-breakpoint

-- puzzle_attempt.puzzle_id → puzzle(puzzle_id) ON DELETE CASCADE
ALTER TABLE puzzle_attempt DROP CONSTRAINT puzzle_attempt_puzzle_id_fkey;
--> statement-breakpoint
ALTER TABLE puzzle_attempt ADD CONSTRAINT puzzle_attempt_puzzle_id_fkey FOREIGN KEY (puzzle_id) REFERENCES puzzle(puzzle_id) ON DELETE CASCADE;