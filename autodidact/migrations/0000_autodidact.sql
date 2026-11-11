CREATE TABLE `checks` (
	`id` text PRIMARY KEY NOT NULL,
	`conceptId` text NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`outcome` text NOT NULL,
	`insight` text DEFAULT '' NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`conceptId`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "checks_outcome_check" CHECK("checks"."outcome" IN ('gap', 'shaky', 'solid'))
);
--> statement-breakpoint
CREATE INDEX `checks_concept_idx` ON `checks` (`conceptId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `concepts` (
	`id` text PRIMARY KEY NOT NULL,
	`topicId` text NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`position` integer NOT NULL,
	`state` text DEFAULT 'unprobed' NOT NULL,
	`lastCheckedAt` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`topicId`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "concepts_state_check" CHECK("concepts"."state" IN ('unprobed', 'gap', 'shaky', 'solid'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `concepts_topic_title_idx` ON `concepts` (`topicId`,`title`);--> statement-breakpoint
CREATE INDEX `concepts_topic_idx` ON `concepts` (`topicId`,`position`);--> statement-breakpoint
CREATE TABLE `autodidact_agent_guard` (
	`value` integer NOT NULL,
	CONSTRAINT "autodidact_agent_atomic" CHECK("autodidact_agent_guard"."value"=1)
);
--> statement-breakpoint
CREATE TABLE `autodidact_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`installationId` text NOT NULL,
	`ownerId` text NOT NULL,
	`threadId` text NOT NULL,
	`turnId` text,
	`requestKey` text NOT NULL,
	`payloadDigest` text NOT NULL,
	`action` text NOT NULL,
	`projectId` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`data` text NOT NULL,
	`receipt` text,
	`decidedBy` text,
	`timelineEntryId` text,
	`createdAt` integer,
	`updatedAt` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `autodidact_proposals_request` ON `autodidact_proposals` (`installationId`,`requestKey`);--> statement-breakpoint
CREATE INDEX `autodidact_proposals_thread` ON `autodidact_proposals` (`installationId`,`threadId`);--> statement-breakpoint
CREATE INDEX `autodidact_proposals_owner` ON `autodidact_proposals` (`installationId`,`ownerId`,`status`);--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`aim` text DEFAULT '' NOT NULL,
	`goalId` text,
	`goalTitle` text,
	`status` text DEFAULT 'active' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	CONSTRAINT "topics_status_check" CHECK("topics"."status" IN ('active', 'paused', 'done'))
);
--> statement-breakpoint
CREATE INDEX `topics_updated_idx` ON `topics` (`updatedAt`);