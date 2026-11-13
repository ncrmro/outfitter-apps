# Dione

Dione is a personal Outfitter app in `ncrmro/outfitter-apps`. Its six custom
connectors live in this same repository under `connectors/`; it never embeds
service credentials or calls arbitrary browser-provided service URLs.

The owner selects approved connections in Settings, then refreshes a briefing
or enables the daily schedule (08:00 America/Chicago by default). Reports keep
release calendars, monitored missing media, recent library additions, queue
activity, and source observations. Reports show three factual sections: upcoming
releases (today through the next seven days), recent library additions (the last
seven days), and things needing attention. Items are ordered chronologically or
by source and title, without model ranking or generated explanations. Missing
media, active/troubled downloads and source failures remain visible; completed
and seeding downloads are omitted from attention unless they report a problem.
Missing or failed connections are visible rather than interpreted as empty data.
Concert and local-event discovery remain unconfigured and are not invented.

Only the personal installation owner can read or change this app. Graph reads
expose reports, items, source freshness, and recommendation state through the
standard `graph.graphql` action. Graph collections are `dioneReports`,
`dioneItems`, `dioneSources`, and `dioneRecommendations`; private bindings and
credentials are not graph fields. Read the committed `graph/schema.graphql`.

An owner must review and explicitly confirm each search request in Dione. The existing Recommendations page searches monitored, missing Radarr/Sonarr/Lidarr media; provider settings decide what a search downloads. The connector rechecks eligibility. The sidebar also supports explicitly reviewed Radarr movie additions and monitoring as described below.
Confirmation claims a recommendation once before contacting the provider. A
lost or failed answer becomes `unknown`, with no automatic retry; reconcile that
state in the source service before further action. Confirmations from apps or
OAuth clients are refused, even when acting for the owner.

## Runtime dependencies

This app requires local Outfitter installation dispatch, installation databases,
custom connector package loading, workflow support, and the generic
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
publishes source read tools: `dione_media_read` for its six approved service bindings,
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

`dione_movie_lookup` resolves exact movie identities and approved Radarr quality
profiles/root folders; `dione_movie_progress` reads current movie/search/import
state and downloader progress. The assistant must ask for disambiguation when a
title has multiple matches, and for a profile/root choice when verified defaults
are absent. Non-null defaults reflect verified existing-library usage rather than a configured Radarr default and remain subject to owner review. `dione_movie_request` prepares a **private proposal** displaying the
exact title, year, TMDb ID, profile and root. Existing unmonitored movies show
**Monitor and search**, including the explicit monitoring change. Existing movies retain their verified actual profile/root; this action cannot move them or change their quality profile. No provider
write occurs until the owner clicks **Approve changes** in that proposal.
The model-facing tool only prepares the review; apps and OAuth actors cannot
confirm it. Every preparation and approval rechecks saved bindings and current
grants, and a changed movie, connection or option requires a new review.

Provider receipts are stored by the standard proposal store; repeated approval
returns the saved receipt. Lost responses remain **unconfirmed** and require
progress inspection, with no automatic retry. A search receipt does not establish
a transfer. Progress joins Radarr download IDs and attributed client names to
SABnzbd or Transmission IDs, never filenames. It preserves unavailable/limited
sources and distinguishes search/queue evidence from imported files; speed and
ETA are shown only when the client actually reports them. Unrelated clients and
jobs are excluded. Movie lookup/progress also publish read-only app actions;
the write action is available only through the private sidebar proposal flow.
Existing Recommendations reviews continue unchanged. The demo uses the
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

### Operator movie requests and downloader progress

`scripts/movie-download.mjs` runs inside the trusted Ocean webapp Pod using its
existing service credentials. It is independent of the sidebar's owner-reviewed proposal flow.
Adding a new title requires an exact TMDb ID, a verified existing quality profile
and movie root, and explicit confirmation. For example, Silent Running (1972) is
TMDb 811:

