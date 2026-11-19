CREATE TABLE `cursors` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`ticket_identifier` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`snapshot` text,
	`sandbox_id` text,
	`branch` text,
	`catch_up_seconds` integer,
	`claude_exit_code` integer,
	`pr_urls` text,
	`error` text,
	`created_at` text NOT NULL,
	`finished_at` text
);
