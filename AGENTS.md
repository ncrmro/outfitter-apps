# Personal Outfitter apps

Keep app source, domain tests, fixtures, owned workflows, migrations and release
metadata here. Shared CI scripts and reusable workflows belong in
`ai-outfitter/apps`; do not copy them back here. `.outfitter/apps.json` describes
app paths, shared Health inputs and validation mode. Shared workflow references
are pinned commits and Dependabot proposes upgrades.

The SDK and app builder live in public `ai-outfitter/apps/packages/*`. CI checks
out that repo at the reviewed sdkSha in .outfitter/apps.json into `.outfitter-sdk`; npm workspaces and
the root lockfile resolve those public packages. Use scripts validation for app
checks, unit/integration tests and both builds. App-test prepares app-local
`.outfitter/packages/<mode>.json` outputs through the portable builder. Do not
reintroduce private webapp source, deploy keys or the legacy toolchain adapter.

Keep app versions independent and synchronize package/app versions through
release-please. Do not publish major versions or use breaking-change commits
without explicit authorization. Shared behavior changes require app-local
release-notes.md entries in each affected app's conventional fix/feature commit.

Successful main-branch app checks automatically request deployment through
GitHub OIDC. SaaS is the default; OUTFITTER_URL can select a self-hosted origin.
Releases run on main without enablement flags. Connect the source repository
and install apps once in Outfitter; later CI updates those installations. A queued
request does not establish activation. Keep the shared deployment call directly
in CI rather than adding a wrapper or a second deployment pipeline. Validate workflow YAML
with actionlint and use the pinned central Action for package checks.
