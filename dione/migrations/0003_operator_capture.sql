ALTER TABLE reports ADD COLUMN origin TEXT;
--> statement-breakpoint
ALTER TABLE reports ADD COLUMN capturedAt INTEGER;
--> statement-breakpoint
ALTER TABLE reports ADD COLUMN captureDigest TEXT;
--> statement-breakpoint
ALTER TABLE reports ADD COLUMN operatorActor TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX reports_capture_digest ON reports(captureDigest);
