Fix sidebar API routing under mounted personal app paths so context, shared
threads and owner confirmation remain inside the installation CSP scope.

Add sidebar movie lookup, private add/search and monitor/search proposals, and
live movie/download progress. Every proposal displays verified identity and
options and pins the approved connection; only the owner's browser approval
writes. Standard proposal receipts prevent duplicate approvals, and uncertain
provider effects require inspection. Progress joins exact attributed download
IDs, preserves source limitations, and excludes unrelated jobs and clients.

Initial Dione personal media briefing app, with approved connections, daily scheduling,
source freshness, owner-confirmed requests, and read-only graph collections.
Requires self-hosted runtime and approved multi-connection schedule support.

Add a trusted operator movie-request and progress command. New movies require
an exact TMDb ID, explicit folder/profile selection and write confirmation.
Existing movies and active searches are reused. Radarr download receipts join
SABnzbd queue/history and Transmission hashes to actual progress; missing jobs
and provider failures remain explicit. This does not widen sidebar permissions.

SABnzbd connection setup verifies credentials with an authenticated queue probe.

Dione now includes a conversational sidebar using Outfitter's shared private
threads. It offers owner-scoped live reads from approved media connections and an
optional full-stack Arr MCP connection for title/artist searches, details,
calendars, queues and service health. Credentials stay in platform connections;
source bindings and permissions are rechecked for every tool call. Replies carry
source freshness and explicitly report unavailable, unsupported and limited
results. The sidebar exposes no download or mutation tools; request submission
continues through the existing explicit Recommendations review.

The synthetic demo includes a scripted sidebar with no app, provider or inference
requests. The operational sidebar requires the platform's shared-thread host,
approved connector access and the app-owned proposal/guard migration. Selecting
only the full-stack MCP enables agent reads independently of daily-report source
bindings; daily briefings still use their selected individual service connectors.

Register the MCP adapter in shared validation and independent releases, and document required upstream missing/upgradable search arguments.

Allow the existing main-push deployment workflow to use an operator-selected runner for a private self-hosted destination; validation remains on hosted runners.

Expand the read-only demo to 26 fictional observations across all six media
services, seven daily reports including a partial-source day, nine recommendation
examples with proposed/submitted/unknown outcomes, configured connections and
schedule health. History selection loads the selected report's own observations.
The scripted agent includes queue progress and library examples. Fixtures are
regenerated through real application services against isolated fake providers;
no live data, credentials, inference or downloads are used.

Add an explicit private production-read baseline command. It captures deployed
service connectors and read-only MCP data, then evaluates the real report service
in an isolated in-memory workflow harness. Artifacts retain source coverage,
limits, timestamps, timings, code pins and failures outside Git. No provider
writes, owner-session substitution, production database changes or public demo
data replacement occur.

Remove report ranking and its inference workflow step. The briefing now groups
provider facts into Upcoming releases, Recent library additions and Needs
attention, with deterministic summaries and chronological/source ordering.
Completed and seeding downloads do not crowd the attention list. The sidebar
agent still queries approved sources through its existing private conversations.
New section provenance is persisted by migration 0002; legacy ranking columns
remain only for safe upgrades and are omitted from report APIs and the graph.
The production baseline collector/replay no longer contacts an inference provider.

Save report timezones for stable history; migration removes old AI summaries while retaining observations. Active downloads remain visible even when progress rounds to 100%. Date-only releases keep their provider calendar date.

Allow trusted platform setup to import a fresh, sanitized capture from the real
media services into a personal installation. Imports keep their capture time,
source revision, digest and operator attribution; they never simulate a workflow
run or submit requests. Setup is atomic and idempotent, cannot overwrite saved
owner settings, and rejects ordinary members, foreign owners, stale captures,
invalid digests, credentials and URLs. The dashboard identifies these records as
live-service snapshots; later owner refreshes use the normal live connections.
