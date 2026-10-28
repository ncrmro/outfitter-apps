import assert from "node:assert/strict";
import test from "node:test";
import { appArtifact } from "@ai-outfitter/app-test/prepare";
import { appWorker } from "@ai-outfitter/app-test/worker";
import { healthRecords, hostDouble, scope } from "./helpers/fixtures";

// The built operational worker over its installation database, as a member's
// own (user-owned) installation, with a workflow host double serving a
// synthetic Apple Health import.

const api = "/api/apps/yoga-practice";
/** The owner of a personal app: no organization, the owner header names the user. */
const owner = { userId: "member-1", organizationId: "", role: "owner", owner: { kind: "user" as const, id: "member-1" } };
const artifact = () => appArtifact(new URL("..", import.meta.url), "operational");
// biome-ignore lint/suspicious/noExplicitAny: API answers are asserted structurally.
const json = async (response: Response): Promise<any> => {
  assert.ok(response.ok, `${response.status} ${await response.clone().text()}`);
  return response.json();
};
const as = (method = "GET", body?: unknown) => ({ method, ...(body === undefined ? {} : { body }), workflowHost: scope(method) });

test("sync imports yoga workouts and mindful sessions once each, with recovery readings, through the owner's connection", async () => {
  const health = healthRecords(Date.now());
  // A heart rate in another unit is not a resting heart rate the weekly average can use.
  const stray = { ...health.readings[0], id: "hk-rhr-stray", unit: "count/s" };
  // Pages of 25 make the sync follow the connector's cursor (42 days of readings) without reaching the page cap.
  const double = hostDouble({ ...health, readings: [...health.readings, stray] }, { pageSize: 25 });
  const app = await appWorker("yoga-practice", artifact(), "yoga", { workflowHost: double.host });
  try {
    assert.equal((await app.call(`${api}/sessions`)).status, 401);
    assert.deepEqual(await json(await app.call(`${api}/health`, owner, as())), { connected: true, lastSyncedAt: null });

    const first = await json(await app.call(`${api}/health`, owner, as("POST", {})));
    const readings = health.readings.length;
    assert.deepEqual({ ...first, runId: undefined }, {
      runId: undefined, run: "complete", workouts: health.workouts.length, mindful: health.mindful.length,
      sessions: health.workouts.length + health.mindful.length, readings, skipped: 0, truncated: false,
    });
    assert.deepEqual(double.runs.get(first.runId)?.inputs, { "import.inputs.days": 90 });
    // Only the declared read operations, on the owner's own import.
    const executed = double.calls.filter((call) => call.operation === "connector.execute");
    assert.ok(executed.every((call) => call.input.connectionId === "apple-health-1" && call.input.resource === "member-1-health"));
    const activities = executed.filter((call) => call.input.operation === "workouts.list").map((call) => (call.input.input as { activity: string }).activity);
    assert.deepEqual([...new Set(activities)], ["yoga", "mind-and-body", "pilates", "flexibility"]);
    const metrics = executed.filter((call) => call.input.operation === "samples.list").map((call) => (call.input.input as { metric: string }).metric);
    assert.deepEqual([...new Set(metrics)], ["mindful-session", "resting-heart-rate", "heart-rate-variability"]);
    assert.ok(executed.some((call) => (call.input.input as { cursor?: string }).cursor), "later pages are read by cursor");

    // A second sync reads the same records and adds nothing.
    const second = await json(await app.call(`${api}/health`, owner, as("POST", {})));
    assert.deepEqual([second.sessions, second.readings, second.run], [0, 0, "complete"]);
    assert.notEqual(second.runId, first.runId);

    const list = await json(await app.call(`${api}/sessions`, owner));
    assert.equal(list.canEdit, true);
    assert.equal(list.sessions.length, health.workouts.length + health.mindful.length);
    const mindful = list.sessions.filter((row: { source: string }) => row.source === "health-mindful");
    assert.equal(mindful.length, health.mindful.length);
    assert.ok(list.sessions.every((row: { style: string; intensity: null }) => row.style === "other" && row.intensity === null), "untagged until the member tags them");
    const hostile = list.sessions.find((row: { healthSource: string | null }) => row.healthSource?.includes("<img"));
    assert.equal(hostile.healthSource, "Mat Flow <img src=x onerror=alert(1)>");
    assert.equal(hostile.heartRateAverage, 104);

    // The member tags an imported session; a stale revision is a conflict.
    const change = { practicedAt: hostile.practicedAt, durationMinutes: 75, style: "power", intensity: "strong", focus: ["back", "back", "balance"], note: " Held crow " };
    const tagged = await json(await app.call(`${api}/sessions/${hostile.id}`, owner, { method: "PUT", body: { ...change, revision: 1 } }));
    assert.deepEqual([tagged.style, tagged.intensity, tagged.focus, tagged.note, tagged.revision], ["power", "strong", ["back", "balance"], "Held crow", 2]);
    assert.equal((await app.call(`${api}/sessions/${hostile.id}`, owner, { method: "PUT", body: { ...change, revision: 1 } })).status, 409);

    // A deleted imported session stays deleted after the next sync.
    const [gone] = mindful;
    assert.equal((await app.call(`${api}/sessions/${gone.id}`, owner, { method: "DELETE", body: { revision: 9 } })).status, 409);
    assert.deepEqual(await json(await app.call(`${api}/sessions/${gone.id}`, owner, { method: "DELETE", body: { revision: 1 } })), { deleted: gone.id });
    assert.equal((await app.call(`${api}/sessions/${gone.id}`, owner, { method: "DELETE", body: { revision: 1 } })).status, 404);
    await json(await app.call(`${api}/health`, owner, as("POST", {})));
    const after = await json(await app.call(`${api}/sessions`, owner));
    assert.equal(after.sessions.length, list.sessions.length - 1);
    assert.ok(!after.sessions.some((row: { id: string }) => row.id === gone.id));

    // Recovery readings feed the weekly trend.
    const overview = await json(await app.call(`${api}/overview`, owner));
    assert.equal(overview.weeks.length, 8);
    assert.ok(overview.weeks.slice(-6).every((week: { restingHeartRate: number | null; hrv: number | null }) => week.restingHeartRate && week.hrv));
    const status = await json(await app.call(`${api}/health`, owner, as()));
    assert.equal(status.connected, true);
    assert.equal(typeof status.lastSyncedAt, "number");
  } finally {
    await app.dispose();
  }
});

