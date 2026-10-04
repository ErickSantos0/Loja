CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_records_kind` ON `records` (`kind`);--> statement-breakpoint
CREATE TABLE `revision` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` integer NOT NULL,
	CONSTRAINT "revision_nonnegative" CHECK("revision"."value" >= 0)
);
