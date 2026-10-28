import assert from "node:assert/strict";
import test from "node:test";
import { appArtifact } from "@ai-outfitter/app-test/prepare";
import { appWorker } from "@ai-outfitter/app-test/worker";
import { demoReps, healthFixture, hostDouble, SESSIONS, scope, sessionDate } from "./helpers/fixtures";

// The built operational worker over its installation database, as a member's
// own app (no organization), with a workflow host double over a fixture Apple
// Health connection.

const nicholas = { userId: "member-1", organizationId: "", role: "owner", owner: { kind: "user" as const, id: "member-1" } };
const artifact = () => appArtifact(new URL("..", import.meta.url), "operational");
const api = (path: string) => `/api/apps/strength-five/${path}`;
// biome-ignore lint/suspicious/noExplicitAny: API answers are asserted structurally.
const json = async (response: Response): Promise<any> => {
  assert.ok(response.ok, `${response.status} ${await response.clone().text()}`);
  return response.json();
};
/** The owner's request as the platform forwards it, with the scope its method gets. */
const as = (method = "GET", body?: unknown) =>
  ({ method, ...(body === undefined ? {} : { body }), workflowHost: scope(method) });

test("the owner sets starting weights, logs sessions and the weights progress", async () => {
  const double = hostDouble(healthFixture());
  const app = await appWorker("strength-five", artifact(), "strength", { workflowHost: double.host });
  try {
    assert.equal((await app.call(api("today"))).status, 401);
    const first = await json(await app.call(api("today"), nicholas));
    assert.equal(first.canEdit, true);
    assert.deepEqual(first.next.lifts.map((lift: { weightKg: number }) => lift.weightKg), [20, 20, 20]);
    assert.equal(first.bodyweight.current, null);

    // Weights go up in 2.5 kg from the bar.
    assert.equal((await app.call(api("weights"), nicholas, as("PUT", { weights: { squat: 61 } }))).status, 400);
    const set = await json(await app.call(api("weights"), nicholas, as("PUT", { weights: { squat: 60, deadlift: 80 } })));
    assert.deepEqual(set.weights.map((lift: { weightKg: number }) => lift.weightKg), [60, 20, 20, 20, 80]);

    // Session 1, A: the row misses a rep, so it repeats; the rest go up.
    const saved = await json(await app.call(api("sessions"), nicholas, as("POST", {
      sequence: 1, workout: "A", date: sessionDate(1), lifts: { squat: [5, 5, 5, 5, 5], bench: [5, 5, 5, 5, 5], row: [5, 5, 5, 5, 4] },
    })));
    assert.equal(saved.next.workout, "B");
    assert.deepEqual(saved.next.lifts.map((lift: { lift: string; weightKg: number }) => [lift.lift, lift.weightKg]),
      [["squat", 62.5], ["press", 20], ["deadlift", 80]]);
    // The same session again is refused, as is a workout that is not next.
    const again = await app.call(api("sessions"), nicholas, as("POST", { sequence: 1, workout: "A", date: sessionDate(1), lifts: {} }));
    assert.equal(again.status, 409);
    assert.equal((await app.call(api("sessions"), nicholas, as("POST", { sequence: 2, workout: "B", date: sessionDate(2), lifts: { bench: [5] } }))).status, 400);
    // Session 2, B with an empty deadlift set: it counts as a miss.
    await json(await app.call(api("sessions"), nicholas, as("POST", {
      sequence: 2, workout: "B", date: sessionDate(2), lifts: { squat: [5, 5, 5, 5, 5], press: [5, 5, 5, 5, 5] },
    })));
    const { sessions } = await json(await app.call(api("sessions"), nicholas));
    assert.deepEqual(sessions.map((session: { sequence: number; lifts: { lift: string; reps: number[]; succeeded: boolean }[] }) =>
      [session.sequence, session.lifts.map((lift) => [lift.lift, lift.reps.join(""), lift.succeeded])]), [
      [2, [["squat", "55555", true], ["press", "55555", true], ["deadlift", "0", false]]],
      [1, [["squat", "55555", true], ["bench", "55555", true], ["row", "55554", false]]],
    ]);
    const weights = await json(await app.call(api("weights"), nicholas));
    assert.deepEqual(weights.weights.map((lift: { weightKg: number }) => lift.weightKg), [65, 22.5, 20, 22.5, 80]);
  } finally {
    await app.dispose();
  }
});

