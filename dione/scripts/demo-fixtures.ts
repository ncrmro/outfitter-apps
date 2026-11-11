import { writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { database, identity } from "../tests/helpers";
import { confirmRecommendation, generateReport, overview, readReport, saveSettings } from "../src/server/service";
import { recommendations } from "../src/server/schema";
import { demoBindings, demoHost, demoStack } from "./demo-catalog";
const demoNow = Date.parse("2026-11-11T14:00:00Z");
const { db, close } = await database();
try {
    const latest = demoHost(demoNow);
    await saveSettings(db, identity, latest.host, { timezone: "America/Chicago", hour: 8, enabled: true, bindings: demoBindings, arrMcpBinding: demoStack }, demoNow);
    const history: Record<string, Awaited<ReturnType<typeof readReport>>> = {};
    for (let daysAgo = 6; daysAgo >= 0; daysAgo--) {
        const now = demoNow - daysAgo * 86400000;
        const {host} = demoHost(now, daysAgo === 2 ? "sabnzbd" : undefined);
        const id = daysAgo === 0 ? "demo-report" : `demo-report-${daysAgo}`;
        history[id] = await generateReport(db, host, {runId: id, now});
    }
    // Exercise real application transitions against a fake provider, including an
    // interrupted receipt. Export stable IDs so rebuilding fixtures has no churn.
    for (const recommendation of await db.select().from(recommendations)) {
        const id = `demo-rec-${recommendation.source}-${recommendation.sourceId}`;
        await db.update(recommendations).set({id}).where(eq(recommendations.id, recommendation.id));
        if ((recommendation.source === "radarr" && recommendation.sourceId === "1") || (recommendation.source === "lidarr" && recommendation.sourceId === "1") || (recommendation.source === "sonarr" && recommendation.sourceId === "5")) {
            try { await confirmRecommendation(db, identity, latest.host, id, {confirmed: true}, demoNow); }
            catch (error) { if (!(error instanceof Response && error.status === 502)) throw error; }
            await db.update(recommendations).set({updatedAt: demoNow}).where(eq(recommendations.id, id));
        }
    }
    const all = await overview(db);
    await writeFile(new URL("../fixtures/demo.json", import.meta.url), JSON.stringify({
        description: "Synthetic fixture; all titles, activity, provider receipts and connections are fictional. No live service data or credentials.",
        overview: all, report: history["demo-report"], reports: history,
        settings: {settings: all.settings, connections: latest.snapshot.filter(c => c.provider !== "arr-mcp").map(c => ({provider: c.provider, connectionId: c.id, resource: c.resource, operations: c.operations})), stackConnections: [demoStack], schedules: [{workflowId: "dione-briefing", enabled: true, nextRunAt: demoNow + 86400000, lastOutcome: "complete"}]},
    }, null, 2) + "\n");
} finally { close(); }
