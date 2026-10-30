import { onPageLoad } from "@ai-outfitter/ui/page";
import { liftNames, lifts } from "../lib/program";
import { errorText, loadSessions, notice } from "./data";
import { kg, lineChart } from "./format";

// Progress: one chart per lift, its weight at each session, oldest first.

onPageLoad(async () => {
  const list = document.getElementById("progress") as HTMLUListElement | null;
  if (!list) return;
  const empty = document.getElementById("progress-empty") as HTMLElement;

  try {
    const { sessions } = await loadSessions();
    const ordered = [...sessions].reverse();
    const cards = lifts.flatMap((lift) => {
      const points = ordered.flatMap((session) =>
        session.lifts.filter((entry) => entry.lift === lift).map((entry) => ({ x: session.sequence, y: entry.weightKg })));
      if (!points.length) return [];
      const card = document.createElement("li");
      card.className = "panel progress-card";
      card.dataset.lift = lift;
      const title = document.createElement("h2");
      title.textContent = liftNames[lift];
      const summary = document.createElement("p");
      summary.className = "muted";
      const [first, last] = [points[0], points[points.length - 1]];
      const best = Math.max(...points.map((point) => point.y));
      summary.textContent = `${kg(first.y)} → ${kg(last.y)} over ${points.length} ${points.length === 1 ? "session" : "sessions"}; best ${kg(best)}`;
      card.replaceChildren(title, summary, lineChart(points, `${liftNames[lift]} weight by session, from ${kg(first.y)} to ${kg(last.y)}`));
      return [card];
    });
    list.replaceChildren(...cards);
    empty.hidden = cards.length > 0;
  } catch (error) {
    notice(errorText(error, "Could not load progress."));
  }
});