test("Sync from Apple Health reads strength workouts and body mass through the owner's connection and matches them to sessions", async () => {
  const double = hostDouble(healthFixture());
  const app = await appWorker("strength-five", artifact(), "strength", { workflowHost: double.host });
  try {
    for (let n = 1; n <= 3; n++) {
      const { next } = await json(await app.call(api("today"), nicholas));
      await json(await app.call(api("sessions"), nicholas, as("POST", { sequence: n, workout: next.workout, date: sessionDate(n), lifts: demoReps(n, next.lifts) })));
    }
    assert.deepEqual(await json(await app.call(api("health"), nicholas, as())), { connected: true, lastSyncedAt: null });
    const synced = await json(await app.call(api("health"), nicholas, as("POST", { timeZone: "UTC" })));
    // The fixture's strength workouts and the past body mass readings; the run is left out.
    assert.equal(synced.workouts, SESSIONS);
    assert.ok(synced.samples > 0);
    const reads = double.calls.filter((call) => call.operation === "connector.execute").map((call) => {
      const input = call.input.input as Record<string, unknown>;
      return [call.input.operation, input.activity ?? input.metric];
    });
    assert.deepEqual(reads, [
      ["workouts.list", "traditional-strength-training"], ["workouts.list", "functional-strength-training"], ["samples.list", "body-mass"],
    ]);
    // A fixed year back from now, every time.
    const windows = double.calls.filter((call) => call.operation === "connector.execute")
      .map((call) => { const input = call.input.input as { from: string; to: string }; return Date.parse(input.to) - Date.parse(input.from); });
    assert.ok(windows.every((span) => span === 365 * 86_400_000));
    // One run, its one step collected with the counts only.
    assert.deepEqual([...double.runs.values()].map((run) => run.collected),
      [{ "sync.outputs.health": { workouts: synced.workouts, samples: synced.samples, skipped: 0, truncated: false } }]);

    const { sessions } = await json(await app.call(api("sessions"), nicholas));
    const health = sessions.map((session: { health: { durationMinutes: number; heartRateMax: number; source: string } | null }) => session.health);
    assert.ok(health.every(Boolean), "each session has the Health workout from its day");
    // Provider text stays text: the markup arrives as a string the page sets with textContent.
    assert.equal(sessions.find((session: { sequence: number }) => session.sequence === 3).health.source, "<img src=x onerror=alert(1)> Watch");
    const today = await json(await app.call(api("today"), nicholas));
    assert.ok(today.bodyweight.current.kg > 80);
    assert.equal(today.bodyweight.series.length > 0, true);

    // A second sync reads the same window again and keeps one row per Health record.
    const second = await json(await app.call(api("health"), nicholas, as("POST", { timeZone: "UTC" })));
    assert.equal(double.runs.size, 2);
    assert.equal(second.workouts, synced.workouts);
    const status = await json(await app.call(api("health"), nicholas, as()));
    assert.equal(typeof status.lastSyncedAt, "number");
    assert.equal((await json(await app.call(api("sessions"), nicholas))).sessions.length, 3);
  } finally {
    await app.dispose();
  }
});

