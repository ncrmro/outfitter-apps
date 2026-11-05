# Review Yoga practice from a pull request

This app's read-only demo uses the synthetic session and recovery fixtures in
`fixtures/demo.json`. The shared preview workflow publishes the PR's exact source
commit into an isolated environment and posts its verified URL on the PR.

While the SDK is private, a maintainer runs **App PR previews** with this PR's
number after reviewing its head commit. The SDK checkout uses a repository-read-only
key; the separate publisher receives the hosting credential and never executes
app build scripts. No sessions, Health grants, installed data or customer APIs
are available in the preview. Once SDK dependencies are public, this repository
can use ordinary pull-request builds with the same publisher.
