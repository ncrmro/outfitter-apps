// The domain in one place, shared by the server, the demo fixtures and the page
// scripts: what a session is, the weekly target and the numbers the app shows.
// Days and weeks (Monday to Sunday) are the member's own, in their time zone.

export const styles = ["vinyasa", "hatha", "yin", "restorative", "power", "other"] as const;
export type Style = (typeof styles)[number];
export const styleLabels: Record<Style, string> = {
  vinyasa: "Vinyasa", hatha: "Hatha", yin: "Yin", restorative: "Restorative", power: "Power", other: "Other",
};

export const intensities = ["gentle", "moderate", "strong"] as const;
export type Intensity = (typeof intensities)[number];
export const intensityLabels: Record<Intensity, string> = { gentle: "Gentle", moderate: "Moderate", strong: "Strong" };

export const focusAreas = ["hips", "hamstrings", "shoulders", "back", "balance", "breath"] as const;
export type Focus = (typeof focusAreas)[number];
export const focusLabels: Record<Focus, string> = {
  hips: "Hips", hamstrings: "Hamstrings", shoulders: "Shoulders", back: "Back", balance: "Balance", breath: "Breath",
};

/** The longest session, logged by hand or imported. */
export const MAX_MINUTES = 600;

/** The target a member starts with: met by either number in a week. */
export const defaultTarget = { sessions: 3, minutes: 120 };
export type Target = typeof defaultTarget;

/** Apple Health workout activities imported as sessions. */
export const healthActivities = ["yoga", "mind-and-body", "pilates", "flexibility"] as const;
/** Apple Health readings shown as the recovery trend. */
export const recoveryMetrics = ["resting-heart-rate", "heart-rate-variability"] as const;
export type RecoveryMetric = (typeof recoveryMetrics)[number];
/** Days of Apple Health each sync reads again, back from now. */
export const SYNC_DAYS = 90;
/** What to do without an Apple Health import. */
export const healthImportHint =
  "Apple Health is not connected. Import your Health export at /connectors/apple-health on the main Outfitter site, then sync again. The app works without it: add sessions by hand.";

/** A session as the API returns it. */
export type Session = {
  id: string;
  /** "manual", or the Apple Health record it came from. */
  source: "manual" | "health-workout" | "health-mindful";
  practicedAt: number;
  durationMinutes: number;
  style: Style;
  /** Null for an imported session the member has not tagged. */
  intensity: Intensity | null;
  focus: Focus[];
  note: string;
  /** Health's activity slug (or "mindful-session"); null for manual sessions. */
  activity: string | null;
  heartRateAverage: number | null;
  heartRateMax: number | null;
  energyKcal: number | null;
  /** The device or app that recorded it in Health: untrusted text, shown with textContent. */
  healthSource: string | null;
  revision: number;
};

export type { HealthStatus } from "../../../apple-health";
/** One sync: what it read and kept, and whether a read stopped at the page cap. */
export type SyncResult = { runId: string; run: string; workouts: number; mindful: number; sessions: number; readings: number; skipped: number; truncated: boolean };

export type Reading = { metric: RecoveryMetric; measuredAt: number; value: number };

/** A week's (or any span's) practice. */
export type Totals = { sessions: number; minutes: number };

export type Week = Totals & {
  start: number;
  met: boolean;
  /** Weekly averages; null without readings that week. */
  restingHeartRate: number | null;
  hrv: number | null;
};

export type StyleTotals = Totals & { style: Style };

export type Overview = {
  now: number;
  /** The time zone the weeks are in. */
  timeZone: string;
  target: Target;
  thisWeek: Totals & { met: boolean };
  /** Weeks in a row the target was met. This week counts once met; until then it does not break the streak. */
  streak: number;
  byStyle: StyleTotals[];
  /** Oldest first. */
  weeks: Week[];
};

const DAY = 86_400_000;

/** `timeZone` when the runtime knows it (an IANA name), otherwise UTC. */
export function knownZone(timeZone: string | null | undefined) {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

const formats = new Map<string, Intl.DateTimeFormat>();
/** The wall clock in `timeZone` at `time`, as if it were UTC. */
function wallClock(time: number, timeZone: string) {
  let format = formats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
    });
    formats.set(timeZone, format);
  }
  const part = Object.fromEntries(format.formatToParts(time).map(({ type, value }) => [type, Number(value)]));
  return Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second);
}

