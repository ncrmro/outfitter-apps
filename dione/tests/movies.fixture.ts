import assert from "node:assert/strict";
import type { InValue } from "@libsql/client";
import { ProposalStore } from "@ai-outfitter/app-sdk/proposal-store";
import type { Thread } from "@ai-outfitter/app-sdk/threads";
import { createDioneAgent, focusId } from "../src/server/agent";
import type { DioneContext } from "../src/server/agent-context";
import { settings } from "../src/server/schema";
import { database, demoNow, identity } from "./helpers";

export async function movieHarness() {
  const h = await database();
  const bindings = ["radarr", "sabnzbd", "transmission"].map(provider => ({ provider, connectionId: `${provider}-approved`, resource: `ocean-${provider}` }));
  await h.db.insert(settings).values({ id: "default", timezone: "America/Chicago", hour: 8, enabled: false, bindings: JSON.stringify(bindings), updatedAt: demoNow });
  const now = new Date().toISOString();
  const match = { movieId: null as number | null, tmdbId: 42, title: "Fictional Moonrise", year: 2026, monitored: false, hasFile: false, qualityProfileId: null as number | null, rootFolderPath: null as string | null };
  const state = { approved: true, uncertain: false, writes: 0, matches: [match], options: { qualityProfiles: [{ id: 7, name: "HD fictional profile" }], rootFolders: [{ path: "/movies", accessible: true }], defaultQualityProfileId: 7 as number | null, defaultRootFolderPath: "/movies" as string | null }, progress: { movie: { ...match, movieId: 101, monitored: true }, search: { id: 8, status: "completed" }, downloads: [{ downloadId: "exact-id", downloadClient: "SABnzbd", status: "downloading", remainingBytes: 100, size: 200 }], history: [{ eventType: "grabbed", date: now, downloadId: "exact-id" }], truncated: false, observedAt: now }, client: { downloads: [{ id: "exact-id", location: "queue", status: "Downloading", percent: 50, remainingBytes: 100, bytesPerSecond: null, etaSeconds: 10 }, { id: "unrelated-id", location: "queue", status: "Failed", percent: 0, remainingBytes: 200, bytesPerSecond: 0, etaSeconds: null }], service: { status: "Downloading", bytesPerSecond: 10, issues: [] }, truncated: false, observedAt: now } };
  const calls: Array<{ name: string; input: any }> = [];
  const id = crypto.randomUUID();
  const thread: Thread = { id, ref: { id }, owner: identity.owner, installationId: identity.installationId, createdBy: identity.userId, visibility: "private", type: "dione.conversation", typeVersion: 1, title: "Movies", status: "active", context: { type: "dione.page", id: focusId }, parent: null, pinned: false, working: true, readOnly: false, createdAt: demoNow, updatedAt: demoNow };
  const call = async (name: string, input: any): Promise<any> => {
    calls.push({ name, input });
    if (name === "snapshot") return { connections: state.approved ? bindings.map(binding => ({ id: binding.connectionId, provider: binding.provider, resource: binding.resource, operations: ["movie.lookup", "movie.options", "movie.request", "movie.progress", "download.status"] })) : [] };
    if (name === "threads.get") return thread;
    if (name === "threads.submission") return { state: "running" };
    if (name === "threads.append") return { id: crypto.randomUUID() };
    assert.equal(name, "connector.execute");
    assert.ok(!("provider" in input));
    if (input.operation === "movie.lookup") return { matches: state.matches, truncated: false };
    if (input.operation === "movie.options") return state.options;
    if (input.operation === "movie.progress") return state.progress;
    if (input.operation === "download.status") return state.client;
    assert.equal(input.operation, "movie.request");
    state.writes++;
    if (state.uncertain) throw Error("private credential must not leak");
    return { ...match, movieId: 101, status: "added-search-requested", observedAt: now, commandId: 8, downloadIds: [] };
  };
  const context: DioneContext = { identity, actor: { kind: "member", id: identity.userId }, originActor: { kind: "member", id: identity.userId }, db: () => h.db, host: () => ({ call }) as ReturnType<DioneContext["host"]> };
  const batch = { query: async (s: { sql: string; params?: unknown[] }) => (await h.client.execute({ sql: s.sql, args: (s.params ?? []) as InValue[] })).rows as Record<string, unknown>[], batch: async (steps: { sql: string; params?: unknown[] }[]) => { await h.client.batch(steps.map(s => ({ sql: s.sql, args: (s.params ?? []) as InValue[] })), "write"); } };
  const store = new ProposalStore(batch, identity, { table: "dione_proposals", guard: "dione_agent_guard" });
  const agent = createDioneAgent(context, store);
  const propose = () => agent.tool({ thread, calls: [], submissionId: "turn", call: { id: "movie-call", name: "dione_movie_request", input: { tmdbId: 42 } } });
  const approve = (proposalId: string, revision = 1) => agent.browser(new Request(`https://dione.example/api/apps/dione/agent/proposals/${proposalId}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision }) }), `proposals/${proposalId}/approve`);
  return { ...h, state, calls, context, store, agent, thread, propose, approve };
}
