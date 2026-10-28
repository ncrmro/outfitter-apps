import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { healthWindow, readWorkouts } from "../../apple-health";
import { fromIsoDay, isoDay, knownZone, metTarget, overview, type Session, startOfDay, weekStart, weekStarts, weekTotals } from "../src/lib/practice";
import { createSession, practiceOverview } from "../src/server/practice";
import { sessionFromMindful, sessionFromWorkout, withoutOverlap } from "../src/server/sync";
import { database, demoPath, demoResponses, healthRecords, hostDouble, owner } from "./helpers/fixtures";

const DAY = 86_400_000;
const at = (iso: string) => Date.parse(iso);
const manual = { style: "vinyasa" as const, intensity: "moderate" as const, focus: [], note: "" };
const target = { sessions: 3, minutes: 120 };
const session = (iso: string, durationMinutes: number): Session => ({
  id: iso, source: "manual", practicedAt: at(iso), durationMinutes, style: "vinyasa", intensity: "moderate", focus: [], note: "",
  activity: null, heartRateAverage: null, heartRateMax: null, energyKcal: null, healthSource: null, revision: 1,
});

test("weeks start on Monday at the member's local midnight", () => {
  assert.equal(weekStart(at("2026-10-21T19:00:00Z")), at("2026-10-19T00:00:00Z"));
  assert.equal(weekStart(at("2026-10-19T00:00:00Z")), at("2026-10-19T00:00:00Z"));
  assert.equal(weekStart(at("2026-10-25T23:59:59Z")), at("2026-10-19T00:00:00Z"));
  // A Pacific Sunday-evening class is still that week, not the next.
  const sunday = at("2026-10-26T02:30:00Z");
  assert.equal(weekStart(sunday, "America/Los_Angeles"), at("2026-10-19T07:00:00Z"));
  assert.equal(isoDay(sunday, "America/Los_Angeles"), "2026-10-25");
  // Across the November change from PDT to PST.
  assert.equal(weekStart(at("2026-11-02T12:00:00Z"), "America/Los_Angeles"), at("2026-11-02T08:00:00Z"));
  assert.equal(fromIsoDay("2026-10-25", "America/Los_Angeles"), at("2026-10-25T19:00:00Z"));
  assert.equal(knownZone("Not/A_Zone"), "UTC");
  // Santiago's clocks went from midnight to 01:00 on 11 September 2022: that day starts at 01:00.
  assert.equal(startOfDay(at("2022-09-11T00:00:00Z") / DAY, "America/Santiago"), at("2022-09-11T04:00:00Z"));
});

test("a week meets the target with either enough sessions or enough minutes", () => {
  assert.equal(metTarget({ sessions: 3, minutes: 30 }, target), true);
  assert.equal(metTarget({ sessions: 1, minutes: 120 }, target), true);
  assert.equal(metTarget({ sessions: 2, minutes: 119 }, target), false);
});

test("the streak counts weeks in a row on target; this week counts once met and never breaks it early", async () => {
  const now = at("2026-10-21T12:00:00Z");
  const { db, close } = await database();
  const add = (iso: string, durationMinutes: number) => createSession(db, owner, { ...manual, practicedAt: at(iso), durationMinutes }, now);
  const streak = async () => (await practiceOverview(db, now)).streak;
  try {
    assert.equal(await streak(), 0);
    await add("2026-10-06T07:00:00Z", 130); // two weeks ago: minutes
    for (const day of ["13", "14", "16"]) await add(`2026-10-${day}T07:00:00Z`, 20); // last week: sessions
    assert.equal(await streak(), 2, "this week is still open");
    await add("2026-10-20T07:00:00Z", 120);
    assert.equal(await streak(), 3, "this week is met");
    // A missed week ends it: four weeks ago counts for nothing after an empty third week.
    await add("2026-09-22T07:00:00Z", 200);
    assert.equal(await streak(), 3);
  } finally {
    close();
  }
});

test("the streak reads back past the chart's eight weeks and a year at a time", async () => {
  const now = at("2026-10-21T12:00:00Z");
  const { db, close } = await database();
  try {
    // One long session every week from this one back, then a gap.
    const weekly = async (from: number, to: number) => {
      for (let weeksAgo = from; weeksAgo <= to; weeksAgo++)
        await createSession(db, owner, { ...manual, practicedAt: now - weeksAgo * 7 * DAY, durationMinutes: 120 }, now);
    };
    await weekly(0, 11);
    assert.equal((await practiceOverview(db, now)).streak, 12);
    await weekly(12, 69);
    assert.equal((await practiceOverview(db, now, "America/Los_Angeles")).streak, 70);
  } finally {
    close();
  }
});

