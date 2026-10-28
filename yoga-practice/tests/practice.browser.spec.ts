import { mkdir } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { appArtifact } from "@ai-outfitter/app-test/prepare";
import { fulfillFrom, routeReadOnly } from "@ai-outfitter/app-test/playwright";
import { appWorker } from "@ai-outfitter/app-test/worker";
import type { HostOptions } from "../../apple-health-test-host";
import { healthRecords, hostDouble, scope } from "./helpers/fixtures";

// One test per member goal. The operational app runs over its installation
// database as the member's own installation, with a workflow host double
// serving a synthetic Apple Health import dated up to today.
// Set SCREENSHOTS=<directory> to save desktop and mobile captures there.

const origin = "https://yoga-practice.example";
const package_ = new URL("..", import.meta.url);
type Member = { userId: string; organizationId: string; role: string; owner?: { kind: "user" | "organization"; id: string } };
const owner: Member = { userId: "member-1", organizationId: "", role: "owner", owner: { kind: "user", id: "member-1" } };
const viewports = [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }];

let failures: string[] = [];
test.beforeEach(({ page }) => {
  failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()); });
  page.on("dialog", (dialog) => dialog.accept());
});
test.afterEach(() => expect(failures).toEqual([]));

/** The operational worker for `member` (the owner), as the platform forwards each request. */
async function operational(page: Page, options: Partial<HostOptions> = {}, member: Member = owner) {
  const health = healthRecords(Date.now());
  const double = hostDouble(health, options);
  const worker = await appWorker("yoga-practice", appArtifact(package_, "operational"), "yoga", { workflowHost: double.host });
  await page.route(`${origin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postData();
    await fulfillFrom(route, await worker.call(url.pathname + url.search, member, {
      method: request.method(),
      body: body ? JSON.parse(body) : undefined,
      headers: { Accept: request.headers().accept ?? "*/*" },
      workflowHost: scope(request.method()),
    }));
  });
  return { worker, double, health };
}

const sessions = (page: Page) => page.getByRole("list", { name: "Sessions" }).getByRole("listitem");
/** Follow a sidebar link; on phones the sidebar opens from the header first. */
async function navigate(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("link", { name, exact: true }).click();
}
const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

async function capture(page: Page, name: string, viewport: string) {
  const directory = process.env.SCREENSHOTS;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${name}-${viewport}.png`, fullPage: true });
}

test("the owner syncs Apple Health, tags and logs sessions, and sees progress", async ({ page }) => {
  test.setTimeout(120_000);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const { worker, double, health } = await operational(page);
    // The synthetic import includes only records up to now; early in the week
    // its current-week workout and mindful session have not happened yet.
    const importedSessions = health.workouts.length + health.mindful.length;
    try {
      await test.step(`${viewport.name}: a sync brings Health sessions in once`, async () => {
        await page.goto(`${origin}/`);
        await expect(page.getByRole("heading", { name: "Practice", level: 1 })).toBeVisible();
        await expect(page.getByText("No sessions yet.")).toBeVisible();
        await page.getByRole("button", { name: "Sync from Apple Health" }).click();
        await expect(page.getByRole("status")).toHaveText(new RegExp(`^Read ${health.workouts.length} workouts and ${health.mindful.length} mindful sessions: ${importedSessions} new sessions, \\d+ new readings\\.$`));
        await expect(sessions(page)).toHaveCount(importedSessions);
        // Health's device names are text, never markup.
        await expect(page.getByText("Mat Flow <img src=x onerror=alert(1)>")).toBeVisible();
        await page.getByRole("button", { name: "Sync from Apple Health" }).click();
        await expect(page.getByRole("status")).toHaveText(/: 0 new sessions, 0 new readings\.$/);
        await expect(sessions(page)).toHaveCount(importedSessions);
        expect(double.calls.filter((call) => call.operation === "workflow.collect")).toHaveLength(2);
      });

      await test.step(`${viewport.name}: tag an imported session, add one and delete one`, async () => {
        const first = sessions(page).first();
        await expect(first.getByText("Not tagged yet")).toBeVisible();
        await first.getByRole("button", { name: /^Edit / }).click();
        const dialog = page.getByRole("dialog", { name: "Edit session" });
        await dialog.getByLabel("Style").selectOption("yin");
        await dialog.getByLabel("Intensity").selectOption("gentle");
        await dialog.getByLabel("Hips").check();
        await dialog.getByLabel("Note").fill("Long holds");
        await capture(page, "edit-session", viewport.name);
        await dialog.getByRole("button", { name: "Save" }).click();
        await expect(page.getByRole("status")).toHaveText("Session saved.");
        await expect(sessions(page).first().getByRole("heading")).toHaveText(/ min yin$/);
        await expect(sessions(page).first().getByText("Gentle · Hips")).toBeVisible();

        await page.getByRole("button", { name: "Add session" }).click();
        const add = page.getByRole("dialog", { name: "Add session" });
        await add.getByLabel("Minutes").fill("25");
        await add.getByLabel("Style").selectOption("restorative");
        await add.getByRole("button", { name: "Save" }).click();
        await expect(page.getByRole("status")).toHaveText("Session added.");
        await expect(sessions(page)).toHaveCount(importedSessions + 1);
        await page.getByRole("button", { name: /^Delete 25 min restorative/ }).click();
        await expect(page.getByRole("status")).toHaveText("Session deleted.");
        await expect(sessions(page)).toHaveCount(importedSessions);
        await noOverflow(page);
      });

      await test.step(`${viewport.name}: progress shows weekly minutes and recovery; settings change the target`, async () => {
        await navigate(page, "Progress");
        await expect(page.getByRole("heading", { name: "Progress", level: 1 })).toBeVisible();
        await expect(page.locator("#chart svg rect")).toHaveCount(8);
        await expect(page.locator("#weeks tbody tr")).toHaveCount(8);
        await expect(page.locator("#weeks tbody tr").nth(1)).toContainText("bpm");
        await noOverflow(page);
        await navigate(page, "Settings");
        await expect(page.locator("#health")).toHaveText(/^Connected\. .* Last synced /);
        await page.getByLabel("Sessions a week").fill("4");
        await page.getByRole("button", { name: "Save target" }).click();
        await expect(page.getByRole("status")).toHaveText("Target saved.");
        await noOverflow(page);
      });
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await worker.dispose();
    }
  }
});

