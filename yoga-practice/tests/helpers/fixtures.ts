import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { sql } from "drizzle-orm";
import type { AppIdentity } from "@ai-outfitter/app-sdk/server";
import { type HealthRecords, type HostOptions, healthHostDouble, interactiveScope } from "../../../apple-health-test-host";
import { weekStart } from "../../src/lib/practice";
import { changeTarget, listSessions, loadSettings, practiceOverview, sessionChange, updateSession } from "../../src/server/practice";
import { sessions } from "../../src/server/schema";
import { syncFromHealth } from "../../src/server/sync";

// The package's synthetic Apple Health import (no real person's data) and the
// scenario the demo shows. Times are relative to `now`, so a test run today
// and the demo's fixed week read the same six weeks.

const DAY = 86_400_000;
const HOUR = 3_600_000;
const WEEK = 7 * DAY;
const iso = (time: number) => new Date(time).toISOString();

// [weeks ago, day of week (0 = Monday), hour UTC, activity, minutes, average heart rate]
const plan: [number, number, number, string, number, number | null][] = [
  [5, 1, 7, "yoga", 45, 96], [5, 4, 18, "yoga", 30, 92],
  [4, 0, 7, "yoga", 60, 101], [4, 2, 18, "yoga", 45, 98],
  [3, 1, 7, "yoga", 75, 104], [3, 3, 17, "pilates", 50, 112],
  [2, 0, 7, "yoga", 45, 99], [2, 2, 18, "yoga", 30, 90], [2, 4, 12, "flexibility", 20, null],
  [1, 1, 7, "yoga", 60, 102], [1, 3, 18, "mind-and-body", 40, 84], [1, 5, 9, "yoga", 30, 95],
  [0, 0, 7, "yoga", 45, 97],
];
// [weeks ago, day, hour, minutes]
const mindfulPlan: [number, number, number, number][] = [[4, 5, 21, 15], [2, 6, 21, 10], [0, 1, 21, 12]];

/** Six weeks of synthetic Apple Health records up to `now`, as the connector returns them. */
export function healthRecords(now: number) {
  const monday = weekStart(now);
  const at = (weeksAgo: number, day: number, hour: number) => monday - weeksAgo * WEEK + day * DAY + hour * HOUR;
  const workouts: HealthRecords["workouts"] = plan.map(([weeksAgo, day, hour, activity, minutes, heart], index) => {
    const start = at(weeksAgo, day, hour);
    return {
      id: `hk-workout-${index + 1}`, startedAt: iso(start), endedAt: iso(start + minutes * 60_000), activity, durationMinutes: minutes,
      energyKcal: Math.round(minutes * 3.2), distanceMeters: null,
      heartRate: heart === null ? null : { average: heart, min: heart - 20, max: heart + 28 }, indoor: true,
      // One source carries markup and a bidirectional override: it must arrive as inert text.
      source: index === 4 ? "Mat Flow <img src=x onerror=alert(1)>‮" : "Synthetic Watch",
    };
  });
  const mindful: HealthRecords["samples"] = mindfulPlan.map(([weeksAgo, day, hour, minutes], index) => {
    const start = at(weeksAgo, day, hour);
    return { id: `hk-mindful-${index + 1}`, metric: "mindful-session", startedAt: iso(start), endedAt: iso(start + minutes * 60_000), value: null, unit: null, category: null, source: "Synthetic Breathe" };
  });
  // A reading every morning: resting heart rate easing down, HRV rising, with a small weekly wobble.
  const readings: HealthRecords["samples"] = [];
  for (let day = 0; day < 42; day++) {
    const time = at(5, 0, 6) + day * DAY;
    if (time > now) break;
    const wobble = [0, 1, -1, 0.5, -0.5, 1.5, -1.5][day % 7];
    readings.push(
      { id: `hk-rhr-${day}`, metric: "resting-heart-rate", startedAt: iso(time), endedAt: iso(time), value: Math.round(58 - day * 0.1 + wobble), unit: "count/min", category: null, source: "Synthetic Watch" },
      { id: `hk-hrv-${day}`, metric: "heart-rate-variability", startedAt: iso(time), endedAt: iso(time), value: Math.round(41 + day * 0.25 - wobble * 2), unit: "ms", category: null, source: "Synthetic Watch" },
    );
  }
  return { workouts: workouts.filter((item) => Date.parse(item.startedAt) <= now), mindful: mindful.filter((item) => Date.parse(item.startedAt) <= now), readings };
}

