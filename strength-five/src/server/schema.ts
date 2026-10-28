import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// This installation's own database (docs/app-databases.md): one member's
// training log. After changing it, run `npm run db:generate:app -- strength-five`
// and commit the new migration.

/** One logged workout. `sequence` counts sessions from 1, so a second save of the same session is refused. */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text().primaryKey(),
    sequence: integer().notNull(),
    workout: text().notNull(),
    /** The member's own calendar day (YYYY-MM-DD), which Health workouts match on. */
    date: text().notNull(),
    performedAt: integer().notNull(),
    createdBy: text().notNull(),
    createdAt: integer().notNull(),
  },
  (t) => [
    uniqueIndex("sessions_sequence_idx").on(t.sequence),
    index("sessions_date_idx").on(t.date),
    check("sessions_workout_check", sql`${t.workout} IN ('A', 'B')`),
  ],
);

/** Each lift of a session: the weight and the reps of each set (a JSON array). */
export const sessionLifts = sqliteTable(
  "session_lifts",
  {
    sessionId: text().notNull().references(() => sessions.id, { onDelete: "cascade" }),
    lift: text().notNull(),
    position: integer().notNull(),
    weightKg: real().notNull(),
    reps: text().notNull(),
    succeeded: integer({ mode: "boolean" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.lift] }),
    index("session_lifts_lift_idx").on(t.lift),
  ],
);

/** A weight the member set for a lift, taking effect after `afterSessions` sessions (0: the starting weight). */
export const liftWeights = sqliteTable(
  "lift_weights",
  {
    lift: text().notNull(),
    afterSessions: integer().notNull(),
    weightKg: real().notNull(),
    updatedBy: text().notNull(),
    updatedAt: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.lift, t.afterSessions] })],
);

/** Strength workouts read from Apple Health. `source` is the member's device or app name: untrusted text. */
export const healthWorkouts = sqliteTable(
  "health_workouts",
  {
    id: text().primaryKey(),
    activity: text().notNull(),
    /** The member's calendar day the workout started on, in the time zone of the sync. */
    date: text().notNull(),
    startedAt: integer().notNull(),
    endedAt: integer().notNull(),
    durationMinutes: real().notNull(),
    energyKcal: real(),
    heartRateAverage: real(),
    heartRateMax: real(),
    source: text().notNull(),
    syncedAt: integer().notNull(),
  },
  (t) => [index("health_workouts_date_idx").on(t.date, t.startedAt)],
);

/** Body mass readings from Apple Health, in kg. */
export const bodyMass = sqliteTable(
  "body_mass",
  {
    id: text().primaryKey(),
    measuredAt: integer().notNull(),
    kg: real().notNull(),
    source: text().notNull(),
    syncedAt: integer().notNull(),
  },
  (t) => [index("body_mass_measured_idx").on(t.measuredAt)],
);

/** The app's own state: one row. */
export const settings = sqliteTable("settings", {
  id: text().primaryKey(),
  lastSyncedAt: integer(),
});
