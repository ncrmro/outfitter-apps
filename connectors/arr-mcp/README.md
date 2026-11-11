# Media stack MCP connector

This package adapts the existing [bardesss/arr-mcp](https://github.com/bardesss/arr-mcp)
server to Outfitter's approved connection/resource boundary. It does not implement
Radarr, Sonarr, Lidarr, Jellyfin, Transmission, or SABnzbd APIs again.

Configure a private Streamable HTTP MCP endpoint as `{ "url": "http://arr-mcp:6060/mcp" }`.
Bind its read-only MCP token to the operator-controlled `apiKey` credential slot.
The personal or organization connection's `externalId` identifies the approved
whole media stack. Provider API keys stay on the MCP server; the app never receives
either kind of credential. A shared full-stack MCP connection must be approved for
the whole stack, rather than represented as a grant to just one underlying service.

`read.call` accepts `{ tool, arguments }`. Tools are fixed to `get_library`,
`search_media`, `get_media_details`, `get_calendar`, `get_queue`, `get_wanted`, and
`get_stack_health`. Server discovery cannot introduce write tools. The return is
`{ tool, observedAt, data, untrusted: true }`; data is structured output when
available, otherwise text content. Arguments are bounded to 16 KiB/depth 10;
results to 30,000 characters. Provider errors, tokens, and known credential fields
are excluded. The platform rechecks owner, connection, operation and resource
access on every invocation. The MCP server should independently issue a read-only
token even though this adapter refuses writes with any token.

Operator provisioning may use `status.get` with `{}`. It authenticates a small
`get_stack_health` call and returns only `{ connected, observedAt }` for the MCP
connection; use `read.call` for the underlying providers' detailed health.

The adapter uses the existing AI SDK MCP client and arr-mcp's JSON HTTP mode,
with bounded requests, no redirects, and session cleanup. Upstream reviewed source:
`03fab3af5f49f53f177f93c281a2151efdb90827` (`1.83.1`). Deploy a reviewed immutable image;
transport compatibility tests do not establish live provider acceptance.
