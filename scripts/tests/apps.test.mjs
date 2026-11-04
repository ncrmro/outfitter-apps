import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { affectedApps, changedFiles, checkApp, discoverApps } from "../apps.mjs";

const apps = discoverApps();
test("a change to one app or its workflow selects only that app", () => {
  assert.deepEqual(affectedApps(apps, ["strength-five/src/pages/index.astro"]), ["strength-five"]);
  assert.deepEqual(affectedApps(apps, ["yoga-practice/workflows/yoga-health-sync/workflow.yaml"]), ["yoga-practice"]);
});
test("shared health helpers and pipeline inputs select both apps", () => {
  for (const path of ["apple-health.ts", "apple-health-test-host.ts", ".github/workflows/ci.yml", "package.json", "scripts/apps.mjs", "removed-app/app.json", "README.md.ts"])
    assert.deepEqual(affectedApps(apps, [path]), ["strength-five", "yoga-practice"]);
});
test("documentation-only changes and empty diffs select no apps", () => {
  assert.deepEqual(affectedApps(apps, ["README.md", "docs/ci.md", "AGENTS.md"]), []);
  assert.deepEqual(affectedApps(apps, []), []);
});
test("missing history and first pushes conservatively select every app", () => {
  assert.equal(changedFiles(process.cwd(), {}), null);
  assert.equal(changedFiles(process.cwd(), { BASE_SHA: "0".repeat(40) }), null);
  assert.equal(changedFiles(process.cwd(), { BASE_SHA: "f".repeat(40) }), null);
  assert.deepEqual(affectedApps(apps, null), ["strength-five", "yoga-practice"]);
});
test("dependency changes fan out transitively through app packages", () => {
  const graph = [
    { slug: "first", pkg: { name: "first" } },
    { slug: "second", pkg: { name: "second", dependencies: { first: "0.1.0" } } },
    { slug: "third", pkg: { name: "third", devDependencies: { second: "0.1.0" } } },
  ];
  assert.deepEqual(affectedApps(graph, ["first/src/lib.ts"]), ["first", "second", "third"]);
});
test("consumers of an app-owned workflow are selected with its owner", () => {
  const graph = [
    { slug: "producer", pkg: { name: "producer" }, ownedPackages: ["shared-workflow"] },
    { slug: "consumer", pkg: { name: "consumer", dependencies: { "shared-workflow": "0.1.0" } } },
  ];
  assert.deepEqual(affectedApps(graph, ["producer/workflows/shared/workflow.yaml"]), ["producer", "consumer"]);
});
test("git selection includes deletions and both sides of a rename", () => {
  const root = mkdtempSync(join(tmpdir(), "app-plan-test-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git("init", "--quiet");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "user.name", "Fixture");
    writeFileSync(join(root, "old.ts"), "export const a = 1;\n");
    git("add", "."); git("commit", "--quiet", "-m", "fixture");
    const base = git("rev-parse", "HEAD");
    git("mv", "old.ts", "new.ts"); git("commit", "--quiet", "-m", "rename");
    assert.deepEqual(changedFiles(root, { BASE_SHA: base }).sort(), ["new.ts", "old.ts"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("both pilot apps satisfy package and release contracts", () => {
  for (const { slug } of apps) assert.equal(checkApp(slug).slug, slug);
  assert.throws(() => checkApp("unknown"), /Unknown app/);
});
test("contract checks reject version drift, missing modes and broken workflow dependencies", () => {
  for (const [path, mutate, error] of [
    ["strength-five/app.json", (value) => { value.version = "0.2.0"; }, /versions differ/],
    ["strength-five/app.json", (value) => { delete value.modes.demo; }, /missing demo mode/],
    ["strength-five/package.json", (value) => { value.dependencies["@ai-outfitter/workflow-strength-health-sync"] = "9.0.0"; }, /workflow dependency differs/],
    [".release-please-manifest.json", (value) => { value["strength-five"] = "0.2.0"; }, /0.2.0/],
  ]) {
    const root = mkdtempSync(join(tmpdir(), "app-contract-test-"));
    try {
      for (const source of ["strength-five", "release-please-config.json", ".release-please-manifest.json"])
        cpSync(source, join(root, source), { recursive: true });
      const target = join(root, path);
      const value = JSON.parse(readFileSync(target, "utf8"));
      mutate(value);
      writeFileSync(target, JSON.stringify(value));
      assert.throws(() => checkApp("strength-five", root), error);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});
