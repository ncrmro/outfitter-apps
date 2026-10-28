import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// This installation's own database (docs/app-databases.md): one member's
// practice. After changing it, run `npm run db:generate:app -- yoga-practice`
// and commit the new migration.
export const sessions = sqliteTable(
  "sessions",
  {
    id: text().primaryKey(),
    /** "manual", or the Apple Health record kind; with `sourceId` it makes imports idempotent. */
    source: text().notNull(),
    sourceId: text().notNull(),
    practicedAt: integer().notNull(),
    durationMinutes: integer().notNull(),
    style: text().notNull().default("other"),
    /** Null until the member tags an imported session. */
    intensity: text(),
    /** A JSON array of focus areas. */
    focus: text().notNull().default("[]"),
    note: text().notNull().default(""),
    /** From Apple Health: its activity, heart rate, energy and the recording device (bounded plain text). */
    activity: text(),
    heartRateAverage: real(),
    heartRateMax: real(),
    energyKcal: real(),
    healthSource: text(),
    /** Deleted sessions stay as tombstones, so a sync does not bring an imported one back. */
    deletedAt: integer(),
    revision: integer().notNull().default(1),
    createdAt: integer().notNull(),
    updatedAt: integer().notNull(),
  },
  (t) => [
    uniqueIndex("sessions_source_idx").on(t.source, t.sourceId),
    index("sessions_practiced_idx").on(t.practicedAt),
    check("sessions_source_check", sql`${t.source} IN ('manual', 'health-workout', 'health-mindful')`),
    check("sessions_style_check", sql`${t.style} IN ('vinyasa', 'hatha', 'yin', 'restorative', 'power', 'other')`),
    check("sessions_intensity_check", sql`${t.intensity} IS NULL OR ${t.intensity} IN ('gentle', 'moderate', 'strong')`),
  ],
);

/** Resting heart rate and HRV readings from Apple Health, one row per Health sample. */
export const readings = sqliteTable(
  "readings",
  {
    id: text().primaryKey(),
    metric: text().notNull(),
    measuredAt: integer().notNull(),
    value: real().notNull(),
    unit: text(),
  },
  (t) => [
    index("readings_metric_idx").on(t.metric, t.measuredAt),
    check("readings_metric_check", sql`${t.metric} IN ('resting-heart-rate', 'heart-rate-variability')`),
  ],
);

/** The app's own settings: one row. */
export const settings = sqliteTable("settings", {
  id: text().primaryKey(),
  weeklySessions: integer().notNull(),
  weeklyMinutes: integer().notNull(),
  lastSyncedAt: integer(),
  updatedAt: integer().notNull(),
});
