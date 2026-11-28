CREATE TABLE `raport_invitations` (
	`email` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	CONSTRAINT "invitation_role" CHECK(role IN ('admin', 'guru', 'wali_kelas'))
);
--> statement-breakpoint
CREATE TABLE `raport_members` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	CONSTRAINT "member_role" CHECK(role IN ('admin', 'guru', 'wali_kelas'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raport_members_email_unique` ON `raport_members` (`email`);--> statement-breakpoint
CREATE TABLE `raport_students` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`record` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "student_json" CHECK(json_valid(record))
);
--> statement-breakpoint
CREATE INDEX `student_class` ON `raport_students` (`class_id`);--> statement-breakpoint
CREATE TABLE `raport_write_guards` (
	`id` text PRIMARY KEY NOT NULL,
	`valid` integer NOT NULL,
	CONSTRAINT "raport_write_conflict" CHECK(valid = 1)
);