test("without Apple Health the app explains how to import it and still logs sessions", async ({ page }) => {
  const { worker } = await operational(page, { connected: false });
  try {
    await page.goto(`${origin}/`);
    await expect(page.locator("#health-hint")).toContainText("/connectors/apple-health");
    await expect(page.getByRole("button", { name: "Sync from Apple Health" })).toBeHidden();
    await page.getByRole("button", { name: "Add session" }).click();
    await page.getByRole("dialog", { name: "Add session" }).getByRole("button", { name: "Save" }).click();
    await expect(sessions(page)).toHaveCount(1);
    await page.goto(`${origin}/settings`);
    await expect(page.locator("#health")).toContainText("works without it");
    await expect(page.getByRole("button", { name: "Sync from Apple Health" })).toBeHidden();
  } finally {
    await worker.dispose();
  }
});

test("on an organization's installation the app says it only works as the member's own", async ({ page }) => {
  const { worker } = await operational(page, { owner: "organization" }, { userId: "member-1", organizationId: "org-1", role: "owner" });
  try {
    await page.goto(`${origin}/`);
    await expect(page.getByRole("status")).toHaveText(/^This is a personal app and only works as your own\./);
    await expect(page.getByRole("button", { name: "Sync from Apple Health" })).toBeHidden();
    // The browser logs each refused request.
    failures = failures.filter((failure) => !failure.includes("403"));
  } finally {
    await worker.dispose();
  }
});

test("the demo shows six weeks of practice and never writes", async ({ page }) => {
  const worker = await appWorker("yoga-practice", appArtifact(package_, "demo"));
  try {
    expect(worker.hasDatabase).toBe(false);
    await routeReadOnly(page, origin, worker);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(`${origin}/`);
      await expect(sessions(page)).toHaveCount(18);
      await expect(page.locator('[data-tile="streak"] .tile-value')).toHaveText("5 weeks");
      await expect(page.locator('[data-tile="minutes"] .tile-value')).toHaveText("97");
      await expect(page.getByRole("button", { name: "Add session" })).toBeHidden();
      await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
      await noOverflow(page);
      await capture(page, "practice", viewport.name);
      await page.goto(`${origin}/progress`);
      await expect(page.locator("#weeks tbody tr")).toHaveCount(8);
      await expect(page.locator("#by-style li").first()).toHaveText("Vinyasa: 4 sessions, 210 min");
      await noOverflow(page);
      await capture(page, "progress", viewport.name);
      await page.goto(`${origin}/settings`);
      await expect(page.locator("#health")).toHaveText("Connected to a synthetic Apple Health import. Syncing is turned off here.");
      await expect(page.getByRole("button", { name: "Save target" })).toBeDisabled();
      await capture(page, "settings", viewport.name);
    }
  } finally {
    await worker.dispose();
  }
});
