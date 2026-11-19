# radarr

Initial capability-scoped media connector implementation. Live service acceptance remains required.

Add bounded movie identity lookup, verified profile/root choices, explicit member-confirmed
add/monitor/search requests, and source-correlated progress. Existing movie profile/root
choices are preserved and rechecked; unmonitored movies require explicit confirmation.
Current queue identities take precedence over the latest dated download receipt. Unknown
POST outcomes are never retried automatically; the app owns durable request receipts.
