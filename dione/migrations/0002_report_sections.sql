ALTER TABLE `items` ADD `section` text;
--> statement-breakpoint
ALTER TABLE `reports` ADD `timezone` text;
--> statement-breakpoint
UPDATE `reports` SET `summary` = 'Archived source observations; open this report for release, library and attention details.', `inferenceError` = NULL;
