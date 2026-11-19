const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const privateFields = new Set(["bindingDigest", "requestId"]);

/** Proposal authority stays in the SDK store. The browser reviews movie facts,
 * not the internal connection fingerprint and replay key used by the server. */
export function presentMovieProposal(value: unknown): unknown {
  if (!record(value) || value.action !== "movie.request" || !record(value.changes) || !record(value.schema)) return value;
  const keep = (fields: Record<string, unknown>) => Object.fromEntries(Object.entries(fields).filter(([key]) => !privateFields.has(key)));
  const schema = { ...value.schema };
  if (record(schema.properties)) schema.properties = keep(schema.properties);
  if (Array.isArray(schema.required)) schema.required = schema.required.filter(key => !privateFields.has(String(key)));
  const title = typeof value.changes.title === "string" ? value.changes.title : "Movie request";
  const label = typeof value.changes.year === "number" ? `${title} (${value.changes.year})` : title;
  return { ...keep(value), targetLabel: label, schema, changes: keep(value.changes),
    ...(record(value.before) ? { before: keep(value.before) } : {}) };
}

export function presentAgentResult(result: unknown): unknown {
  if (result instanceof Response) return result;
  const value = presentMovieProposal(result);
  if (record(value)) {
    const visible = { ...value };
    for (const key of ["proposals", "unresolved"]) if (Array.isArray(value[key])) visible[key] = value[key].map(presentMovieProposal);
    if ("proposal" in value) visible.proposal = presentMovieProposal(value.proposal);
    return visible;
  }
  return value;
}
