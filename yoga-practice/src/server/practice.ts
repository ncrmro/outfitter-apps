import { and, count, desc, eq, gte, isNull, lt, sum } from "drizzle-orm";
import { z } from "zod";
import { type AppIdentity, requireEditor } from "@ai-outfitter/app-sdk/server";
import type { Database } from "../../../apple-health";
import {
  countStreak, defaultTarget, focusAreas, intensities, knownZone, MAX_MINUTES, overview, type RecoveryMetric, type Session, type Style, styles,
  type Target, weekStarts, weekTotals,
} from "../lib/practice";
import { readings, sessions, settings } from "./schema";

/** The session list shows the newest ones; the overview reads by week, not from this list. */
const MAX_SESSIONS = 1000;
const DAY = 86_400_000;
const WEEKS = 8;

/** A row as the API returns it: without its import key, tombstone and timestamps. */
function view({ sourceId, deletedAt, createdAt, updatedAt, focus, ...row }: typeof sessions.$inferSelect): Session {
  return { ...row, focus: JSON.parse(focus) } as Session;
}

/** Newest sessions first, without deleted ones. */
export async function listSessions(db: Database) {
  const rows = await db.select().from(sessions).where(isNull(sessions.deletedAt))
    .orderBy(desc(sessions.practicedAt)).limit(MAX_SESSIONS);
  return rows.map(view);
}

export const sessionInput = z.strictObject({
  practicedAt: z.number().int().positive(),
  durationMinutes: z.number().int().min(1).max(MAX_MINUTES),
  style: z.enum(styles),
  intensity: z.enum(intensities),
  focus: z.array(z.enum(focusAreas)).max(focusAreas.length).transform((focus) => [...new Set(focus)]),
  note: z.string().max(280).transform((note) => note.trim()),
});

export const sessionChange = sessionInput.extend({ revision: z.number().int().positive() });
export const revisionInput = z.strictObject({ revision: z.number().int().positive() });

function notFuture(practicedAt: number, now: number) {
  if (practicedAt > now + DAY) throw new Response("A session cannot be in the future", { status: 400 });
}

export async function createSession(db: Database, identity: AppIdentity, value: z.infer<typeof sessionInput>, now = Date.now()) {
  requireEditor(identity);
  notFuture(value.practicedAt, now);
  const id = crypto.randomUUID();
  const [row] = await db.insert(sessions).values({
    ...value, id, source: "manual", sourceId: id, focus: JSON.stringify(value.focus), createdAt: now, updatedAt: now,
  }).returning();
  return view(row);
}

/** Changes a session, manual or imported. A stale revision is a conflict, so two tabs never overwrite each other. */
export async function updateSession(db: Database, identity: AppIdentity, id: string, value: z.infer<typeof sessionChange>, now = Date.now()) {
  requireEditor(identity);
  notFuture(value.practicedAt, now);
  const { revision, ...change } = value;
  const [row] = await db.update(sessions)
    .set({ ...change, focus: JSON.stringify(change.focus), revision: revision + 1, updatedAt: now })
    .where(and(eq(sessions.id, id), eq(sessions.revision, revision), isNull(sessions.deletedAt)))
    .returning();
  if (row) return view(row);
  throw await missingOrStale(db, id);
}

/** Why a change matched no row: the session is gone, or its revision moved on. */
async function missingOrStale(db: Database, id: string) {
  const [current] = await db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.id, id), isNull(sessions.deletedAt)));
  return current
    ? new Response("This session changed elsewhere. Reload and try again.", { status: 409 })
    : new Response("Session not found", { status: 404 });
}

/** Deletes a session. The row stays as a tombstone so a sync never brings it back. */
export async function deleteSession(db: Database, identity: AppIdentity, id: string, { revision }: z.infer<typeof revisionInput>, now = Date.now()) {
  requireEditor(identity);
  const [row] = await db.update(sessions).set({ deletedAt: now, updatedAt: now })
    .where(and(eq(sessions.id, id), eq(sessions.revision, revision), isNull(sessions.deletedAt)))
    .returning({ id: sessions.id });
  if (!row) throw await missingOrStale(db, id);
  return { deleted: row.id };
}

