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

Run an app from this checkout inside a local Outfitter server (a checkout of
`ai-outfitter/webapp` beside this one). Once, set up the public SDK at the pinned
`sdkSha` from `.outfitter/apps.json`, and install dependencies:

```sh
git clone https://github.com/ai-outfitter/apps .outfitter-sdk
git -C .outfitter-sdk checkout <sdkSha> && npm ci
```

Then, from the webapp checkout:

```sh
node scripts/dev-local.mjs --apps-checkout ../outfitter-apps --app strength-five --port 4392
```

Saving a file in `strength-five/`, a shared input (`apple-health.ts`) or the SDK's
`packages/ui` rebuilds the affected apps; reload the page to see the change. A failed
build keeps the last working version and prints the error. Stop with Ctrl-C or
`node scripts/dev-local.mjs --stop`. Nothing is released or published. See the
webapp's `docs/local-organizations.md`.

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

## Automatic deployment to Outfitter

After selected app checks pass on a main-branch push, CI calls the shared deploy
workflow with GitHub OIDC. SaaS at `https://ai-outfitter.com` is the default.
There is no deployment enablement flag or platform deployment secret. Releases
are independent of deployment; merging an app change is enough to request it.

One-time setup in SaaS:

1. Open [Apps](https://ai-outfitter.com/apps#app-repositories) in your personal
   account, add `ncrmro/outfitter-apps`, and install Strength and Yoga. Authorize
   GitHub repository access when requested. Existing installs created before CI
   deployments need Update once to record their repository and installer.
2. Merge a checked app change to main. Outfitter verifies the GitHub job's
   repository and commit, builds that exact revision, and updates its existing
   installations when successful. Inspect installation history for activation.

The platform requires the installing member's current repository and account
permissions. CI cannot create arbitrary installations in another user's account.
Apps without subscribed installations report nothing to update. Accepted
build/install requests are reported as queued, rather than as active deployments.

For a self-hosted instance later, set `OUTFITTER_URL` to its HTTPS origin. The
same OIDC audience and API contract apply. The runner must reach that host;
WireGuard access and the self-hosted runtime will be configured separately.
No deployment-runner override or WireGuard workflow is needed for SaaS.
The caller grants `id-token: write` only to the deployment job; app checks and
preview builds receive no deployment credentials.

## Pull-request preview environments

Same-repository PRs automatically check and test selected apps, then publish
separate read-only synthetic demo previews. Build jobs use the pinned public SDK
and receive no hosting token. Publication validates the artifact's source before
uploading, reports a URL per app and verifies the served commit SHA. Closing the
PR removes its preview Workers.

Only `CLOUDFLARE_API_TOKEN` in the `preview-publish` environment and repository
variable `OUTFITTER_PREVIEW_ACCOUNT_ID` are required for preview hosting.
Previews contain no customer sessions, installed data or platform APIs.
