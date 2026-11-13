import assert from "node:assert/strict";
import test from "node:test";
import { ProposalStore } from "@ai-outfitter/app-sdk/proposal-store";
import type { InValue } from "@libsql/client";
import type { Thread, ThreadEntry } from "@ai-outfitter/app-sdk/threads";
import { agentReads, mediaReadInput, readMedia, readStack, stackReadInput } from "../src/server/agent-reads";
import { createDioneAgent, focusId } from "../src/server/agent";
import type { DioneContext } from "../src/server/agent-context";
import { settings } from "../src/server/schema";
import { loadSettings, saveSettings } from "../src/server/service";
import { database, demoNow, identity, hostDouble } from "./helpers";

async function setup() {
  const databaseHandle = await database();
  await databaseHandle.db.insert(settings).values({ id: "default", timezone: "America/Chicago", hour: 8, enabled: false, bindings: JSON.stringify([{ provider: "radarr", connectionId: "approved-radarr", resource: "ocean-radarr" }]), updatedAt: demoNow });
  const calls: Array<{ name: string; input: any }> = [];
  let approved = true;
  let fail = false;
  let value: unknown = { items: [{ id: "movie:42", title: "A movie", kind: "movie", date: null, detail: "In the library", url: "https://radarr.example/movie/42", request: { operation: "request.search", input: { id: 42 } } }], cursor: "next-page", truncated: false };
  const context: DioneContext = {
    identity, actor: { kind: "member", id: identity.userId }, originActor: { kind: "member", id: identity.userId }, db: () => databaseHandle.db,
    host: () => ({ call: async (name: string, input: any) => {
      calls.push({ name, input });
      if (name === "snapshot") return { connections: approved ? [{ id: "approved-radarr", provider: "radarr", resource: "ocean-radarr", operations: ["library.list", "status.get", "calendar.list"] }] : [] };
      assert.equal(name, "connector.execute");
      if (fail) throw Error("private-provider-key must not appear");
      return value;
    } }) as ReturnType<DioneContext["host"]>,
  };
  return { ...databaseHandle, context, calls, revoke: () => { approved = false; }, fail: () => { fail = true; }, value: (next: unknown) => { value = next; } };
}

test("sidebar reads only the saved approved binding and rechecks a revoked grant on the next call", async () => {
  const h = await setup();
  try {
    const input = mediaReadInput.parse({ provider: "radarr", view: "library" });
    const result = await readMedia(h.context, input, demoNow);
    assert.equal(result.status, "ok");
    assert.equal(result.observedAt, new Date(demoNow).toISOString());
    assert.deepEqual(h.calls[1], { name: "connector.execute", input: { connectionId: "approved-radarr", resource: "ocean-radarr", operation: "library.list", input: { limit: 10 } } });
    assert.ok(!JSON.stringify(result).includes("request.search"));
    assert.ok(!JSON.stringify(result).includes("approved-radarr"));
    h.revoke();
    assert.equal((await readMedia(h.context, input, demoNow)).status, "access-unavailable");
    assert.equal(h.calls.filter(c => c.name === "connector.execute").length, 1);
  } finally { h.close(); }
});

test("sidebar cannot select arbitrary connections, issue writes, or act for another owner", async () => {
  const h = await setup();
  try {
    assert.equal(mediaReadInput.safeParse({ provider: "radarr", view: "request.search" }).success, false);
    assert.equal(mediaReadInput.safeParse({ provider: "radarr", view: "library", connectionId: "other" }).success, false);
    await assert.rejects(agentReads["media.read"].invoke({ ...h.context, identity: { ...identity, userId: "other" } }, { provider: "radarr", view: "library" }), e => e instanceof Response && e.status === 403);
    assert.equal(h.calls.length, 0);
    assert.equal(agentReads["media.read"].access, "read");
    assert.equal(agentReads["media.read"].mcpTool, "dione_media_read");
  } finally { h.close(); }
});

