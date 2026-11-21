import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { AppIdentity } from "@ai-outfitter/app-sdk/server";
import { type WorkflowHostScope, type WorkflowHostStub, workflowHost } from "@ai-outfitter/app-sdk/workflow-host";
import { wikiGraphFixture } from "@ai-outfitter/app-test/wiki-fixture";
import type { DemoState } from "../../src/server/page-state";
import { addConcepts, listTopics, recordCheck, saveTopic, topicDetail } from "../../src/server/store";
import { readGoals } from "../../src/server/goals";

// Synthetic data only: no real person's goals or answers.

/** The owner of a personal installation: a user, with no organization. */
export const owner: AppIdentity = {
  userId: "member-1", owner: { kind: "user", id: "member-1" }, installationId: "autodidact", role: "owner", canEdit: true,
};

/** A fresh installation database with the package's migrations, in memory. */
export async function database() {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../migrations", import.meta.url)) });
  return { db, close: () => client.close() };
}

// ── The member's Wiki ───────────────────────────────────────────────────────

export const wikiId = "wiki";
const goalType = "71000000-0000-4000-8000-000000000010";
const noteType = "71000000-0000-4000-8000-000000000020";
export const goals = {
  analytics: "9a1e0000-0000-4000-8000-000000000001",
  marathon: "9a1e0000-0000-4000-8000-000000000002",
  archived: "9a1e0000-0000-4000-8000-000000000003",
};

/** A Wiki with two open goals, an archived one and a note that is not a goal. */
export const wikiGraph = () => wikiGraphFixture(wikiId, {
  types: [
    { ref: { id: goalType }, attributes: { category: "node", name: "Goal", title: "Goal" } },
    { ref: { id: noteType }, attributes: { category: "node", name: "Note", title: "Note" } },
  ],
  nodes: [
    { ref: { id: goals.marathon }, title: "Run a sub-4 marathon", attributes: { typeId: goalType, summary: "Spring race.", properties: { goal_status: "active", due_date: "2027-04-18" } } },
    { ref: { id: goals.analytics }, title: "Read our experiment results without help", attributes: { typeId: goalType, summary: "Judge A/B tests on my own.", properties: { goal_status: "active" } } },
    { ref: { id: goals.archived }, title: "Learn Esperanto", attributes: { typeId: goalType, archived: true } },
    { ref: { id: "9a1e0000-0000-4000-8000-000000000009" }, title: "Not a goal", attributes: { typeId: noteType } },
  ],
});

/** The platform host for a dispatch: the member's Wiki, or none installed. */
export function wikiHost(options: { wiki?: boolean } = {}) {
  const calls: { operation: string; input: unknown }[] = [];
  const stub = (_scope: WorkflowHostScope): WorkflowHostStub => ({
    async call(operation: string, input: unknown) {
      calls.push({ operation, input });
      if (operation === "entities.types")
        return { ok: true, value: options.wiki === false ? [] : ["graph-type", "graph-node", "graph-edge"].map((type) => ({
          type, title: type, description: type, schema: {}, writable: false, installationId: wikiId, hostname: null, template: "wiki-map", slug: "wiki-map",
        })) };
      if (operation === "actions.call" && (input as { action?: string }).action === "graph.read") return { ok: true, value: wikiGraph() };
      return { ok: false, status: 403, message: `Operation not used by this test: ${operation}` };
    },
  });
  return { stub, calls };
}

/** A typed host over a stub, as a route gets it from its dispatch props. */
export const hostOf = (stub: WorkflowHostStub) => workflowHost<"interactive">({ props: { workflowHost: stub } });

/** The owner's interactive scope, as the platform passes it with a dispatch. */
export const scope = (method = "GET"): WorkflowHostScope => ({
  organizationId: null, installationId: "autodidact", userId: "member-1", packageHash: "hash", phase: "interactive", expiresAt: Date.now() + 60_000,
  ...(["GET", "HEAD"].includes(method) ? {} : { initiation: "member" as const }),
});

