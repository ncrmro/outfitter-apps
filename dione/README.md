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
