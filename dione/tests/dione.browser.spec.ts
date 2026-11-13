import { expect, test } from "@playwright/test";
import { appArtifact } from "@ai-outfitter/app-test/prepare";
import { appWorker } from "@ai-outfitter/app-test/worker";
import { expectClientNavigation, fulfillFrom } from "@ai-outfitter/app-test/playwright";
import { readFileSync } from "node:fs";
const fixtures = JSON.parse(readFileSync(new URL("../fixtures/demo.json", import.meta.url), "utf8"));
import type { overview } from "../src/server/service";
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
            await expect(page.getByRole("heading", { name: "Upcoming releases", exact: true })).toBeVisible();
            await expect(page.getByRole("heading", { name: "Recent library additions", exact: true })).toBeVisible();
            await expect(page.getByRole("heading", { name: "Needs attention", exact: true })).toBeVisible();
            await expect(page.locator("#upcoming-items > li")).toHaveCount(9);
            await expect(page.locator("#library-items > li")).toHaveCount(5);
            await expect(page.locator("#attention-items > li")).toHaveCount(10);
            await expect(page.locator("#items")).toHaveCount(0);
            await expect(page.locator("#upcoming-items > li").first()).toContainText("Paper Satellites — Soft Geometry");
            await expect(page.locator("#library-items > li").first()).toContainText("A Sunday in October");
            await expect(page.locator("#attention-items")).not.toContainText("Public-domain short film collection");
            await expect(page.locator("#attention-items")).not.toContainText("The Archive Room · S01E02");
            await expect(page.locator("#sources > li")).toHaveCount(6);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            await page.screenshot({path:testInfo.outputPath(viewport.width > 1000 ? "desktop.png" : "mobile.png"),fullPage:true});
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
        await expectClientNavigation(page, origin, ["Today", "History", "Recommendations", "Settings"], () => expect(page.locator("#notice")).toContainText("Synthetic demo"));
        await page.goto(`${origin}/history`);
        await expect(page.locator("#history > li")).toHaveCount(7);
        await page.getByRole("button", {name: "2026-11-09 · partial", exact: true}).click();
        await expect(page.locator("#briefing")).toContainText("2026-11-09 · partial");
        await expect(page.getByRole("button", {name: "2026-11-09 · partial", exact: true})).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator("#attention-items > li")).toHaveCount(8);
        await expect(page.locator("#source-attention")).toContainText("SABnzbd is unavailable");
        await expect(page.locator("#sources")).not.toBeVisible();
        await page.locator("#source-freshness summary").click();
        await expect(page.locator("#sources")).toContainText("SABnzbd: unavailable");
        await page.screenshot({path:testInfo.outputPath("history.png"),fullPage:true});
        await page.getByRole("button", {name: "2026-11-10 · complete", exact: true}).click();
        await expect(page.locator("#briefing")).toContainText("2026-11-10 · complete");
        await expect(page.locator("#source-attention > li")).toHaveCount(0);
        await expect(page.locator("#attention-items > li")).toHaveCount(10);
        await page.goto(`${origin}/recommendations`);
        await expect(page.locator("#recommendations > li")).toHaveCount(9);
        await expect(page.locator("#recommendations")).toContainText("submitted");
        await expect(page.locator("#recommendations")).toContainText("unknown");
        for (const button of await page.getByRole("button", {name: "Review request"}).all()) await expect(button).toBeDisabled();
        await page.screenshot({path:testInfo.outputPath("recommendations.png"),fullPage:true});
        await page.goto(`${origin}/settings`);
        await expect(page.getByRole("heading",{name:"Settings",exact:true})).toBeVisible();
        await expect(page.locator("#arr-mcp")).toHaveValue(/demo-arr-mcp/);
        await expect(page.locator("#schedule-health")).toContainText("Last outcome: complete");
        await page.screenshot({path:testInfo.outputPath("settings.png"),fullPage:true,animations:"disabled"});
        expect(errors).toEqual([]);
    }
    finally {
        await worker.dispose();
    }
});

test("empty lists remain distinct from an unavailable source", async ({ page }) => {
    test.setTimeout(120000);
    const worker = await appWorker("dione", appArtifact(new URL("..", import.meta.url), "operational"));
    const empty = structuredClone(fixtures.overview) as unknown as Awaited<ReturnType<typeof overview>>;
    empty.items = [];
    empty.sections = { upcoming: [], library: [], attention: [] };
    empty.latest = { ...empty.latest!, status: "partial", summary: "No media items returned; one source could not be checked." };
    empty.sources = empty.sources.map(source => ({ ...source, count: 0, status: source.source === "radarr" ? "unavailable" : "ok", error: source.source === "radarr" ? "Source unavailable or access revoked" : null }));
    await page.route(`${origin}/**`, async route => {
        const path = new URL(route.request().url()).pathname;
        expect(route.request().method()).toBe("GET");
        if (path === "/api/apps/dione/overview") return route.fulfill({ json: empty });
        expect(path.startsWith("/api/")).toBe(false);
        await fulfillFrom(route, await worker.fetch(route.request().url()));
    });
    try {
        await page.goto(origin);
        await expect(page.locator("#upcoming-empty")).toContainText("No upcoming releases were returned");
        await expect(page.locator("#library-empty")).toContainText("No recent library additions were returned");
        await expect(page.locator("#attention-empty")).toContainText("No missing media or active download items were returned");
        await expect(page.locator("#source-attention")).toContainText("Radarr is unavailable; its media could not be checked");
        await expect(page.locator("#source-attention")).toBeVisible();
        await expect(page.locator("#sources")).not.toBeVisible();
    } finally { await worker.dispose(); }
});