// ── The demo ────────────────────────────────────────────────────────────────

export const demoPath = new URL("../../fixtures/demo.json", import.meta.url);
const demoNow = Date.parse("2026-11-10T18:00:00Z");
const MINUTE = 60_000;

/** A member two sessions into learning to read experiment results, and a paused topic from a prompt. */
export async function demoState(): Promise<DemoState> {
  const { db, close } = await database();
  try {
    const at = (minutes: number) => demoNow - minutes * MINUTE;
    const stats = await saveTopic(db, owner, {
      title: "Reading A/B test results", aim: "Say whether an experiment's result is real, how big it is and what to do next, without asking an analyst.",
      goal: { id: goals.analytics, title: "Read our experiment results without help" },
    }, at(300));
    const { ids } = await addConcepts(db, owner, { topicId: stats.id, concepts: [
      { title: "Sampling variation", summary: "Why two groups differ even when the change does nothing." },
      { title: "Null hypothesis", summary: "What 'no effect' predicts, so a result can surprise it." },
      { title: "p-value", summary: "How surprising the data would be if there were no effect." },
      { title: "Confidence interval", summary: "The range of effect sizes the data is consistent with." },
      { title: "Statistical power", summary: "Why a small test can miss a real effect." },
      { title: "Peeking and stopping early", summary: "Why checking every day inflates false positives." },
    ] }, at(295));
    const check = (index: number, minutes: number, question: string, answer: string, outcome: "gap" | "shaky" | "solid", insight: string) =>
      recordCheck(db, owner, { conceptId: ids[index], question, answer, outcome, insight }, at(minutes));
    await check(0, 280, "If we split users into two groups and change nothing, would their conversion rates match? Why or why not?",
      "Not exactly. Each group is a random handful of people, so the rates wobble a bit even with no change.", "solid", "Explains chance differences and why they shrink with more users.");
    await check(1, 270, "Before we look at the data, what does 'the new checkout makes no difference' predict we will see?",
      "That the conversion rates are the same?", "shaky", "Expects identical rates; has not connected the null to the wobble they just described.");
    await check(2, 255, "A test reports p = 0.03. In your own words, what is that 3% the probability of?",
      "That there's a 3% chance the new version isn't better.", "gap", "Reads the p-value as the probability the hypothesis is true: the most common misconception.");
    await check(1, 240, "If there is no effect and we ran this test 100 times, would every run show identical rates?",
      "No, they'd bounce around. So no effect means the difference is near zero, within the usual wobble.", "solid", "Reached the null's prediction from sampling variation on their own.");
    await check(3, 230, "The dashboard says +2% conversion, 95% CI from -1% to +5%. Would you ship it?",
      "Yes, it's 2% better.", "gap", "Reads the point estimate only; does not see that the interval includes no effect or a loss.");
    const writing = await saveTopic(db, owner, { title: "Writing SQL window functions", aim: "Write running totals and rankings for my own reports." }, at(2000));
    await addConcepts(db, owner, { topicId: writing.id, concepts: [{ title: "PARTITION BY" }, { title: "ORDER BY in a window" }, { title: "Frames: ROWS vs RANGE" }] }, at(1990));
    await saveTopic(db, owner, { id: writing.id, revision: writing.revision, status: "paused" }, at(1500));
    const list = await listTopics(db);
    const details = Object.fromEntries(await Promise.all(list.map(async (topic) => [topic.id, await topicDetail(db, topic.id)] as const)));
    const state: DemoState = { topics: list, details, goals: await readGoals(hostOf(wikiHost().stub(scope()))) };
    // Stable ids, so regenerating the fixture changes nothing.
    let text = JSON.stringify(state);
    const generated = [...new Set(text.match(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g) ?? [])].filter((id) => !Object.values(goals).includes(id));
    generated.forEach((id, n) => { text = text.replaceAll(id, `demo-${n + 1}`); });
    return JSON.parse(text);
  } finally {
    close();
  }
}
