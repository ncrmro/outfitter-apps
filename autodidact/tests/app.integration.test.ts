import assert from "node:assert/strict";
import test from "node:test";
import { actionPath } from "@ai-outfitter/app-sdk/actions";
import { appArtifact } from "@ai-outfitter/app-test/prepare";
import { appWorker } from "@ai-outfitter/app-test/worker";
import { focusId } from "../src/lib/learning";
import { goals, scope, wikiHost } from "./helpers/fixtures";

// The built operational Worker over its installation database, as the member's own
// (user-owned) installation, with a platform host serving a synthetic Wiki.

const api = "/api/apps/autodidact";
/** The owner of a personal app: no organization, the owner header names the user. */
const owner = { userId: "member-1", organizationId: "", role: "owner", owner: { kind: "user" as const, id: "member-1" } };
const artifact = () => appArtifact(new URL("..", import.meta.url), "operational");
// biome-ignore lint/suspicious/noExplicitAny: API answers are asserted structurally.
const json = async (response: Response): Promise<any> => {
  assert.ok(response.ok, `${response.status} ${await response.clone().text()}`);
  return response.json();
};
const post = (body: unknown) => ({ method: "POST", body, workflowHost: scope("POST") });

async function withApp(run: (app: Awaited<ReturnType<typeof appWorker>>, host: ReturnType<typeof wikiHost>) => Promise<void>, options: { wiki?: boolean } = {}) {
  const host = wikiHost(options);
  const app = await appWorker("autodidact", artifact(), "autodidact", { workflowHost: host.stub });
  try {
    await run(app, host);
  } finally {
    await app.dispose();
  }
}

