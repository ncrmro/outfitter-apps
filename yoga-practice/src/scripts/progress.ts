import { type Overview, styleLabels, type Week } from "../lib/practice";
import { errorText, loadOverview, notice } from "./data";
import { weekText, weekTiles } from "./format";

// The Progress page: a bar chart of weekly minutes with the target line, the
// same weeks as a table with resting heart rate and HRV, and practice by style.

const SVG = "http://www.w3.org/2000/svg";
const svg = (name: string, attributes: Record<string, string | number>) => {
  const element = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
};

/** Weekly minutes as bars; the dashed line is the minutes target. */
function chart(overview: Overview) {
  const { weeks, target } = overview;
  const width = 320;
  const height = 160;
  const top = Math.max(target.minutes, ...weeks.map((week) => week.minutes)) * 1.15;
  const y = (minutes: number) => height - 20 - (minutes / top) * (height - 30);
  const slot = width / weeks.length;
  const root = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `Minutes per week for the last ${weeks.length} weeks, target ${target.minutes}` });
  weeks.forEach((week, index) => {
    const x = index * slot + slot * 0.2;
    const bar = svg("rect", { x, y: y(week.minutes), width: slot * 0.6, height: height - 20 - y(week.minutes), rx: 3, class: week.met ? "bar bar--met" : "bar" });
    const label = svg("text", { x: x + slot * 0.3, y: height - 6, "text-anchor": "middle", class: "axis" });
    label.textContent = weekText(week.start, overview.timeZone);
    root.appendChild(bar);
    root.appendChild(label);
  });
  root.appendChild(svg("line", { x1: 0, x2: width, y1: y(target.minutes), y2: y(target.minutes), class: "target-line" }));
  return root;
}

const cell = (text: string) => {
  const td = document.createElement("td");
  td.textContent = text;
  return td;
};

function row(week: Week, timeZone: string) {
  const tr = document.createElement("tr");
  const head = document.createElement("th");
  head.scope = "row";
  head.textContent = weekText(week.start, timeZone);
  tr.replaceChildren(head, cell(String(week.sessions)), cell(`${week.minutes}${week.met ? " ✓" : ""}`),
    cell(week.restingHeartRate === null ? "—" : `${week.restingHeartRate} bpm`), cell(week.hrv === null ? "—" : `${week.hrv} ms`));
  return tr;
}

try {
  const overview = await loadOverview();
  weekTiles(document.getElementById("week") as HTMLElement, overview);
  (document.getElementById("chart") as HTMLElement).replaceChildren(chart(overview));
  (document.querySelector("#weeks tbody") as HTMLElement).replaceChildren(...[...overview.weeks].reverse().map((week) => row(week, overview.timeZone)));
  const byStyle = document.getElementById("by-style") as HTMLUListElement;
  byStyle.replaceChildren(...overview.byStyle.map(({ style, sessions, minutes }) => {
    const item = document.createElement("li");
    item.textContent = `${styleLabels[style]}: ${sessions} ${sessions === 1 ? "session" : "sessions"}, ${minutes} min`;
    return item;
  }));
  if (!overview.byStyle.length) byStyle.replaceChildren(Object.assign(document.createElement("li"), { textContent: "No sessions yet." }));
} catch (error) {
  notice(errorText(error, "Could not load your progress."));
}
