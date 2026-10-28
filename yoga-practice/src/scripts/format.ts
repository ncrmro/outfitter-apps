import type { Overview } from "../lib/practice";

// Times show in the browser's time zone; week labels in the zone the overview's weeks are in.
const day = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
const stamp = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const dayText = (time: number) => day.format(time);
export const weekText = (time: number, timeZone: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone }).format(time);
export const when = (time: number) => stamp.format(time);

function tile(label: string, value: string, detail: string, id: string) {
  const box = document.createElement("div");
  box.className = "tile";
  box.dataset.tile = id;
  const term = document.createElement("dt");
  term.textContent = label;
  const amount = document.createElement("dd");
  amount.className = "tile-value";
  amount.textContent = value;
  const note = document.createElement("dd");
  note.className = "muted";
  note.textContent = detail;
  box.replaceChildren(term, amount, note);
  return box;
}

/** This week's minutes and sessions against the target, and the streak. */
export function weekTiles(list: HTMLElement, { thisWeek, target, streak }: Overview) {
  list.replaceChildren(
    tile("Minutes this week", String(thisWeek.minutes), `of ${target.minutes}`, "minutes"),
    tile("Sessions this week", String(thisWeek.sessions), `of ${target.sessions}`, "sessions"),
    tile("Streak", `${streak} ${streak === 1 ? "week" : "weeks"}`, thisWeek.met ? "This week's target is met" : "Weeks in a row on target", "streak"),
  );
}
