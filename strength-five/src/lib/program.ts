// The 5x5 program: two alternating workouts and linear progression. These are
// the product's fixed rules, kept here and nowhere else. Weights are kg.

export const lifts = ["squat", "bench", "row", "press", "deadlift"] as const;
export type Lift = (typeof lifts)[number];

export const liftNames: Record<Lift, string> = {
  squat: "Squat",
  bench: "Bench press",
  row: "Barbell row",
  press: "Overhead press",
  deadlift: "Deadlift",
};

/** Sets of five, and the weight added after a session where every set made five. */
const plan: Record<Lift, { sets: number; increment: number; start: number }> = {
  squat: { sets: 5, increment: 2.5, start: 20 },
  bench: { sets: 5, increment: 2.5, start: 20 },
  row: { sets: 5, increment: 2.5, start: 20 },
  press: { sets: 5, increment: 2.5, start: 20 },
  deadlift: { sets: 1, increment: 5, start: 40 },
};
export const REPS = 5;
export const BAR_KG = 20;
/** Failed sessions in a row on one lift before it drops by DELOAD. */
export const FAILS_BEFORE_DELOAD = 3;
export const DELOAD = 0.1;
/** The smallest weight step: two 1.25 kg plates. */
export const STEP_KG = 2.5;
/** The heaviest weight the app accepts for any lift. */
export const MAX_KG = 500;

export const workouts = { A: ["squat", "bench", "row"], B: ["squat", "press", "deadlift"] } as const satisfies Record<string, readonly Lift[]>;
export type Workout = keyof typeof workouts;

export const setsFor = (lift: Lift) => plan[lift].sets;
export const incrementFor = (lift: Lift) => plan[lift].increment;

/** A then B then A: the workout after `last` (A when there is none). */
export const nextWorkout = (last: Workout | null): Workout => (last === "A" ? "B" : "A");

/** Down to the nearest 2.5 kg, never below the empty bar. */
export const roundDown = (kg: number) => Math.max(BAR_KG, Math.floor(kg / STEP_KG + 1e-9) * STEP_KG);

/** A lift's working weight and its failed sessions in a row. */
export type LiftState = { weightKg: number; failures: number };

/** Whether every set reached five reps. */
export const succeeded = (lift: Lift, reps: readonly number[]) =>
  reps.length === setsFor(lift) && reps.every((count) => count >= REPS);

/**
 * The state after one session of `lift` at `weightKg`: all sets of five adds
 * the increment; otherwise the weight repeats, and the third failure in a row
 * takes 10% off (rounded down to 2.5 kg).
 */
export function progress(lift: Lift, weightKg: number, reps: readonly number[], failures: number): LiftState {
  if (succeeded(lift, reps)) return { weightKg: weightKg + plan[lift].increment, failures: 0 };
  if (failures + 1 >= FAILS_BEFORE_DELOAD) return { weightKg: roundDown(weightKg * (1 - DELOAD)), failures: 0 };
  return { weightKg, failures: failures + 1 };
}

/** A logged session, as replay needs it. */
export type LoggedSession = { workout: Workout; lifts: { lift: Lift; weightKg: number; reps: number[] }[] };
/** A weight the member set for a lift, applying after `afterSessions` logged sessions. */
export type WeightOverride = { lift: Lift; weightKg: number; afterSessions: number };

/**
 * Where each lift stands after `sessions` (oldest first): the defaults, the
 * member's own weights where they set them, and progression through each session.
 */
export function replay(sessions: readonly LoggedSession[], overrides: readonly WeightOverride[] = []) {
  const state = Object.fromEntries(lifts.map((lift) => [lift, { weightKg: plan[lift].start, failures: 0 }])) as Record<Lift, LiftState>;
  const apply = (count: number) => {
    for (const override of overrides)
      if (override.afterSessions === count) state[override.lift] = { weightKg: override.weightKg, failures: 0 };
  };
  apply(0);
  sessions.forEach((session, index) => {
    for (const entry of session.lifts) state[entry.lift] = progress(entry.lift, entry.weightKg, entry.reps, state[entry.lift].failures);
    apply(index + 1);
  });
  return state;
}

/** The next workout and its target weights. */
export function nextSession(sessions: readonly LoggedSession[], overrides: readonly WeightOverride[] = []) {
  const state = replay(sessions, overrides);
  const workout = nextWorkout(sessions.at(-1)?.workout ?? null);
  return {
    sequence: sessions.length + 1,
    workout,
    lifts: workouts[workout].map((lift) => ({ lift, name: liftNames[lift], sets: setsFor(lift), reps: REPS, ...state[lift] })),
  };
}
export type NextSession = ReturnType<typeof nextSession>;
