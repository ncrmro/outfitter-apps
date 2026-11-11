Initial Dione personal media briefing app, with approved connections, daily scheduling,
source freshness, owner-confirmed requests, and read-only graph collections.
Requires self-hosted runtime and approved multi-connection schedule support.

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
