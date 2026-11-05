# Review Strength 5x5 from a pull request

The read-only demo uses the synthetic workouts and bodyweight fixtures in
`fixtures/demo.json`. The shared preview workflow publishes the PR's exact source
commit to an isolated environment and posts its verified URL on the PR.

Changed apps publish automatically on same-repository PRs when both the author
and triggering actor are explicitly trusted (`ncrmro` in this repository).
Other sources require reviewed manual dispatch; forks are not imported
alongside private SDK access. The pinned SDK build uses a repository-read-only
key. The separate publisher receives the hosting credential and never executes
app build scripts. No saved workouts, Health grants, installed data or customer
APIs are available in this preview.
