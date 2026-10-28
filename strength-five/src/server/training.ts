import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { type AppIdentity, requireEditor } from "@ai-outfitter/app-sdk/server";
import { type Database, writeRows } from "../../../apple-health";
import {
  BAR_KG, type Lift, type LoggedSession, liftNames, lifts, MAX_KG, nextSession, replay, STEP_KG, setsFor, succeeded,
  type WeightOverride, type Workout, workouts,
} from "../lib/program";
import type { HealthMatch, SessionList, SessionView, Today, Weights } from "../lib/views";
import { bodyMass, healthWorkouts, liftWeights, sessionLifts, sessions } from "./schema";

type Row = typeof sessions.$inferSelect & { lifts: (typeof sessionLifts.$inferSelect)[] };

/** Every session, oldest first, with its lifts. */
async function loadSessions(db: Database): Promise<Row[]> {
  const rows = await db.select().from(sessions).orderBy(asc(sessions.sequence));
  const entries = rows.length ? await db.select().from(sessionLifts).orderBy(asc(sessionLifts.position)) : [];
  return rows.map((row) => ({ ...row, lifts: entries.filter((entry) => entry.sessionId === row.id) }));
}

const logged = (row: Row): LoggedSession => ({
  workout: row.workout as Workout,
  lifts: row.lifts.map((entry) => ({ lift: entry.lift as Lift, weightKg: entry.weightKg, reps: JSON.parse(entry.reps) as number[] })),
});

async function loadOverrides(db: Database): Promise<WeightOverride[]> {
  const rows = await db.select().from(liftWeights);
  return rows.map((row) => ({ lift: row.lift as Lift, weightKg: row.weightKg, afterSessions: row.afterSessions }));
}

/** The member's bodyweight now and over the last 180 days. */
async function bodyweight(db: Database, now: number) {
  const series = await db.select({ measuredAt: bodyMass.measuredAt, kg: bodyMass.kg }).from(bodyMass)
    .where(gte(bodyMass.measuredAt, now - 180 * 86_400_000)).orderBy(asc(bodyMass.measuredAt));
  const [current] = await db.select({ measuredAt: bodyMass.measuredAt, kg: bodyMass.kg }).from(bodyMass).orderBy(desc(bodyMass.measuredAt)).limit(1);
  return { current: current ?? null, series };
}

/** The next workout with its target weights, and the bodyweight Health reports. */
export async function today(db: Database, identity: AppIdentity, now = Date.now()): Promise<Today> {
  const rows = await loadSessions(db);
  const last = rows.at(-1);
  return {
    now,
    canEdit: identity.canEdit,
    next: nextSession(rows.map(logged), await loadOverrides(db)),
    last: last ? { date: last.date, workout: last.workout as Workout } : null,
    bodyweight: await bodyweight(db, now),
  };
}

/** The longest Health strength workout on each day from `first` to `last` (YYYY-MM-DD). */
async function healthByDate(db: Database, first: string | undefined, last: string | undefined) {
  const matches = new Map<string, HealthMatch>();
  if (!first || !last) return matches;
  const rows = await db.select().from(healthWorkouts).where(and(gte(healthWorkouts.date, first), lte(healthWorkouts.date, last)))
    .orderBy(desc(healthWorkouts.durationMinutes));
  for (const row of rows) {
    if (matches.has(row.date)) continue;
    const { activity, durationMinutes, energyKcal, heartRateAverage, heartRateMax, source } = row;
    matches.set(row.date, { activity, durationMinutes, energyKcal, heartRateAverage, heartRateMax, source });
  }
  return matches;
}