test("missing connections, unsupported views and provider failures stay explicit and do not leak private errors", async () => {
  const h = await setup();
  try {
    assert.equal((await readMedia(h.context, mediaReadInput.parse({ provider: "transmission", view: "queue" }))).status, "not-connected");
    assert.equal((await readMedia(h.context, mediaReadInput.parse({ provider: "jellyfin", view: "queue" }))).status, "not-supported");
    assert.equal(h.calls.length, 0);
    h.fail();
    const result = await readMedia(h.context, mediaReadInput.parse({ provider: "radarr", view: "library" }));
    assert.equal(result.status, "unavailable");
    assert.ok(!JSON.stringify(result).includes("private-provider-key"));
  } finally { h.close(); }
});

test("calendar defaults use the trusted observation time and provider status is reduced to bounded public fields", async () => {
  const h = await setup();
  try {
    await readMedia(h.context, mediaReadInput.parse({ provider: "radarr", view: "calendar" }), demoNow);
    const request = h.calls[1].input.input;
    assert.equal(request.start, new Date(demoNow - 24 * 3600000).toISOString());
    assert.equal(request.end, new Date(demoNow + 7 * 24 * 3600000).toISOString());
    h.value({ connected: true, version: "6.0", secret: "provider-key" });
    const result = await readMedia(h.context, mediaReadInput.parse({ provider: "radarr", view: "status" }), demoNow);
    assert.deepEqual(result, { provider: "radarr", view: "status", observedAt: new Date(demoNow).toISOString(), status: "ok", connected: true, version: "6.0" });
    assert.deepEqual(h.calls[3].input.input, {});
  } finally { h.close(); }
});

test("large provider pages remain bounded and explicitly partial", async () => {
  const h = await setup();
  try {
    h.value({ items: Array.from({ length: 20 }, (_, id) => ({ id: String(id), title: "💿".repeat(150), kind: "movie", date: null, detail: "💿".repeat(250), url: null })), cursor: "next", truncated: false });
    const result = await readMedia(h.context, mediaReadInput.parse({ provider: "radarr", view: "library", limit: 20 }));
    assert.ok(new TextEncoder().encode(JSON.stringify(result)).byteLength <= 24000);
    assert.equal("truncated" in result && result.truncated, true);
  } finally { h.close(); }
});

test("an MCP-only installation reads the approved stack while rejected tools never reach the connector", async () => {
  const h = await setup();
  try {
    await h.db.update(settings).set({ bindings: "[]", arrMcpBinding: JSON.stringify({ connectionId: "media-mcp", resource: "ocean-media" }) });
    let allowed = true;
    h.context.host = () => ({ call: async (name: string, input: any) => {
      h.calls.push({ name, input });
      if (name === "snapshot") return { connections: allowed ? [{ id: "media-mcp", provider: "arr-mcp", resource: "ocean-media", operations: ["read.call"] }] : [] };
      assert.equal(name, "connector.execute");
      return { tool: input.input.tool, observedAt: new Date(demoNow).toISOString(), data: { service: "radarr", title: "A movie" }, untrusted: true };
    } }) as ReturnType<DioneContext["host"]>;
    const input = stackReadInput.parse({ tool: "search_media", arguments: { query: "A movie", service: "radarr" } });
    assert.equal((await readStack(h.context, input, demoNow)).status, "ok");
    assert.deepEqual(h.calls[1].input, { connectionId: "media-mcp", resource: "ocean-media", operation: "read.call", input });
    allowed = false;
    assert.equal((await readStack(h.context, input)).status, "access-unavailable");
    assert.equal(h.calls.filter(c => c.name === "connector.execute").length, 1);
    assert.equal(stackReadInput.safeParse({ tool: "add_media", arguments: {} }).success, false);
    assert.equal(stackReadInput.safeParse({ tool: "get_stack_health", arguments: {}, url: "https://other.example" }).success, false);
  } finally { h.close(); }
});

