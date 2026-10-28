import type { Lift } from "../lib/program";
import { localDate, type Today } from "../lib/views";
import { demoMode, errorText, loadToday, notice, saveSession } from "./data";
import { day, importLink, kg, lineChart, when } from "./format";

// Today: the next workout's lifts with a big button per set. A tap marks five
// reps; each further tap takes one off, down to zero, then clears the set.

const list = document.getElementById("lifts") as HTMLOListElement;
const template = document.getElementById("lift-template") as HTMLTemplateElement;
const meta = document.getElementById("next-meta") as HTMLElement;
const heading = document.getElementById("next-heading") as HTMLElement;
const save = document.getElementById("save") as HTMLButtonElement;
const saveNote = document.getElementById("save-note") as HTMLElement;
const date = document.getElementById("session-date") as HTMLInputElement;
let data: Today | null = null;
/** Reps per set by lift; null is a set not done yet. */
let reps: Partial<Record<Lift, (number | null)[]>> = {};

const nextReps = (value: number | null, target: number) => (value === null ? target : value === 0 ? null : value - 1);
const setLabel = (index: number, count: number, value: number | null) =>
  `Set ${index + 1} of ${count}: ${value === null ? "not done" : `${value} reps`}`;

function setButton(lift: Lift, index: number, count: number, target: number, editable: boolean) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "set";
  const show = () => {
    const value = reps[lift]?.[index] ?? null;
    button.textContent = value === null ? "" : String(value);
    button.setAttribute("aria-label", setLabel(index, count, value));
    button.classList.toggle("set--done", value === target);
    button.classList.toggle("set--short", value !== null && value < target);
  };
  button.disabled = !editable;
  button.addEventListener("click", () => {
    const sets = reps[lift] ?? [];
    sets[index] = nextReps(sets[index] ?? null, target);
    reps[lift] = sets;
    show();
  });
  show();
  return button;
}

function renderNext(today: Today) {
  const editable = today.canEdit && !demoMode;
  const { next } = today;
  heading.textContent = `Workout ${next.workout}`;
  meta.textContent = today.last ? `Session ${next.sequence} · last: ${today.last.workout} on ${day(today.last.date)}` : "Your first session";
  reps = Object.fromEntries(next.lifts.map((lift) => [lift.lift, Array(lift.sets).fill(null)]));
  list.replaceChildren(...next.lifts.map((lift) => {
    const node = template.content.firstElementChild?.cloneNode(true) as HTMLLIElement;
    (node.querySelector("[data-name]") as HTMLElement).textContent = lift.name;
    (node.querySelector("[data-weight]") as HTMLElement).textContent = kg(lift.weightKg);
    (node.querySelector("[data-note]") as HTMLElement).textContent =
      `${lift.sets}×${lift.reps}${lift.failures ? ` · missed ${lift.failures} ${lift.failures === 1 ? "time" : "times"} in a row` : ""}`;
    const sets = node.querySelector("[data-sets]") as HTMLElement;
    sets.setAttribute("aria-label", `${lift.name} sets`);
    sets.replaceChildren(...Array.from({ length: lift.sets }, (_, index) => setButton(lift.lift, index, lift.sets, lift.reps, editable)));
    return node;
  }));
  save.disabled = !editable;
  date.disabled = !editable;
  date.value = localDate(today.now, Intl.DateTimeFormat().resolvedOptions().timeZone);
  saveNote.textContent = demoMode ? "This demo is read-only." : today.canEdit ? "Sets you leave empty count as missed." : "Only the app's owner logs sessions.";
}

function renderBodyweight(today: Today) {
  const { current, series } = today.bodyweight;
  (document.getElementById("bodyweight-now") as HTMLElement).textContent = current ? kg(Math.round(current.kg * 10) / 10) : "";
  const chart = document.getElementById("bodyweight-chart") as HTMLElement;
  const note = document.getElementById("bodyweight-note") as HTMLElement;
  if (!current) {
    chart.replaceChildren();
    note.replaceChildren(importLink("Import your Apple Health data"), " on the main Outfitter site, allow this app to read it, then sync. The app works without it.");
    return;
  }
  const first = series[0];
  chart.replaceChildren(lineChart(series.map((point) => ({ x: point.measuredAt, y: point.kg })), "Bodyweight over the last six months"));
  note.textContent = first && series.length > 1
    ? `${kg(Math.round(first.kg * 10) / 10)} on ${when(first.measuredAt)}; ${series.length} readings from Apple Health.`
    : `Measured ${when(current.measuredAt)}, from Apple Health.`;
}

function render(today: Today) {
  data = today;
  renderNext(today);
  renderBodyweight(today);
}

save.addEventListener("click", async () => {
  if (!data) return;
  save.disabled = true;
  notice("Saving…");
  try {
    const lifts = Object.fromEntries(Object.entries(reps).map(([lift, sets]) => [lift, sets.map((value) => value ?? 0)]));
    const done = data.next;
    render(await saveSession({ sequence: done.sequence, workout: done.workout, date: date.value, lifts }));
    notice(`Saved workout ${done.workout}. Next: workout ${data.next.workout}.`);
  } catch (error) {
    save.disabled = false;
    notice(errorText(error, "Could not save the session."));
  }
});

document.addEventListener("health-synced", async () => render(await loadToday()));

try {
  render(await loadToday());
} catch (error) {
  notice(errorText(error, "Could not load today's workout."));
}
