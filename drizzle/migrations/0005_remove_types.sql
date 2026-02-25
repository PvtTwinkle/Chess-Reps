-- Remove the MAIN/PUNISHMENT type distinction from moves and SR cards.
-- All moves are now just moves — no separate "punishment line" category.
-- Also remove the default_drill_mode setting and drill_session.mode
-- since the sub-mode selector is gone.

ALTER TABLE user_move DROP COLUMN type;
--> statement-breakpoint
ALTER TABLE user_repertoire_move DROP COLUMN type;
--> statement-breakpoint
ALTER TABLE user_settings DROP COLUMN default_drill_mode;
--> statement-breakpoint
ALTER TABLE drill_session DROP COLUMN mode;