test("without an Apple Health import the app says where to import it; a failed read leaves the run to resume", async () => {
  const none = hostDouble(healthFixture(), { connected: false });
  const app = await appWorker("strength-five", artifact(), "strength", { workflowHost: none.host });
  try {
    assert.deepEqual(await json(await app.call(api("health"), nicholas, as())), { connected: false, lastSyncedAt: null });
    const response = await app.call(api("health"), nicholas, as("POST", {}));
    assert.equal(response.status, 409);
    assert.match(await response.text(), /\/connectors\/apple-health/);
    assert.ok(!none.calls.some((call) => call.operation.startsWith("workflow.")), "no run starts without an import");
    // Without edit rights the owner reads but cannot log.
    const reader = { ...nicholas, role: "member" };
    assert.equal((await app.call(api("sessions"), reader, as("POST", { sequence: 1, workout: "A", date: sessionDate(1), lifts: {} }))).status, 403);
  } finally {
    await app.dispose();
  }
  const flaky = hostDouble(healthFixture(), { failReads: true });
  const other = await appWorker("strength-five", artifact(), "strength", { workflowHost: flaky.host });
  try {
    assert.equal((await other.call(api("health"), nicholas, as("POST", {}))).status, 502);
    const [runId] = flaky.runs.keys();
    flaky.options.failReads = false;
    const resumed = await json(await other.call(api("health"), nicholas, as("POST", {})));
    assert.equal(resumed.runId, runId, "the waiting run is resumed, not a new one started");
    assert.equal(flaky.runs.size, 1);
  } finally {
    await other.dispose();
  }
});

test("a sync that reaches the page cap keeps the newest records and says so", async () => {
  // Pages of 5: the cap of two pages reads 10 of the 14 traditional strength workouts.
  const double = hostDouble(healthFixture(), { pageSize: 5 });
  const app = await appWorker("strength-five", artifact(), "strength", { workflowHost: double.host });
  try {
    const synced = await json(await app.call(api("health"), nicholas, as("POST", { timeZone: "UTC" })));
    assert.equal(synced.truncated, true);
    assert.equal(synced.workouts, 11);
    assert.deepEqual([...double.runs.values()].map((run) => run.collected["sync.outputs.health"]),
      [{ workouts: 11, samples: synced.samples, skipped: 0, truncated: true }]);
  } finally {
    await app.dispose();
  }
});

test("a record the app cannot read is skipped and counted, and an empty sync still counts as synced", async () => {
  const health = healthFixture();
  // The connector allows 256-character ids; a negative duration is not a workout the app can read.
  health.workouts[0] = { ...health.workouts[0], id: `hw-${"x".repeat(250)}` };
  health.workouts[1] = { ...health.workouts[1], durationMinutes: -1 };
  const double = hostDouble(health);
  const app = await appWorker("strength-five", artifact(), "strength", { workflowHost: double.host });
  try {
    const synced = await json(await app.call(api("health"), nicholas, as("POST", { timeZone: "UTC" })));
    assert.deepEqual([synced.workouts, synced.skipped, synced.run], [SESSIONS - 1, 1, "complete"]);
  } finally {
    await app.dispose();
  }
  const empty = hostDouble({ workouts: [], samples: [] });
  const other = await appWorker("strength-five", artifact(), "strength", { workflowHost: empty.host });
  try {
    const synced = await json(await other.call(api("health"), nicholas, as("POST", {})));
    assert.deepEqual([synced.workouts, synced.samples], [0, 0]);
    const status = await json(await other.call(api("health"), nicholas, as()));
    assert.equal(typeof status.lastSyncedAt, "number");
  } finally {
    await other.dispose();
  }
});

test("only the owner of the member's own installation gets in; an organization's installation is refused", async () => {
  const double = hostDouble(healthFixture(), { owner: "organization" });
  const app = await appWorker("strength-five", artifact(), "strength", { workflowHost: double.host });
  const routes: [string, string, unknown?][] = [
    ["today", "GET"], ["sessions", "GET"], ["weights", "GET"], ["health", "GET"],
    ["sessions", "POST", { sequence: 1, workout: "A", date: sessionDate(1), lifts: {} }], ["weights", "PUT", { weights: { squat: 60 } }],
    ["health", "POST", {}],
  ];
  // Any member of an organization, its owner included.
  const member = { userId: "member-1", organizationId: "org-1", role: "owner" };
  // Someone else on this member's own installation.
  const stranger = { ...nicholas, userId: "member-2" };
  try {
    for (const [path, method, body] of routes) {
      const refused = await app.call(api(path), member, as(method, body));
      assert.equal(refused.status, 403, `${method} ${path}`);
      assert.match(await refused.text(), /personal app/);
      assert.equal((await app.call(api(path), stranger, as(method, body))).status, 404, `${method} ${path}`);
    }
    assert.ok(!double.calls.length, "no route reaches the host");
  } finally {
    await app.dispose();
  }
});
