import { getTableColumns, sql } from "drizzle-orm";
import type { BatchItem, BatchResponse } from "drizzle-orm/batch";
import type { BaseSQLiteDatabase, SQLiteColumn, SQLiteTable, SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { type AppIdentity, requestIdentity, requireEditor } from "@ai-outfitter/app-sdk/server";
import { type OperationInput, type OperationOutput, workflowHost } from "@ai-outfitter/app-sdk/workflow-host";

// The Apple Health read layer the personal fitness apps share (strength-five,
// yoga-practice). A sync is one app-collected workflow step: the app finds the
// member's Apple Health connection, re-reads a fixed window of records through
// `connector.execute` (it never holds the data's credentials), writes them in
// batches and collects the counts. Connector shapes:
// packages/connector-apple-health/README.md.

/** D1 in the Worker, libSQL in tests: both run a batch as one transaction. */
// biome-ignore lint/suspicious/noExplicitAny: one query interface for either driver.
export type Database = BaseSQLiteDatabase<"async", any> & {
  batch<U extends BatchItem<"sqlite">, T extends Readonly<[U, ...U[]]>>(batch: T): Promise<BatchResponse<T>>;
};

/**
 * The member forwarding this request, on a personal app. These apps hold one
 * person's training and health data, so they serve only a user-owned
 * installation, and only its owner: an organization's installation is refused
 * whoever asks, and anyone else is not found.
 */
export function ownerIdentity(request: Request): AppIdentity {
  const identity = requestIdentity(request);
  if (identity.owner.kind !== "user")
    throw new Response("This is a personal app and only works as your own. Add it from Apps as your own app to use it.", { status: 403 });
  if (identity.userId !== identity.owner.id) throw new Response("Not found", { status: 404 });
  return identity;
}

/** `connected` is null for anyone who cannot see the app's connections, or without a host on the request. */
export type HealthStatus = { connected: boolean | null; lastSyncedAt: number | null };

type Operation = "snapshot" | "workflow.active" | "workflow.start" | "workflow.collect" | "connector.execute";
/** The workflow host operations a sync uses. */
export type HealthHost = { call<K extends Operation>(operation: K, input: OperationInput<K>): Promise<OperationOutput<K>> };

/** The host the platform passes on this request, or null when it passed none (a status read still answers). */
export function optionalHealthHost(locals: Parameters<typeof workflowHost>[0]): HealthHost | null {
  try {
    return workflowHost<"interactive">(locals);
  } catch {
    return null;
  }
}

const reads = ["workouts.list", "samples.list"];

/** The member's Apple Health import as the app names it to `connector.execute`. */
export type HealthSource = { connectionId: string; resource: string };

/**
 * The member's own active Apple Health connection, when this app declares
 * both reads on it, or null. On a user-owned installation the host's snapshot
 * lists only the owner's own active connections; the host still checks the
 * owner and the manifest on every read.
 */
export async function healthSource(host: HealthHost): Promise<HealthSource | null> {
  const { connections } = await host.call("snapshot", {});
  const health = connections.find((connection) => connection.provider === "apple-health" && connection.owner === "user" &&
    connection.resource && reads.every((operation) => connection.operations.includes(operation)));
  return health?.resource ? { connectionId: health.id, resource: health.resource } : null;
}

/** Whether the app can read Apple Health; null for anyone who cannot see its connections, or without a host. */
export async function healthConnected(host: HealthHost | null, identity: AppIdentity) {
  return identity.canEdit && host ? Boolean(await healthSource(host)) : null;
}

// Control and format characters, including bidirectional overrides that can
// make one name look like another.
// biome-ignore lint/suspicious/noControlCharactersInRegex: removes control characters from provider text.
const invisible = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

/** One line of at most `max` characters: no markers, no control characters, whitespace collapsed. */
export function plainText(value: unknown, max: number) {
  return String(value ?? "")
    .replace(/<<<|>>>/g, " ")
    .replace(invisible, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

// Health text (activity, unit and above all `source`, the member's device and
// app names) is untrusted: every record arrives as bounded plain text, which
// the pages still set only with textContent.
const text = (max: number) => z.string().nullish().transform((value) => plainText(value, max) || null);
const time = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const amount = z.number().nullish();
/** The connector's own bound on a record id. */
const id = z.string().min(1).max(256);
const healthWorkout = z.object({
  id, startedAt: time, endedAt: time, activity: z.string().transform((value) => plainText(value, 64)), durationMinutes: z.number().min(0),
  energyKcal: amount, distanceMeters: amount, heartRate: z.object({ average: amount, min: amount, max: amount }).nullish(),
  indoor: z.boolean().nullish(), source: text(120),
});
const healthSample = z.object({
  id, metric: z.string().max(64), startedAt: time, endedAt: time, value: amount, unit: text(16), category: z.string().nullish(), source: text(120),
});
/** Records as the apps receive them: parsed, their text sanitized. */
export type HealthWorkout = z.output<typeof healthWorkout>;
export type HealthSample = z.output<typeof healthSample>;
/** Records as the connector returns them. */
export type HealthRecords = { workouts: z.input<typeof healthWorkout>[]; samples: z.input<typeof healthSample>[] };

const DAY = 86_400_000;
/** The connector's largest page. */
const PAGE_SIZE = 500;
/**
 * Pages per read: 1,000 records, newest first. The cap keeps a sync inside the
 * host's two-minute scope and D1's queries per invocation; a read that reaches
 * it reports `truncated` and keeps the newest records.
 */
const MAX_PAGES = 2;

const page = z.object({ workouts: z.array(z.unknown()).optional(), samples: z.array(z.unknown()).optional(), cursor: z.string().nullish() });
const pageKey = { "workouts.list": "workouts", "samples.list": "samples" } as const;

/**
 * Every record of one read, up to the page cap. A record that does not parse is
 * skipped and counted, so one bad record cannot stop every later sync; a page
 * that is not a page at all fails the sync (502) and leaves its run waiting.
 */
async function readPages<T extends z.ZodType>(host: HealthHost, source: HealthSource, operation: keyof typeof pageKey, item: T, input: Record<string, string>) {
  const items: z.output<T>[] = [];
  let skipped = 0;
  let cursor: string | null | undefined;
  for (let index = 0; index < MAX_PAGES; index++) {
    const parsed = page.safeParse(await host.call("connector.execute", {
      ...source, operation, input: { ...input, limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) },
    }));
    const list = parsed.data?.[pageKey[operation]];
    if (!parsed.success || !list) throw new Response("Apple Health returned a page this app cannot read", { status: 502 });
    for (const value of list) {
      const record = item.safeParse(value);
      if (record.success) items.push(record.data);
      else skipped++;
    }
    cursor = parsed.data.cursor;
    if (!cursor) break;
  }
  return { items, skipped, truncated: Boolean(cursor) };
}

/** Every sync re-reads the same fixed window back from `now`, so a later export import fills in older records. */
export const healthWindow = (days: number, now: number) => ({ from: new Date(now - days * DAY).toISOString(), to: new Date(now).toISOString() });

export const readWorkouts = (host: HealthHost, source: HealthSource, input: { activity: string; from: string; to: string }) =>
  readPages(host, source, "workouts.list", healthWorkout, input);
export const readSamples = (host: HealthHost, source: HealthSource, input: { metric: string; from: string; to: string }) =>
  readPages(host, source, "samples.list", healthSample, input);

/** One app-collected sync step: its workflow, the `days` input slot and the output slot it collects. */
type SyncWorkflow = { workflow: string; days: string; output: string; defaultDays: number };

/**
 * The owner's "Sync from Apple Health". Without a connection it answers 409 with
 * `hint`. Otherwise it resumes the sync run a failed sync left waiting, or
 * starts one, runs `step` over the run's `days` and collects its counts, which
 * completes the run. A step that throws leaves the run waiting for the next sync.
 */
export async function syncHealth<T extends Record<string, number | boolean>>(
  identity: AppIdentity, host: HealthHost, sync: SyncWorkflow, hint: string, step: (source: HealthSource, days: number) => Promise<T>,
) {
  requireEditor(identity);
  const source = await healthSource(host);
  if (!source) throw new Response(hint, { status: 409 });
  const [waiting] = await host.call("workflow.active", { slots: [sync.days], workflows: [sync.workflow] });
  const days = typeof waiting?.inputs[sync.days] === "number" ? (waiting.inputs[sync.days] as number) : sync.defaultDays;
  const runId = waiting?.id ?? (await host.call("workflow.start", { workflow: sync.workflow, id: crypto.randomUUID(), inputs: { [sync.days]: days } })).id;
  const counts = await step(source, days);
  const { run } = await host.call("workflow.collect", { runId, slot: sync.output, value: counts });
  return { runId, run, ...counts };
}

/** D1 binds at most 100 parameters to one statement. */
const MAX_PARAMS = 100;

/**
 * Inserts `rows` as multi-row statements of at most 100 bound values, in one
 * batch. On a conflict on `upsert` the row takes the new values; without it the
 * existing row stays. Returns how many rows were inserted or updated.
 */
export async function writeRows<T extends SQLiteTable>(db: Database, table: T, rows: T["$inferInsert"][], upsert?: SQLiteColumn[]) {
  if (!rows.length) return 0;
  const columns = getTableColumns(table) as Record<string, SQLiteColumn>;
  // Drizzle binds a value, or the default, for every column.
  const size = Math.max(1, Math.floor(MAX_PARAMS / Object.keys(columns).length));
  const set = Object.fromEntries(Object.keys(rows[0]).map((key) => [key, sql.raw(`excluded."${columns[key].name}"`)])) as SQLiteUpdateSetSource<T>;
  const statements = [];
  for (let start = 0; start < rows.length; start += size) {
    const insert = db.insert(table).values(rows.slice(start, start + size));
    statements.push((upsert ? insert.onConflictDoUpdate({ target: upsert, set }) : insert.onConflictDoNothing()).returning({ one: sql`1` }));
  }
  const results = await db.batch(statements as unknown as [BatchItem<"sqlite">]);
  return (results as unknown[][]).reduce((sum, result) => sum + result.length, 0);
}
