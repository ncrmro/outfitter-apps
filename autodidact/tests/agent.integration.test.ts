import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { tutorHost } from "./helpers/tutor";

// The tutor on the real platform thread service with the built Worker. The model is
// scripted: passing tests prove no live inference. evals/tutor runs a real one.

const finish = (reason: "stop" | "tool-calls") => ({
  type: "finish" as const, finishReason: { unified: reason, raw: reason },
  usage: { inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 3, text: 3, reasoning: 0 } },
});
type Step = { text?: string; tools?: { name: string; input: unknown }[] };

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
  const host = await tutorHost(model);
  return { ...host, prompts, script: (steps: Step[]) => { script = steps; } };
}

test("the tutor records a Socratic check only after the member approves it", async () => {
  const t = await setup();
  try {
    const topic = await t.action<{ id: string }>("topic.save", { title: "Reading A/B tests", aim: "Judge a result myself." });
    const { ids: [conceptId] } = await t.action<{ ids: string[] }>("concepts.add", { topicId: topic.id, concepts: [{ title: "p-value" }] });
    const read = () => t.action<{ concepts: { state: string }[]; checks: { answer: string }[] }>("topic.read", { topicId: topic.id });

    const thread = await t.conversation();
    t.script([
      { tools: [{ name: "autodidact_check_record", input: { conceptId, question: "What is p = 0.03 the probability of?", answer: "A 3% chance B isn't better.", outcome: "gap", insight: "Reads p as the chance the hypothesis is true." } }] },
      { text: "Suppose B truly changes nothing. How often would you still see a gap this big?" },
    ]);
    const state = await t.send(thread.id, "p = 0.03 means a 3% chance B isn't better.", { location: `topic?id=${topic.id}`, topicId: topic.id });
    assert.equal(state.state, "completed");
    // The tutor saw its method, the open topic's concepts and its tools.
    assert.match(t.prompts[0], /Socratic tutor/);
    assert.match(t.prompts[0], /p-value/);
    assert.match(t.prompts[0], /unprobed/);

    // Nothing changed yet: the check is a proposal for the member.
    assert.equal((await read()).checks.length, 0);
    const proposals = await t.proposals(thread.id);
    assert.deepEqual(proposals.map((proposal) => [proposal.action, proposal.status]), [["check.record", "pending"]]);
    await t.decide(proposals[0], "approve");
    let detail = await read();
    assert.deepEqual([detail.concepts[0].state, detail.checks[0].answer], ["gap", "A 3% chance B isn't better."]);

    // A rejected proposal changes nothing.
    t.script([{ tools: [{ name: "autodidact_check_record", input: { conceptId, question: "q", answer: "a", outcome: "solid" } }] }, { text: "Let's check first." }]);
    await t.send(thread.id, "Mark it solid.");
    const next = (await t.proposals(thread.id)).find((proposal) => proposal.status === "pending");
    assert.ok(next);
    await t.decide(next, "reject");
    detail = await read();
    assert.deepEqual([detail.concepts[0].state, detail.checks.length], ["gap", 1]);
  } finally {
    await t.dispose();
  }
});

test("reads run at once, as the member: the tutor reads Wiki goals to start a topic", async () => {
  const t = await setup();
  try {
    const thread = await t.conversation();
    t.script([{ tools: [{ name: "autodidact_goals_read", input: {} }] }, { text: "Which goal?" }]);
    assert.equal((await t.send(thread.id, "What should I learn?")).state, "completed");
    assert.match(t.prompts[1], /Run a sub-4 marathon/);
  } finally {
    await t.dispose();
  }
});
