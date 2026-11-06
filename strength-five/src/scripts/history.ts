import { onPageLoad } from "@ai-outfitter/ui/page";
import type { HealthMatch, SessionLiftView, SessionView } from "../lib/views";
import { errorText, loadSessions, notice } from "./data";
import { day, kg } from "./format";

// History: each session, newest first. Health text (the source device or app)
// is set only with textContent, so markup in it is shown, never run.

const changes: Record<SessionLiftView["change"], string> = { up: "", same: "", first: "", down: " · deload" };

function liftRow(entry: SessionLiftView) {
  const row = document.createElement("tr");
  const cells = [entry.name, `${kg(entry.weightKg)}${changes[entry.change]}`, `${entry.reps.join(" ")} ${entry.succeeded ? "✓" : "✗"}`];
  row.replaceChildren(...cells.map((text, index) => {
    const cell = document.createElement(index ? "td" : "th");
    if (!index) cell.setAttribute("scope", "row");
    cell.textContent = text;
    return cell;
  }));
  row.classList.toggle("lift-missed", !entry.succeeded);
  return row;
}

/** "Apple Health: 52 min · 310 kcal · 128 avg / 161 max bpm · from …". */
function healthText(health: HealthMatch) {
  const parts = [`${Math.round(health.durationMinutes)} min`];
  if (health.energyKcal !== null) parts.push(`${Math.round(health.energyKcal)} kcal`);
  if (health.heartRateAverage !== null || health.heartRateMax !== null)
    parts.push(`${health.heartRateAverage === null ? "–" : Math.round(health.heartRateAverage)} avg / ${health.heartRateMax === null ? "–" : Math.round(health.heartRateMax)} max bpm`);
  return `Apple Health: ${parts.join(" · ")} · from ${health.source}`;
}

onPageLoad(async (signal) => {
  const root = document.getElementById("sessions");
  if (!root) return;
  const list = root as HTMLOListElement;
  const empty = document.getElementById("sessions-empty") as HTMLElement;
  const template = document.getElementById("session-template") as HTMLTemplateElement;

  function item(session: SessionView) {
    const node = template.content.firstElementChild?.cloneNode(true) as HTMLLIElement;
    (node.querySelector("[data-title]") as HTMLElement).textContent = `Workout ${session.workout} · ${day(session.date)}`;
    (node.querySelector("[data-sequence]") as HTMLElement).textContent = `Session ${session.sequence}`;
    (node.querySelector("[data-lifts]") as HTMLElement).replaceChildren(...session.lifts.map(liftRow));
    const health = node.querySelector("[data-health]") as HTMLElement;
    if (session.health) {
      health.hidden = false;
      health.textContent = healthText(session.health);
    }
    return node;
  }

  async function refresh() {
    const { sessions } = await loadSessions();
    list.replaceChildren(...sessions.map(item));
    empty.hidden = sessions.length > 0;
  }

  document.addEventListener("health-synced", () => void refresh(), { signal });

  try {
    await refresh();
  } catch (error) {
    notice(errorText(error, "Could not load sessions."));
  }
});
