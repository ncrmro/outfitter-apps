# sabnzbd

Initial capability-scoped media connector implementation. Live service acceptance remains required.

Add exact-ID queue/history download status with current service rate and sanitized recent
service issue codes. Per-job rate remains unknown rather than borrowing the aggregate
service speed. Current queue data wins over an older completed history row.

SABnzbd connection checks now authenticate with a bounded queue read; HTTP 200 API errors and malformed responses are refused without exposing provider details.
