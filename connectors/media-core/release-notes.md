# Media connector operations

Add Radarr movie lookup/options/request/progress and SABnzbd/Transmission
download status for Dione's reviewed movie actions. Movie writes require member
initiation, exact TMDb identity, current verified profile/root selection and an
explicit flag before enabling monitoring on an existing movie. Concurrent
same-process requests are serialized; provider state is rechecked before search.
The caller must persist request IDs and unknown outcomes: there is no automatic
retry of a mutation whose receipt is unavailable.

Keep the shared 4 MiB provider response limit. Lookup resolves at most twenty
exact TMDb-filtered existing movies rather than fetching the whole library.
Option defaults use modal existing metadata only when that bounded read succeeds;
otherwise the verified profile/root choices remain available and defaults are
null, except a single verified accessible root folder. Existing-movie requests
validate selections without loading the full library.

Movie progress is bounded to twenty queue pages, one hundred matching jobs and
thirty correlated history events, with explicit truncation. Current queue IDs
take precedence; otherwise only events for the latest dated receipt are returned.
A historical completed downloader row does not establish current transfer or import.
Per-operation deadlines bound the new multi-request operations to thirty seconds
in addition to the existing per-request timeout.

SABnzbd results expose exact IDs and distinguish aggregate service speed from
unknown per-job speed. Recent diagnostic text becomes safe issue codes, with no
raw server names, credentials or warnings. Transmission uses canonical lowercase
hashes and exact read-only RPC fields. Fixture acceptance does not replace live
provider verification.