/** Every session, newest first, each lift compared with its previous session and matched to Health by day. */
export async function listSessions(db: Database): Promise<SessionList> {
  const rows = await loadSessions(db);
  const dates = rows.map((row) => row.date).sort((a, b) => a.localeCompare(b));
  const health = await healthByDate(db, dates[0], dates.at(-1));
  const previous = new Map<string, number>();
  const views = rows.map((row): SessionView => ({
    id: row.id,
    sequence: row.sequence,
    workout: row.workout as Workout,
    date: row.date,
    performedAt: row.performedAt,
    health: health.get(row.date) ?? null,
    lifts: row.lifts.map((entry) => {
      const before = previous.get(entry.lift);
      previous.set(entry.lift, entry.weightKg);
      const change = before === undefined ? "first" : entry.weightKg > before ? "up" : entry.weightKg < before ? "down" : "same";
      return { lift: entry.lift as Lift, name: liftNames[entry.lift as Lift], weightKg: entry.weightKg, reps: JSON.parse(entry.reps), succeeded: entry.succeeded, change };
    }),
  }));
  return { sessions: views.reverse() };
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Not a date");
export const sessionInput = z.strictObject({
  /** The session number the page showed, so a second save of it is refused. */
  sequence: z.number().int().positive(),
  workout: z.enum(["A", "B"]),
  /** The member's calendar day. */
  date: day,
  lifts: z.partialRecord(z.enum(lifts), z.array(z.number().int().min(0).max(20)).max(5)),
});

/** Logs the next session at its target weights. Sets left empty count as zero reps. */
export async function saveSession(db: Database, identity: AppIdentity, body: z.infer<typeof sessionInput>, now = Date.now()) {
  requireEditor(identity);
  const rows = await loadSessions(db);
  const next = nextSession(rows.map(logged), await loadOverrides(db));
  if (body.sequence !== next.sequence || body.workout !== next.workout)
    throw new Response("This session is already saved. Reload to see the next workout.", { status: 409 });
  // A day after the member's tomorrow is a mistake, whatever their time zone.
  if (Date.parse(`${body.date}T00:00:00Z`) > now + 2 * 86_400_000) throw new Response("The date is in the future", { status: 400 });
  const expected = workouts[next.workout] as readonly Lift[];
  if (Object.keys(body.lifts).some((lift) => !expected.includes(lift as Lift)))
    throw new Response(`Workout ${next.workout} is ${expected.map((lift) => liftNames[lift]).join(", ")}`, { status: 400 });
  const id = crypto.randomUUID();
  // One transaction: the session and its lifts are saved together or not at all.
  try {
    await db.batch([
      db.insert(sessions).values({
        id, sequence: next.sequence, workout: next.workout, date: body.date, performedAt: now, createdBy: identity.userId, createdAt: now,
      }),
      db.insert(sessionLifts).values(next.lifts.map((target, position) => {
        const reps = Array.from({ length: setsFor(target.lift) }, (_, set) => body.lifts[target.lift]?.[set] ?? 0);
        return { sessionId: id, lift: target.lift, position, weightKg: target.weightKg, reps: JSON.stringify(reps), succeeded: succeeded(target.lift, reps) };
      })),
    ]);
  } catch (error) {
    // A concurrent save of the same session took its sequence number.
    const [taken] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.sequence, next.sequence));
    if (taken) throw new Response("This session is already saved. Reload to see the next workout.", { status: 409 });
    throw error;
  }
  return today(db, identity, now);
}

/** Each lift's next working weight. */
export async function currentWeights(db: Database): Promise<Weights> {
  const rows = await loadSessions(db);
  const state = replay(rows.map(logged), await loadOverrides(db));
  return { afterSessions: rows.length, weights: lifts.map((lift) => ({ lift, name: liftNames[lift], weightKg: state[lift].weightKg })) };
}

const weight = z.number().min(BAR_KG).max(MAX_KG).refine((kg) => Number.isInteger(kg / STEP_KG), `Weights go up in ${STEP_KG} kg`);
export const weightsInput = z.strictObject({ weights: z.partialRecord(z.enum(lifts), weight) });

/** Sets lifts' next weights (before any session: the starting weights). Progression continues from them. */
export async function setWeights(db: Database, identity: AppIdentity, { weights }: z.infer<typeof weightsInput>, now = Date.now()) {
  requireEditor(identity);
  const { afterSessions, weights: current } = await currentWeights(db);
  const changed = current.filter(({ lift, weightKg }) => weights[lift] !== undefined && weights[lift] !== weightKg)
    .map(({ lift }) => ({ lift, afterSessions, weightKg: weights[lift] as number, updatedBy: identity.userId, updatedAt: now }));
  await writeRows(db, liftWeights, changed, [liftWeights.lift, liftWeights.afterSessions]);
  return currentWeights(db);
}
