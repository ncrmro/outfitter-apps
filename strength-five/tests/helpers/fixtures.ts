import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { AppIdentity } from "@ai-outfitter/app-sdk/server";
import type { Lift } from "../../src/lib/program";
import { type HealthRecords, type HostOptions, healthHostDouble, interactiveScope } from "../../../apple-health-test-host";
import { healthStatus, syncFromHealth } from "../../src/server/health";
import { currentWeights, listSessions, saveSession, setWeights, today } from "../../src/server/training";

// The package's synthetic fixture set and the scenario the demo shows: five
// weeks of Monday, Wednesday and Friday sessions, a squat that stalls at 60 kg
// and deloads, and the Apple Health workouts and weigh-ins from those weeks.

/** The member who owns this personal installation (no organization). */
export const owner: AppIdentity = {
  userId: "member-1", owner: { kind: "user", id: "member-1" }, installationId: "strength", role: "owner", canEdit: true,
};
/** Anyone else the platform might forward (it does not, on a user's own app); read-only. */
export const viewer: AppIdentity = { ...owner, userId: "viewer", role: "member", canEdit: false };

/** A fresh installation database with the package's migrations, in memory. */
export async function database() {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client);
  await client.execute("PRAGMA foreign_keys = ON");
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../migrations", import.meta.url)) });
  return { db, close: () => client.close() };
}

export const starting: Record<Lift, number> = { squat: 40, bench: 30, row: 30, press: 25, deadlift: 60 };
const first = Date.parse("2026-09-14T00:00:00Z");
/** Session `n` (from 1): Monday, Wednesday, Friday from Sept 14. */
export const sessionDate = (n: number) => {
  const index = n - 1;
  return new Date(first + (Math.floor(index / 3) * 7 + (index % 3) * 2) * 86_400_000).toISOString().slice(0, 10);
};
/** Missed reps in the demo: the squat stalls three times, the bench once. */
const misses: Record<number, Partial<Record<Lift, number[]>>> = {
  7: { bench: [5, 5, 5, 5, 4] },
  9: { squat: [5, 5, 4, 3, 3] },
  10: { squat: [5, 5, 5, 4, 3] },
  11: { squat: [5, 4, 4, 3, 3] },
};
export const SESSIONS = 15;
export const demoNow = Date.parse("2026-10-16T19:00:00Z");

/** The reps the demo member made in session `n` of `workout`. */
export function demoReps(n: number, lifts: { lift: Lift; sets: number }[]) {
  return Object.fromEntries(lifts.map(({ lift, sets }) => [lift, misses[n]?.[lift] ?? Array(sets).fill(5)]));
}

/** The shared workflow host double over `health`, for this app's sync workflow. */
export const hostDouble = (health: HealthRecords, options: Partial<HostOptions> = {}) =>
  healthHostDouble(health, { workflow: "strength-health-sync", output: "sync.outputs.health", installationId: "strength", ...options });
/** The owner's interactive scope for a request with `method`. */
export const scope = (method = "GET") => interactiveScope("strength", method);

/** Health workouts on each session day, plus one on a rest day; one source carries markup. */
export function healthFixture(): HealthRecords {
  const workouts = Array.from({ length: SESSIONS }, (_, index) => {
    const start = Date.parse(`${sessionDate(index + 1)}T17:05:00Z`);
    const minutes = 48 + (index % 4) * 4;
    return {
      id: `hw-${index + 1}`, startedAt: new Date(start).toISOString(), endedAt: new Date(start + minutes * 60_000).toISOString(),
      activity: index === 4 ? "functional-strength-training" : "traditional-strength-training", durationMinutes: minutes,
      energyKcal: 260 + index * 6, distanceMeters: null, heartRate: { average: 118 + (index % 5), min: 82, max: 152 + (index % 7) },
      indoor: true, source: index === 2 ? "<img src=x onerror=alert(1)> Watch" : "Apple Watch",
    };
  });
  workouts.push({ ...workouts[0], id: "hw-run", activity: "running", startedAt: "2026-09-20T09:00:00.000Z", endedAt: "2026-09-20T09:30:00.000Z" });
  const samples = Array.from({ length: 12 }, (_, index) => {
    const at = Date.parse("2026-08-01T07:00:00Z") + index * 7 * 86_400_000;
    return { id: `bm-${index + 1}`, metric: "body-mass", startedAt: new Date(at).toISOString(), endedAt: new Date(at).toISOString(),
      value: Math.round((81.6 + index * 0.25 - (index > 8 ? 0.4 : 0)) * 100) / 100, unit: "kg", category: null, source: "Smart scale" };
  });
  return { workouts, samples };
}

/** Logs the demo's sessions through the app's own code, then syncs the Health fixture. */
export async function demoScenario(db: Awaited<ReturnType<typeof database>>["db"]) {
  await setWeights(db, owner, { weights: starting }, first);
  for (let n = 1; n <= SESSIONS; n++) {
    const now = Date.parse(`${sessionDate(n)}T18:00:00Z`);
    const next = (await today(db, owner, now)).next;
    await saveSession(db, owner, { sequence: next.sequence, workout: next.workout, date: sessionDate(n), lifts: demoReps(n, next.lifts) }, now);
  }
  const health = hostDouble(healthFixture());
  await syncFromHealth(db, owner, health.typed(), { timeZone: "UTC" }, demoNow);
  return health;
}

/** The demo's API responses, computed by the app's own code over the fixtures. */
export async function demoResponses() {
  const { db, close } = await database();
  try {
    await demoScenario(db);
    const status = await healthStatus(db, null, viewer);
    return {
      today: await today(db, viewer, demoNow),
      // Stable ids, so the fixture only changes when the app's output does.
      sessions: { sessions: (await listSessions(db)).sessions.map((session) => ({ ...session, id: `session-${session.sequence}` })) },
      weights: await currentWeights(db),
      health: { ...status, connected: true },
    };
  } finally {
    close();
  }
}
export const demoPath = new URL("../../fixtures/demo.json", import.meta.url);
