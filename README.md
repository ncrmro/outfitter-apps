# Personal Outfitter apps

Strength 5x5 and Yoga Practice, including their app-owned workflows and shared
Apple Health helpers. CI, release and deployment tooling lives in
[ai-outfitter/apps](https://github.com/ai-outfitter/apps).

This repository keeps app source, manifests, domain tests, fixtures, migrations
and release metadata. `.outfitter/apps.json` declares discovery, shared inputs
and validation mode. Thin workflows call shared tooling at a reviewed commit;
Dependabot proposes upgrades without rebuilding every consumer automatically.
No generic scripts or tooling tests are copied into this repository.

The Check workflow selects affected apps, follows local workflow dependencies,
and fans shared Health changes out to both apps. Every selected app runs its
checks, unit/integration tests, and both build modes with `npm ci` and the public
SDK. The stable `CI gate` records those results.

## Local development

Check out public `ai-outfitter/apps` at the `sdk-sha` pinned in `.github/workflows/ci.yml`
into `.outfitter-sdk`, then run `npm ci`. The root workspaces include those public
packages and app-owned workflows; package-lock.json pins the complete dependency
graph. Run `npm run check --workspace @ai-outfitter/app-strength-five` or the app's
`test`, `build`, and `test:e2e` commands. The same works for Yoga Practice.
`outfitter-app-build` produces `.outfitter/packages/<mode>.json` within each app;
`preview:build` produces the read-only demo consumed by shared preview publication.
No private webapp checkout or SSH key is needed by these workflows.

## Independent releases

Release automation is enabled with `OUTFITTER_RELEASES_ENABLED=true`. The
main-push workflow creates and updates release-please PRs for changed apps. Keep `release-please-config.json`,
`.release-please-manifest.json`, app versions and changelogs here. Components have
independent versions and tags, for example `strength-five-v0.1.1`. Release PRs
update `package.json`, `app.json` and `.release-please-manifest.json` together.
When a release PR merges, release-please automatically creates the component tag
and GitHub release. Owned workflows retain their own declared versions; this does
not publish SDK packages to npm.

Optionally supply `RELEASE_PLEASE_TOKEN` (GitHub App or PAT). Otherwise the shared
runner job resolves the repository's generated token using the caller's declared
write permissions. GitHub Actions is allowed to create release PRs. Changes made
using the generated token do not trigger follow-up PR workflows. Nothing auto-merges. Root shared behavior
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
Release automation and preview credentials are configured. Main-branch
installation deployment remains a separate opt-in setting. No app behavior or
platform code is changed by these wrappers.

## Pull-request preview environments

Same-repository PRs automatically check and test selected apps, then publish
separate read-only synthetic demo previews. Build jobs use the pinned public SDK
and receive no hosting token. Publication validates the artifact's source before
uploading, reports a URL per app and verifies the served commit SHA. Closing the
PR removes its preview Workers.

Only `CLOUDFLARE_API_TOKEN` in the `preview-publish` environment and repository
variable `OUTFITTER_PREVIEW_ACCOUNT_ID` are required for preview hosting.
Previews contain no customer sessions, installed data or platform APIs.
