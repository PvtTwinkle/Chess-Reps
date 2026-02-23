CREATE TABLE `book_move` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_fen` text NOT NULL,
	`to_fen` text NOT NULL,
	`san` text NOT NULL,
	`annotation` text,
	`contributor` text
);
--> statement-breakpoint
CREATE TABLE `book_position` (
	`fen` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `drill_session` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`repertoire_id` integer NOT NULL,
	`mode` text NOT NULL,
	`cards_reviewed` integer DEFAULT 0 NOT NULL,
	`cards_correct` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`repertoire_id`) REFERENCES `repertoire`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `eco_opening` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`fen` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `repertoire` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reviewed_game` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`repertoire_id` integer NOT NULL,
	`pgn` text NOT NULL,
	`source` text NOT NULL,
	`lichess_game_id` text,
	`deviation_fen` text,
	`played_at` integer,
	`reviewed_at` integer NOT NULL,
	`notes` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`repertoire_id`) REFERENCES `repertoire`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_unique` ON `user` (`username`);--> statement-breakpoint
CREATE TABLE `user_move` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`repertoire_id` integer NOT NULL,
	`from_fen` text NOT NULL,
	`to_fen` text NOT NULL,
	`san` text NOT NULL,
	`type` text NOT NULL,
	`source` text NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`repertoire_id`) REFERENCES `repertoire`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `user_repertoire_move` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`repertoire_id` integer NOT NULL,
	`from_fen` text NOT NULL,
	`san` text NOT NULL,
	`type` text NOT NULL,
	`due` integer,
	`stability` real,
	`difficulty` real,
	`elapsed_days` integer,
	`scheduled_days` integer,
	`reps` integer,
	`lapses` integer,
	`state` integer,
	`last_review` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`repertoire_id`) REFERENCES `repertoire`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`stockfish_depth` integer DEFAULT 15 NOT NULL,
	`default_drill_mode` text DEFAULT 'MAIN' NOT NULL,
	`board_theme` text DEFAULT 'blue' NOT NULL,
	`piece_set` text DEFAULT 'cburnett' NOT NULL,
	`sound_enabled` integer DEFAULT true NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
