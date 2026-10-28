import type { AppIdentity } from "@ai-outfitter/app-sdk/server";
import { z } from "zod";
import {
  type Database, type HealthHost, type HealthSource, type HealthSample, type HealthStatus, type HealthWorkout, healthConnected, healthWindow, readSamples, readWorkouts,
  syncHealth, writeRows,
} from "../../../apple-health";
import { healthActivities, healthImportHint, MAX_MINUTES, recoveryMetrics, SYNC_DAYS, type SyncResult } from "../lib/practice";
import { loadSettings, markSynced } from "./practice";
import { readings, sessions } from "./schema";

// Sync from Apple Health: the yoga-health-sync workflow has one step, import,
// that the app fills on the owner's click (../../../apple-health.ts). Every
// sync re-reads the last SYNC_DAYS days; each Health record id becomes at most one
// row, so a session the member tagged or deleted keeps its state.

const sync = { workflow: "yoga-health-sync", days: "import.inputs.days", output: "import.outputs.imported", defaultDays: SYNC_DAYS };

/** Whether Apple Health is connected, and when it was last synced. */
export async function healthStatus(db: Database, host: HealthHost | null, identity: AppIdentity): Promise<HealthStatus> {
  const { lastSyncedAt } = await loadSettings(db);
  return { connected: await healthConnected(host, identity), lastSyncedAt };
}

const round = (value: number | null | undefined) => (typeof value === "number" ? Math.round(value * 10) / 10 : null);
/** Whole minutes, from 1 up to the longest session a member can log: one bogus record cannot meet a week's target. */
const minutes = (value: number) => Math.min(MAX_MINUTES, Math.max(1, Math.round(value)));

/** One session from one Health workout: style "other" until the member tags it. */
export function sessionFromWorkout(item: HealthWorkout, now: number): typeof sessions.$inferInsert {
  return {
    id: crypto.randomUUID(), source: "health-workout", sourceId: item.id,
    practicedAt: Date.parse(item.startedAt), durationMinutes: minutes(item.durationMinutes),
    style: "other", activity: item.activity,
    heartRateAverage: round(item.heartRate?.average), heartRateMax: round(item.heartRate?.max), energyKcal: round(item.energyKcal),
    healthSource: item.source, createdAt: now, updatedAt: now,
  };
}

/** One session from one mindful session: its length is end minus start. */
export function sessionFromMindful(item: HealthSample, now: number): typeof sessions.$inferInsert {
  const started = Date.parse(item.startedAt);
  return {
    id: crypto.randomUUID(), source: "health-mindful", sourceId: item.id,
    practicedAt: started, durationMinutes: minutes((Date.parse(item.endedAt) - started) / 60_000),
    style: "other", activity: "mindful-session", heartRateAverage: null, heartRateMax: null, energyKcal: null,
    healthSource: item.source, createdAt: now, updatedAt: now,
  };
}

const span = (item: { startedAt: string; endedAt: string }) => [Date.parse(item.startedAt), Date.parse(item.endedAt)];

/** Mindful sessions that do not overlap a workout: a Watch yoga workout and a meditation app logging the same minutes are one practice. */
export function withoutOverlap(mindful: HealthSample[], workouts: HealthWorkout[]) {
  const busy = workouts.map(span);
  return mindful.filter((item) => {
    const [start, end] = span(item);
    return !busy.some(([from, to]) => start < to && from < end);
  });
}

/** The unit each reading must carry (Health's own); a reading in any other unit would skew the weekly average. */
const units: Record<(typeof recoveryMetrics)[number], string> = { "resting-heart-rate": "count/min", "heart-rate-variability": "ms" };

/** import: reads the window and keeps the sessions and readings new to the app. */
async function importStep(db: Database, host: HealthHost, source: HealthSource, days: number, now: number) {
  const window = healthWindow(days, now);
  const workouts = await Promise.all(healthActivities.map((activity) => readWorkouts(host, source, { ...window, activity })));
  const [mindful, ...recovery] = await Promise.all(["mindful-session", ...recoveryMetrics].map((metric) => readSamples(host, source, { ...window, metric })));
  const workoutItems = workouts.flatMap((read) => read.items);
  const added = await writeRows(db, sessions, [
    ...workoutItems.map((item) => sessionFromWorkout(item, now)),
    ...withoutOverlap(mindful.items, workoutItems).map((item) => sessionFromMindful(item, now)),
  ]);
  const values = recovery.flatMap((read, index) => {
    const metric = recoveryMetrics[index];
    return read.items.flatMap((item) => typeof item.value === "number" && item.value > 0 && item.unit === units[metric]
      ? [{ id: item.id, metric, measuredAt: Date.parse(item.startedAt), value: item.value, unit: item.unit }]
      : []);
  });
  const kept = await writeRows(db, readings, values);
  const all = [...workouts, mindful, ...recovery];
  return {
    workouts: workoutItems.length, mindful: mindful.items.length, sessions: added, readings: kept,
    skipped: all.reduce((sum, read) => sum + read.skipped, 0), truncated: all.some((read) => read.truncated),
  };
}

/** The POST body: nothing yet, but JSON, so the sync is a same-origin API call and not a form post. */
export const syncInput = z.strictObject({});

/** The owner's "Sync from Apple Health": resumes a run a failed sync left waiting, or starts one. */
export async function syncFromHealth(db: Database, identity: AppIdentity, host: HealthHost, now = Date.now()): Promise<SyncResult> {
  const result = await syncHealth(identity, host, sync, healthImportHint, (source, days) => importStep(db, host, source, days, now));
  await markSynced(db, now);
  return result;
}
