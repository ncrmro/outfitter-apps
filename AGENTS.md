# Outfitter apps

- This repository pilots independent app CI, releases and deployment. Keep app
  behavior changes separate from workflow work; do not extract platform code here.
- Each top-level directory with `app.json` is one app. Its workflows, fixtures,
  tests and migrations remain app-owned. Root Health helpers are shared inputs.
- Run `npm test` and `npm run check` before pushing workflow changes. These require
  Node 24 and no dependency installation. Validate Actions files with actionlint.
- `Package contract` checks validate metadata, not app behavior. Full validation
  uses the manual `App toolchain` workflow until the public SDK/tooling exists.
  Never label a contract-only pass as an app test/build pass.
- Use conventional commits. Keep app versions independent and synchronize each
  app's `package.json` and `app.json` through release-please. Do not publish major
  versions or use breaking-change commits without explicit authorization.
- Changes to shared Health helpers select both apps. To release shared behavior
  changes, include an app-local release note (`release-notes.md`) for each affected
  app in the conventional fix/feature commit so release-please sees both paths.
- Production deployment requests and release automation are opt-in repository
  settings. A 202 response means queued work, not successful deployment.
- Private toolchain access belongs only in the manually dispatched workflow's
  `toolchain` environment. Never run private checkout credentials in public PR
  workflows or upload private platform source as an artifact.
