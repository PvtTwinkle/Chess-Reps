ALTER TABLE user_settings ADD COLUMN tempo_enabled BOOLEAN NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE user_settings ADD COLUMN tempo_seconds INTEGER NOT NULL DEFAULT 10