import assert from "node:assert/strict";
import test from "node:test";
import type { InValue } from "@libsql/client";
import { serveGraphql } from "@ai-outfitter/app-sdk/app-graphql";
import type { AppActor, AppIdentity } from "@ai-outfitter/app-sdk/server";
import type { BatchDatabase, Statement } from "@ai-outfitter/app-sdk/proposal-store";
import { initializeDione, parseOperatorCapture, prepareOperatorCapture } from "../src/server/initialization";
import { loadSettings, overview, readReport } from "../src/server/service";
import { graphqlSchema } from "../src/server/graphql";
import { items, recommendations, reports, settings } from "../src/server/schema";
import { database, demoNow, identity } from "./helpers";

const actor: AppActor = { kind: "platform", id: "deployment-key:local-operator" };
const operator: AppIdentity = { ...identity, userId: actor.id, role: "admin", access: "admin" };
const binding = { provider: "radarr", connectionId: "11111111-1111-4111-8111-111111111111", resource: "ocean-radarr" };
const configuration = { timezone: "America/Chicago", hour: 8, enabled: false as const, bindings: [binding], arrMcpBinding: null };
const rejected = (status = 400) => (error: unknown) => error instanceof Response && error.status === status;
function rawCapture(now = demoNow) {
  const observedAt = new Date(now).toISOString();
  return {
    connectorRevision: "a".repeat(40), platformRevision: "b".repeat(40), observedAt,
    providerWrites: false, executionMode: "explicit-read-only-operator-baseline",
    reads: [
      { provider: "radarr", operation: "status.get", input: {}, observedAt, durationMs: 20, status: "ok", result: { connected: true, version: "6.0" } },
      { provider: "radarr", operation: "briefing.read", input: { start: new Date(now - 86400000).toISOString(), end: new Date(now + 7 * 86400000).toISOString(), limit: 100 }, observedAt, durationMs: 25, status: "ok", result: { items: [{ id: "42", title: "Fictional Moonrise", kind: "movie", date: new Date(now + 86400000).toISOString(), detail: "Monitored; not in library", url: "https://radarr.example/movie/42?apikey=not-a-real-key", request: { operation: "request.search", input: { id: 42 } } }], cursor: null, truncated: false } },
      { provider: "radarr", operation: "queue.list", input: { limit: 100 }, observedAt, durationMs: 12, status: "ok", result: { items: [{ id: "queue:7", title: "Fictional Ocean Atlas", kind: "download", date: null, detail: "Downloading · 62%", url: "https://radarr.example/activity" }], cursor: null, truncated: false } },
    ],
  };
}
function adapter(client: Awaited<ReturnType<typeof database>>["client"], fail = false): BatchDatabase {
  return {
    query: async statement => (await client.execute({ sql: statement.sql, args: (statement.params ?? []) as InValue[] })).rows as Record<string, unknown>[],
    batch: async statements => {
      const input: Statement[] = [...statements, ...(fail ? [{ sql: "INSERT INTO missing_import_test_table(value) VALUES(1)" }] : [])];
      await client.batch(input.map(statement => ({ sql: statement.sql, args: (statement.params ?? []) as InValue[] })), "write");
    },
  };
}

test("private initialization materializes source facts and provenance without workflows, recommendations or a human session", async () => {
  const h = await database();
  try {
    const input = await prepareOperatorCapture(rawCapture(), "owner", configuration, demoNow);
    assert.ok(!JSON.stringify(input).includes("apikey"));
    assert.ok(!JSON.stringify(input).includes("request.search"));
    assert.ok(!JSON.stringify(input).includes("https://"));
    const result = await initializeDione(h.db, adapter(h.client), operator, actor, input, demoNow + 1000);
    assert.equal(result.imported, true);
    const report = await readReport(h.db, result.reportId!);
    assert.equal(report.report.origin, "operator-capture");
    assert.equal(report.report.capturedAt, demoNow);
    assert.equal(report.report.generatedAt, demoNow);
    assert.equal(report.report.operatorActor, actor.id);
    assert.equal(report.report.captureDigest, input.digest);
    assert.equal(report.sections.upcoming[0].title, "Fictional Moonrise");
    assert.equal(report.sections.attention[0].title, "Fictional Ocean Atlas");
    assert.equal(report.sources.length, 6);
    assert.equal(report.sources.find(source => source.source === "radarr")?.status, "ok");
    assert.deepEqual(await h.db.select().from(recommendations), []);
    assert.equal((await loadSettings(h.db)).enabled, false);
    const graph = await serveGraphql({ schema: graphqlSchema, query: "{ dioneReports(first:10) { nodes { origin capturedAt } } }", context: { identity, db: () => h.db } });
    assert.equal(graph.errors, undefined);
    assert.equal((graph.data as any).dioneReports.nodes[0].origin, "operator-capture");
    assert.equal((graph.data as any).dioneReports.nodes[0].capturedAt, new Date(demoNow).toISOString());
    const replay = await initializeDione(h.db, adapter(h.client), operator, actor, input, demoNow + 60000);
    assert.equal(replay.imported, false);
    assert.equal((await h.db.select().from(reports)).length, 1);
    assert.equal((await h.db.select().from(items)).length, 2);
  } finally { h.close(); }
});

