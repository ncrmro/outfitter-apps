import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { proposalTables } from "@ai-outfitter/app-sdk/proposal-tables";

// This installation's own database: one member's learning. After changing it,
// run `npx drizzle-kit generate` in this folder and commit the new migration.

/** Something the member wants to be able to do: from a Wiki goal or their own prompt. */
export const topics = sqliteTable(
  "topics",
  {
    id: text().primaryKey(),
    title: text().notNull(),
    /** What the member wants to be able to do once they know it, in their words. */
    aim: text().notNull().default(""),
    /** The Wiki Goal this topic serves; null for a topic started from a prompt. Title kept so the page reads without the Wiki. */
    goalId: text(),
    goalTitle: text(),
    status: text().notNull().default("active"),
    revision: integer().notNull().default(1),
    createdAt: integer().notNull(),
    updatedAt: integer().notNull(),
  },
  (t) => [
    index("topics_updated_idx").on(t.updatedAt),
    check("topics_status_check", sql`${t.status} IN ('active', 'paused', 'done')`),
  ],
);

/** A concept the topic depends on, in map order (foundations first), with what the checks so far concluded. */
export const concepts = sqliteTable(
  "concepts",
  {
    id: text().primaryKey(),
    topicId: text().notNull().references(() => topics.id, { onDelete: "cascade" }),
    title: text().notNull(),
    summary: text().notNull().default(""),
    position: integer().notNull(),
    state: text().notNull().default("unprobed"),
    lastCheckedAt: integer(),
    revision: integer().notNull().default(1),
    createdAt: integer().notNull(),
    updatedAt: integer().notNull(),
  },
  (t) => [
    uniqueIndex("concepts_topic_title_idx").on(t.topicId, t.title),
    index("concepts_topic_idx").on(t.topicId, t.position),
    check("concepts_state_check", sql`${t.state} IN ('unprobed', 'gap', 'shaky', 'solid')`),
  ],
);

/** One Socratic probe: the question, the member's answer in their words, and what it showed. */
export const checks = sqliteTable(
  "checks",
  {
    id: text().primaryKey(),
    conceptId: text().notNull().references(() => concepts.id, { onDelete: "cascade" }),
    question: text().notNull(),
    answer: text().notNull(),
    outcome: text().notNull(),
    /** What the answer showed: the misconception, the missing piece, or what they could do. */
    insight: text().notNull().default(""),
    createdAt: integer().notNull(),
  },
  (t) => [
    index("checks_concept_idx").on(t.conceptId, t.createdAt),
    check("checks_outcome_check", sql`${t.outcome} IN ('gap', 'shaky', 'solid')`),
  ],
);

/** The tutor's proposals awaiting the member's review (shared action-agent store). */
export const { proposals, guard } = proposalTables("autodidact_proposals", "autodidact_agent_guard");
