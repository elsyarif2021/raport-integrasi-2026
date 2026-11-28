CREATE TABLE `raport_pin_bulk_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`result_cipher` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `raport_pin_accounts` ADD `pin_fingerprint` text;--> statement-breakpoint
CREATE UNIQUE INDEX `raport_pin_accounts_pin_fingerprint_unique` ON `raport_pin_accounts` (`pin_fingerprint`);