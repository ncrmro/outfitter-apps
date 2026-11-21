import assert from "node:assert/strict";
import test from "node:test";
import { cases } from "../evals/tutor/cases";
import { closedQuestion, grade, ownWords, questions, transcript, universal } from "../evals/tutor/grade";
import type { Entry, Proposal } from "./helpers/tutor";

// The eval's grader on hand-written conversations: no model, no Worker.

const entries = (...turns: [string, string, { name: string; input: unknown }[]?][]): Entry[] =>
  turns.flatMap(([member, reply, tools = []], n) => [
    { id: `u${n}`, role: "user", parts: [{ type: "text", text: member }] },
    { id: `a${n}`, role: "assistant", parts: [...tools.map((call) => ({ type: "tool-call", ...call })), { type: "text", text: reply }] },
  ]);
const proposal = (action: string, changes: Record<string, unknown>): Proposal => ({ id: crypto.randomUUID(), action, status: "pending", revision: 1, changes });
const seed = { topicId: "t1", concepts: { "p-value": "c-p", "Confidence interval": "c-ci", "Statistical power": "c-power" } };
const named = (id: string) => {
  const found = cases.find((item) => item.id === id);
  assert.ok(found, id);
  return found;
};

test("question counting and closed questions", () => {
  assert.equal(questions("Good start. What does 0.03 describe? Think aloud."), 1);
  assert.equal(questions("What is it? And why?"), 2);
  assert.ok(closedQuestion("Nice. Is a p-value the chance the null is true?"));
  assert.ok(!closedQuestion("What would you expect to see if B changed nothing?"));
  assert.equal(ownWords("a 3% chance the new version isn't better", "It means there's only a 3% chance the new version isn't actually better."), 1);
  assert.ok(ownWords("They understand Bayesian updating well", "no idea") < 0.2);
});

test("a Socratic reply to a misconception passes; a lecture that invents the answer fails", () => {
  const good = transcript(entries(
    ["Ask me about p-values.", "Say the new checkout truly changes nothing. What does p = 0.03 describe?"],
    ["It means there's only a 3% chance the new version isn't actually better.", "Interesting. If B truly did nothing, how often would you still see a gap this big?", [{ name: "autodidact_check_record", input: {} }]],
  ), [proposal("check.record", { conceptId: "c-p", outcome: "gap", answer: "only a 3% chance the new version isn't actually better" })]);
  const passing = grade([...universal(good), ...named("record-misconception").expect(good, seed)]);
  assert.equal(passing.pass, true, JSON.stringify(passing.checks.filter((item) => !item.pass)));

  const lecture = "A p-value is the probability of seeing data at least this extreme if the null hypothesis were true. It is not the probability that the hypothesis is true. ".repeat(5) + "I've recorded this as solid. Does that make sense? Any questions?";
  const bad = transcript(entries(["Ask me about p-values.", "What is a p-value?"], ["It means there's only a 3% chance the new version isn't actually better.", lecture]),
    [proposal("check.record", { conceptId: "c-p", outcome: "solid", answer: "The member understands p-values as tail probabilities under the null." })]);
  const failing = grade([...universal(bad), ...named("record-misconception").expect(bad, seed)]);
  const failed = failing.checks.filter((item) => !item.pass).map((item) => item.name);
  for (const name of ["one-question (turn 2)", "concise (turn 2)", "no-false-claims (turn 2)", "answer-is-members", "judged-gap", "no-lecture"]) assert.ok(failed.includes(name), `${name} in ${failed.join(", ")}`);
});

test("starting from a goal must read the Wiki and link only real goals", () => {
  const t = transcript(entries(["Where do we begin?", "Your Wiki has two goals: reading experiment results and a sub-4 marathon. Which one matters more right now?", [{ name: "autodidact_goals_read", input: {} }]]), []);
  assert.equal(grade(named("start-from-goal").expect(t, { concepts: {} })).pass, true);
  const invented = transcript(entries(["Where do we begin?", "Let's start with marathon pacing. What pace do you run now?"]),
    [proposal("topic.save", { title: "Marathon pacing", goal: { id: "made-up", title: "Run fast" } })]);
  const failed = grade(named("start-from-goal").expect(invented, { concepts: {} })).checks.filter((item) => !item.pass).map((item) => item.name);
  assert.deepEqual(failed, ["reads-goals", "real-goal-links"]);
});

test("every case has a unique id and at least one turn", () => {
  assert.equal(new Set(cases.map((item) => item.id)).size, cases.length);
  assert.ok(cases.every((item) => item.turns.length > 0 && item.description));
});