test("without Apple Health the app says how to import it, and sessions and the target still work by hand", async () => {
  const double = hostDouble(healthRecords(Date.now()), { connected: false });
  const app = await appWorker("yoga-practice", artifact(), "yoga", { workflowHost: double.host });
  try {
    assert.deepEqual(await json(await app.call(`${api}/health`, owner, as())), { connected: false, lastSyncedAt: null });
    const sync = await app.call(`${api}/health`, owner, as("POST", {}));
    assert.equal(sync.status, 409);
    assert.match(await sync.text(), /\/connectors\/apple-health/);
    assert.ok(!double.calls.some((call) => call.operation.startsWith("workflow.")), "no run starts without an import");

    const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
    const session = { practicedAt: today, durationMinutes: 45, style: "yin", intensity: "gentle", focus: ["hips"], note: "Evening" };
    const created = await json(await app.call(`${api}/sessions`, owner, { method: "POST", body: session }));
    assert.equal(created.source, "manual");
    for (const invalid of [{ ...session, style: "hot" }, { ...session, durationMinutes: 0 }, { ...session, focus: ["toes"] }, { ...session, practicedAt: today + 3 * 86_400_000 }])
      assert.equal((await app.call(`${api}/sessions`, owner, { method: "POST", body: invalid })).status, 400);
    // Someone without the right to change the app reads but cannot write.
    const reader = { ...owner, role: "member" };
    assert.equal((await app.call(`${api}/sessions`, reader, { method: "POST", body: session })).status, 403);
    assert.equal((await app.call(`${api}/settings`, reader, { method: "PUT", body: { sessions: 2, minutes: 60 } })).status, 403);

    assert.deepEqual(await json(await app.call(`${api}/settings`, owner)), { target: { sessions: 3, minutes: 120 }, lastSyncedAt: null });
    assert.equal((await app.call(`${api}/settings`, owner, { method: "PUT", body: { sessions: 0, minutes: 60 } })).status, 400);
    await json(await app.call(`${api}/settings`, owner, { method: "PUT", body: { sessions: 1, minutes: 60 } }));
    const overview = await json(await app.call(`${api}/overview`, owner));
    assert.deepEqual([overview.target, overview.thisWeek, overview.streak], [{ sessions: 1, minutes: 60 }, { sessions: 1, minutes: 45, met: true }, 1]);
    // The streak reads further back than the chart's eight weeks.
    for (let weeksAgo = 1; weeksAgo <= 11; weeksAgo++)
      await json(await app.call(`${api}/sessions`, owner, { method: "POST", body: { ...session, practicedAt: today - weeksAgo * 7 * 86_400_000 } }));
    assert.equal((await json(await app.call(`${api}/overview?timeZone=America/Los_Angeles`, owner))).streak, 12);
  } finally {
    await app.dispose();
  }
});

test("only the owner of the member's own installation gets in; an organization's installation is refused", async () => {
  const double = hostDouble(healthRecords(Date.now()), { owner: "organization" });
  const app = await appWorker("yoga-practice", artifact(), "yoga", { workflowHost: double.host });
  const session = { practicedAt: Date.now(), durationMinutes: 30, style: "yin", intensity: "gentle", focus: [], note: "" };
  const routes: [string, string, unknown?][] = [
    ["sessions", "GET"], ["overview", "GET"], ["settings", "GET"], ["health", "GET"], ["sessions", "POST", session],
    ["sessions/some-id", "PUT", { ...session, revision: 1 }], ["sessions/some-id", "DELETE", { revision: 1 }],
    ["settings", "PUT", { sessions: 2, minutes: 60 }], ["health", "POST", {}],
  ];
  // Any member of an organization, its owner included.
  const member = { userId: "member-1", organizationId: "org-1", role: "owner" };
  // Someone else on this member's own installation.
  const stranger = { ...owner, userId: "member-2" };
  try {
    for (const [path, method, body] of routes) {
      const refused = await app.call(`${api}/${path}`, member, as(method, body));
      assert.equal(refused.status, 403, `${method} ${path}`);
      assert.match(await refused.text(), /personal app/);
      assert.equal((await app.call(`${api}/${path}`, stranger, as(method, body))).status, 404, `${method} ${path}`);
    }
    assert.ok(!double.calls.length, "no route reaches the host");
    // The sync takes an empty JSON object and nothing else.
    assert.equal((await app.call(`${api}/health`, owner, as("POST", { days: 3650 }))).status, 400);
  } finally {
    await app.dispose();
  }
});
