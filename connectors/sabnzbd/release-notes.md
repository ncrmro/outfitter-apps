# sabnzbd

Initial capability-scoped media connector implementation. Live service acceptance remains required.

SABnzbd connection checks now authenticate with a bounded queue read; HTTP 200 API errors and malformed responses are refused without exposing provider details.