/** The shared workflow host double over a synthetic import, for this app's sync workflow. */
export const hostDouble = (health: ReturnType<typeof healthRecords>, options: Partial<HostOptions> = {}) =>
  healthHostDouble({ workouts: health.workouts, samples: [...health.mindful, ...health.readings] },
    { workflow: "yoga-health-sync", output: "import.outputs.imported", installationId: "yoga", ...options });
/** The owner's interactive scope for a request with `method`. */
export const scope = (method = "GET") => interactiveScope("yoga", method);

/** The owner of a personal installation: a user, with no organization. */
export const owner: AppIdentity = {
  userId: "member-1", owner: { kind: "user", id: "member-1" }, installationId: "yoga", role: "owner", canEdit: true,
};

/** A fresh installation database with the package's migrations, in memory. */
export async function database() {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../migrations", import.meta.url)) });
  return { db, close: () => client.close() };
}

export const demoPath = new URL("../../fixtures/demo.json", import.meta.url);

/** The demo's week: Wednesday evening, after a sync, with the owner's tags and two sessions added by hand. */
export const demoScenario = {
  now: Date.parse("2026-10-21T19:00:00Z"),
  tags: {
    "hk-workout-1": { style: "hatha", intensity: "gentle", focus: ["hips", "breath"], note: "Slow start; tight hips." },
    "hk-workout-3": { style: "vinyasa", intensity: "moderate", focus: ["shoulders"], note: "" },
    "hk-workout-5": { style: "power", intensity: "strong", focus: ["back", "balance"], note: "Long flow, held crow for 5 breaths." },
    "hk-workout-7": { style: "vinyasa", intensity: "moderate", focus: ["hamstrings"], note: "" },
    "hk-workout-8": { style: "yin", intensity: "gentle", focus: ["hips"], note: "" },
    "hk-workout-10": { style: "vinyasa", intensity: "strong", focus: ["shoulders", "balance"], note: "" },
    "hk-workout-12": { style: "hatha", intensity: "moderate", focus: ["hamstrings", "back"], note: "" },
    "hk-workout-13": { style: "vinyasa", intensity: "moderate", focus: ["breath"], note: "Monday class." },
  } as Record<string, { style: string; intensity: string; focus: string[]; note: string }>,
  manual: [
    { id: "manual-1", practicedAt: Date.parse("2026-10-18T12:00:00Z"), durationMinutes: 30, style: "restorative", intensity: "gentle", focus: ["back", "breath"], note: "Bolster and blocks before bed." },
    { id: "manual-2", practicedAt: Date.parse("2026-10-21T12:00:00Z"), durationMinutes: 40, style: "yin", intensity: "gentle", focus: ["hips", "hamstrings"], note: "" },
  ],
};

/** The demo's API responses, computed by the app's own code over the synthetic import. */
export async function demoResponses() {
  const { db, close } = await database();
  try {
    const { now, tags, manual } = demoScenario;
    await syncFromHealth(db, owner, hostDouble(healthRecords(now)).typed(), now);
    // Stable ids, so regenerating the fixture changes nothing.
    await db.update(sessions).set({ id: sql`'demo-' || ${sessions.sourceId}`, createdAt: now, updatedAt: now });
    for (const session of await listSessions(db)) {
      const tag = tags[session.id.slice("demo-".length)];
      if (tag) await updateSession(db, owner, session.id, sessionChange.parse({ ...tag, practicedAt: session.practicedAt, durationMinutes: session.durationMinutes, revision: session.revision }), now);
    }
    for (const { id, ...session } of manual)
      await db.insert(sessions).values({ ...session, id, source: "manual", sourceId: id, focus: JSON.stringify(session.focus), createdAt: now, updatedAt: now });
    await changeTarget(db, owner, { sessions: 3, minutes: 120 }, now);
    const { lastSyncedAt } = await loadSettings(db);
    return {
      sessions: { now, canEdit: false, sessions: await listSessions(db) },
      overview: await practiceOverview(db, now),
      settings: await loadSettings(db),
      health: { connected: true, lastSyncedAt },
    };
  } finally {
    close();
  }
}
