import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { type LoggedSession, nextSession, nextWorkout, progress, replay, roundDown, succeeded } from "../src/lib/program";
import { localDate } from "../src/lib/views";
import { demoPath, demoResponses } from "./helpers/fixtures";

const five = [5, 5, 5, 5, 5];

test("workouts alternate A and B, starting with A", () => {
  assert.equal(nextWorkout(null), "A");
  assert.equal(nextWorkout("A"), "B");
  assert.equal(nextWorkout("B"), "A");
  const first = nextSession([]);
  assert.deepEqual([first.sequence, first.workout, first.lifts.map((lift) => [lift.lift, lift.sets, lift.weightKg])],
    [1, "A", [["squat", 5, 20], ["bench", 5, 20], ["row", 5, 20]]]);
  const second = nextSession([{ workout: "A", lifts: [] }]);
  assert.deepEqual(second.lifts.map((lift) => [lift.lift, lift.sets, lift.weightKg]), [["squat", 5, 20], ["press", 5, 20], ["deadlift", 1, 40]]);
});

test("every set of five adds 2.5 kg, or 5 kg on the deadlift", () => {
  assert.deepEqual(progress("squat", 60, five, 0), { weightKg: 62.5, failures: 0 });
  assert.deepEqual(progress("deadlift", 100, [5], 2), { weightKg: 105, failures: 0 });
  // More than five counts as five; fewer sets than the plan is not a success.
  assert.equal(succeeded("bench", [6, 5, 5, 5, 5]), true);
  assert.equal(succeeded("bench", [5, 5, 5, 5]), false);
});

test("a missed set repeats the weight; the third miss in a row deloads 10%, rounded down to 2.5 kg", () => {
  assert.deepEqual(progress("squat", 60, [5, 5, 5, 5, 4], 0), { weightKg: 60, failures: 1 });
  assert.deepEqual(progress("squat", 60, [5, 5, 5, 5, 4], 1), { weightKg: 60, failures: 2 });
  // 60 × 0.9 = 54 → 52.5.
  assert.deepEqual(progress("squat", 60, [5, 5, 5, 5, 4], 2), { weightKg: 52.5, failures: 0 });
  assert.equal(roundDown(100 * 0.9), 90);
  assert.equal(roundDown(47.5 * 0.9), 42.5);
  // Never below the empty bar.
  assert.equal(roundDown(20 * 0.9), 20);
});

test("replay counts misses per lift across sessions, and a success resets them", () => {
  const session = (workout: "A" | "B", squat: number, reps: number[]): LoggedSession => ({ workout, lifts: [{ lift: "squat", weightKg: squat, reps }] });
  const miss = [5, 5, 4, 3, 3];
  assert.deepEqual(replay([session("A", 60, miss), session("B", 60, five)]).squat, { weightKg: 62.5, failures: 0 });
  assert.deepEqual(replay([session("A", 60, miss), session("B", 60, miss)]).squat, { weightKg: 60, failures: 2 });
  assert.deepEqual(replay([session("A", 60, miss), session("B", 60, miss), session("A", 60, miss)]).squat, { weightKg: 52.5, failures: 0 });
  // Lifts not in a session keep their state.
  assert.deepEqual(replay([session("A", 60, miss)]).deadlift, { weightKg: 40, failures: 0 });
});

test("the member's weights replace the defaults where they set them, and progression continues from there", () => {
  const overrides = [
    { lift: "squat" as const, weightKg: 60, afterSessions: 0 },
    { lift: "squat" as const, weightKg: 50, afterSessions: 1 },
  ];
  assert.equal(replay([], overrides).squat.weightKg, 60);
  const sessions: LoggedSession[] = [{ workout: "A", lifts: [{ lift: "squat", weightKg: 60, reps: five }] }];
  // After one session the member reset the squat to 50; failures clear with it.
  assert.deepEqual(replay(sessions, overrides).squat, { weightKg: 50, failures: 0 });
  assert.equal(nextSession(sessions, overrides).lifts[0].weightKg, 50);
});

test("calendar days follow the member's time zone", () => {
  const late = Date.parse("2026-10-16T03:30:00Z");
  assert.equal(localDate(late, "UTC"), "2026-10-16");
  assert.equal(localDate(late, "America/Chicago"), "2026-10-15");
  assert.equal(localDate(late, "Not/AZone"), "2026-10-16");
});

test("the demo fixture is what the app's own code computes from the scenario", async () => {
  const saved = JSON.parse(await readFile(demoPath, "utf8"));
  assert.deepEqual(saved.responses, JSON.parse(JSON.stringify(await demoResponses())), "run scripts/demo-fixtures.ts");
  const { sessions } = saved.responses.sessions;
  // Five weeks, the squat deloads once, and each session has its Health workout.
  assert.equal(sessions.length, 15);
  assert.deepEqual(sessions.flatMap((session: { lifts: { lift: string; change: string; weightKg: number }[] }) =>
    session.lifts.filter((lift) => lift.change === "down").map((lift) => [lift.lift, lift.weightKg])), [["squat", 52.5]]);
  assert.ok(sessions.every((session: { health: unknown }) => session.health));
});
