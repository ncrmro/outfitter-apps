# Dione

Dione is a personal Outfitter app in `ncrmro/outfitter-apps`. Its six custom
connectors live in this same repository under `connectors/`; it never embeds
service credentials or calls arbitrary browser-provided service URLs.

The owner selects approved connections in Settings, then refreshes a briefing
or enables the daily schedule (08:00 America/Chicago by default). Reports keep
release calendars, monitored missing media, recent library additions, queue
activity, and source observations. Platform inference ranks observed entries;
an unavailable model leaves source observations available with a partial label.
Missing or failed connections are visible rather than interpreted as empty data.
Concert and local-event discovery remain unconfigured and are not invented.

Only the personal installation owner can read or change this app. Graph reads
expose reports, items, source freshness, and recommendation state through the
standard `graph.graphql` action. Graph collections are `dioneReports`,
`dioneItems`, `dioneSources`, and `dioneRecommendations`; private bindings and
credentials are not graph fields. Read the committed `graph/schema.graphql`.

An owner must review and explicitly confirm each search request in Dione. Only
existing monitored, missing Radarr/Sonarr/Lidarr media can be requested; provider
settings decide what a search downloads. The connector rechecks eligibility.
Confirmation claims a recommendation once before contacting the provider. A
lost or failed answer becomes `unknown`, with no automatic retry; reconcile that
state in the source service before further action. Confirmations from apps or
OAuth clients are refused, even when acting for the owner.

## Runtime dependencies

This app requires local Outfitter installation dispatch, installation databases,
custom connector package loading, workflow/inference support, and the generic
`schedule.save.connectionBindings` extension. The platform approves each binding
when saved and rechecks it for scheduled reads; inputs do not grant authority.
The app deliberately cannot substitute network access for missing host support.
Actual migration and live acceptance are tracked in `ncrmro/ks-config`.

## Development

From the repository root after installing the pinned SDK and running `npm ci`:

```sh
npm run check --workspace dione
npm run test --workspace dione
npm run test:e2e --workspace dione
npm run build --workspace dione
```

The build prepares both operational and synthetic read-only demo artifacts.
Tests cover real SQLite migrations, report and graph consistency, request
claims, partial failures, workflow receipt retries, and built-worker access
boundaries. Browser tests exercise desktop/mobile rendering and client navigation.
These checks do not establish live Ocean connectivity or provider activation.

Regenerate synthetic fixture data with `node --import tsx dione/scripts/demo-fixtures.ts`
and the graph schema with `node --import tsx dione/scripts/graph-schema.ts`.

### Sidebar agent

“Ask Dione” uses Outfitter's shared private conversations and inference. The app
publishes two read tools: `dione_media_read` for its six approved service bindings,
and `dione_stack_read` for an optional approved `arr-mcp` connection. Configure the
latter in Settings → Agent connection for full-stack title/artist search and
media details. It works independently of the individual briefing bindings.

The MCP connector exposes only seven read operations (`get_library`,
`search_media`, `get_media_details`, `get_calendar`, `get_queue`, `get_wanted`,
`get_stack_health`). The app never receives provider credentials or an arbitrary
MCP URL. Every tool call rechecks the selected connection/resource and current
read grant before platform connector execution. Source failures and limited
results are explicit, and provider text is treated as untrusted data. Sidebar
read outputs are excluded from durable thread tool-result storage (`store:false`).

The sidebar cannot submit downloads or change service state. Existing download
recommendations remain behind the owner's explicit review. The demo uses the
shared scripted sidebar and makes no inference, platform-thread or provider calls.
Operational conversations require an installed package with `threads.use`,
`threads.provide`, workflow-host bindings and the app's `0001` migration.

### Populated synthetic demo

Run `npm run demo:seed --workspace dione` from the repository root to regenerate
`fixtures/demo.json`. `scripts/demo-catalog.ts` supplies fictional observations
for all six services; the seed runs the real settings, report and recommendation
services against an in-memory database and fake host. The small unit-test host
remains independent of the larger visual demo.

The fixture includes 26 observations, seven daily reports (one with an unavailable
source), nine recommendations across proposed/submitted/unknown states, an MCP
connection, all six service selections, and schedule health. Queue examples cover
active, queued, completed and seeding downloads. Historical report links resolve
to their own dated observations. IDs, dates and receipts are deterministic;
regenerating the fixture requires no live credentials, inference or provider calls.

### Private production-read baseline

Run `npm run baseline:prod --workspace dione -- default` with authorized Ocean
Kubernetes operator access. The command refuses a Kubernetes API other than
Ocean's configured address. It uses the existing private MCP Secret and deployed
connector bundles, without writing credentials to disk or command arguments.
The existing active personal MCP connection must be present.

This is explicit operator evaluation: it does not create owner sessions,
installation grants or production workflow records. Status, calendar/briefing,
missing, queue, small library samples and SABnzbd history are reads only. Each
briefing/missing/queue operation has the app's three-page cap of 100 per page;
this is a bounded snapshot, not a full inventory. MCP results retain degraded
source and freshness information. No download recommendation is confirmed.

The captured normalized pages feed the real report service using a disposable
in-memory database and workflow receipt harness. Ranking uses Ocean's configured
Spark provider with the app's instructions, data and validated result schema;
this is an operator provider call, not platform owner routing, billing or a
scheduled installation run. Model failures remain partial reports, not successful
ranking. The harness uses the rank step's 3000 token output budget and a 60 second
request timeout; it records model input/output and usage privately.

Artifacts are stored outside Git under
`~/.local/state/dione/baselines/<UTC timestamp>/` (directory 0700, files 0600):
`capture.json` contains timestamped reads/timings and connector/platform pins;
`report.json` contains app output, recommendation examples and inference evidence;
`summary.json` contains coverage, caps and failures; `report.md` is the readable
briefing. Treat these as personal library data. Never replace the fictional public
demo fixture with production captures. Keep partial/error runs for diagnosis and
use the committed-source baseline for comparison.
