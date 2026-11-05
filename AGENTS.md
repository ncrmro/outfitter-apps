# Personal Outfitter apps

Keep app source, domain tests, fixtures, owned workflows, migrations and release
metadata here. Shared CI scripts and reusable workflows belong in
`ai-outfitter/apps`; do not copy them back here. `.outfitter/apps.json` describes
app paths, shared Health inputs and validation mode. Shared workflow references
are pinned commits and Dependabot proposes upgrades.

The SDK and app builder live in public `ai-outfitter/apps/packages/*`. CI checks
out that repo at the reviewed sdk-sha into `.outfitter-sdk`; npm workspaces and
the root lockfile resolve those public packages. Use scripts validation for app
checks, unit/integration tests and both builds. App-test prepares app-local
`.outfitter/packages/<mode>.json` outputs through the portable builder. Do not
reintroduce private webapp source, deploy keys or the legacy toolchain adapter.

Keep app versions independent and synchronize package/app versions through
release-please. Do not publish major versions or use breaking-change commits
without explicit authorization. Shared behavior changes require app-local
release-notes.md entries in each affected app's conventional fix/feature commit.

Deployment and releases are opt-in repository settings. The destination may be
SaaS or self-hosted; a queued request does not establish activation. Avoid enabling
the older broad deployment PR alongside this pipeline. Validate workflow YAML
with actionlint and use the pinned central Action for package checks.