/** The local calendar day of `time`, counted in days from 1 January 1970. */
export const dayNumber = (time: number, timeZone: string) => Math.floor(wallClock(time, timeZone) / DAY);

/** The instant local day `day` starts in `timeZone`: midnight, or the first instant after it on a day whose midnight is skipped. */
export function startOfDay(day: number, timeZone: string) {
  const midnight = day * DAY;
  const guess = midnight - (wallClock(midnight, timeZone) - midnight);
  const start = midnight - (wallClock(guess, timeZone) - guess);
  // Clocks went forward over midnight: `start` is still the evening before.
  return start + Math.max(0, midnight - wallClock(start, timeZone));
}

/** `YYYY-MM-DD` of `time` in `timeZone`, for a date input; and back, as that day's local noon. */
export const isoDay = (time: number, timeZone: string) => new Date(dayNumber(time, timeZone) * DAY).toISOString().slice(0, 10);
export const fromIsoDay = (value: string, timeZone: string) => startOfDay(Date.parse(`${value}T00:00:00Z`) / DAY, timeZone) + DAY / 2;

/** Week starts from `from` weeks to `to` weeks after the week of `now` (0 is this week), oldest first. */
export function weekStarts(now: number, timeZone: string, from: number, to: number) {
  const day = dayNumber(now, timeZone);
  // 1 January 1970 was a Thursday: day 0 is three days after a Monday.
  const monday = day - ((day + 3) % 7);
  return Array.from({ length: to - from + 1 }, (_, index) => startOfDay(monday + (from + index) * 7, timeZone));
}

/** Local midnight on the Monday of the week holding `time`. */
export const weekStart = (time: number, timeZone = "UTC") => weekStarts(time, timeZone, 0, 0)[0];

export const metTarget = (week: Totals, target: Target) => week.sessions >= target.sessions || week.minutes >= target.minutes;

type Timed = { practicedAt: number; durationMinutes: number };

/** Totals between consecutive `bounds` (ascending): one fewer than the bounds. */
export function weekTotals(sessions: Timed[], bounds: number[]): Totals[] {
  return bounds.slice(1).map((end, index) => {
    const inWeek = sessions.filter((session) => session.practicedAt >= bounds[index] && session.practicedAt < end);
    return { sessions: inWeek.length, minutes: inWeek.reduce((sum, session) => sum + session.durationMinutes, 0) };
  });
}

/**
 * Weeks in a row on target over `weeks`, newest first. When `current` the
 * first is this week, which counts once met and until then does not break the
 * streak. `open`: every week given was met, so older weeks may extend it.
 */
export function countStreak(weeks: Totals[], target: Target, current: boolean) {
  let streak = 0;
  for (const [index, week] of weeks.entries()) {
    if (metTarget(week, target)) streak++;
    else if (!(current && index === 0)) return { streak, open: false };
  }
  return { streak, open: true };
}

const average = (values: number[]) =>
  values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : null;

/**
 * Everything the Practice and Progress pages show: each week between `bounds`
 * (ascending week starts, the last one next week's) with its totals and
 * recovery readings, the streak and the style totals.
 */
export function overview(
  { totals, readings, byStyle, streak }: { totals: Totals[]; readings: Reading[]; byStyle: StyleTotals[]; streak: number },
  bounds: number[], target: Target, now: number, timeZone: string,
): Overview {
  const weeks = totals.map((week, index): Week => {
    const inWeek = (metric: RecoveryMetric) => readings
      .filter((reading) => reading.metric === metric && reading.measuredAt >= bounds[index] && reading.measuredAt < bounds[index + 1])
      .map((reading) => reading.value);
    return {
      start: bounds[index], ...week, met: metTarget(week, target),
      restingHeartRate: average(inWeek("resting-heart-rate")), hrv: average(inWeek("heart-rate-variability")),
    };
  });
  const { sessions, minutes, met } = weeks[weeks.length - 1];
  return { now, timeZone, target, thisWeek: { sessions, minutes, met }, streak, byStyle, weeks };
}
