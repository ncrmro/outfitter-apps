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

Check out public `ai-outfitter/apps` at the `sdkSha` pinned in `.outfitter/apps.json`
into `.outfitter-sdk`, then run `npm ci`. The root workspaces include those public
packages and app-owned workflows; package-lock.json pins the complete dependency
graph. Run `npm run check --workspace @ai-outfitter/app-strength-five` or the app's
`test`, `build`, and `test:e2e` commands. The same works for Yoga Practice.
`outfitter-app-build` produces `.outfitter/packages/<mode>.json` within each app;
`preview:build` produces the read-only demo consumed by shared preview publication.
No private webapp checkout or SSH key is needed by these workflows.

## Independent releases

The main-push workflow creates and updates release-please PRs for changed apps. Keep `release-please-config.json`,
`.release-please-manifest.json`, app versions and changelogs here. Components have
independent versions and tags, for example `strength-five-v0.1.1`. Release PRs
update `package.json`, `app.json` and `.release-please-manifest.json` together.
When a release PR merges, release-please automatically creates the component tag
and GitHub release. Owned workflows retain their own declared versions; this does
not publish SDK packages to npm.

Release-please refreshes open component PRs after other releases merge, keeping
the shared version manifest current.

Optionally supply `RELEASE_PLEASE_TOKEN` (GitHub App or PAT). Otherwise the shared
runner job resolves the repository's generated token using the caller's declared
write permissions. GitHub Actions is allowed to create release PRs. Changes made
using the generated token do not trigger follow-up PR workflows. Nothing auto-merges. Root shared behavior
changes need app-local release-notes.md entries in each affected app's conventional
fix/feature commit so release-please sees those component paths.

## Release notifications and scheduled updates

After release-please publishes an app's component release, the shared release
workflow notifies Outfitter through GitHub OIDC. It registers the version and
immutable source commit and requests `personal/strength-five` or
`personal/yoga-practice` updates according to `.outfitter/apps.json`.
Ordinary main pushes no longer request production deployment. App checks and
builds validate changes; their artifacts are not production deployment inputs.

Outfitter does not poll repositories for releases. Notifications only register
releases and update requests; the server's scheduled tick separately dispatches
isolated builds and activates successful packages. A build starts when an
existing installation needs the release or someone first installs it. Successful
packages are cached and failed builds leave the active installation running.

One-time setup in SaaS:

1. Open [Apps](https://ai-outfitter.com/apps#app-repositories) in your personal
   account, authorize GitHub repository access, add `ncrmro/outfitter-apps`, and
   install Strength and Yoga. Older installs may need Update once to establish
   their repository and installer binding.
2. Merge a checked app change and then its release-please PR. The release workflow
   records the new version and personal update requests. Inspect Outfitter's
   release receipts and installation history for build and activation results.

Scopes select authorized existing owners; they do not grant account access.
If more than one personal binding matches, add that source's `repositoryId` to
its `releaseTargets` entry. Organization updates use `org/<app-slug>` and an
explicit source binding when ambiguous. `platform` publication requires a
separately registered publisher; this repository cannot request it by changing
its configuration.

If a notification fails after a release was created, rerun the failed notification
job. Alternatively manually run this repository's **App releases** workflow on
`main` with its `releases` input set to an existing release, for example:

```json
[{"app":"yoga-practice","tag":"yoga-practice-v0.1.1","commit":"FULL_RELEASE_COMMIT_SHA","targets":[{"target":"personal/yoga-practice"}]}]
```

Use the full commit referenced by that published tag. Retrying is idempotent and
does not create a version or run a build in Actions. Run recovery from this repo,
not the central tooling repo, so OIDC retains this repository's identity.
Registration/queue acceptance is not completed activation. No platform deployment
secret or enablement flag is required; only notification jobs get `id-token: write`.

SaaS at `https://ai-outfitter.com` is the default. For self-hosting later,
`OUTFITTER_URL` selects the HTTPS origin and OIDC audience; WireGuard reachability
and self-hosted runtime setup remain separate work.

See the [release architecture](https://github.com/ai-outfitter/webapp/blob/main/docs/architecture/app-releases.md).
Deploy platform support before merging this workflow crossover.

## Pull-request preview environments

Same-repository PRs automatically check and test selected apps, then publish
separate read-only synthetic demo previews. Build jobs use the pinned public SDK
and receive no hosting token. Publication validates the artifact's source before
uploading, reports a URL per app and verifies the served commit SHA. Closing the
PR removes its preview Workers.

Only `CLOUDFLARE_API_TOKEN` in the `preview-publish` environment and repository
variable `OUTFITTER_PREVIEW_ACCOUNT_ID` are required for preview hosting.
Previews contain no customer sessions, installed data or platform APIs.
