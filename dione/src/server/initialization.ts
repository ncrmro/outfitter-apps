import { eq } from "drizzle-orm";
import { z } from "zod";
import { canonicalJSON, digest, type BatchDatabase, type Statement } from "@ai-outfitter/app-sdk/proposal-store";
import type { AppActor, AppIdentity } from "@ai-outfitter/app-sdk/server";
import { collectedItem, loadSettings, type Database } from "./service";
import { items, reports, settings, sources } from "./schema";
import { plain, providers, reportDay, reportSections, reportSummary, settingsInput } from "./model";

const unavailable = "Source unavailable or access revoked";
const maxBytes = 4 * 1024 * 1024;
const credential = /\b(?:api[_ -]?key|access[_ -]?token|authorization|password|secret)\s*[:=]|\bbearer\s+[a-z0-9._~+\/-]{8,}|\btskey-[a-z0-9-]+/i;
const text = (maximum: number, minimum = 0) => z.string().min(minimum).max(maximum).refine(value => !credential.test(value), "Invalid capture text");
const dateTime = z.iso.datetime({ offset: true });
const revision = z.string().regex(/^[a-f0-9]{7,64}$/i);
const resource = text(1024, 1).refine(value => !/^[a-z][a-z0-9+.-]*:\/\//i.test(value), "Resource must be an opaque approved identifier");
const connection = z.strictObject({ connectionId: z.uuid(), resource });
const selected = connection.extend({ provider: z.enum(providers) });
const initialSettings = z.strictObject({
  timezone: settingsInput.shape.timezone,
  hour: settingsInput.shape.hour,
  enabled: z.literal(false),
  bindings: z.array(selected).max(6).refine(rows => new Set(rows.map(row => row.provider)).size === rows.length && new Set(rows.map(row => row.connectionId)).size === rows.length),
  arrMcpBinding: connection.nullable().default(null),
});
const operations = ["status.get", "briefing.read", "queue.list", "missing.list"] as const;
const allowed: Record<typeof providers[number], readonly typeof operations[number][]> = {
  radarr: ["status.get", "briefing.read", "queue.list", "missing.list"],
  sonarr: ["status.get", "briefing.read", "queue.list", "missing.list"],
  lidarr: ["status.get", "briefing.read", "queue.list", "missing.list"],
  jellyfin: ["status.get", "briefing.read"],
  transmission: ["status.get", "briefing.read", "queue.list"],
  sabnzbd: ["status.get", "briefing.read", "queue.list"],
};
const pageInput = z.strictObject({ limit: z.number().int().min(1).max(100), cursor: text(512, 1).optional(), start: dateTime.optional(), end: dateTime.optional() });
const item = z.strictObject({ id: text(256, 1), title: text(500, 1), kind: z.enum(["movie", "episode", "album", "library", "download"]), date: z.string().max(64).refine(value => Number.isFinite(Date.parse(value))).nullable(), detail: text(2000), url: z.null() });
const page = z.strictObject({ items: z.array(item).max(100), cursor: text(512, 1).nullable(), truncated: z.boolean() });
const status = z.strictObject({ connected: z.boolean(), version: text(100).nullable() });
const common = { provider: z.enum(providers), operation: z.enum(operations), input: z.union([z.strictObject({}), pageInput]), observedAt: dateTime, durationMs: z.number().int().min(0).max(300000) };
const read = z.discriminatedUnion("status", [
  z.strictObject({ ...common, status: z.literal("ok"), result: z.union([status, page]) }),
  z.strictObject({ ...common, status: z.literal("failed"), error: z.literal(unavailable) }),
]).superRefine((value, context) => {
  if (!allowed[value.provider].includes(value.operation)) context.addIssue({ code: "custom", message: "Unsupported source read" });
  if (value.operation === "status.get") {
    if (Object.keys(value.input).length || (value.status === "ok" && !("connected" in value.result))) context.addIssue({ code: "custom", message: "Invalid status read" });
  } else {
    if (!("limit" in value.input) || (value.status === "ok" && !("items" in value.result))) context.addIssue({ code: "custom", message: "Invalid page read" });
    if ("limit" in value.input) {
      const calendar = value.operation === "briefing.read";
      if (calendar !== Boolean(value.input.start && value.input.end) || (!calendar && (value.input.start || value.input.end))) context.addIssue({ code: "custom", message: "Invalid read window" });
      if (value.input.start && value.input.end && (Date.parse(value.input.end) <= Date.parse(value.input.start) || Date.parse(value.input.end) - Date.parse(value.input.start) > 31 * 86400000)) context.addIssue({ code: "custom", message: "Read window is too large" });
    }
    if (value.status === "ok" && "items" in value.result) {
      const kind = value.operation === "queue.list" || ["transmission", "sabnzbd"].includes(value.provider) ? "download" : value.provider === "radarr" ? "movie" : value.provider === "sonarr" ? "episode" : value.provider === "lidarr" ? "album" : "library";
      if (value.result.items.some(row => row.kind !== kind)) context.addIssue({ code: "custom", message: "Item type does not match source read" });
    }
  }
});
const capture = z.strictObject({ connectorRevision: revision, platformRevision: revision, observedAt: dateTime, providerWrites: z.literal(false), executionMode: z.literal("explicit-read-only-operator-baseline"), reads: z.array(read).min(1).max(64) });
const payload = z.strictObject({ version: z.literal(1), ownerId: text(256, 1), settings: initialSettings, capture });
const initialization = payload.extend({ digest: z.string().regex(/^[a-f0-9]{64}$/) });
export type OperatorCapture = z.infer<typeof initialization>;

function invalid(): never { throw new Response("Invalid operator capture", { status: 400 }); }
function fresh(value: z.infer<typeof payload>, now: number) {
  const capturedAt = Date.parse(value.capture.observedAt);
  const times = [capturedAt, ...value.capture.reads.map(row => Date.parse(row.observedAt))];
  if (times.some(time => time < now - 86400000 || time > now + 300000 || Math.abs(time - capturedAt) > 3600000)) invalid();
  if (value.capture.reads.reduce((sum, row) => sum + (row.status === "ok" && "items" in row.result ? row.result.items.length : 0), 0) > 2000) invalid();
  if (value.capture.reads.some(row => !value.settings.bindings.some(binding => binding.provider === row.provider))) invalid();
  const pages = new Map<string, { count: number; cursor: string | null; failed: boolean; limit: number; start?: string; end?: string }>();
  const statuses = new Set<string>();
  for (const row of value.capture.reads) {
    const key = `${row.provider}:${row.operation}`;
    if (row.operation === "status.get") {
      if (statuses.has(key)) invalid();
      statuses.add(key);
      continue;
    }
    if (!("limit" in row.input)) invalid();
    const prior = pages.get(key);
    if (!prior && row.input.cursor) invalid();
    if (prior && (prior.failed || prior.cursor === null || prior.cursor !== row.input.cursor || prior.limit !== row.input.limit || prior.start !== row.input.start || prior.end !== row.input.end)) invalid();
    const count = (prior?.count ?? 0) + 1;
    if (count > 3) invalid();
    pages.set(key, { count, cursor: row.status === "ok" && "items" in row.result ? row.result.cursor : null, failed: row.status === "failed", limit: row.input.limit, start: row.input.start, end: row.input.end });
  }
}

/** Stable SHA-256 of the validated, sanitized body; the digest field is excluded. */
export async function operatorCaptureDigest(input: unknown) {
  const result = payload.safeParse(input);
  if (!result.success) invalid();
  return digest(result.data);
}

/** Validate an explicit private import, including its source timestamps and digest. */
export async function parseOperatorCapture(input: unknown, now = Date.now()): Promise<OperatorCapture> {
  const result = initialization.safeParse(input);
  if (!result.success) invalid();
  const value = result.data;
  if (new TextEncoder().encode(canonicalJSON(value)).byteLength > maxBytes) invalid();
  fresh(value, now);
  const { digest: supplied, ...body } = value;
  if (await operatorCaptureDigest(body) !== supplied) invalid();
  return value;
}

/**
 * App-owned preparation for a private operator baseline. No data leaves this
 * function. Operator API failures, URLs and request descriptors are omitted;
 * the full-stack MCP baseline is not a report source and is not imported.
 */
export async function prepareOperatorCapture(input: unknown, ownerId: string, approvedSettings: unknown, now = Date.now()): Promise<OperatorCapture> {
  const rawRead = z.strictObject({ provider: z.string(), operation: z.string(), input: z.unknown(), observedAt: dateTime, durationMs: z.number().int().min(0).max(300000), status: z.enum(["ok", "failed"]), result: z.unknown().optional(), error: z.unknown().optional(), detail: z.unknown().optional() });
  const raw = z.strictObject({ connectorRevision: revision, platformRevision: revision, observedAt: dateTime, providerWrites: z.literal(false), executionMode: z.literal("explicit-read-only-operator-baseline"), reads: z.array(rawRead).min(1).max(64) }).safeParse(input);
  if (!raw.success) invalid();
  const reads: unknown[] = [];
  for (const row of raw.data.reads) {
    const observedAt = Date.parse(row.observedAt);
    if (observedAt < now - 86400000 || observedAt > now + 300000 || Math.abs(observedAt - Date.parse(raw.data.observedAt)) > 3600000) invalid();
    if (row.provider === "arr-mcp") {
      const mcp = z.object({ operation: z.literal("read.call"), input: z.strictObject({ tool: z.enum(["get_library", "search_media", "get_media_details", "get_calendar", "get_queue", "get_wanted", "get_stack_health"]), arguments: z.record(z.string(), z.json()) }), observedAt: dateTime }).safeParse(row);
      if (!mcp.success || Date.parse(mcp.data.observedAt) < now - 86400000 || Date.parse(mcp.data.observedAt) > now + 300000) invalid();
      continue;
    }
    if (["calendar.list", "library.list", "history.list"].includes(row.operation)) {
      const provider = z.enum(providers).safeParse(row.provider);
      const permitted = row.operation === "history.list" ? row.provider === "sabnzbd" : row.operation === "calendar.list" ? ["radarr", "sonarr", "lidarr"].includes(row.provider) : ["radarr", "sonarr", "lidarr", "jellyfin"].includes(row.provider);
      const parameters = pageInput.safeParse(row.input);
      if (!provider.success || !permitted || !parameters.success) invalid();
      if (row.operation === "calendar.list" && (!parameters.data.start || !parameters.data.end)) invalid();
      if (row.operation !== "calendar.list" && (parameters.data.start || parameters.data.end)) invalid();
      // Supplementary diagnostic reads are not part of the canonical report.
      // In particular, an Arr library page is not a recent-addition feed.
      continue;
    }
    const base = { provider: row.provider, operation: row.operation, input: row.input, observedAt: row.observedAt, durationMs: row.durationMs };
    if (row.status === "failed") reads.push({ ...base, status: "failed", error: unavailable });
    else if (row.status === "ok") {
      if (row.operation === "status.get") {
        const parsed = status.safeParse(row.result); if (!parsed.success) invalid();
        reads.push({ ...base, status: "ok", result: parsed.data });
      } else {
        const rawPage = z.strictObject({ items: z.array(z.strictObject({ id: z.string(), title: z.string(), kind: z.string(), date: z.string().nullable(), detail: z.string(), url: z.string().nullable(), request: z.unknown().optional() })).max(100), cursor: z.string().nullable(), truncated: z.boolean() }).safeParse(row.result);
        if (!rawPage.success) invalid();
        reads.push({ ...base, status: "ok", result: { ...rawPage.data, items: rawPage.data.items.map(row => ({ id: row.id, title: plain(row.title, 500), kind: row.kind, date: row.date, detail: plain(row.detail, 2000), url: null })) } });
      }
    } else invalid();
  }
  const body = payload.safeParse({ version: 1, ownerId, settings: approvedSettings, capture: { ...raw.data, reads } });
  if (!body.success) invalid();
  fresh(body.data, now);
  return parseOperatorCapture({ ...body.data, digest: await operatorCaptureDigest(body.data) }, now);
}

/** Reserved setup is a platform service actor, never an impersonated owner. */
export function authorizeInitialization(identity: AppIdentity, actor: AppActor) {
  if (identity.owner.kind !== "user" || Boolean(identity.organizationId) || identity.role !== "admin" || !identity.canEdit || (identity.access && identity.access !== "admin") || actor.kind !== "platform" || actor.id !== identity.userId || identity.userId === identity.owner.id)
    throw new Response("Platform initialization required", { status: 403 });
}

/** Atomic import only: this function never calls a provider, workflow or inference. */
export async function initializeDione(db: Database, database: BatchDatabase, identity: AppIdentity, actor: AppActor, input: unknown, now = Date.now()) {
  authorizeInitialization(identity, actor);
  if (input && typeof input === "object" && !Array.isArray(input) && Object.keys(input).length === 0) {
    const current = await loadSettings(db);
    return { status: current.bindings.length || current.arrMcpBinding ? "ready" : "unconfigured" };
  }
  const value = await parseOperatorCapture(input, now);
  if (value.ownerId !== identity.owner.id) throw new Response("Capture owner does not match installation", { status: 403 });
  const [existing] = await db.select({ id: reports.id }).from(reports).where(eq(reports.captureDigest, value.digest));
  if (existing) return { status: "ready", imported: false, reportId: existing.id, digest: value.digest };
  const capturedAt = Date.parse(value.capture.observedAt), reportId = `operator:${value.digest}`;
  const day = reportDay(capturedAt, value.settings.timezone);
  const observations: ReturnType<typeof collectedItem>[] = [];
  const sourceRows: typeof sources.$inferInsert[] = [];
  for (const provider of providers) {
    const captured = value.capture.reads.filter(row => row.provider === provider);
    const seen = new Set<string>();
    let failed = false, successful = false, truncated = false;
    const lastPages = new Map<string, string | null>();
    for (const row of captured) {
      if (row.status === "failed") { failed = true; continue; }
      if (!("items" in row.result)) { if (!row.result.connected) failed = true; continue; }
      successful = true;
      truncated ||= row.result.truncated;
      lastPages.set(row.operation, row.result.cursor);
      for (const item of row.result.items) {
        const key = `${item.kind}:${item.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        observations.push(collectedItem(item, provider, reportId, capturedAt, value.settings.timezone, row.operation, day));
      }
    }
    truncated ||= [...lastPages.values()].some(cursor => cursor !== null);
    const status = !successful ? "unavailable" : failed || truncated ? "partial" : "ok";
    const observedAt = captured.length ? Math.max(...captured.map(row => Date.parse(row.observedAt))) : capturedAt;
    sourceRows.push({ id: `${reportId}:${provider}`, reportId, source: provider, observedAt, status, error: !successful || failed ? unavailable : null, count: seen.size, truncated });
  }
  const sections = reportSections(observations, capturedAt, value.settings.timezone, day);
  const statements: Statement[] = [db.insert(reports).values({ id: reportId, day, timezone: value.settings.timezone, origin: "operator-capture", capturedAt, captureDigest: value.digest, operatorActor: actor.id, generatedAt: capturedAt, completedAt: now, status: sourceRows.some(row => row.status !== "ok") ? "partial" : "complete", summary: reportSummary(sections) }).onConflictDoNothing().toSQL()];
  for (let offset = 0; offset < observations.length; offset += 5) statements.push(db.insert(items).values(observations.slice(offset, offset + 5)).onConflictDoNothing().toSQL());
  statements.push(db.insert(sources).values(sourceRows).onConflictDoNothing().toSQL());
  statements.push(db.insert(settings).values({ id: "default", timezone: value.settings.timezone, hour: value.settings.hour, enabled: false, bindings: JSON.stringify(value.settings.bindings), arrMcpBinding: value.settings.arrMcpBinding ? JSON.stringify(value.settings.arrMcpBinding) : null, updatedAt: now }).onConflictDoNothing().toSQL());
  await database.batch(statements);
  return { status: "ready", imported: true, reportId, digest: value.digest };
}