test("agent sidebar hydrates under CSP and the demo replies without a provider or platform request", async ({ page }, testInfo) => {
    test.setTimeout(120000);
    const worker = await appWorker("dione", appArtifact(new URL("..", import.meta.url), "demo"));
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route(`${origin}/**`, async route => {
        expect(route.request().method()).toBe("GET");
        expect(new URL(route.request().url()).pathname.startsWith("/api/")).toBe(false);
        await fulfillFrom(route, await worker.fetch(route.request().url()));
    });
    try {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(origin);
        await page.getByRole("button", { name: "Ask Dione", exact: true }).click();
        await page.getByPlaceholder("Ask Dione…").fill("What is downloading?");
        await page.getByRole("button", { name: "Send to Dione", exact: true }).click();
        await expect(page.locator("#dione-agent")).toContainText("This is a scripted example.");
        await expect(page.locator("#dione-agent")).toContainText("a real installation reads your approved connections");
        await page.screenshot({ path: testInfo.outputPath("agent-desktop.png"), fullPage: true, animations: "disabled" });
        await page.getByRole("button", { name: "Close Dione chat", exact: true }).click();
        await page.getByRole("link", { name: "Settings", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Ask Dione", exact: true }).click();
        await expect(page.getByPlaceholder("Ask Dione…")).toBeVisible();
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(page.getByPlaceholder("Ask Dione…")).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath("agent-mobile.png"), fullPage: true, animations: "disabled" });
        expect(errors).toEqual([]);
    } finally { await worker.dispose(); }
});

test("mounted operational sidebar keeps context, threads and owner approval inside its CSP scope", async ({ page }) => {
    test.setTimeout(120000);
    const mount = "/apps/dione";
    const apiRequests: string[] = [];
    const { movieHarness } = await import("./movies.fixture");
    const h = await movieHarness();
    const worker = await appWorker("dione", appArtifact(new URL("..", import.meta.url), "operational"));
    const proposed = await h.propose();
    const entry = { id: crypto.randomUUID(), thread: { id: h.thread.id }, role: "assistant", parts: proposed.parts, status: "complete", submissionId: "turn", sourceKey: null, attribution: { actor: h.context.actor, origin: h.context.originActor, userId: "owner", installationId: "dione-test" }, metadata: null, createdAt: Date.now(), recordedAt: null };
    let approvalCalls = 0;
    await page.route(`${origin}/**`, async route => {
        const request = route.request(); const url = new URL(request.url());
        if (url.pathname.includes("/api/")) { expect(url.pathname.startsWith(`${mount}/api/`)).toBe(true); apiRequests.push(url.pathname); }
        const path = url.pathname.startsWith(mount + "/") ? url.pathname.slice(mount.length) : url.pathname;
        if (path.startsWith("/api/apps/dione/agent/")) {
            const operation = path.slice("/api/apps/dione/agent/".length);
            if (operation.endsWith("/approve")) approvalCalls++;
            try { return route.fulfill({ json: await h.agent.browser(new Request(request.url(), { method: request.method(), headers: { "Content-Type": "application/json" }, ...(request.postData() ? { body: request.postData() } : {}) }), operation) }); }
            catch (error) { if (error instanceof Response) return fulfillFrom(route, error); throw error; }
        }
        if (path === "/api/platform/threads") return route.fulfill({ json: { thread: h.thread, entries: [entry], before: null } });
        if (path === `/api/platform/threads/${h.thread.id}/entries`) return route.fulfill({ json: { entries: [entry], before: null, after: null } });
        if (path === "/api/apps/dione/overview") return route.fulfill({ json: fixtures.overview });
        expect(path.startsWith("/api/")).toBe(false);
        url.pathname = path;
        const response = await worker.fetch(url.toString());
        if (response.headers.get("content-type")?.includes("text/html")) return route.fulfill({ status: response.status, headers: { ...Object.fromEntries(response.headers), "Content-Security-Policy": `default-src 'self'; connect-src ${origin}${mount}/; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;` }, body: await response.text() });
        await fulfillFrom(route, response);
    });
    try {
        await page.goto(`${origin}${mount}/`);
        await page.getByRole("button", { name: "Ask Dione", exact: true }).click();
        const review = page.getByRole("region", { name: "Review proposed change" });
        await expect(review).toBeVisible();
        await expect(review.getByLabel("Movie title", { exact: true })).toHaveValue("Fictional Moonrise");
        await expect(review.getByLabel("Release year", { exact: true })).toHaveValue("2026");
        await expect(review.getByLabel("TMDb ID", { exact: true })).toHaveValue("42");
        await expect(review.getByLabel("Quality profile", { exact: true })).toHaveValue("HD fictional profile");
        await expect(review.getByLabel("Root folder", { exact: true })).toHaveValue("/movies");
        await expect(review.getByLabel("Confirm operation", { exact: true })).toHaveValue("Add and search");
        expect(h.state.writes).toBe(0);
        await review.getByRole("button", { name: "Approve changes", exact: true }).click();
        await expect(review).toContainText("Approved changes saved.");
        expect(h.state.writes).toBe(1); expect(approvalCalls).toBe(1);
        expect(apiRequests.some(path => path.startsWith(`${mount}/api/apps/dione/agent/context`))).toBe(true);
        expect(apiRequests).toContain(`${mount}/api/platform/threads`);
        expect(apiRequests.some(path => path.endsWith("/approve"))).toBe(true);
        await expect(review.getByRole("button", { name: "Approve changes", exact: true })).toHaveCount(0);
    } finally { h.close(); await worker.dispose(); }
});
