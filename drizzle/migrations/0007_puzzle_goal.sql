-- 0007_puzzle_goal.sql
-- Adds puzzle goal columns to user_settings and an index for efficient
-- date-range queries on puzzle_attempt.

ALTER TABLE user_settings ADD COLUMN puzzle_goal_count INTEGER;
--> statement-breakpoint
ALTER TABLE user_settings ADD COLUMN puzzle_goal_frequency TEXT;
--> statement-breakpoint
CREATE INDEX idx_puzzle_attempt_user_date ON puzzle_attempt(user_id, attempted_at)
