import { expectClientNavigation, fulfillFrom, routeReadOnly } from "@ai-outfitter/app-test/playwright";
import { appArtifact } from "@ai-outfitter/app-test/prepare";
import { appWorker } from "@ai-outfitter/app-test/worker";
import { type Page, test } from "@playwright/test";
import { healthRecords, hostDouble, scope } from "./helpers/fixtures";

const origin = "https://yoga-practice.example";
const package_ = new URL("..", import.meta.url);
const links = ["Practice", "Progress", "Settings"];
/** Each page's data has loaded; with `hint`, Practice also shows the import hint. */
const settle = (page: Page, hint = false) => () => page.waitForFunction((hint) => {
  if (document.getElementById("sessions"))
    return document.querySelector("#sessions li, #sessions-empty:not([hidden])") && (!hint || document.querySelector("#health-hint:not([hidden])"));
  return document.querySelector("#by-style li") || /^(?!Checking)./.test(document.getElementById("health")?.textContent ?? "");
}, hint);

test("sidebar links swap pages inside the app shell", async ({ page }) => {
  test.setTimeout(120_000);
  const app = await appWorker("yoga-practice", appArtifact(package_, "demo"));
  try {
    await routeReadOnly(page, origin, app);
    await expectClientNavigation(page, `${origin}/`, links, settle(page));
  } finally {
    await app.dispose();
  }
});

// The header's sync script shows Practice's import hint, on every visit to it.
test("the import hint comes back with Practice", async ({ page }) => {
  test.setTimeout(120_000);
  const double = hostDouble(healthRecords(Date.now()), { connected: false });
  const app = await appWorker("yoga-practice", appArtifact(package_, "operational"), "yoga", { workflowHost: double.host });
  const member = { userId: "member-1", organizationId: "", role: "owner", owner: { kind: "user" as const, id: "member-1" } };
  try {
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const body = request.postData();
      await fulfillFrom(route, await app.call(url.pathname + url.search, member, {
        method: request.method(),
        body: body ? JSON.parse(body) : undefined,
        headers: { Accept: request.headers().accept ?? "*/*" },
        workflowHost: scope(request.method()),
      }));
    });
    await expectClientNavigation(page, `${origin}/`, links, settle(page, true));
  } finally {
    await app.dispose();
  }
});
