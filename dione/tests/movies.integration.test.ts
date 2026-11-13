import assert from "node:assert/strict";
import test from "node:test";
import { lookupMovie, movieActions, movieProgress, prepareMovieRequest, applyMovieRequest } from "../src/server/movies";
import { settings } from "../src/server/schema";
import { identity } from "./helpers";
import { movieHarness } from "./movies.fixture";
import { presentAgentResult } from "../src/server/agent-presentation";

const refused = (code: number) => (error: unknown) => error instanceof Response && error.status === code;

test("normal SDK write tool creates a private verified review; only the owner browser decision writes and repeated approval reuses its receipt", async () => {
  const h = await movieHarness();
  try {
    const proposal = await h.propose();
    assert.equal(h.state.writes, 0);
    const proposalId = (proposal.output as any).proposalId;
    const row = await h.store.get(proposalId);
    const changes = JSON.parse(row.data).changes;
    assert.equal(changes.title, "Fictional Moonrise"); assert.equal(changes.year, 2026); assert.equal(changes.intent, "Add and search"); assert.equal(changes.qualityProfileId, 7); assert.equal(changes.rootFolderPath, "/movies");
    assert.ok(!JSON.stringify(changes).includes("radarr-approved"));
    const reviewed = presentAgentResult(await h.agent.browser(new Request(`https://dione.example/api/apps/dione/agent/proposals?thread=${h.thread.id}`), "proposals")) as any;
    const publicProposal = reviewed.proposals[0];
    assert.equal(publicProposal.changes.bindingDigest, undefined);
    assert.equal(publicProposal.changes.requestId, undefined);
    assert.equal(publicProposal.targetLabel, "Fictional Moonrise (2026)");
    assert.equal(JSON.parse((await h.store.get(proposalId)).data).changes.bindingDigest, changes.bindingDigest);
    const approved = await h.approve(publicProposal.id, publicProposal.revision) as any;
    assert.equal(approved.proposal.status, "applied"); assert.equal(approved.receipt.tmdbId, 42); assert.equal(h.state.writes, 1);
    await h.approve(proposalId); assert.equal(h.state.writes, 1);
    assert.equal((await h.store.forThread(h.thread.id)).length, 1);
  } finally { h.close(); }
});

test("agent invocation cannot apply; changed binding, revoked grants and mismatched owners cannot confirm", async () => {
  const h = await movieHarness();
  try {
    const prepared = await prepareMovieRequest(h.context, { tmdbId: 42 }, "reviewed-request");
    await assert.rejects(applyMovieRequest({ ...h.context, actor: { kind: "app", id: "assistant" } }, prepared), refused(403));
    await assert.rejects(movieActions["movie.request"].invoke({ ...h.context, identity: { ...identity, userId: "another" } }, prepared), refused(403));
    h.state.approved = false;
    await assert.rejects(applyMovieRequest(h.context, prepared), refused(409));
    assert.equal(h.state.writes, 0);
    h.state.approved = true;
    await h.db.update(settings).set({ bindings: JSON.stringify([{ provider: "radarr", connectionId: "different", resource: "ocean-radarr" }]) });
    await assert.rejects(applyMovieRequest(h.context, prepared), refused(409));
  } finally { h.close(); }
});

test("identity/options are verified; ambiguous movies and absent defaults cannot silently become requests; existing monitoring is explicit", async () => {
  const h = await movieHarness();
  try {
    assert.equal((await lookupMovie(h.context, { query: "Fictional Moonrise" })).status, "ok");
    h.state.matches.push({ ...h.state.matches[0] });
    await assert.rejects(prepareMovieRequest(h.context, { tmdbId: 42 }, "r"), refused(409));
    h.state.matches.pop(); h.state.options.defaultQualityProfileId = null;
    await assert.rejects(prepareMovieRequest(h.context, { tmdbId: 42 }, "r"), refused(409));
    h.state.matches[0].movieId = 101; h.state.matches[0].qualityProfileId = 7; h.state.matches[0].rootFolderPath = "/movies";
    await assert.rejects(prepareMovieRequest(h.context, { tmdbId: 42, qualityProfileId: 8 }, "r"), refused(409));
    const prepared = await prepareMovieRequest(h.context, { tmdbId: 42, qualityProfileId: 7, rootFolderPath: "/movies", title: "invented", monitorExisting: false }, "r");
    assert.equal(prepared.title, "Fictional Moonrise"); assert.equal(prepared.intent, "Monitor and search"); assert.equal(prepared.monitorExisting, true);
    await assert.rejects(applyMovieRequest(h.context, { ...prepared, intent: "Add and search" }), refused(409));
    assert.equal(h.state.writes, 0);
  } finally { h.close(); }
});

test("an uncertain provider effect remains inspect-only and never automatically repeats a write", async () => {
  const h = await movieHarness();
  try {
    const proposed = await h.propose(); const proposalId = (proposed.output as any).proposalId;
    h.state.uncertain = true;
    let error: unknown; try { await h.approve(proposalId); } catch (caught) { error = caught; }
    assert.ok(error instanceof Response); assert.equal(error.status, 502); assert.ok(!(await error.text()).includes("private credential"));
    assert.equal((await h.store.get(proposalId)).status, "uncertain"); assert.equal(h.state.writes, 1);
    await assert.rejects(h.approve(proposalId), refused(409)); assert.equal(h.state.writes, 1);
    assert.equal((await movieProgress(h.context, { tmdbId: 42 })).status, "ok");
  } finally { h.close(); }
});

test("progress joins exact IDs and attributed clients, omits unrelated jobs/clients, and preserves zero, partial and unavailable evidence", async () => {
  const h = await movieHarness();
  try {
    const result = await movieProgress(h.context, { tmdbId: 42 }) as any;
    assert.equal(result.state, "download-observed"); assert.equal(result.clients.length, 1); assert.equal(result.clients[0].provider, "sabnzbd");
    assert.equal(result.clients[0].downloads.length, 1); assert.equal(result.clients[0].downloads[0].id, "exact-id"); assert.equal(result.clients[0].downloads[0].bytesPerSecond, null);
    assert.deepEqual(h.calls.find(call => call.input?.operation === "download.status")?.input.input, { ids: ["exact-id"] });
    h.state.progress.truncated = true; h.state.client.truncated = true; h.state.client.downloads[0].bytesPerSecond = 0 as any;
    const limited = await movieProgress(h.context, { tmdbId: 42 }) as any; assert.equal(limited.truncated, true); assert.equal(limited.clients[0].truncated, true); assert.equal(limited.clients[0].downloads[0].bytesPerSecond, 0);
    h.state.progress.movie.hasFile = true;
    assert.equal((await movieProgress(h.context, { tmdbId: 42 }) as any).state, "imported");
    h.state.approved = false;
    assert.equal((await movieProgress(h.context, { tmdbId: 42 })).status, "unavailable");
  } finally { h.close(); }
});
