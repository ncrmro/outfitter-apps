# Review Yoga practice from a pull request

This app's read-only demo uses the synthetic session and recovery fixtures in
`fixtures/demo.json`. The shared preview workflow publishes the PR's exact source
commit into an isolated environment and posts its verified URL on the PR.

The shared workflow automatically publishes changes from same-repository PRs
when both the author and triggering actor are explicitly trusted (`ncrmro` in
this repository). Other sources require reviewed manual dispatch; forks are not
imported automatically. The private SDK checkout uses a repository-read-only
key. The separate publisher receives the hosting credential and never executes
app build scripts. No sessions, Health grants, installed data or customer APIs
are available in the preview.
