import { expect, test } from "@playwright/test";
import { appArtifact } from "@ai-outfitter/app-test/prepare";
import { appWorker } from "@ai-outfitter/app-test/worker";
import { expectClientNavigation, fulfillFrom } from "@ai-outfitter/app-test/playwright";
const origin = "https://dione.example";
test("synthetic briefing is readable on desktop and mobile and survives client navigation", async ({ page }, testInfo) => {
    test.setTimeout(120000);
    const worker = await appWorker("dione", appArtifact(new URL("..", import.meta.url), "demo"));
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.route(`${origin}/**`, async (route) => { expect(route.request().method()).toBe("GET"); expect(new URL(route.request().url()).pathname.startsWith("/api/")).toBe(false); await fulfillFrom(route, await worker.fetch(route.request().url())); });
    try {
        for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
            await page.setViewportSize(viewport);
            await page.goto(origin);
            await expect(page.getByRole("heading", { name: "Today’s briefing", exact: true })).toBeVisible();
            await expect(page.getByText("Synthetic Moonrise", { exact: true })).toBeVisible();
            await expect(page.getByRole("button", { name: "Refresh briefing" })).toBeDisabled();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            await page.screenshot({path:testInfo.outputPath(viewport.width > 1000 ? "desktop.png" : "mobile.png"),fullPage:true});
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
        await expectClientNavigation(page, origin, ["Today", "History", "Recommendations", "Settings"], () => expect(page.locator("#notice")).toContainText("Synthetic demo"));
        await page.goto(`${origin}/settings`);
        await expect(page.getByRole("heading",{name:"Settings",exact:true})).toBeVisible();
        await page.screenshot({path:testInfo.outputPath("settings.png"),fullPage:true,animations:"disabled"});
        expect(errors).toEqual([]);
    }
    finally {
        await worker.dispose();
    }
});
