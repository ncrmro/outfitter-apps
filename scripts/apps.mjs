import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const read = (root, path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));

export function discoverApps(root = process.cwd()) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(resolve(root, entry.name, "app.json")))
    .map(({ name }) => {
      assert.match(name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      const pkg = read(root, `${name}/package.json`);
      const workflows = resolve(root, name, "workflows");
      const ownedPackages = existsSync(workflows) ? readdirSync(workflows)
        .map((entry) => read(root, `${name}/workflows/${entry}/package.json`).name) : [];
      return { slug: name, pkg, ownedPackages, manifest: read(root, `${name}/app.json`) };
    }).sort((a, b) => a.slug.localeCompare(b.slug));
}

export function affectedApps(apps, paths) {
  if (paths === null) return apps.map(({ slug }) => slug);
  const affected = new Set();
  for (const path of paths) {
    const app = apps.find(({ slug }) => path.startsWith(`${slug}/`));
    if (app) affected.add(app.slug);
    else if (!/^(?:README\.md|AGENTS\.md|LICENSE(?:\.[^/]*)?)$|^docs\//.test(path))
      // Root helpers, CI, tooling and unknown/deleted package paths fan out.
      apps.forEach(({ slug }) => affected.add(slug));
  }
  // An app can consume another app package or an app-owned workflow package.
  const packageOwners = new Map(apps.flatMap(({ slug, pkg, ownedPackages = [] }) => [
    [pkg.name, slug],
    ...ownedPackages.map((name) => [name, slug]),
  ]));
  let changed;
  do {
    changed = false;
    for (const { slug, pkg } of apps) {
      if (!affected.has(slug) && Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies })
        .some((name) => affected.has(packageOwners.get(name)))) {
        affected.add(slug);
        changed = true;
      }
    }
  } while (changed);
  return apps.filter(({ slug }) => affected.has(slug)).map(({ slug }) => slug);
}

export function changedFiles(root = process.cwd(), env = process.env) {
  const base = env.BASE_SHA;
  const head = env.HEAD_SHA || "HEAD";
  if (!base || /^0+$/.test(base)) return null;
  // Treat SHAs as data, never options or arbitrary revision expressions.
  if (!/^[a-f0-9]{40}$/.test(base) || !/^(?:HEAD|[a-f0-9]{40})$/.test(head)) return null;
  try {
    return execFileSync("git", ["diff", "--no-renames", "--name-only", "-z", base, head, "--"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\0").filter(Boolean);
  } catch { return null; }
}

export function checkApp(slug, root = process.cwd()) {
  const app = discoverApps(root).find((app) => app.slug === slug);
  assert.ok(app, `Unknown app: ${slug}`);
  const { pkg, manifest } = app;
  assert.equal(pkg.name, `@ai-outfitter/app-${slug}`);
  assert.equal(pkg.outfitter?.kind, "app");
  assert.equal(pkg.version, manifest.version, `${slug}: package/app versions differ`);
  assert.match(pkg.version, /^0\.\d+\.\d+$/);
  for (const command of ["build", "check", "test", "test:e2e"])
    assert.ok(pkg.scripts?.[command], `${slug}: missing ${command}`);
  for (const mode of ["demo", "operational"]) {
    assert.ok(manifest.modes?.[mode], `${slug}: missing ${mode} mode`);
    assert.equal(manifest.catalog?.[mode]?.slug, slug);
  }
  assert.ok(existsSync(resolve(root, slug, manifest.catalog.cover)), `${slug}: missing cover`);
  const config = read(root, "release-please-config.json").packages[slug];
  assert.equal(config?.component, slug);
  assert.equal(read(root, ".release-please-manifest.json")[slug], pkg.version);
  const workflows = resolve(root, slug, "workflows");
  for (const entry of existsSync(workflows) ? readdirSync(workflows) : []) {
    const workflow = read(root, `${slug}/workflows/${entry}/package.json`);
    assert.equal(pkg.dependencies[workflow.name], workflow.version, `${slug}: workflow dependency differs`);
    assert.ok(existsSync(resolve(workflows, entry, workflow.outfitter.definition)));
  }
  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, slug] = process.argv.slice(2);
  const apps = discoverApps();
  assert.ok(apps.length, "No apps discovered");
  if (command === "plan") {
    const selected = affectedApps(apps, changedFiles());
    const outputs = { apps: JSON.stringify(selected), has_apps: String(selected.length > 0) };
    console.log(JSON.stringify(outputs));
    if (process.env.GITHUB_OUTPUT)
      for (const [name, value] of Object.entries(outputs)) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  } else if (command === "check") {
    for (const selected of slug ? [slug] : apps.map(({ slug }) => slug)) {
      checkApp(selected);
      console.log(`Validated package contract: ${selected}`);
    }
  } else throw Error("Usage: node scripts/apps.mjs plan|check [APP]");
}
