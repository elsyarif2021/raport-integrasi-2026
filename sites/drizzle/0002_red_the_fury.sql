CREATE TABLE `raport_admin_guards` (
	`id` text PRIMARY KEY NOT NULL,
	`valid` integer NOT NULL,
	CONSTRAINT "raport_admin_limit" CHECK(valid = 1)
);
--> statement-breakpoint
CREATE TABLE `raport_pin_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`login_name` text NOT NULL,
	`slug` text NOT NULL,
	`role` text NOT NULL,
	`pin_hash` text NOT NULL,
	`pin_salt` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "pin_account_role" CHECK(role IN ('admin', 'guru', 'wali_kelas'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raport_pin_accounts_login_name_unique` ON `raport_pin_accounts` (`login_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `raport_pin_accounts_slug_unique` ON `raport_pin_accounts` (`slug`);--> statement-breakpoint
CREATE TABLE `raport_pin_attempts` (
	`bucket` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`reset_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `raport_pin_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `raport_pin_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pin_session_account` ON `raport_pin_sessions` (`account_id`);