test("the overview totals this week and averages recovery per week, in the member's time zone", () => {
  const now = at("2026-10-21T12:00:00Z");
  const readings = [
    { metric: "resting-heart-rate" as const, measuredAt: at("2026-10-19T06:00:00Z"), value: 55 },
    { metric: "resting-heart-rate" as const, measuredAt: at("2026-10-20T06:00:00Z"), value: 56 },
    { metric: "heart-rate-variability" as const, measuredAt: at("2026-10-13T06:00:00Z"), value: 48 },
  ];
  const sessions = [session("2026-10-20T07:00:00Z", 40), session("2026-10-14T07:00:00Z", 60)];
  const twoWeeks = (timeZone: string) => {
    const bounds = weekStarts(now, timeZone, -1, 1);
    return overview({ totals: weekTotals(sessions, bounds), readings, byStyle: [], streak: 0 }, bounds, target, now, timeZone);
  };
  const result = twoWeeks("UTC");
  assert.deepEqual(result.thisWeek, { sessions: 1, minutes: 40, met: false });
  assert.deepEqual(result.weeks.map((week) => [week.minutes, week.restingHeartRate, week.hrv]), [[60, null, 48], [40, 55.5, null]]);
  // In Los Angeles, Monday 06:00 UTC is still Sunday: that reading is last week's.
  assert.deepEqual(twoWeeks("America/Los_Angeles").weeks.map((week) => [week.minutes, week.restingHeartRate]), [[60, 55], [40, 56]]);
});

test("Health records arrive as inert text, a bad one is skipped and counted, and an overlapping mindful session is the same practice", async () => {
  const now = at("2026-10-21T19:00:00Z");
  const records = healthRecords(now);
  // The connector allows 256-character ids; a negative duration is not a workout.
  records.workouts.push({ ...records.workouts[0], id: `hk-${"x".repeat(253)}` }, { ...records.workouts[0], id: "hk-bad", durationMinutes: -5 });
  const read = await readWorkouts(hostDouble(records).typed(), { connectionId: "apple-health-1", resource: "member-1-health" }, { activity: "yoga", ...healthWindow(90, now) });
  assert.equal(read.skipped, 1);
  assert.ok(read.items.some((item) => item.id.length === 256));
  const hostile = read.items.find((item) => item.source?.includes("<img"));
  assert.ok(hostile);
  // Markup stays text for textContent; the bidirectional override is gone.
  assert.equal(hostile.source, "Mat Flow <img src=x onerror=alert(1)>");
  const row = sessionFromWorkout(hostile, now);
  assert.deepEqual([row.source, row.sourceId, row.style, row.intensity, row.durationMinutes, row.heartRateAverage, row.energyKcal, row.healthSource],
    ["health-workout", hostile.id, "other", undefined, 75, 104, 240, hostile.source]);
  // An imported session is never longer than one logged by hand.
  assert.equal(sessionFromWorkout({ ...hostile, durationMinutes: 24 * 60 }, now).durationMinutes, 600);

  const mindful = { id: "m", metric: "mindful-session", startedAt: hostile.startedAt, endedAt: new Date(at(hostile.startedAt) + 15 * 60_000).toISOString(), value: null, unit: null, category: null, source: null };
  const breathe = sessionFromMindful(mindful, now);
  assert.deepEqual([breathe.source, breathe.durationMinutes, breathe.activity], ["health-mindful", 15, "mindful-session"]);
  const later = { ...mindful, id: "m2", startedAt: hostile.endedAt, endedAt: new Date(at(hostile.endedAt) + 600_000).toISOString() };
  assert.deepEqual(withoutOverlap([mindful, later], [hostile]).map((item) => item.id), ["m2"]);
});

test("the demo fixture is what the app computes from the synthetic import", async () => {
  const stored = JSON.parse(await readFile(demoPath, "utf8"));
  assert.deepEqual(stored.responses, JSON.parse(JSON.stringify(await demoResponses())));
  assert.equal(stored.responses.sessions.canEdit, false);
  assert.equal(stored.responses.overview.streak, 5);
});
