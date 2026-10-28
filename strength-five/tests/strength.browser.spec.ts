import { mkdir } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { appArtifact } from "@ai-outfitter/app-test/prepare";
import { fulfillFrom, routeReadOnly } from "@ai-outfitter/app-test/playwright";
import { appWorker } from "@ai-outfitter/app-test/worker";
import type { HostOptions } from "../../apple-health-test-host";
import { healthFixture, hostDouble, scope } from "./helpers/fixtures";

// The member's goals at the gym, on a phone and a desktop. The operational app
// runs over its installation database as the member's own app, with a
// workflow host double over a fixture Apple Health connection.
// Set SCREENSHOTS=<directory> to save desktop and mobile captures there.

const origin = "https://strength-five.alpha.localhost";
const package_ = new URL("..", import.meta.url);
type Member = { userId: string; organizationId: string; role: string; owner?: { kind: "user" | "organization"; id: string } };
const nicholas: Member = { userId: "member-1", organizationId: "", role: "owner", owner: { kind: "user", id: "member-1" } };
const viewports = [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }];

let failures: string[] = [];
test.beforeEach(({ page }) => {
  failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()); });
  page.on("dialog", (dialog) => failures.push(`dialog: ${dialog.message()}`));
});
test.afterEach(() => expect(failures).toEqual([]));

/** The operational worker for `member` (the owner), as the platform forwards each request. */
async function operational(page: Page, options: Partial<HostOptions> = {}, member: Member = nicholas) {
  const double = hostDouble(healthFixture(), options);
  const worker = await appWorker("strength-five", appArtifact(package_, "operational"), "strength", { workflowHost: double.host });
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
  return { worker, double };
}

async function navigate(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("link", { name, exact: true }).click();
}
const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
const set = (page: Page, lift: string, index: number) => page.getByRole("group", { name: `${lift} sets` }).getByRole("button").nth(index);

async function capture(page: Page, directory: string | undefined, name: string, viewport: string) {
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${directory}/${name}-${viewport}.png`, fullPage: true });
}

test("the owner logs a session at the gym, syncs Apple Health and sees progress", async ({ page }) => {
  test.setTimeout(120_000);
  const directory = process.env.SCREENSHOTS;
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const { worker } = await operational(page);
    try {
      await test.step(`${viewport.name}: set starting weights`, async () => {
        await page.goto(`${origin}/settings`);
        await expect(page.locator("#health")).toHaveText(/^Connected\./);
        await page.getByLabel("Squat").fill("60");
        await page.getByLabel("Deadlift").fill("80");
        await page.getByRole("button", { name: "Save weights" }).click();
        await expect(page.getByRole("status")).toHaveText("Saved. Today shows the new weights.");
        await noOverflow(page);
      });

      await test.step(`${viewport.name}: tap each set and save`, async () => {
        await navigate(page, "Today");
        await expect(page.getByRole("heading", { name: "Workout A" })).toBeVisible();
        await expect(page.getByRole("listitem").filter({ hasText: "Squat" }).getByText("60 kg")).toBeVisible();
        // Sets are big enough to hit with a thumb.
        const box = await set(page, "Squat", 0).boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(48);
        for (const lift of ["Squat", "Bench press", "Barbell row"])
          for (let index = 0; index < 5; index++) await set(page, lift, index).click();
        // A second tap on the last row set: four reps.
        await set(page, "Barbell row", 4).click();
        await expect(set(page, "Barbell row", 4)).toHaveAccessibleName("Set 5 of 5: 4 reps");
        await capture(page, directory, "today-logging", viewport.name);
        await page.getByRole("button", { name: "Save session" }).click();
        await expect(page.getByRole("status")).toHaveText("Saved workout A. Next: workout B.");
        await expect(page.getByRole("listitem").filter({ hasText: "Squat" }).getByText("62.5 kg")).toBeVisible();
        await noOverflow(page);
      });

      await test.step(`${viewport.name}: sync from Apple Health`, async () => {
        await page.getByRole("button", { name: "Sync from Apple Health" }).click();
        await expect(page.getByRole("status")).toHaveText(/^Synced \d+ strength workouts and \d+ bodyweight readings\.$/);
        await expect(page.locator("#bodyweight-now")).toHaveText(/kg$/);
        await capture(page, directory, "today", viewport.name);
        await navigate(page, "History");
        const session = page.getByRole("list", { name: "Sessions" }).getByRole("listitem").first();
        await expect(session.getByRole("row", { name: /Barbell row/ })).toContainText("5 5 5 5 4");
        await noOverflow(page);
      });
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await worker.dispose();
    }
  }
});

test("without Apple Health the app says how to import it and still logs sessions", async ({ page }) => {
  const { worker } = await operational(page, { connected: false });
  try {
    await page.goto(`${origin}/`);
    await expect(page.getByRole("button", { name: "Sync from Apple Health" })).toBeHidden();
    await expect(page.getByRole("link", { name: "Import your Apple Health data" })).toHaveAttribute("href", "/connectors/apple-health");
    await expect(page.getByRole("button", { name: "Save session" })).toBeEnabled();
    await page.goto(`${origin}/settings`);
    await expect(page.locator("#health")).toContainText("Apple Health is not connected.");
    await expect(page.locator("#health").getByRole("link", { name: "Open the Apple Health import" })).toHaveAttribute("href", "/connectors/apple-health");
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

test("the demo shows five weeks with a deload and Health workouts, and never writes", async ({ page }) => {
  test.setTimeout(120_000);
  const worker = await appWorker("strength-five", appArtifact(package_, "demo"));
  const directory = process.env.SCREENSHOTS;
  try {
    expect(worker.hasDatabase).toBe(false);
    await routeReadOnly(page, origin, worker);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(`${origin}/`);
      await expect(page.getByRole("heading", { name: "Workout B" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Save session" })).toBeDisabled();
      await expect(page.locator("#bodyweight-chart svg")).toBeVisible();
      await capture(page, directory, "demo-today", viewport.name);
      await page.goto(`${origin}/history`);
      await expect(page.getByRole("list", { name: "Sessions" }).getByRole("listitem")).toHaveCount(15);
      await expect(page.getByText("52.5 kg · deload")).toBeVisible();
      // A Health source with markup is shown as text.
      await expect(page.getByText("<img src=x onerror=alert(1)> Watch", { exact: false })).toBeVisible();
      await capture(page, directory, "history", viewport.name);
      await page.goto(`${origin}/progress`);
      await expect(page.locator(".progress-card")).toHaveCount(5);
      await expect(page.locator('[data-lift="squat"]')).toContainText("40 kg → 60 kg");
      await noOverflow(page);
      await capture(page, directory, "progress", viewport.name);
      await page.goto(`${origin}/settings`);
      await expect(page.locator("#health")).toHaveText("Synthetic Apple Health workouts and bodyweight. Syncing is turned off here.");
      await capture(page, directory, "settings", viewport.name);
    }
  } finally {
    await worker.dispose();
  }
});