test("a topic from a Wiki goal gets a concept map and checks, and the pages show them", async () => {
  await withApp(async (app, host) => {
    assert.equal((await app.call(`${api}/topic.save`, undefined, { method: "POST", body: { title: "x" } })).status, 401);
    // The overview lists the Wiki's open goals to start from.
    const overview = await (await app.call("/", owner, { workflowHost: scope() })).text();
    assert.match(overview, /Read our experiment results without help/);
    assert.match(overview, /Run a sub-4 marathon/);
    assert.doesNotMatch(overview, /Learn Esperanto|Not a goal/);
    assert.ok(host.calls.some((call) => call.operation === "actions.call"), "goals are read through the platform, as the member");

    const topic = await json(await app.call(`${api}/topic.save`, owner, post({ title: "Reading A/B tests", aim: "Judge a result myself.", goal: { id: goals.analytics, title: "Read our experiment results without help" } })));
    const map = await json(await app.call(`${api}/concepts.add`, owner, post({ topicId: topic.id, concepts: [{ title: "Sampling variation" }, { title: "p-value", summary: "How surprising the data is under no effect." }] })));
    assert.equal(map.added, 2);
    const recorded = await json(await app.call(`${api}/check.record`, owner, post({
      conceptId: map.ids[1], question: "What is p = 0.03 the probability of?", answer: "That <b>B</b> isn't better.", outcome: "gap", insight: "Reads p as the chance the hypothesis is true.",
    })));
    assert.deepEqual(recorded.concept.to, "gap");

    for (const [action, body] of [["topic.save", { title: "" }], ["concepts.add", { topicId: topic.id, concepts: [] }], ["check.record", { conceptId: map.ids[0], question: "q", answer: "a", outcome: "maybe" }]] as const)
      assert.equal((await app.call(`${api}/${action}`, owner, post(body))).status, 400, action);
    assert.equal((await app.call(`${api}/made.up`, owner, post({}))).status, 404);

    const page = await (await app.call(`/topic?id=${topic.id}`, owner)).text();
    assert.match(page, /Next up: <strong>p-value<\/strong>/);
    assert.match(page, /Toward your goal: Read our experiment results without help/);
    // The member's answer is shown as text, never markup.
    assert.match(page, /That &lt;b&gt;B&lt;\/b&gt; isn&#39;t better\.|That &lt;b&gt;B&lt;\/b&gt; isn't better\./);
    assert.equal((await app.call("/topic?id=missing", owner)).status, 404);
    const after = await (await app.call("/", owner, { workflowHost: scope() })).text();
    assert.match(after, /0 of 2 solid · 1 gap · 1 not checked/);
    assert.match(after, /Topic started/);
    // The deploy check requests the shell without a member.
    assert.equal((await app.call("/")).status, 200);
    assert.equal((await app.call("/settings", owner)).status, 200);
  });
});

test("without a Wiki the overview says so, and a topic still starts from a prompt", async () => {
  await withApp(async (app) => {
    const overview = await (await app.call("/", owner, { workflowHost: scope() })).text();
    assert.match(overview, /Add the Wiki app/);
    const topic = await json(await app.call(`${api}/topic.save`, owner, post({ title: "SQL window functions", aim: "", goal: null })));
    assert.equal(topic.goalId, null);
    const goalsRead = await app.call(`${actionPath}/call`, owner, { method: "POST", body: { action: "goals.read", input: {}, access: "read" }, workflowHost: scope() });
    assert.deepEqual(await json(goalsRead), { available: false, reason: "Add the Wiki app to your own apps to start topics from your goals." });
  }, { wiki: false });
});

test("the same actions are published for MCP clients and other apps, as the member", async () => {
  await withApp(async (app) => {
    const list = await json(await app.call(`${actionPath}/list`, owner));
    assert.deepEqual(list.map((action: { name: string }) => action.name).sort(), ["check.record", "concepts.add", "goals.read", "topic.read", "topic.save", "topics.read"]);
    const created = await json(await app.call(`${actionPath}/call`, owner, { method: "POST", body: { action: "topic.save", input: { title: "Bayes" } } }));
    const topics = await json(await app.call(`${actionPath}/call`, owner, { method: "POST", body: { action: "topics.read", input: {}, access: "read" } }));
    assert.deepEqual(topics.map((topic: { id: string }) => topic.id), [created.id]);
    // A read-only call cannot write.
    assert.equal((await app.call(`${actionPath}/call`, owner, { method: "POST", body: { action: "topic.save", input: { title: "x" }, access: "read" } })).status, 403);
  });
});

test("the tutor's page context offers its tools, and only to the owner", async () => {
  await withApp(async (app) => {
    const context = await json(await app.call(`${api}/agent/context?focus=${focusId}`, owner, { workflowHost: scope() }));
    assert.equal(context.type, "autodidact.conversation");
    assert.deepEqual(context.actions.map((tool: { name: string }) => tool.name).sort(), [
      "autodidact_check_record", "autodidact_concepts_add", "autodidact_goals_read", "autodidact_topic_read", "autodidact_topic_save", "autodidact_topics_read",
    ]);
    assert.ok(context.actions.find((tool: { name: string }) => tool.name === "autodidact_check_record").description.includes("prepares a private proposal"));
    assert.equal((await app.call(`${api}/agent/context?focus=other`, owner, { workflowHost: scope() })).status, 400);
  });
});

test("only the owner of the member's own installation gets in; an organization's installation is refused", async () => {
  await withApp(async (app, host) => {
    const member = { userId: "member-1", organizationId: "org-1", role: "owner" };
    const stranger = { ...owner, userId: "member-2" };
    const routes: [string, string, unknown?][] = [
      [`${api}/topic.save`, "POST", { title: "x" }], [`${api}/topics.read`, "POST", {}], [`${actionPath}/call`, "POST", { action: "topics.read", input: {}, access: "read" }],
      [`${api}/agent/context?focus=${focusId}`, "GET"],
    ];
    for (const [path, method, body] of routes) {
      const refused = await app.call(path, member, { method, body, workflowHost: scope(method) });
      assert.equal(refused.status, 403, `${method} ${path}`);
      assert.match(await refused.text(), /personal app/);
      assert.equal((await app.call(path, stranger, { method, body, workflowHost: scope(method) })).status, 404, `${method} ${path}`);
    }
    assert.ok(!host.calls.length, "no refused route reaches the host");
  });
});

test("the demo shows the synthetic topic, read-only, with no API", async () => {
  const app = await appWorker("autodidact", appArtifact(new URL("..", import.meta.url), "demo"), "autodidact-demo");
  try {
    const overview = await (await app.call("/")).text();
    assert.match(overview, /Reading A\/B test results/);
    assert.match(overview, /2 of 6 solid · 2 gaps · 2 not checked/);
    assert.doesNotMatch(overview, /id="topic-form"|data-start-goal/);
    const topic = await (await app.call("/topic?id=demo-1")).text();
    assert.match(topic, /Next up: <strong>p-value<\/strong>/);
    assert.match(topic, /Reads the p-value as the probability the hypothesis is true/);
    assert.equal((await app.call(`${api}/topic.save`, owner, { method: "POST", body: { title: "x" } })).status, 405);
  } finally {
    await app.dispose();
  }
});
