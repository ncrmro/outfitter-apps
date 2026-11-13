import { and, asc, desc, eq } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { AppIdentity } from "@ai-outfitter/app-sdk/server";
import type { OperationInput, OperationOutput } from "@ai-outfitter/app-sdk/workflow-host";
import { z } from "zod";
import { arrMcpBinding, binding, briefingRead, owner, plain, providers, observationSection, reportSections, reportSummary, reportDay, safeURL, settingsInput, type Binding } from "./model";
import { items, recommendations, reports, settings, sources } from "./schema";
export type Database = BaseSQLiteDatabase<"async", any>;
type Operations = "snapshot" | "schedules" | "schedule.save" | "workflow.start" | "workflow.read" | "workflow.collect" | "connector.execute";
export type Host = {
    call<K extends Operations>(operation: K, input: OperationInput<K>): Promise<OperationOutput<K>>;
};
export type BriefingHost = {
    call<K extends Exclude<Operations, "snapshot" | "schedules" | "schedule.save">>(operation: K, input: OperationInput<K>): Promise<OperationOutput<K>>;
};
export const workflow = "dione-briefing";
const reportFields = {id: reports.id, day: reports.day, status: reports.status, summary: reports.summary, generatedAt: reports.generatedAt, completedAt: reports.completedAt, timezone: reports.timezone, origin: reports.origin, capturedAt: reports.capturedAt, captureDigest: reports.captureDigest, operatorActor: reports.operatorActor};
const itemFields = {id: items.id, reportId: items.reportId, source: items.source, sourceId: items.sourceId, title: items.title, kind: items.kind, date: items.date, detail: items.detail, url: items.url, section: items.section};
export async function loadSettings(db: Database) {
    const [row] = await db.select().from(settings).where(eq(settings.id, "default"));
    return row ? { timezone: row.timezone, hour: row.hour, enabled: row.enabled, bindings: z.array(binding).parse(JSON.parse(row.bindings)), arrMcpBinding: row.arrMcpBinding ? arrMcpBinding.parse(JSON.parse(row.arrMcpBinding)) : null } : { timezone: "America/Chicago", hour: 8, enabled: false, bindings: [] as Binding[], arrMcpBinding: null };
}
export async function connections(host: Host) {
    const { connections } = await host.call("snapshot", {});
    return connections.filter(c => (providers as readonly string[]).includes(c.provider) && c.resource && c.operations.includes("briefing.read")).map(c => ({ provider: c.provider, connectionId: c.id, resource: c.resource!, operations: c.operations }));
}
export async function stackConnections(host: Host) {
    const { connections } = await host.call("snapshot", {});
    return connections.filter(c => c.provider === "arr-mcp" && c.resource && c.operations.includes("read.call")).map(c => ({ connectionId: c.id, resource: c.resource! }));
}
export async function saveSettings(db: Database, identity: AppIdentity, host: Host, input: unknown, now = Date.now()) {
    owner(identity);
    const value = settingsInput.parse(input);
    const available = await connections(host);
    for (const b of value.bindings)
        if (!available.some(c => c.provider === b.provider && c.connectionId === b.connectionId && c.resource === b.resource))
            throw new Response("Select an active approved connection", { status: 409 });
    if (value.arrMcpBinding && !(await stackConnections(host)).some(c => c.connectionId === value.arrMcpBinding!.connectionId && c.resource === value.arrMcpBinding!.resource))
        throw new Response("Select an active approved media MCP connection", { status: 409 });
    if (value.enabled && !value.bindings.length)
        throw new Response("Connect a media source before enabling the schedule", { status: 409 });
    // Platform validates and persists these bindings, then rechecks every scheduled read.
    const scheduleInput: OperationInput<"schedule.save"> & {
        connectionBindings: {
            connectionId: string;
            resource: string;
        }[];
    } = { workflow, timezone: value.timezone, cron: `0 ${value.hour} * * *`, inputs: {}, enabled: value.enabled, connectionBindings: value.bindings.map(({ connectionId, resource }) => ({ connectionId, resource })) };
    await host.call("schedule.save", scheduleInput);
    const stored = { ...value, bindings: JSON.stringify(value.bindings), arrMcpBinding: value.arrMcpBinding ? JSON.stringify(value.arrMcpBinding) : null, updatedAt: now };
    await db.insert(settings).values({ id: "default", ...stored }).onConflictDoUpdate({ target: settings.id, set: stored });
    return value;
}
export async function overview(db: Database) {
    const history = await db.select(reportFields).from(reports).orderBy(desc(reports.generatedAt)).limit(60);
    const latest = history[0] ?? null;
    const report = latest ? await readReport(db, latest.id) : null;
    return {settings: await loadSettings(db), reports: history, latest: report?.report ?? null, items: report?.items ?? [], sources: report?.sources ?? [], sections: report?.sections ?? {upcoming: [], library: [], attention: []}, recommendations: await db.select({id: recommendations.id, source: recommendations.source, sourceId: recommendations.sourceId, title: recommendations.title, status: recommendations.status, receipt: recommendations.receipt, updatedAt: recommendations.updatedAt}).from(recommendations).orderBy(desc(recommendations.createdAt)).limit(100)};
}
export async function readReport(db: Database, id: string) {
    const [report] = await db.select(reportFields).from(reports).where(eq(reports.id, id));
    if (!report)
        throw new Response("Report not found", { status: 404 });
    const rows = await db.select(itemFields).from(items).where(eq(items.reportId, id)).orderBy(asc(items.title), asc(items.source));
    const sections = reportSections(rows, report.generatedAt, report.timezone ?? "UTC", report.day);
    return {report: {...report, summary: reportSummary(sections)}, items: rows, sections, sources: await db.select().from(sources).where(eq(sources.reportId, id))};
}
/** Canonical storage projection shared by live collection and a verified capture. */
export function collectedItem(item: z.infer<typeof briefingRead>["items"][number], source: typeof providers[number], runId: string, now: number, timezone: string, operation: string, day: string) {
    return { id: `${runId}:${source}:${item.kind}:${item.id}`, reportId: runId, source, sourceId: item.id, title: plain(item.title, 500), kind: item.kind, date: item.date, detail: plain(item.detail, 2000), url: safeURL(item.url), section: observationSection({...item, source}, now, timezone, operation, !!item.request, day) };
}
/** Collecting is bounded to three pages per service; one failed source never erases another. */
async function collect(db: Database, host: BriefingHost, bindings: Binding[], runId: string, now: number, timezone: string, day: string) {
    let count = 0;
    const start = new Date(now - 24 * 3600000).toISOString(), end = new Date(now + 7 * 24 * 3600000).toISOString();
    for (const source of providers) {
        const b = bindings.find(row => row.provider === source);
        let truncated = false, read = 0, error: string | null = null;
        if (!b)
            error = "Not connected";
        else
            try {
                let cursor: string | null = null;
                const seen = new Set<string>();
                for (const operation of (["radarr", "sonarr", "lidarr"].includes(source) ? ["briefing.read", "missing.list", "queue.list"] : ["briefing.read"])) {
                    cursor = null;
                    for (let page = 0; page < 3; page++) {
                        const value = briefingRead.parse(await host.call("connector.execute", { connectionId: b.connectionId, resource: b.resource, operation, input: { ...(operation === "briefing.read" ? { start, end } : {}), limit: 100, ...(cursor ? { cursor } : {}) } }));
                        for (const item of value.items) {
                            const itemKey = `${item.kind}:${item.id}`;
                            if (seen.has(itemKey))
                                continue;
                            seen.add(itemKey);
                            read++;
                            const row = collectedItem(item, source, runId, now, timezone, operation, day);
                            await db.insert(items).values(row).onConflictDoNothing();
                            if (item.request && ["radarr", "sonarr", "lidarr"].includes(source))
                                await db.insert(recommendations).values({ id: crypto.randomUUID(), source, sourceId: item.id, title: row.title, operation: item.request.operation, input: JSON.stringify(item.request.input), connectionId: b.connectionId, resource: b.resource, status: "proposed", createdAt: now, updatedAt: now }).onConflictDoNothing();
                        }
                        truncated = truncated || value.truncated;
                        cursor = value.cursor;
                        if (!cursor)
                            break;
                        if (page === 2)
                            truncated = true;
                    }
                }
            }
            catch {
                error = "Source unavailable or access revoked";
            }
        count += read;
        const observation = { id: `${runId}:${source}`, reportId: runId, source, observedAt: now, status: error ? "unavailable" : truncated ? "partial" : "ok", error, count: read, truncated };
        await db.insert(sources).values(observation).onConflictDoUpdate({ target: sources.id, set: observation });
    }
    return count;
}
export async function generateReport(db: Database, host: BriefingHost, options: {
    runId?: string;
    now?: number;
    clock?: () => number;
} = {}) {
    const requestedNow = options.now ?? Date.now(), runId = options.runId ?? crypto.randomUUID();
    const config = await loadSettings(db);
    const [existing] = await db.select().from(reports).where(eq(reports.id, runId));
    const now = existing?.generatedAt ?? requestedNow;
    const timezone = existing ? existing.timezone ?? "UTC" : config.timezone;
    const day = existing?.day ?? reportDay(now, timezone);
    const completionTime = options.clock ?? Date.now;
    if (existing?.completedAt)
        return readReport(db, runId);
    const state = await host.call("workflow.read", { id: runId });
    const finalStep = state?.readiness.steps.rank !== undefined ? "rank" : "briefing";
    if (existing && ((state?.readiness.steps.briefing === "complete" || state?.readiness.steps.rank === "complete") || state?.readiness.run === "complete")) {
        await db.update(reports).set({ completedAt: completionTime() }).where(eq(reports.id, runId));
        return readReport(db, runId);
    }
    if (!state)
        await host.call("workflow.start", { workflow, id: runId, inputs: {} });
    await db.insert(reports).values({ id: runId, day, timezone, origin: "workflow", status: "collecting", generatedAt: now }).onConflictDoNothing();
    const readiness = state?.readiness.steps ?? { collect: "ready" };
    if (readiness.collect === "ready") {
        const count = await collect(db, host, config.bindings, runId, now, timezone, day);
        await host.call("workflow.collect", { runId, slot: "collect.outputs.observations", value: { count } });
    }
    const observedRows = await db.select().from(items).where(eq(items.reportId, runId));
    const sections = reportSections(observedRows, now, timezone, day);
    const observations = await db.select().from(sources).where(eq(sources.reportId, runId));
    const partial = observations.some(row => row.status !== "ok");
    await db.update(reports).set({summary: reportSummary(sections), inferenceError: null, status: partial ? "partial" : "complete"}).where(eq(reports.id, runId));
    // Older running workflow snapshots still name their final receipt "rank".
    // Complete that receipt without invoking inference; new runs use "briefing".
    await host.call("workflow.collect", {runId, slot: `${finalStep}.outputs.briefing`, value: {reportId: runId}});
    await db.update(reports).set({ completedAt: completionTime() }).where(eq(reports.id, runId));
    return readReport(db, runId);
}
export async function confirmRecommendation(db: Database, identity: AppIdentity, host: Host, id: string, input: unknown, now = Date.now()) {
    owner(identity);
    z.strictObject({ confirmed: z.literal(true) }).parse(input);
    const [current] = await db.select().from(recommendations).where(eq(recommendations.id, id));
    if (!current)
        throw new Response("Recommendation not found", { status: 404 });
    if (current.status !== "proposed")
        throw new Response("This recommendation has already been submitted or needs reconciliation", { status: 409 });
    const configured = (await loadSettings(db)).bindings.find(b => b.provider === current.source && b.connectionId === current.connectionId && b.resource === current.resource);
    if (!configured)
        throw new Response("The original connection is no longer configured", { status: 409 });
    const active = await connections(host);
    if (!active.some(b => b.provider === current.source && b.connectionId === current.connectionId && b.resource === current.resource && b.operations.includes("request.search")))
        throw new Response("Request access is unavailable", { status: 403 });
    const [claimed] = await db.update(recommendations).set({ status: "submitting", confirmedBy: identity.userId, updatedAt: now }).where(and(eq(recommendations.id, id), eq(recommendations.status, "proposed"))).returning();
    if (!claimed)
        throw new Response("Request already submitted", { status: 409 });
    try {
        const receipt = await host.call("connector.execute", { connectionId: claimed.connectionId, resource: claimed.resource, operation: "request.search", input: JSON.parse(claimed.input) });
        await db.update(recommendations).set({ status: "submitted", receipt: JSON.stringify(receipt).slice(0, 8000), updatedAt: Date.now() }).where(eq(recommendations.id, id));
        return { id, status: "submitted" };
    }
    catch {
        // An interrupted answer may follow a successful provider write. Never retry blindly.
        await db.update(recommendations).set({ status: "unknown", receipt: "Provider outcome unknown. Check the source before taking further action.", updatedAt: Date.now() }).where(eq(recommendations.id, id));
        throw new Response("Request outcome unknown. Check the source service; Dione will not submit it again automatically.", { status: 502 });
    }
}
