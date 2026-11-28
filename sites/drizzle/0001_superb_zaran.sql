CREATE TABLE `raport_login_links` (
	`email` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raport_login_links_token_hash_unique` ON `raport_login_links` (`token_hash`);