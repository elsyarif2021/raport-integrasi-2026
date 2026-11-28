CREATE TABLE `raport_google_admins` (
	`google_sub` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raport_google_admins_email_unique` ON `raport_google_admins` (`email`);--> statement-breakpoint
CREATE TABLE `raport_google_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `raport_google_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`google_sub` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`google_sub`) REFERENCES `raport_google_admins`(`google_sub`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `google_session_expiry` ON `raport_google_sessions` (`expires_at`);