test("MCP settings persist only a currently approved resource and do not require direct briefing connections", async () => {
  const h = await setup();
  try {
    const fixture = hostDouble();
    const original = fixture.host.call;
    fixture.host.call = (async (name: string, input: any) => name === "snapshot" ? { connections: [{ id: "media-mcp", provider: "arr-mcp", resource: "ocean-media", operations: ["read.call"] }] } : original(name as never, input as never)) as typeof fixture.host.call;
    const input = { timezone: "America/Chicago", hour: 8, enabled: false, bindings: [], arrMcpBinding: { connectionId: "media-mcp", resource: "ocean-media" } };
    await assert.rejects(saveSettings(h.db, identity, fixture.host, { ...input, arrMcpBinding: { connectionId: "media-mcp", resource: "another-resource" } }), e => e instanceof Response && e.status === 409);
    await saveSettings(h.db, identity, fixture.host, input, demoNow);
    const saved = await loadSettings(h.db);
    assert.deepEqual(saved.arrMcpBinding, input.arrMcpBinding);
    assert.deepEqual(saved.bindings, []);
    assert.deepEqual(fixture.calls.find(c => c.name === "schedule.save")?.input.connectionBindings, []);
  } finally { h.close(); }
});

test("shared thread callbacks expose reads and private proposal preparation and reject another owner's thread or an expired turn", async () => {
  const h = await setup();
  try {
    const batch = {
      query: async (s: { sql: string; params?: unknown[] }) => (await h.client.execute({ sql: s.sql, args: (s.params ?? []) as InValue[] })).rows as Record<string, unknown>[],
      batch: async (steps: { sql: string; params?: unknown[] }[]) => h.client.batch(steps.map(s => ({ sql: s.sql, args: (s.params ?? []) as InValue[] })), "write"),
    };
    const store = new ProposalStore(batch, identity, { table: "dione_proposals", guard: "dione_agent_guard" });
    const original = h.context.host();
    let running = true;
    h.context.host = () => ({ call: async (name: string, input: any) => name === "threads.submission" ? { state: running ? "running" : "aborted" } : original.call(name as never, input as never) }) as ReturnType<DioneContext["host"]>;
    const agent = createDioneAgent(h.context, store);
    const id = crypto.randomUUID();
    const thread: Thread = { id, ref: { id }, owner: identity.owner, installationId: identity.installationId, createdBy: identity.userId, visibility: "private", type: "dione.conversation", typeVersion: 1, title: "My media", status: "active", context: { type: "dione.page", id: focusId }, parent: null, pinned: false, working: true, readOnly: false, createdAt: demoNow, updatedAt: demoNow };
    const entry: ThreadEntry = { id: "user-entry", thread: { id }, role: "user", parts: [{ type: "text", text: "What is in Radarr?" }], status: "complete", submissionId: null, sourceKey: null, attribution: { actor: { kind: "member", id: identity.userId }, origin: { kind: "member", id: identity.userId }, userId: identity.userId, installationId: identity.installationId }, metadata: null, createdAt: demoNow, recordedAt: null };
    const callback = (operation: string, body: unknown) => agent.provider(new Request(`https://dione.example/api/internal/threads/v1/${operation}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), operation);
    const prepared = await callback("prepare", { thread, entry, submissionId: "turn", retry: false });
    assert.equal(prepared.status, 200);
    const context = await prepared.json() as any;
    assert.deepEqual(context.tools.map((t: any) => t.name), ["dione_movie_request", "dione_media_read", "dione_stack_read", "dione_movie_lookup", "dione_movie_progress"]);
    assert.ok(context.tools.filter((t: any) => t.name !== "dione_movie_request").every((t: any) => t.store === false));
    assert.ok(!JSON.stringify(context.context).includes("approved-radarr"));
    const input = { thread, submissionId: "turn", call: { id: "call", name: "dione_media_read", input: { provider: "radarr", view: "library" } } };
    const response = await callback("tool", input);
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as any).output.status, "ok");
    assert.equal((await callback("tool", { ...input, call: { ...input.call, name: "dione_request_search" } })).status, 404);
    assert.equal((await callback("tool", { ...input, thread: { ...thread, createdBy: "other" } })).status, 409);
    running = false;
    assert.equal((await callback("tool", input)).status, 409);
    assert.equal(h.calls.filter(c => c.name === "connector.execute").length, 1);
    assert.deepEqual(await store.forThread(id), []);
  } finally { h.close(); }
});
