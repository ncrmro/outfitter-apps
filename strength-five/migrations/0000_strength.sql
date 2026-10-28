CREATE TABLE `body_mass` (
	`id` text PRIMARY KEY NOT NULL,
	`measuredAt` integer NOT NULL,
	`kg` real NOT NULL,
	`source` text NOT NULL,
	`syncedAt` integer NOT NULL
) STRICT;
--> statement-breakpoint
CREATE INDEX `body_mass_measured_idx` ON `body_mass` (`measuredAt`);--> statement-breakpoint
CREATE TABLE `health_workouts` (
	`id` text PRIMARY KEY NOT NULL,
	`activity` text NOT NULL,
	`date` text NOT NULL,
	`startedAt` integer NOT NULL,
	`endedAt` integer NOT NULL,
	`durationMinutes` real NOT NULL,
	`energyKcal` real,
	`heartRateAverage` real,
	`heartRateMax` real,
	`source` text NOT NULL,
	`syncedAt` integer NOT NULL
) STRICT;
--> statement-breakpoint
CREATE INDEX `health_workouts_date_idx` ON `health_workouts` (`date`,`startedAt`);--> statement-breakpoint
CREATE TABLE `lift_weights` (
	`lift` text NOT NULL,
	`afterSessions` integer NOT NULL,
	`weightKg` real NOT NULL,
	`updatedBy` text NOT NULL,
	`updatedAt` integer NOT NULL,
	PRIMARY KEY(`lift`, `afterSessions`)
) STRICT;
--> statement-breakpoint
CREATE TABLE `session_lifts` (
	`sessionId` text NOT NULL,
	`lift` text NOT NULL,
	`position` integer NOT NULL,
	`weightKg` real NOT NULL,
	`reps` text NOT NULL,
	`succeeded` integer NOT NULL,
	PRIMARY KEY(`sessionId`, `lift`),
	FOREIGN KEY (`sessionId`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE INDEX `session_lifts_lift_idx` ON `session_lifts` (`lift`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`sequence` integer NOT NULL,
	`workout` text NOT NULL,
	`date` text NOT NULL,
	`performedAt` integer NOT NULL,
	`createdBy` text NOT NULL,
	`createdAt` integer NOT NULL,
	CONSTRAINT "sessions_workout_check" CHECK("sessions"."workout" IN ('A', 'B'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_sequence_idx` ON `sessions` (`sequence`);--> statement-breakpoint
CREATE INDEX `sessions_date_idx` ON `sessions` (`date`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`lastSyncedAt` integer
) STRICT;
