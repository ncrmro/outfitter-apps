# Outfitter apps

Nicholas's personal Outfitter apps, and the pilot for independent app CI and
releases. Each app keeps its own workflows, fixtures, migrations and tests.

| App | What it does |
| --- | --- |
| [`strength-five`](strength-five) | Strength 5x5 training, progression and Apple Health context. |
| [`yoga-practice`](yoga-practice) | Yoga sessions, weekly targets, streaks and Apple Health recovery readings. |

`apple-health.ts` and `apple-health-test-host.ts` are shared by both apps.
These apps are ordinary repository sources configured in Outfitter's app
repository settings. They no longer require a submodule bump in the platform.

## CI

`Check` runs on PRs, merge-queue commits and pushes to main. It discovers apps
from their `app.json` files and selects a matrix from the Git diff:

- An app or its workflow changes: select that app and dependent apps.
- A shared Health helper, CI/tooling input or unknown path changes: select all.
- Root documentation changes only: run workflow-tooling tests, with no app jobs.
- Missing history or a first push: select all.

Main-branch pushes compare against the last successful main pipeline, including
deployment when enabled. This accumulates changes from failed or superseded runs
instead of losing an app update when another commit arrives before it deploys.

Each matrix entry validates package identity, declared modes, version alignment,
the cover asset, workflow dependencies and release configuration. `CI gate` is the
stable check to require in branch protection. Local commands need only Node 24:

```sh
npm test
npm run check
BASE_SHA=<40-character-base-commit> npm run ci:plan
node scripts/apps.mjs check strength-five
```

These are **package-contract and CI-tooling checks**, not app runtime tests.
The SDK, UI, server helpers and build/test tooling are still unpublished;
`npm install` at the root deliberately does not install app workspaces or pretend
that private packages can resolve. No platform source is copied into this repo.

## Full app validation while the SDK is private

`App toolchain` is a manually dispatched matrix for a reviewed, exact app source
commit. Each app gets a fresh, pinned platform checkout and runs its existing
check, unit/integration tests, demo/operational builds and browser suite. It does
not run the platform's full test suite or deploy anything.

Configure before using it:

1. Set repository variable `OUTFITTER_TOOLCHAIN_SHA` to an audited 40-character
   commit of `ai-outfitter/webapp` containing `scripts/build-app-repository.mjs`.
2. Create environment `toolchain` with required reviewers. Store environment
   secret `OUTFITTER_TOOLCHAIN_TOKEN`, with read-only contents access to webapp.
3. Dispatch `App toolchain` from main with the reviewed app `source_sha`. Treat
   dispatch/review as permission to execute that source with private SDK access.

The adapter modifies only the disposable toolchain checkout. It currently uses
`npm install` to add app dependencies, so pinning source and toolchain revisions
does **not** guarantee reproducible dependency resolution. Source is archived
from the requested commit, not uncommitted files. Locally, after installing the
disposable toolchain's dependencies:

```sh
node scripts/toolchain.mjs strength-five /absolute/path/to/disposable-webapp
```

On the NixOS workstation, run browser validation inside the platform's
`devenv shell`; hosted Ubuntu CI installs Chromium dependencies itself.

Once SDK/tooling packages are published, replace this private checkout lane with
locked npm workspaces and normal PR build/test matrices. A configured toolchain
run is separate evidence; the public CI gate does not require it yet.

## Independent app releases

Release-please uses one manifest with two independent components, separate PRs,
changelogs and tags such as `strength-five-v0.1.1` and `yoga-practice-v0.1.1`.
It updates `package.json` and `app.json` together. App-owned workflow packages keep
their own declared versions; they are bundled with their owning app, not separately
published by this pilot. App packages remain private npm packages: GitHub releases
here are app source releases, not npm publication.

Use conventional fix/feature commits that touch the app being released. A change
only to a root shared helper is outside release-please's component paths: include
an app-local `release-notes.md` describing the effect in each affected app in the
same commit to release both. This is separate from CI's automatic shared-input
fan-out. Release-please creates reviewable PRs; it never merges them automatically.

To enable releases, configure `RELEASE_PLEASE_TOKEN` with repository contents,
issues and PR write access, then set `OUTFITTER_RELEASES_ENABLED=true`. A dedicated
token lets release PRs trigger normal CI. Without one, the workflow falls back to
`GITHUB_TOKEN`, which requires permission to create PRs and may require manual
approval/dispatch for their checks. The repository currently disallows token-based
PR creation; enable that setting if choosing the fallback.

## Deployment requests

Set `OUTFITTER_DEPLOY_ENABLED=true` to enable the reusable deployment workflow
after a successful main-branch CI gate. Each affected app has its own matrix job
and concurrency group; it posts `{"apps":["<slug>"]}` to Outfitter using GitHub
OIDC. No Outfitter API secret is needed. Changes to one app do not request builds
of unrelated apps or a platform deployment. Docs-only changes make no requests.

The platform performs the actual checks, build and installation. It verifies the
repository identity and current default-branch SHA, deduplicates requests and
retains the previous installed package on failure. CI reports request acceptance
and fails on HTTP or per-app request errors; it does not poll or attest completed
activation. Inspect installation history for the final result. Push deployment
and GitHub source releases are independent; deployment is not release-gated.

Both release automation and deployment are **off until explicitly configured**.
This scaffold changes no installed apps and moves no additional platform apps.

References: [app repository contract](https://github.com/ai-outfitter/webapp/blob/main/docs/app-repositories.md),
[release-please manifests](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md),
[GitHub token event behavior](https://docs.github.com/en/actions/concepts/security/github_token).