test("initializer requires a distinct platform administrator and an explicit matching personal owner", async () => {
  const h = await database();
  try {
    const input = await prepareOperatorCapture(rawCapture(), "owner", configuration, demoNow);
    await assert.rejects(initializeDione(h.db, adapter(h.client), identity, { kind: "member", id: "owner" }, input, demoNow), rejected(403));
    await assert.rejects(initializeDione(h.db, adapter(h.client), operator, { ...actor, id: "another-key" }, input, demoNow), rejected(403));
    await assert.rejects(initializeDione(h.db, adapter(h.client), { ...operator, access: "write" }, actor, input, demoNow), rejected(403));
    await assert.rejects(initializeDione(h.db, adapter(h.client), { ...operator, userId: "owner" }, { kind: "platform", id: "owner" }, input, demoNow), rejected(403));
    await assert.rejects(initializeDione(h.db, adapter(h.client), { ...operator, owner: { kind: "organization", id: "org" } }, actor, input, demoNow), rejected(403));
    const foreign = await prepareOperatorCapture(rawCapture(), "other-owner", configuration, demoNow);
    await assert.rejects(initializeDione(h.db, adapter(h.client), operator, actor, foreign, demoNow), rejected(403));
    assert.deepEqual(await h.db.select().from(reports), []);
  } finally { h.close(); }
});

test("default setup is unconfigured without creating data; imported settings never overwrite owner state or later live reports", async () => {
  const h = await database();
  try {
    assert.deepEqual(await initializeDione(h.db, adapter(h.client), operator, actor, {}, demoNow), { status: "unconfigured" });
    assert.deepEqual(await h.db.select().from(settings), []);
    await h.db.insert(settings).values({ id: "default", timezone: "UTC", hour: 15, enabled: true, bindings: JSON.stringify([binding]), updatedAt: demoNow + 3600000 });
    await h.db.insert(reports).values({ id: "owner-live-report", day: "2026-11-09", status: "complete", origin: "workflow", timezone: "UTC", generatedAt: demoNow + 3600000, completedAt: demoNow + 3600001 });
    const input = await prepareOperatorCapture(rawCapture(), "owner", configuration, demoNow);
    await initializeDione(h.db, adapter(h.client), operator, actor, input, demoNow + 7200000);
    const config = await loadSettings(h.db);
    assert.equal(config.timezone, "UTC");
    assert.equal(config.hour, 15);
    assert.equal(config.enabled, true);
    assert.equal((await overview(h.db)).latest?.id, "owner-live-report");
    assert.deepEqual(await initializeDione(h.db, adapter(h.client), operator, actor, {}, demoNow), { status: "ready" });
  } finally { h.close(); }
});

test("an import batch failure leaves no partial report, data or settings and can be retried", async () => {
  const h = await database();
  try {
    const input = await prepareOperatorCapture(rawCapture(), "owner", configuration, demoNow);
    await assert.rejects(initializeDione(h.db, adapter(h.client, true), operator, actor, input, demoNow));
    assert.deepEqual(await h.db.select().from(reports), []);
    assert.deepEqual(await h.db.select().from(items), []);
    assert.deepEqual(await h.db.select().from(settings), []);
    assert.equal((await initializeDione(h.db, adapter(h.client), operator, actor, input, demoNow)).imported, true);
  } finally { h.close(); }
});

test("capture schemas reject stale/future reads, tampered digests, writes, fake bindings, arbitrary URLs and credential text", async () => {
  const input = await prepareOperatorCapture(rawCapture(), "owner", configuration, demoNow);
  await assert.rejects(parseOperatorCapture(input, demoNow + 86400001), rejected());
  await assert.rejects(prepareOperatorCapture(rawCapture(demoNow + 300001), "owner", configuration, demoNow), rejected());
  await assert.rejects(parseOperatorCapture({ ...input, ownerId: "other" }, demoNow), rejected());
  await assert.rejects(prepareOperatorCapture({ ...rawCapture(), providerWrites: true }, "owner", configuration, demoNow), rejected());
  await assert.rejects(prepareOperatorCapture(rawCapture(), "owner", { ...configuration, bindings: [{ ...binding, connectionId: "baseline-radarr" }] }, demoNow), rejected());
  const write = rawCapture(); write.reads[1].operation = "request.search";
  await assert.rejects(prepareOperatorCapture(write, "owner", configuration, demoNow), rejected());
  const credential = structuredClone(input); (credential.capture.reads[1] as any).result.items[0].detail = "api_key=private-value";
  await assert.rejects(parseOperatorCapture(credential, demoNow), rejected());
  const url = structuredClone(input); (url.capture.reads[1] as any).result.items[0].url = "https://arbitrary.example";
  await assert.rejects(parseOperatorCapture(url, demoNow), rejected());
  const invalidKind = rawCapture(); (invalidKind.reads[1].result as any).items[0].kind = "library";
  await assert.rejects(prepareOperatorCapture(invalidKind, "owner", configuration, demoNow), rejected());
});

test("limited pagination remains partial and supplementary diagnostics cannot generate recommendations", async () => {
  const h = await database();
  try {
    const raw = rawCapture(); (raw.reads[1].result as any).cursor = "next";
    (raw.reads[1].result as any).truncated = true;
    const input = await prepareOperatorCapture(raw, "owner", configuration, demoNow);
    const result = await initializeDione(h.db, adapter(h.client), operator, actor, input, demoNow);
    const report = await readReport(h.db, result.reportId!);
    assert.equal(report.sources.find(source => source.source === "radarr")?.status, "partial");
    assert.equal(report.sources.find(source => source.source === "radarr")?.truncated, true);
    assert.deepEqual(await h.db.select().from(recommendations), []);
  } finally { h.close(); }
});
