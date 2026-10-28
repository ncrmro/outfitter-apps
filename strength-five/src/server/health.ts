import { z } from "zod";
import type { AppIdentity } from "@ai-outfitter/app-sdk/server";
import {
  type Database, type HealthHost, type HealthSource, type HealthStatus, healthConnected, healthWindow, readSamples, readWorkouts, syncHealth, writeRows,
} from "../../../apple-health";
import { healthImportHint, localDate, SYNC_DAYS, type SyncResult } from "../lib/views";
import { bodyMass, healthWorkouts, settings } from "./schema";

// Sync from Apple Health: the strength-health-sync workflow has one step, sync,
// that the app fills on the owner's click (../../../apple-health.ts). Every
// sync re-reads the last year of strength workouts and body mass and upserts
// them by Health id, so a later export import fills in older records.

const sync = { workflow: "strength-health-sync", days: "sync.inputs.days", output: "sync.outputs.health", defaultDays: SYNC_DAYS };
const strengthActivities = ["traditional-strength-training", "functional-strength-training"];
const SETTINGS_ID = "app";

/** When the owner last synced, and whether their Apple Health import is connected. */
export async function healthStatus(db: Database, host: HealthHost | null, identity: AppIdentity): Promise<HealthStatus> {
  const [row] = await db.select({ lastSyncedAt: settings.lastSyncedAt }).from(settings);
  return { connected: await healthConnected(host, identity), lastSyncedAt: row?.lastSyncedAt ?? null };
}

/** sync: reads the window and keeps every strength workout and body mass reading. */
async function syncStep(db: Database, host: HealthHost, source: HealthSource, days: number, timeZone: string, now: number) {
  const window = healthWindow(days, now);
  const reads = await Promise.all(strengthActivities.map((activity) => readWorkouts(host, source, { ...window, activity })));
  const mass = await readSamples(host, source, { ...window, metric: "body-mass" });
  const workouts = reads.flatMap((read) => read.items).map((workout) => {
    const startedAt = Date.parse(workout.startedAt);
    return {
      id: workout.id, activity: workout.activity, date: localDate(startedAt, timeZone), startedAt,
      endedAt: Date.parse(workout.endedAt), durationMinutes: workout.durationMinutes, energyKcal: workout.energyKcal ?? null,
      heartRateAverage: workout.heartRate?.average ?? null, heartRateMax: workout.heartRate?.max ?? null,
      source: workout.source ?? "Apple Health", syncedAt: now,
    };
  });
  // The connector reports mass in kg; anything else is not a body mass reading.
  const samples = mass.items.flatMap((sample) =>
    typeof sample.value === "number" && sample.unit === "kg" && sample.value > 0 && sample.value <= 500
      ? [{ id: sample.id, measuredAt: Date.parse(sample.startedAt), kg: sample.value, source: sample.source ?? "Apple Health", syncedAt: now }]
      : []);
  await writeRows(db, healthWorkouts, workouts, [healthWorkouts.id]);
  await writeRows(db, bodyMass, samples, [bodyMass.id]);
  const all = [...reads, mass];
  return {
    workouts: workouts.length, samples: samples.length,
    skipped: all.reduce((sum, read) => sum + read.skipped, 0), truncated: all.some((read) => read.truncated),
  };
}

export const syncInput = z.strictObject({ timeZone: z.string().max(64).optional() });

/** The owner's "Sync from Apple Health"; a sync that finds nothing still counts as one. */
export async function syncFromHealth(db: Database, identity: AppIdentity, host: HealthHost, input: z.infer<typeof syncInput>, now = Date.now()): Promise<SyncResult> {
  const result = await syncHealth(identity, host, sync, healthImportHint, (source, days) => syncStep(db, host, source, days, input.timeZone ?? "UTC", now));
  await db.insert(settings).values({ id: SETTINGS_ID, lastSyncedAt: now }).onConflictDoUpdate({ target: settings.id, set: { lastSyncedAt: now } });
  return result;
}
