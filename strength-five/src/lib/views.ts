import type { Lift, NextSession, Workout } from "./program";

// What the API returns and the pages render. Health `source` is the member's
// device or app name: untrusted text, rendered only with textContent.

export type HealthMatch = {
  activity: string;
  durationMinutes: number;
  energyKcal: number | null;
  heartRateAverage: number | null;
  heartRateMax: number | null;
  source: string;
};

export type SessionLiftView = {
  lift: Lift;
  name: string;
  weightKg: number;
  reps: number[];
  succeeded: boolean;
  /** Against this lift's previous session: heavier, the same, lighter (a deload or a reset), or its first. */
  change: "up" | "same" | "down" | "first";
};

export type SessionView = {
  id: string;
  sequence: number;
  workout: Workout;
  date: string;
  performedAt: number;
  lifts: SessionLiftView[];
  health: HealthMatch | null;
};

type BodyWeight = { measuredAt: number; kg: number };
export type Today = {
  now: number;
  canEdit: boolean;
  next: NextSession;
  last: { date: string; workout: Workout } | null;
  bodyweight: { current: BodyWeight | null; series: BodyWeight[] };
};

export type SessionList = { sessions: SessionView[] };
export type Weights = { afterSessions: number; weights: { lift: Lift; name: string; weightKg: number }[] };
export type { HealthStatus } from "../../../apple-health";
/** One sync: what it read, the records it could not read, and whether a read stopped at the page cap. */
export type SyncResult = { runId: string; run: string; workouts: number; samples: number; skipped: number; truncated: boolean };

/** Days of Apple Health each sync reads again, back from now. */
export const SYNC_DAYS = 365;

/**
 * What to do without an Apple Health import. The app is the member's own, served
 * under /apps/ on the main site, so the root-relative path reaches the import page.
 */
export const healthImportHint =
  "Apple Health is not connected. Import your Health export at /connectors/apple-health on the main Outfitter site, then sync again. The app works without it.";

/** `timeZone` when the runtime knows it (an IANA name), otherwise UTC. */
function knownZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

/** The calendar day of `time` in `timeZone`, as YYYY-MM-DD (en-CA's own format); UTC when the zone is unknown. */
export const localDate = (time: number, timeZone = "UTC") =>
  new Intl.DateTimeFormat("en-CA", { timeZone: knownZone(timeZone), year: "numeric", month: "2-digit", day: "2-digit" }).format(time);
