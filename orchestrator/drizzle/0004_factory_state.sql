CREATE TABLE `factory_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`changed_at` text NOT NULL,
	`last_polled_at` text
);
--> statement-breakpoint
ALTER TABLE `runs` ADD `current_step` text;