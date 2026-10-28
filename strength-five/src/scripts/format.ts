// Shared formatting and the inline SVG line chart.

export const kg = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)} kg`;

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
/** A YYYY-MM-DD day as "Sat, Oct 12". */
export const day = (date: string) => dayFormat.format(Date.parse(`${date}T12:00:00Z`));

const timeFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const when = (time: number) => timeFormat.format(time);

/**
 * A link to the main site's Apple Health import. The app is the member's own,
 * served under /apps/ on the main site, so the root-relative path reaches it.
 */
export function importLink(text: string) {
  const link = document.createElement("a");
  link.href = "/connectors/apple-health";
  link.textContent = text;
  return link;
}

const svg = <K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number>) => {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
};

/** A small line chart of `points` (oldest first), labelled with `label` for screen readers. */
export function lineChart(points: { x: number; y: number }[], label: string) {
  const width = 320;
  const height = 120;
  const pad = 8;
  const chart = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": label, class: "chart" });
  if (!points.length) return chart;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const x = (value: number) => pad + ((value - minX) / (maxX - minX || 1)) * (width - pad * 2);
  // A flat line sits in the middle.
  const y = (value: number) => (maxY === minY ? height / 2 : pad + (1 - (value - minY) / (maxY - minY)) * (height - pad * 2));
  chart.appendChild(svg("polyline", { points: points.map((point) => `${x(point.x)},${y(point.y)}`).join(" "), class: "chart-line" }));
  for (const point of points) chart.appendChild(svg("circle", { cx: x(point.x), cy: y(point.y), r: 3, class: "chart-dot" }));
  return chart;
}
