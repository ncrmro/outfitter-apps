import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { fileURLToPath } from "node:url";
import type { AppIdentity } from "@ai-outfitter/app-sdk/server";
import type { Host } from "../src/server/service";
export const identity: AppIdentity = { userId: "owner", owner: { kind: "user", id: "owner" }, installationId: "dione-test", role: "owner", canEdit: true };
export async function database() { const client = createClient({ url: ":memory:" }); const db = drizzle(client); await migrate(db, { migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)) }); return { db, client, close: () => client.close() }; }
export const demoNow = Date.parse("2026-11-09T14:00:00Z");
export function hostDouble(options: {
    failSource?: boolean;
    failInference?: boolean;
    failRequest?: boolean;
} = {}) {
    const calls: Array<{
        name: string;
        input: any;
    }> = [];
    const runs = new Map<string, any>();
    const call = async (name: string, input: any): Promise<any> => {
        calls.push({ name, input });
        if (name === "snapshot")
            return { connections: [{ id: "radarr-one", provider: "radarr", resource: "ocean-radarr", owner: "user", operations: ["briefing.read", "missing.list", "queue.list", "request.search"] }] };
        if (name === "schedules")
            return [];
        if (name === "schedule.save")
            return { ...input, id: "schedule", workflowId: input.workflow, nextRunAt: demoNow, lastRunAt: null, lastOutcome: null };
        if (name === "workflow.read")
            return runs.get(input.id) ?? null;
        if (name === "workflow.start") {
            runs.set(input.id, { readiness: { steps: { collect: "ready", rank: "waiting" } } });
            return { id: input.id };
        }
        if (name === "workflow.collect") {
            const run = runs.get(input.runId);
            run.readiness.steps = input.slot.startsWith("collect") ? { collect: "complete", rank: "ready" } : { collect: "complete", rank: "complete" };
            return { run: input.slot.startsWith("rank") ? "complete" : "running", steps: run.readiness.steps };
        }
        if (name === "connector.execute") {
            if (input.operation === "request.search") {
                if (options.failRequest)
                    throw Error("unknown receipt");
                return { id: 77, status: "queued" };
            }
            if (options.failSource)
                throw Error("provider secret must not appear");
            return { items: input.operation === "queue.list" ? [] : [{ id: "42", title: "Synthetic Moonrise", kind: "movie", date: "2026-11-09T00:00:00Z", detail: "Monitored; not in library", url: "https://radarr.example/movie/42", request: { operation: "request.search", input: { id: 42 } } }], cursor: null, truncated: false };
        }
        if (name === "inference.generate") {
            if (options.failInference)
                throw Error("inference unavailable");
            return { output: { summary: "One monitored movie is available to review.", items: [{ ref: "m0", reason: "A new release from your monitored movies." }, { ref: "invented", reason: "Must never create an item" }] } };
        }
        throw Error(`Unexpected host operation ${name}`);
    };
    return { host: { call } as Host, calls, runs };
}