const SETTINGS_ID = "practice";

/** The weekly target and when Apple Health was last synced. */
export async function loadSettings(db: Database) {
  const [row] = await db.select().from(settings).where(eq(settings.id, SETTINGS_ID));
  const target: Target = row ? { sessions: row.weeklySessions, minutes: row.weeklyMinutes } : { ...defaultTarget };
  return { target, lastSyncedAt: row?.lastSyncedAt ?? null };
}

/** A target is 1 to 14 sessions and 10 to 1200 minutes a week. */
export const targetInput = z.strictObject({
  sessions: z.number().int().min(1).max(14),
  minutes: z.number().int().min(10).max(1200),
});

export async function changeTarget(db: Database, identity: AppIdentity, target: Target, now = Date.now()) {
  requireEditor(identity);
  await db.insert(settings)
    .values({ id: SETTINGS_ID, weeklySessions: target.sessions, weeklyMinutes: target.minutes, updatedAt: now })
    .onConflictDoUpdate({ target: settings.id, set: { weeklySessions: target.sessions, weeklyMinutes: target.minutes, updatedAt: now } });
  return loadSettings(db);
}

export async function markSynced(db: Database, now: number) {
  await db.insert(settings)
    .values({ id: SETTINGS_ID, weeklySessions: defaultTarget.sessions, weeklyMinutes: defaultTarget.minutes, lastSyncedAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: settings.id, set: { lastSyncedAt: now } });
}

const live = isNull(sessions.deletedAt);

/** The time and length of each session from the first to the last of `bounds`. */
const sessionsWithin = (db: Database, bounds: number[]) =>
  db.select({ practicedAt: sessions.practicedAt, durationMinutes: sessions.durationMinutes }).from(sessions)
    .where(and(live, gte(sessions.practicedAt, bounds[0]), lt(sessions.practicedAt, bounds[bounds.length - 1])));

/** The streak through the chart's weeks (newest first), extended a year at a time while every week was met. */
async function streak(db: Database, recent: { sessions: number; minutes: number }[], target: Target, now: number, timeZone: string) {
  let { streak: weeks, open } = countStreak(recent, target, true);
  for (let end = 1 - recent.length; open; end -= 52) {
    const bounds = weekStarts(now, timeZone, end - 52, end);
    const more = countStreak(weekTotals(await sessionsWithin(db, bounds), bounds).reverse(), target, false);
    weeks += more.streak;
    open = more.open;
  }
  return weeks;
}

/** The Practice and Progress numbers in the member's time zone: the last eight weeks, the streak and practice by style. */
export async function practiceOverview(db: Database, now = Date.now(), timeZone = "UTC") {
  const zone = knownZone(timeZone);
  const bounds = weekStarts(now, zone, 1 - WEEKS, 1);
  const [recent, { target }, rows, byStyle] = await Promise.all([
    sessionsWithin(db, bounds),
    loadSettings(db),
    db.select().from(readings).where(and(gte(readings.measuredAt, bounds[0]), lt(readings.measuredAt, bounds[WEEKS]))),
    db.select({ style: sessions.style, sessions: count(), minutes: sum(sessions.durationMinutes).mapWith(Number) }).from(sessions)
      .where(live).groupBy(sessions.style),
  ]);
  const totals = weekTotals(recent, bounds);
  return overview({
    totals,
    readings: rows.map((row) => ({ metric: row.metric as RecoveryMetric, measuredAt: row.measuredAt, value: row.value })),
    byStyle: byStyle.map((row) => ({ ...row, style: row.style as Style })).sort((a, b) => styles.indexOf(a.style) - styles.indexOf(b.style)),
    streak: await streak(db, [...totals].reverse(), target, now, zone),
  }, bounds, target, now, zone);
}
