import { onPageLoad } from "@ai-outfitter/ui/page";
import { type Focus, focusLabels, fromIsoDay, intensityLabels, isoDay, type Session, styleLabels } from "../lib/practice";
import {
  createSession, deleteSession, demoMode, errorText, loadOverview, loadSessions, notice, type SessionInput, type SessionList, timeZone,
  updateSession,
} from "./data";
import { dayText, weekTiles } from "./format";

// The Practice page: this week, the session list, and the add/edit dialog.
// Apple Health text (the recording device) is set only with textContent.

onPageLoad(async (signal) => {
  const root = document.getElementById("sessions");
  if (!root) return;
  const list = root as HTMLOListElement;
  // Progress has a "week" too; this page's root is the session list.
  const week = document.getElementById("week") as HTMLElement;
  const empty = document.getElementById("sessions-empty") as HTMLElement;
  const template = document.getElementById("session-template") as HTMLTemplateElement;
  const add = document.getElementById("add") as HTMLButtonElement;
  const dialog = document.getElementById("session-dialog") as HTMLDialogElement;
  const form = document.getElementById("session-form") as HTMLFormElement;
  let data: SessionList = { now: Date.now(), canEdit: false, sessions: [] };
  /** The session the dialog edits; null when it adds one. */
  let editing: Session | null = null;

  function title(session: Session) {
    return `${session.durationMinutes} min ${styleLabels[session.style].toLowerCase()}`;
  }

  function tags(session: Session) {
    const parts = [session.intensity ? intensityLabels[session.intensity] : "Not tagged yet"];
    parts.push(...session.focus.map((focus) => focusLabels[focus]));
    return parts.join(" · ");
  }

  function healthLine(session: Session) {
    const parts = [session.source === "health-mindful" ? "Mindful session from Apple Health" : `Apple Health ${session.activity ?? "workout"}`];
    if (session.heartRateAverage !== null) parts.push(`avg ${Math.round(session.heartRateAverage)} bpm`);
    if (session.energyKcal !== null) parts.push(`${Math.round(session.energyKcal)} kcal`);
    if (session.healthSource) parts.push(session.healthSource);
    return parts.join(" · ");
  }

  function item(session: Session) {
    const node = template.content.firstElementChild?.cloneNode(true) as HTMLLIElement;
    const field = <T = HTMLElement>(name: string) => node.querySelector(`[data-${name}]`) as T;
    node.dataset.id = session.id;
    field("title").textContent = title(session);
    field("date").textContent = dayText(session.practicedAt);
    field("tags").textContent = tags(session);
    if (session.source !== "manual") {
      field("health").textContent = healthLine(session);
      field("health").hidden = false;
    }
    if (session.note) {
      field("note").textContent = session.note;
      field("note").hidden = false;
    }
    if (data.canEdit && !demoMode) {
      field("actions").hidden = false;
      field("edit").setAttribute("aria-label", `Edit ${title(session)} on ${dayText(session.practicedAt)}`);
      field("delete").setAttribute("aria-label", `Delete ${title(session)} on ${dayText(session.practicedAt)}`);
      field("edit").addEventListener("click", () => open(session));
      field("delete").addEventListener("click", () => remove(session));
    }
    return node;
  }

  async function refresh() {
    const [sessions, overview] = await Promise.all([loadSessions(), loadOverview()]);
    data = sessions;
    weekTiles(week, overview);
    list.replaceChildren(...data.sessions.map(item));
    empty.hidden = data.sessions.length > 0;
  }

  const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement;

  function open(session: Session | null) {
    editing = session;
    form.reset();
    (document.getElementById("session-dialog-title") as HTMLElement).textContent = session ? "Edit session" : "Add session";
    input("date").value = isoDay(session?.practicedAt ?? Date.now(), timeZone);
    input("minutes").value = String(session?.durationMinutes ?? 30);
    input("style").value = session?.style ?? "vinyasa";
    input("intensity").value = session?.intensity ?? "moderate";
    input("note").value = session?.note ?? "";
    for (const box of form.querySelectorAll<HTMLInputElement>('input[name="focus"]'))
      box.checked = session?.focus.includes(box.value as Focus) ?? false;
    dialog.showModal();
  }

  /** The form's values. A session keeps its time unless its day changes; a new day is that day's local noon. */
  function values(): SessionInput {
    const date = input("date").value;
    const keepTime = editing && isoDay(editing.practicedAt, timeZone) === date;
    return {
      practicedAt: keepTime && editing ? editing.practicedAt : fromIsoDay(date, timeZone),
      durationMinutes: Number(input("minutes").value),
      style: input("style").value as SessionInput["style"],
      intensity: input("intensity").value as SessionInput["intensity"],
      focus: [...form.querySelectorAll<HTMLInputElement>('input[name="focus"]:checked')].map((box) => box.value as Focus),
      note: input("note").value,
    };
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      if (editing) await updateSession(editing.id, { ...values(), revision: editing.revision });
      else await createSession(values());
      dialog.close();
      notice(editing ? "Session saved." : "Session added.");
      await refresh();
    } catch (error) {
      notice(errorText(error, "Could not save the session."));
    }
  });
  document.getElementById("session-cancel")?.addEventListener("click", () => dialog.close());

  async function remove(session: Session) {
    if (!confirm(`Delete ${title(session)} on ${dayText(session.practicedAt)}?`)) return;
    try {
      await deleteSession(session.id, session.revision);
      notice("Session deleted.");
      await refresh();
    } catch (error) {
      notice(errorText(error, "Could not delete the session."));
    }
  }

  add.addEventListener("click", () => open(null));
  document.addEventListener("health-synced", () => void refresh().catch((error) => notice(errorText(error, "Could not load your practice."))), { signal });

  try {
    await refresh();
    add.hidden = demoMode || !data.canEdit;
  } catch (error) {
    notice(errorText(error, "Could not load your practice."));
  }
});
