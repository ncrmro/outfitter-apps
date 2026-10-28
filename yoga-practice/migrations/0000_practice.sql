CREATE TABLE `readings` (
	`id` text PRIMARY KEY NOT NULL,
	`metric` text NOT NULL,
	`measuredAt` integer NOT NULL,
	`value` real NOT NULL,
	`unit` text,
	CONSTRAINT "readings_metric_check" CHECK("readings"."metric" IN ('resting-heart-rate', 'heart-rate-variability'))
) STRICT;
--> statement-breakpoint
CREATE INDEX `readings_metric_idx` ON `readings` (`metric`,`measuredAt`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`sourceId` text NOT NULL,
	`practicedAt` integer NOT NULL,
	`durationMinutes` integer NOT NULL,
	`style` text DEFAULT 'other' NOT NULL,
	`intensity` text,
	`focus` text DEFAULT '[]' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`activity` text,
	`heartRateAverage` real,
	`heartRateMax` real,
	`energyKcal` real,
	`healthSource` text,
	`deletedAt` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	CONSTRAINT "sessions_source_check" CHECK("sessions"."source" IN ('manual', 'health-workout', 'health-mindful')),
	CONSTRAINT "sessions_style_check" CHECK("sessions"."style" IN ('vinyasa', 'hatha', 'yin', 'restorative', 'power', 'other')),
	CONSTRAINT "sessions_intensity_check" CHECK("sessions"."intensity" IS NULL OR "sessions"."intensity" IN ('gentle', 'moderate', 'strong'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_source_idx` ON `sessions` (`source`,`sourceId`);--> statement-breakpoint
CREATE INDEX `sessions_practiced_idx` ON `sessions` (`practicedAt`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`weeklySessions` integer NOT NULL,
	`weeklyMinutes` integer NOT NULL,
	`lastSyncedAt` integer,
	`updatedAt` integer NOT NULL
) STRICT;
