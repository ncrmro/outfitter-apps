# Ocean media connectors

These packages belong to `ncrmro/outfitter-apps`. They implement Outfitter's
`connector.runtime.v1` using the public `@ai-outfitter/connector-core` contracts.
A generic operator loader loads each built `dist/runtime.mjs` singleton export; no provider code
needs to be copied into the platform repository.

| Package | Runtime export | Operations |
| --- | --- | --- |
| `@ncrmro/connector-radarr` | `radarrConnector` | `briefing.read`, `status.get`, `calendar.list`, `library.list`, `queue.list`, `missing.list`, `request.search` |
| `@ncrmro/connector-sonarr` | `sonarrConnector` | Same |
| `@ncrmro/connector-lidarr` | `lidarrConnector` | Same |
| `@ncrmro/connector-jellyfin` | `jellyfinConnector` | `briefing.read`, `status.get`, `library.list` |
| `@ncrmro/connector-transmission` | `transmissionConnector` | `briefing.read`, `status.get`, `queue.list` |
| `@ncrmro/connector-sabnzbd` | `sabnzbdConnector` | `briefing.read`, `status.get`, `queue.list`, `history.list` |

Source workspaces expose `./runtime` and each also exports `create<Name>Connector({ fetch })` for isolated tests and a
`./manifest` descriptor. `media-core` owns shared transport and normalization.

## Provisioning and authorization

Provision an approved connection with a secret-free config `{baseUrl, publicUrl?}`.
`baseUrl` is the internal service's HTTP origin/base path. The optional public URL
is used only for member-facing links. Do not take service URLs from app requests.
The resource is the connection's `externalId`. The connector supports organization
connections and user-owned account connections; personal connections must act as
their owner. Revocation, operation grants, resource, and ownership are checked by
`executeConnector` on every call.

The operator lends `credentials.apiKey` per operation for Radarr, Sonarr, Lidarr,
Jellyfin and SABnzbd; Transmission uses `username` and `password` when RPC auth is
enabled. Credentials are not stored in package manifests or returned to the app.
SABnzbd's protocol puts its key in query parameters: exclude URLs from transport
logs. Use credential bindings specific to the provider/operation and do not give
these secrets to agent tasks.

Read capability names are `connector.<provider>.briefing.read` and analogous
operation suffixes. The only writes are Arr `request.search` commands for existing,
monitored, missing IDs. They require `initiation: "member"` at the broker. Schedules,
agents, and workflow phases cannot issue them. Dione owns confirmation, deduplication,
and storage of the returned `{id,mediaId,status}` command receipt. A command receipt
is not proof that a download completed.

## Normalized reading contract

`briefing.read` takes `{start,end,limit?,cursor?}` with ISO timestamps, an increasing
window of at most 31 days, and at most 100 items per page. It returns
`{items,cursor,truncated}`. Items contain provider `id`, title, media kind, date or
null, factual detail, public URL or null, and an optional `request.search` proposal.
Arr briefings read release calendars; Jellyfin contributes recent library context;
download clients contribute current queue context. Missing, library and queue operations
are available separately. Consumers should label each item with the provider and
connection that supplied it. Provider strings are untrusted display data.

The adapters bound requests to 15 seconds and JSON responses to 4 MiB, reject
redirects, and return sanitized failures. Successful fixture tests do not establish
live acceptance, actual service routing, or credential provisioning.

Upstream API references: [Radarr](https://radarr.video/docs/api/), [Sonarr](https://sonarr.tv/docs/api/), [Lidarr](https://lidarr.audio/docs/api/).

## Runtime artifacts

Run `npm run build --workspace @ncrmro/connector-radarr` (and each provider) to
produce self-contained Node 24 ESM at `connectors/radarr/dist/runtime.mjs`.
The artifacts bundle their dependencies and do not require TypeScript loading,
`tsx`, workspace symlinks, or runtime npm installation. Mount/copy these read-only
into the Outfitter operator's runtime image or volume. An operator loader entry
uses an absolute artifact path and the named singleton export, for example
`{"path":"/opt/outfitter/connectors/radarr/runtime.mjs","export":"radarrConnector"}`.
Only trusted operator configuration may select module paths. A source package
manifest is not permission to load code into the platform.

Supply `CONNECTOR_MODULES` through the generic operator loading mechanism and
lend credential slots through the existing per-operation credential bindings.
Do not bake credentials into these artifacts, container build arguments, image
layers, package metadata, or checked-in connection configuration. Provision
connection ownership and capability grants before enabling Dione's schedule.
