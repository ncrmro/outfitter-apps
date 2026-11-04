# Personal Outfitter apps

Keep app source, domain tests, fixtures, owned workflows, migrations and release
metadata here. Shared CI scripts and reusable workflows belong in
`ai-outfitter/apps`; do not copy them back here. `.outfitter/apps.json` describes
app paths, shared Health inputs and validation mode. Shared workflow references
are pinned commits and Dependabot proposes upgrades.

The current SDK is private: metadata validation does not run app tests or builds.
Use the optional manual App toolchain workflow with a reviewed source SHA and
private credentials in the protected `toolchain` environment for full validation.
Never expose those credentials to public PR checks. Change validation to scripts
only after published SDK dependencies and a root npm lockfile are available.

Keep app versions independent and synchronize package/app versions through
release-please. Do not publish major versions or use breaking-change commits
without explicit authorization. Shared behavior changes require app-local
release-notes.md entries in each affected app's conventional fix/feature commit.

Deployment and releases are opt-in repository settings. The destination may be
SaaS or self-hosted; a queued request does not establish activation. Avoid enabling
the older broad deployment PR alongside this pipeline. Validate workflow YAML
with actionlint and use the pinned central Action for package checks.
