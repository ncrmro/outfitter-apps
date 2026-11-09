import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { serveGraphql } from "@ai-outfitter/app-sdk/app-graphql";
import { confirmRecommendation, generateReport, overview, saveSettings } from "../src/server/service";
import { graphqlSchema } from "../src/server/graphql";
import { recommendations } from "../src/server/schema";
import { database, demoNow, hostDouble, identity } from "./helpers";
const config = { timezone: "America/Chicago", hour: 8, enabled: true, bindings: [{ provider: "radarr", connectionId: "radarr-one", resource: "ocean-radarr" }] };
test("persisted briefing includes provenance and explicit partial source states; graph returns same report", async () => { const { db, close } = await database(); try {
    const h = hostDouble();
    await saveSettings(db, identity, h.host, config, demoNow);
    const report = await generateReport(db, h.host, { runId: "report-one", now: demoNow });
    assert.equal(report.report.day, "2026-11-09");
    assert.equal(report.report.status, "partial");
    assert.equal(report.items.length, 1);
    assert.equal(report.items[0].reason, "A new release from your monitored movies.");
    assert.equal(report.sources.length, 6);
    assert.equal(report.sources.filter(s => s.status === "unavailable").length, 5);
    assert.equal((await overview(db)).recommendations.length, 1);
    const again = await generateReport(db, h.host, { runId: "report-one", now: demoNow });
    assert.equal(again.items.length, 1);
    const result = await serveGraphql({ schema: graphqlSchema, query: "{ dioneReports(first: 10) { nodes { id summary status } } dioneRecommendations(first:10) { nodes { title status } } }", context: { identity, db: () => db } });
    assert.equal(result.errors, undefined);
    assert.equal(((result.data as any)?.dioneReports).nodes[0].id, "report-one");
    assert.ok(!JSON.stringify(result).includes("radarr-one"));
    assert.equal(h.calls.find(c => c.name === "schedule.save")?.input.connectionBindings[0].resource, "ocean-radarr");
}
finally {
    close();
} });
test("recommendation requires explicit owner confirmation and submits once", async () => { const { db, close } = await database(); try {
    const h = hostDouble();
    await saveSettings(db, identity, h.host, config, demoNow);
    await generateReport(db, h.host, { now: demoNow });
    const [rec] = await db.select().from(recommendations);
    await assert.rejects(confirmRecommendation(db, identity, h.host, rec.id, { confirmed: false }));
    await assert.rejects(confirmRecommendation(db, { ...identity, userId: "stranger" }, h.host, rec.id, { confirmed: true }), e => e instanceof Response && e.status === 403);
    await confirmRecommendation(db, identity, h.host, rec.id, { confirmed: true });
    await assert.rejects(confirmRecommendation(db, identity, h.host, rec.id, { confirmed: true }), e => e instanceof Response && e.status === 409);
    assert.equal(h.calls.filter(c => c.name === "connector.execute" && c.input.operation === "request.search").length, 1);
    const [saved] = await db.select().from(recommendations).where(eq(recommendations.id, rec.id));
    assert.equal(saved.status, "submitted");
    assert.match(saved.receipt!, /queued/);
}
finally {
    close();
} });
test("unknown write outcome is never blindly retried", async () => { const { db, close } = await database(); try {
    const h = hostDouble({ failRequest: true });
    await saveSettings(db, identity, h.host, config, demoNow);
    await generateReport(db, h.host, { now: demoNow });
    const [rec] = await db.select().from(recommendations);
    await assert.rejects(confirmRecommendation(db, identity, h.host, rec.id, { confirmed: true }), e => e instanceof Response && e.status === 502);
    await assert.rejects(confirmRecommendation(db, identity, h.host, rec.id, { confirmed: true }), e => e instanceof Response && e.status === 409);
    assert.equal((await db.select().from(recommendations))[0].status, "unknown");
}
finally {
    close();
} });
test("inference failure preserves observed items, while a missing grant cannot be selected", async () => { const { db, close } = await database(); try {
    const h = hostDouble({ failInference: true });
    await assert.rejects(saveSettings(db, identity, h.host, { ...config, bindings: [{ provider: "radarr", connectionId: "other", resource: "other" }] }, demoNow), e => e instanceof Response && e.status === 409);
    await saveSettings(db, identity, h.host, config, demoNow);
    const result = await generateReport(db, h.host, { now: demoNow });
    assert.equal(result.items.length, 1);
    assert.match(result.report.inferenceError!, /unavailable/);
}
finally {
    close();
} });
test("source reads use strict operation inputs, retain truncation, and distinguish queue IDs", async () => { const { db, close } = await database(); try {
    const h = hostDouble();
    const original = h.host.call.bind(h.host);
    h.host.call = (async (name: string, input: any) => { if (name === "connector.execute" && input.operation !== "request.search") {
        assert.deepEqual(Object.keys(input.input).sort(), input.operation === "briefing.read" ? ["end", "limit", "start"] : ["limit"]);
        return { items: [{ id: "42", title: input.operation === "queue.list" ? "Queued media" : "Calendar media", kind: input.operation === "queue.list" ? "download" : "movie", date: null, detail: "Fixture", url: null }], cursor: null, truncated: input.operation === "briefing.read" };
    } return original(name as any, input); }) as any;
    await saveSettings(db, identity, h.host, config, demoNow);
    const result = await generateReport(db, h.host, { now: demoNow });
    assert.equal(result.items.length, 2);
    assert.equal(result.sources.find(s => s.source === "radarr")?.truncated, true);
}
finally {
    close();
} });
test("a failed final workflow receipt can be retried without marking the report finished prematurely", async () => { const { db, close } = await database(); try {
    const h = hostDouble();
    await saveSettings(db, identity, h.host, config, demoNow);
    const original = h.host.call.bind(h.host);
    let fail = true;
    h.host.call = (async (name: string, input: any) => { if (name === "workflow.collect" && input.slot === "rank.outputs.briefing" && fail) {
        fail = false;
        throw Error("temporary workflow failure");
    } return original(name as any, input); }) as any;
    await assert.rejects(generateReport(db, h.host, { runId: "retry-report", now: demoNow }));
    assert.equal((await overview(db)).latest?.completedAt, null);
    const done = await generateReport(db, h.host, { runId: "retry-report", now: demoNow });
    assert.equal(done.report.completedAt, demoNow);
    assert.equal(done.items.length, 1);
}
finally {
    close();
} });
test("a report reconciles a completed workflow without repeating inference after a lost local marker", async () => { const { db, close } = await database(); try {
    const h = hostDouble();
    await saveSettings(db, identity, h.host, config, demoNow);
    await generateReport(db, h.host, { runId: "marker-report", now: demoNow });
    const { reports } = await import("../src/server/schema");
    await db.update(reports).set({ completedAt: null }).where(eq(reports.id, "marker-report"));
    const count = h.calls.filter(c => c.name === "inference.generate").length;
    const done = await generateReport(db, h.host, { runId: "marker-report", now: demoNow });
    assert.equal(done.report.completedAt, demoNow);
    assert.equal(h.calls.filter(c => c.name === "inference.generate").length, count);
}
finally {
    close();
} });
