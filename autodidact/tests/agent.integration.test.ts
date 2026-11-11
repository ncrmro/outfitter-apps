import assert from "node:assert/strict";
import test from "node:test";
import type { WorkflowHostScope, WorkflowHostStub } from "@ai-outfitter/app-sdk/workflow-host";
import { appArtifact } from "@ai-outfitter/app-test/prepare";
import { threadTestHost } from "@ai-outfitter/app-test/threads";
import { appWorker } from "@ai-outfitter/app-test/worker";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { focusId } from "../src/lib/learning";
import { wikiHost } from "./helpers/fixtures";

// The tutor on the REAL platform thread service, with the built Worker answering its
// provider callbacks. The model is scripted: passing tests prove no live inference.

const api = "/api/apps/autodidact";
const owner = { userId: "member-1", organizationId: "", role: "owner", owner: { kind: "user" as const, id: "member-1" } };
const principal = { userId: "member-1", organizationId: null, installationId: "autodidact" };
const finish = (reason: "stop" | "tool-calls") => ({
  type: "finish" as const, finishReason: { unified: reason, raw: reason },
  usage: { inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 3, text: 3, reasoning: 0 } },
});
type Step = { text?: string; tools?: { name: string; input: unknown }[] };
// biome-ignore lint/suspicious/noExplicitAny: API answers are asserted structurally.
const json = async (response: Response): Promise<any> => {
  assert.ok(response.ok, `${response.status} ${await response.clone().text()}`);
  return response.json();
};

