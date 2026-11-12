import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { proposalTables } from "@ai-outfitter/app-sdk/proposal-tables";
export const { proposals: agentProposals, guard: agentGuard } = proposalTables("dione_proposals", "dione_agent_guard");
export const reports = sqliteTable("reports", {
    id: text().primaryKey(), day: text().notNull(), status: text().notNull(), summary: text().notNull().default(""),
    generatedAt: integer().notNull(), completedAt: integer(), timezone: text(), inferenceError: text(),
});
// Legacy reason/rank and inferenceError columns remain for database upgrades only.
// Report generation and the public graph no longer use them.
export const items = sqliteTable("items", {
    id: text().primaryKey(), reportId: text().notNull().references(() => reports.id), source: text().notNull(), sourceId: text().notNull(),
    title: text().notNull(), kind: text().notNull(), date: text(), detail: text().notNull(), url: text(), section: text({enum:["upcoming","library","attention"]}), reason: text().notNull().default(""), rank: integer().notNull().default(100),
}, t => [uniqueIndex("items_report_source").on(t.reportId, t.source, t.sourceId, t.kind), index("items_report").on(t.reportId)]);
export const sources = sqliteTable("source_observations", {
    id: text().primaryKey(), reportId: text().notNull().references(() => reports.id), source: text().notNull(), observedAt: integer().notNull(), status: text().notNull(), error: text(), count: integer().notNull(), truncated: integer({ mode: "boolean" }).notNull(),
});
export const recommendations = sqliteTable("recommendations", {
    id: text().primaryKey(), source: text().notNull(), sourceId: text().notNull(), title: text().notNull(), operation: text().notNull(), input: text().notNull(),
    connectionId: text().notNull(), resource: text().notNull(), status: text().notNull().default("proposed"), receipt: text(), confirmedBy: text(), createdAt: integer().notNull(), updatedAt: integer().notNull(),
}, t => [uniqueIndex("recommendations_target").on(t.source, t.sourceId, t.operation, t.connectionId, t.resource)]);
export const settings = sqliteTable("settings", { id: text().primaryKey(), timezone: text().notNull(), hour: integer().notNull(), enabled: integer({ mode: "boolean" }).notNull(), bindings: text().notNull(), arrMcpBinding: text(), updatedAt: integer().notNull() });
