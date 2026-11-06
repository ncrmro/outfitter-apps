import { expectClientNavigation, routeReadOnly } from "@ai-outfitter/app-test/playwright";
import { appArtifact } from "@ai-outfitter/app-test/prepare";
import { appWorker } from "@ai-outfitter/app-test/worker";
import { test } from "@playwright/test";

const origin = "https://strength-five.alpha.localhost";

test("sidebar links swap pages inside the app shell", async ({ page }) => {
  test.setTimeout(120_000);
  const app = await appWorker("strength-five", appArtifact(new URL("..", import.meta.url), "demo"));
  try {
    await routeReadOnly(page, origin, app);
    await expectClientNavigation(page, `${origin}/`, ["Today", "History", "Progress", "Settings"],
      () => page.waitForFunction(() => document.querySelector("#lifts li, #sessions li, #progress li")
        || /^(?!Checking)./.test(document.querySelector("#health")?.textContent ?? "")));
  } finally {
    await app.dispose();
  }
});
