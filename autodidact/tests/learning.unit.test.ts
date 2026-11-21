import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { nextConcept, progressText } from "../src/lib/learning";
import { readGoals } from "../src/server/goals";
import { addConcepts, listTopics, recordCheck, saveTopic, topicDetail } from "../src/server/store";
import { database, demoPath, demoState, goals, hostOf, owner, scope, wikiHost } from "./helpers/fixtures";

test("the next concept closes gaps first, then shaky ones, then unchecked ones, foundations first", () => {
  const concept = (id: string, state: "unprobed" | "gap" | "shaky" | "solid", position: number) => ({ id, state, position });
  assert.equal(nextConcept([concept("a", "unprobed", 0), concept("b", "shaky", 1), concept("c", "gap", 3), concept("d", "gap", 2)])?.id, "d");
  assert.equal(nextConcept([concept("a", "unprobed", 1), concept("b", "shaky", 2), concept("c", "solid", 0)])?.id, "b");
  assert.equal(nextConcept([concept("a", "unprobed", 1), concept("b", "unprobed", 0)])?.id, "b");
  assert.equal(nextConcept([concept("a", "solid", 0)]), null);
  assert.equal(progressText([]), "No concepts mapped yet");
  assert.equal(progressText([concept("a", "solid", 0), concept("b", "gap", 1), concept("c", "unprobed", 2)]), "1 of 3 solid · 1 gap · 1 not checked");
});

test("a topic maps concepts in order, skips duplicates, and each check moves its concept", async () => {
  const { db, close } = await database();
  try {
    const topic = await saveTopic(db, owner, { title: "  Bayes  ", aim: "Update a belief from evidence.", goal: { id: goals.analytics, title: "Read results" } });
    assert.deepEqual([topic.title, topic.goalId, topic.status, topic.revision], ["Bayes", goals.analytics, "active", 1]);
    await assert.rejects(saveTopic(db, owner, { aim: "No title" }), (error: Response) => error.status === 400);

    const first = await addConcepts(db, owner, { topicId: topic.id, concepts: [{ title: "Prior" }, { title: "Likelihood" }, { title: "prior" }] });
    assert.deepEqual([first.added, first.skipped], [2, 1]);
    const second = await addConcepts(db, owner, { topicId: topic.id, concepts: [{ title: "Posterior", summary: "What you believe after." }, { title: "LIKELIHOOD" }] });
    assert.deepEqual([second.added, second.skipped], [1, 1]);
    await assert.rejects(addConcepts(db, owner, { topicId: "missing", concepts: [{ title: "x" }] }), (error: Response) => error.status === 404);
    await assert.rejects(addConcepts(db, owner, { topicId: topic.id, concepts: Array.from({ length: 20 }, (_, n) => ({ title: `c${n}` })) }).then(() =>
      addConcepts(db, owner, { topicId: topic.id, concepts: Array.from({ length: 20 }, (_, n) => ({ title: `d${n}` })) })), (error: Response) => error.status === 400);

    let detail = await topicDetail(db, topic.id);
    assert.deepEqual(detail.concepts.slice(0, 3).map((concept) => [concept.title, concept.position, concept.state]), [["Prior", 0, "unprobed"], ["Likelihood", 1, "unprobed"], ["Posterior", 2, "unprobed"]]);
    const [prior, likelihood] = detail.concepts;
    const gap = await recordCheck(db, owner, { conceptId: likelihood.id, question: "What does the likelihood measure?", answer: " The chance the hypothesis is true ", outcome: "gap", insight: "Confuses likelihood with posterior." });
    assert.deepEqual(gap.concept, { id: likelihood.id, title: "Likelihood", from: "unprobed", to: "gap" });
    assert.equal(gap.check.answer, "The chance the hypothesis is true");
    await recordCheck(db, owner, { conceptId: prior.id, question: "Before any test, how likely is a disease that 1 in 1,000 people have?", answer: "One in a thousand, before we know anything else.", outcome: "solid" });
    detail = await topicDetail(db, topic.id);
    assert.equal(detail.next?.id, likelihood.id);
    assert.deepEqual(detail.checks.map((check) => check.outcome), ["solid", "gap"]);
    await assert.rejects(recordCheck(db, owner, { conceptId: prior.id, question: "q", answer: "a", outcome: "unprobed" as never }));
    await assert.rejects(recordCheck(db, owner, { conceptId: "missing", question: "q", answer: "a", outcome: "gap" }), (error: Response) => error.status === 404);

    // Changes are made at the revision the caller saw; a stale one is a conflict.
    const paused = await saveTopic(db, owner, { id: topic.id, revision: 1, status: "paused" });
    assert.deepEqual([paused.status, paused.revision, paused.goalId, paused.title], ["paused", 2, goals.analytics, "Bayes"]);
    await assert.rejects(saveTopic(db, owner, { id: topic.id, revision: 1, status: "done" }), (error: Response) => error.status === 409);
    await assert.rejects(saveTopic(db, owner, { id: "missing", revision: 1, status: "done" }), (error: Response) => error.status === 404);
    const unlinked = await saveTopic(db, owner, { id: topic.id, revision: 2, goal: null });
    assert.equal(unlinked.goalId, null);
    // Only an editor writes.
    await assert.rejects(saveTopic(db, { ...owner, canEdit: false }, { title: "x" }), (error: Response) => error.status === 403);

    const [summary] = await listTopics(db);
    assert.equal(summary.progress, `1 of ${detail.concepts.length} solid · 1 gap · ${detail.concepts.length - 2} not checked`);
  } finally {
    close();
  }
});

test("goals come from the member's Wiki: open Goal records only, open ones first", async () => {
  const result = await readGoals(hostOf(wikiHost().stub(scope())));
  assert.ok(result.available);
  assert.deepEqual(result.goals.map((goal) => [goal.title, goal.status, goal.due]), [
    ["Read our experiment results without help", "active", null],
    ["Run a sub-4 marathon", "active", "2027-04-18"],
  ]);
  // Without a Wiki, topics still start from a prompt.
  assert.deepEqual(await readGoals(hostOf(wikiHost({ wiki: false }).stub(scope()))), { available: false, reason: "Add the Wiki app to your own apps to start topics from your goals." });
});

test("the demo fixture is what the app's own code computes for the demo scenario", async () => {
  assert.deepEqual(JSON.parse(await readFile(demoPath, "utf8")), await demoState(), "regenerate it with scripts/demo-fixtures.ts");
});