async function setup() {
  let script: Step[] = [];
  const prompts: string[] = [];
  const model = () => new MockLanguageModelV3({
    doStream: async (options) => {
      prompts.push(JSON.stringify(options.prompt));
      const step = script.shift() ?? { text: "Done." };
      const chunks = [
        ...(step.text ? [{ type: "text-start" as const, id: "t" }, { type: "text-delta" as const, id: "t", delta: step.text }, { type: "text-end" as const, id: "t" }] : []),
        ...(step.tools ?? []).map((tool, i) => ({ type: "tool-call" as const, toolCallId: `call-${prompts.length}-${i}`, toolName: tool.name, input: JSON.stringify(tool.input) })),
        finish(step.tools?.length ? "tool-calls" : "stop"),
      ];
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
  // The app's host on each dispatch: the thread service for threads.*, the Wiki for the rest.
  const wiki = wikiHost();
  // eslint-disable-next-line prefer-const
  let threads: Awaited<ReturnType<typeof threadTestHost>>;
  const host = (scope: WorkflowHostScope): WorkflowHostStub => ({
    call: (operation, input) => operation.startsWith("threads.") ? threads.stub(principal).call(operation, input) : wiki.stub(scope).call(operation, input),
  });
  const app = await appWorker("autodidact", appArtifact(new URL("..", import.meta.url), "operational"), "autodidact", { workflowHost: host });
  const scope: WorkflowHostScope = { organizationId: null, installationId: "autodidact", userId: "member-1", packageHash: "hash", phase: "interactive", expiresAt: Date.now() + 600_000 };
  threads = await threadTestHost({
    model, installations: ["autodidact"], users: ["member-1"],
    provider: async ({ operation, input }) => {
      const response = await app.call(`/api/internal/threads/v1/${operation}`, owner, { method: "POST", body: input, workflowHost: scope });
      const text = await response.text();
      if (!response.ok) throw new Response(text, { status: response.status });
      return text ? JSON.parse(text) : null;
    },
  });
  async function call<T>(operation: string, input: unknown): Promise<T> {
    const result = await threads.stub(principal).call(operation, input);
    if (!result.ok) throw new Response(result.message, { status: result.status });
    return result.value as T;
  }
  const conversation = () => call<{ id: string }>("threads.create", { type: "autodidact.conversation", title: "Tutor", context: { type: "autodidact.page", id: focusId } });
  async function send(threadId: string, text: string, steps: Step[], metadata?: unknown) {
    script = steps;
    const submissionId = crypto.randomUUID();
    await call("threads.send", { threadId, submissionId, text, ...(metadata ? { metadata } : {}) });
    await threads.settle();
    return call<{ state: string }>("threads.submission", { threadId, submissionId });
  }
  const as = (method = "GET", body?: unknown) => ({ method, ...(body === undefined ? {} : { body }), workflowHost: scope });
  return { app, prompts, conversation, send, as, dispose: () => app.dispose() };
}

test("the tutor records a Socratic check only after the member approves it", async () => {
  const t = await setup();
  try {
    const { app, as } = t;
    const topic = await json(await app.call(`${api}/topic.save`, owner, as("POST", { title: "Reading A/B tests", aim: "Judge a result myself." })));
    const { ids: [conceptId] } = await json(await app.call(`${api}/concepts.add`, owner, as("POST", { topicId: topic.id, concepts: [{ title: "p-value" }] })));

    const thread = await t.conversation();
    const state = await t.send(thread.id, "p = 0.03 means a 3% chance B isn't better.", [
      { tools: [{ name: "autodidact_check_record", input: { conceptId, question: "What is p = 0.03 the probability of?", answer: "A 3% chance B isn't better.", outcome: "gap", insight: "Reads p as the chance the hypothesis is true." } }] },
      { text: "Suppose B truly changes nothing. How often would you still see a gap this big?" },
    ], { "app.page": { location: `topic?id=${topic.id}`, title: "Reading A/B tests", state: { topicId: topic.id } } });
    assert.equal(state.state, "completed");
    // The tutor saw its method, the open topic's concepts and its tools.
    assert.match(t.prompts[0], /Socratic tutor/);
    assert.match(t.prompts[0], /p-value/);
    assert.match(t.prompts[0], /unprobed/);

    // Nothing changed yet: the check is a proposal for the member.
    let detail = await json(await app.call(`${api}/topic.read`, owner, as("POST", { topicId: topic.id })));
    assert.equal(detail.checks.length, 0);
    const { proposals } = await json(await app.call(`${api}/agent/proposals?thread=${thread.id}`, owner, as()));
    assert.deepEqual(proposals.map((proposal: { action: string; status: string }) => [proposal.action, proposal.status]), [["check.record", "pending"]]);

    await json(await app.call(`${api}/agent/proposals/${proposals[0].id}/approve`, owner, as("POST", { revision: proposals[0].revision })));
    detail = await json(await app.call(`${api}/topic.read`, owner, as("POST", { topicId: topic.id })));
    assert.deepEqual([detail.concepts[0].state, detail.checks[0].answer], ["gap", "A 3% chance B isn't better."]);

    // A rejected proposal changes nothing.
    await t.send(thread.id, "Mark it solid.", [{ tools: [{ name: "autodidact_check_record", input: { conceptId, question: "q", answer: "a", outcome: "solid" } }] }, { text: "Let's check first." }]);
    const next = (await json(await app.call(`${api}/agent/proposals?thread=${thread.id}`, owner, as()))).proposals.find((proposal: { status: string }) => proposal.status === "pending");
    await json(await app.call(`${api}/agent/proposals/${next.id}/reject`, owner, as("POST", { revision: next.revision })));
    detail = await json(await app.call(`${api}/topic.read`, owner, as("POST", { topicId: topic.id })));
    assert.deepEqual([detail.concepts[0].state, detail.checks.length], ["gap", 1]);
  } finally {
    await t.dispose();
  }
});

test("reads run at once, as the member: the tutor reads Wiki goals to start a topic", async () => {
  const t = await setup();
  try {
    const thread = await t.conversation();
    const state = await t.send(thread.id, "What should I learn?", [{ tools: [{ name: "autodidact_goals_read", input: {} }] }, { text: "Which goal?" }]);
    assert.equal(state.state, "completed");
    assert.match(t.prompts[1], /Run a sub-4 marathon/);
  } finally {
    await t.dispose();
  }
});
