# Personal Outfitter apps

Strength 5x5 and Yoga Practice, including their app-owned workflows and shared
Apple Health helpers. CI, release and deployment tooling lives in
[ai-outfitter/apps](https://github.com/ai-outfitter/apps).

This repository keeps app source, manifests, domain tests, fixtures, migrations
and release metadata. `.outfitter/apps.json` declares discovery, shared inputs
and validation mode. Thin workflows call shared tooling at a reviewed commit;
Dependabot proposes upgrades without rebuilding every consumer automatically.
No generic scripts or tooling tests are copied into this repository.

The Check workflow selects affected apps, follows local package dependencies,
and fans shared Health changes out to both apps. Its stable `CI gate` validates
metadata only while the SDK remains private. It does not certify app tests or
builds. Validation provenance artifacts record each selected app, source SHA,
tooling SHA and mode. Domain test commands remain in each app's package.json.

## Full app validation

The optional manual App toolchain workflow requires a reviewed full `source_sha`,
repository variable `OUTFITTER_TOOLCHAIN_SHA` (a full private webapp commit), and
a read-only `OUTFITTER_TOOLCHAIN_TOKEN` in a protected `toolchain` environment.
Configure required reviewers before granting access. It runs the centralized
legacy adapter in a disposable checkout, including app checks, unit/integration
tests, both package modes and browser tests. Do not trigger private credentials
on unreviewed PR code. This adapter's installation is not fully reproducible
from source pins alone. When the SDK becomes public, add locked dependencies
and set `validation: scripts` to execute app commands in ordinary PR CI.

## Independent releases

Set `OUTFITTER_RELEASES_ENABLED=true` to let the separate main-push release
workflow create release-please PRs. Keep `release-please-config.json`,
`.release-please-manifest.json`, app versions and changelogs here. Components have
independent versions and tags, for example `strength-five-v0.1.1`. Release PRs
update both package.json and app.json; owned workflows keep their own declared
versions. These are GitHub source releases, not npm SDK publication.

Pass `RELEASE_PLEASE_TOKEN` (GitHub App or PAT); otherwise the caller explicitly
passes `github.token`, which requires repository permission to create PRs and may
not trigger follow-up workflows. Nothing auto-merges. Root shared behavior
changes need app-local release-notes.md entries in each affected app's conventional
fix/feature commit so release-please sees those component paths.

## Automatic deployment to SaaS or self-hosted Outfitter

Set `OUTFITTER_DEPLOY_ENABLED=true` to request deployments after successful
main-push checks. The wrapper calls the central per-app deployment matrix with
GitHub OIDC; it does not store a platform deployment token. Deployment follows
checked main commits, independently of source releases.

| Repository setting | Value |
| --- | --- |
| `OUTFITTER_URL` | SaaS default `https://ai-outfitter.com`, or self-hosted HTTPS origin |
| `OUTFITTER_DEPLOY_RUNNER` | Default `ubuntu-latest`, or a runner label that can reach a private destination |
| Environment `outfitter` | Caller-owned deployment protection rules |

The destination must enroll this GitHub app repository and configure its GitHub
integration and operational build/runtime provider. Older installations may need
Update once to record repository claims. The platform verifies caller repository
ID, default-branch SHA and installer authority; OIDC audience is the destination
origin. Queue acceptance is not completed deployment—inspect installation history
for build/activation results. Self-hosted operational runtime work remains in
[webapp #589](https://github.com/ai-outfitter/webapp/pull/589); a custom URL alone
does not configure it. For two destinations, add a second thin caller with its own
environment and URL.

This replaces the broad deployment approach proposed in
[PR #2](https://github.com/ncrmro/outfitter-apps/pull/2). Do not enable both.
Release, deployment and private-toolchain credentials remain unconfigured until
explicitly enabled. No app behavior or platform code is changed by these wrappers.

## Pull-request preview environments

The **App PR previews** workflow calls the shared publisher and posts a verified,
read-only app URL on the PR. While SDK dependencies are private, run it manually
with the PR number after reviewing its current head; it builds only affected
apps through the pinned private toolchain. This is not automatic publishing of
unreviewed PR code. After SDK publication, the same publisher can use ordinary
pull-request builds with each app's `preview:build` script and a root lockfile.

Preview hosting is configured in separate `preview-build` and `preview-publish`
environments. The first holds a repository-read-only SDK SSH key; the second
holds the Cloudflare preview credential. Build code never receives the hosting
credential. Previews contain synthetic fixtures, no customer sessions, installed
data or platform APIs. Closed PRs automatically clean up their preview Workers.
These URLs are separate from SaaS/self-hosted installation deployment.
