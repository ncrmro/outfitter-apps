import test from "node:test";
import assert from "node:assert/strict";
import { presentAgentResult, presentMovieProposal } from "../src/server/agent-presentation";

test("movie review omits internal bookkeeping without mutating stored authority", async () => {
  const proposal = { id: "review", action: "movie.request", status: "pending", revision: 1, requestId: "stable",
    changes: { title: "Silent Running", year: 1972, qualityProfileId: 1, rootFolderPath: "/movies", bindingDigest: "internal", requestId: "stable" },
    schema: { properties: { title: { type: "string" }, qualityProfileId: { type: "number" }, bindingDigest: { type: "string" }, requestId: { type: "string" } }, required: ["qualityProfileId", "bindingDigest", "requestId"] }, before: {} };
  const saved = structuredClone(proposal);
  const result = presentAgentResult({ proposals: [proposal] }) as { proposals: Record<string, any>[] };
  const view = result.proposals[0];
  assert.equal(view.targetLabel, "Silent Running (1972)");
  assert.equal(view.changes.bindingDigest, undefined);
  assert.equal(view.changes.requestId, undefined);
  assert.equal(view.changes.qualityProfileId, 1);
  assert.deepEqual(view.schema.required, ["qualityProfileId"]);
  assert.equal(view.schema.properties.requestId, undefined);
  assert.deepEqual(proposal, saved);
  assert.equal(view.requestId, undefined);
  assert.equal(view.id, proposal.id);
  assert.equal(view.revision, proposal.revision);
  assert.deepEqual(presentMovieProposal({ action: "another.action" }), { action: "another.action" });
  const errorResponse = new Response("Denied", { status: 403 });
  assert.equal(presentAgentResult(errorResponse), errorResponse);
  for (const envelope of [proposal, { proposal }, { unresolved: [proposal] }]) {
    assert.ok(!JSON.stringify(presentAgentResult(envelope)).includes('"stable"'));
    assert.ok(!JSON.stringify(presentAgentResult(envelope)).includes('"internal"'));
  }
});
