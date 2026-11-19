CREATE TABLE reports (id text PRIMARY KEY NOT NULL, day text NOT NULL, status text NOT NULL, summary text NOT NULL DEFAULT '', generatedAt integer NOT NULL, completedAt integer, inferenceError text);
--> statement-breakpoint
CREATE TABLE items (id text PRIMARY KEY NOT NULL, reportId text NOT NULL REFERENCES reports(id), source text NOT NULL, sourceId text NOT NULL, title text NOT NULL, kind text NOT NULL, date text, detail text NOT NULL, url text, reason text NOT NULL DEFAULT '', rank integer NOT NULL DEFAULT 100);
--> statement-breakpoint
CREATE UNIQUE INDEX items_report_source ON items(reportId,source,sourceId,kind);
--> statement-breakpoint
CREATE INDEX items_report ON items(reportId);
--> statement-breakpoint
CREATE TABLE source_observations (id text PRIMARY KEY NOT NULL, reportId text NOT NULL REFERENCES reports(id), source text NOT NULL, observedAt integer NOT NULL, status text NOT NULL, error text, count integer NOT NULL, truncated integer NOT NULL);
--> statement-breakpoint
CREATE TABLE recommendations (id text PRIMARY KEY NOT NULL, source text NOT NULL, sourceId text NOT NULL, title text NOT NULL, operation text NOT NULL, input text NOT NULL, connectionId text NOT NULL, resource text NOT NULL, status text NOT NULL DEFAULT 'proposed', receipt text, confirmedBy text, createdAt integer NOT NULL, updatedAt integer NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX recommendations_target ON recommendations(source,sourceId,operation,connectionId,resource);
--> statement-breakpoint
CREATE TABLE settings (id text PRIMARY KEY NOT NULL, timezone text NOT NULL, hour integer NOT NULL, enabled integer NOT NULL, bindings text NOT NULL, updatedAt integer NOT NULL);