```sh
kubectl --context default -n outfitter-cloud exec -i deployment/outfitter-webapp \
  -c webapp -- node --input-type=module -e \
  'import{writeFile}from"node:fs/promises";let s="";for await(const b of process.stdin)s+=b;await writeFile("/tmp/dione-movie-download.mjs",s,{mode:0o600})' \
  < dione/scripts/movie-download.mjs

# Mutates provider state only with explicit confirmation. Choose the intended
# profile/root; these values are the existing Ocean configuration.
kubectl --context default -n outfitter-cloud exec deployment/outfitter-webapp \
  -c webapp -- node /tmp/dione-movie-download.mjs --tmdb-id 811 \
  --add --search --confirm --quality-profile-id 1 --root-folder /ocean/media/movies

# Subsequent checks are read-only; run again to observe changes in progress.
kubectl --context default -n outfitter-cloud exec deployment/outfitter-webapp \
  -c webapp -- node /tmp/dione-movie-download.mjs --tmdb-id 811
```

The command checks the existing TMDb ID before adding, reuses active searches and
queued jobs, and never automatically retries an uncertain provider write. It joins
Radarr receipts to SABnzbd job IDs and Transmission hashes rather than guessing
from filenames. Output separates search status, provider acceptance, percent,
remaining bytes/MB, queue speed/state, ETA, import status, recent service-level
authentication/storage warnings and failed status reads. A queued job at 0% with
an idle downloader is not evidence that bytes are transferring. Read results may
be incomplete beyond 2,000 Radarr queue entries or 1,000 SABnzbd history entries.
Remove the temporary script after use. Keep live command receipts outside Git.

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
in-memory database and workflow receipt harness. Reports group all observed items
into the same upcoming, library and attention sections as the app. Report
generation makes no inference requests; the conversational sidebar retains its
normal shared-thread inference separately. This command does not prove owner
routing, a scheduled installation run, or graph publication.

Artifacts are stored outside Git under
`~/.local/state/dione/baselines/<UTC timestamp>/` (directory 0700, files 0600):
`capture.json` contains timestamped reads/timings and connector/platform pins;
`report.json` contains app output, grouped observations and recommendation examples;
`summary.json` contains coverage, caps and failures; `report.md` is the readable
briefing. Treat these as personal library data. Never replace the fictional public
demo fixture with production captures. Keep partial/error runs for diagnosis and
use the committed-source baseline for comparison.

The `0002_report_sections` migration adds factual section provenance. Old database
ranking columns are retained only for safe upgrades and omitted from report APIs
and graph documents. Older in-flight workflow snapshots can finish their final
legacy checkpoint without inference. New workflows collect observations and
publish a briefing directly.

Each new report saves its timezone and generation time, so changing schedule
settings does not move historical releases between days. Legacy reports without
saved timezone metadata use their saved report day and UTC calendar dates, not
current settings; their old AI summaries are replaced with a factual archive
label during migration. Completion timestamps record actual completion rather
than the original scheduled time.

To compare a private production capture without contacting services, run:

```sh
npm run baseline:prod --workspace dione -- --capture /private/path/capture.json
```

Replay uses the original capture window and the current factual section logic;
it makes no Kubernetes, media-provider or model calls.

### Real-data initialization on Ocean

The reserved operational initializer accepts only a trusted platform setup actor
for this personal installation. `prepareOperatorCapture` prepares a fresh private
capture with the owner's real approved connection UUIDs, strips external URLs and
request operations, and binds the sanitized payload to a digest. Setup imports
source observations atomically and records `operator-capture`, observed time,
digest and operator attribution. It creates no workflow or human session, makes
no provider calls and never overwrites existing owner settings. Ordinary members
cannot invoke this setup route. All captures and initialization payloads stay
outside Git and the public synthetic demo.

The owner then opens the installed operational app using their existing Ocean
login. Sidebar queries and Refresh briefing use the normal approved connections;
initial imported reports explicitly show their source capture time.
