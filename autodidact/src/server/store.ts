import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { type AppIdentity, requireEditor } from "@ai-outfitter/app-sdk/server";
import { type ConceptState, MAX_CONCEPTS, nextConcept, type Outcome, outcomes, progressText, stateCounts, type TopicStatus, topicStatuses } from "../lib/learning";
import { checks, concepts, topics } from "./schema";

// biome-ignore lint/suspicious/noExplicitAny: one query interface for D1 in the Worker and libSQL in tests.
export type Database = BaseSQLiteDatabase<"async", any>;

const conflict = (what: string) => new Response(`This ${what} changed elsewhere. Reload and try again.`, { status: 409 });
const missing = (what: string) => new Response(`${what} not found`, { status: 404 });
const id = z.string().min(1).max(64);
const revision = z.number().int().positive();
const line = (max: number) => z.string().trim().min(1).max(max);
const text = (max: number) => z.string().max(max).transform((value) => value.trim());

export type Topic = Omit<typeof topics.$inferSelect, "status"> & { status: TopicStatus };
export type Concept = Omit<typeof concepts.$inferSelect, "state"> & { state: ConceptState };
export type Check = Omit<typeof checks.$inferSelect, "outcome"> & { outcome: Outcome };

// ── Reads ───────────────────────────────────────────────────────────────────

/** Every topic, newest change first, with its concepts' progress and where to go next. */
export async function listTopics(db: Database) {
  const rows = (await db.select().from(topics).orderBy(desc(topics.updatedAt)).limit(200)) as Topic[];
  const all = rows.length
    ? ((await db.select().from(concepts).where(inArray(concepts.topicId, rows.map((row) => row.id))).orderBy(asc(concepts.position))) as Concept[])
    : [];
  return rows.map((topic) => {
    const own = all.filter((concept) => concept.topicId === topic.id);
    const next = nextConcept(own);
    return { ...topic, concepts: own.length, counts: stateCounts(own), progress: progressText(own), next: next ? { id: next.id, title: next.title, state: next.state } : null };
  });
}
export type TopicSummary = Awaited<ReturnType<typeof listTopics>>[number];

/** One topic with its concept map and the latest checks, newest first. */
export async function topicDetail(db: Database, topicId: string) {
  const [topic] = (await db.select().from(topics).where(eq(topics.id, topicId))) as Topic[];
  if (!topic) throw missing("Topic");
  const map = (await db.select().from(concepts).where(eq(concepts.topicId, topicId)).orderBy(asc(concepts.position))) as Concept[];
  const recent = map.length
    ? ((await db.select().from(checks).where(inArray(checks.conceptId, map.map((concept) => concept.id))).orderBy(desc(checks.createdAt)).limit(50)) as Check[])
    : [];
  const next = nextConcept(map);
  return { topic, concepts: map, checks: recent, progress: progressText(map), next: next ? { id: next.id, title: next.title, state: next.state } : null };
}
export type TopicDetail = Awaited<ReturnType<typeof topicDetail>>;

// ── Topics ──────────────────────────────────────────────────────────────────

export const goalRef = z.strictObject({
  id: id.describe("The Wiki Goal's id, from autodidact_goals_read."),
  title: line(200).describe("The goal's title as the Wiki shows it."),
});

export const topicInput = z.strictObject({
  id: id.optional().describe("Omit to start a topic; send it with revision to change one."),
  revision: revision.optional(),
  title: line(160).optional().describe("A short name for what to learn. Required for a new topic."),
  aim: text(1000).optional().describe("What the member wants to be able to do once they know it, in their words."),
  goal: goalRef.nullable().optional().describe("The Wiki Goal this topic serves, or null for one from the member's own prompt."),
  status: z.enum(topicStatuses).optional(),
});

/** Starts a topic, or changes one at the revision the caller saw. Omitted fields are kept. */
export async function saveTopic(db: Database, identity: AppIdentity, input: z.input<typeof topicInput>, now = Date.now()) {
  requireEditor(identity);
  const value = topicInput.parse(input);
  const goal = value.goal === undefined ? {} : { goalId: value.goal?.id ?? null, goalTitle: value.goal?.title ?? null };
  if (!value.id) {
    if (!value.title) throw new Response("A new topic needs a title", { status: 400 });
    const [row] = await db.insert(topics).values({
      id: crypto.randomUUID(), title: value.title, aim: value.aim ?? "", ...goal, status: value.status ?? "active", createdAt: now, updatedAt: now,
    }).returning();
    return row as Topic;
  }
  if (value.revision === undefined) throw conflict("topic");
  const { id: topicId, revision: seen, goal: _goal, ...change } = value;
  const [row] = await db.update(topics).set({ ...change, ...goal, revision: seen + 1, updatedAt: now })
    .where(and(eq(topics.id, topicId), eq(topics.revision, seen))).returning();
  if (row) return row as Topic;
  const [current] = await db.select({ id: topics.id }).from(topics).where(eq(topics.id, topicId));
  throw current ? conflict("topic") : missing("Topic");
}

// ── Concepts ────────────────────────────────────────────────────────────────

export const conceptsInput = z.strictObject({
  topicId: id,
  concepts: z.array(z.strictObject({
    title: line(160).describe("The concept, named so the member would recognize it."),
    summary: text(500).default("").describe("One line on what understanding it means for the aim."),
  })).min(1).max(20).describe("In learning order: foundations first. Added after the topic's existing concepts."),
});

/** Adds concepts to the end of a topic's map. A title the map already has (any case) is skipped. */
export async function addConcepts(db: Database, identity: AppIdentity, input: z.input<typeof conceptsInput>, now = Date.now()) {
  requireEditor(identity);
  const value = conceptsInput.parse(input);
  const [topic] = await db.select({ id: topics.id }).from(topics).where(eq(topics.id, value.topicId));
  if (!topic) throw missing("Topic");
  const existing = await db.select({ title: concepts.title, position: concepts.position }).from(concepts).where(eq(concepts.topicId, value.topicId));
  const seen = new Set(existing.map((row) => row.title.toLowerCase()));
  const fresh = value.concepts.filter((concept) => {
    const key = concept.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (existing.length + fresh.length > MAX_CONCEPTS) throw new Response(`A topic holds at most ${MAX_CONCEPTS} concepts. Split it into narrower topics.`, { status: 400 });
  let position = Math.max(-1, ...existing.map((row) => row.position)) + 1;
  const ids: string[] = [];
  // One row per statement: D1 binds at most 100 parameters each.
  for (const concept of fresh) {
    const conceptId = crypto.randomUUID();
    await db.insert(concepts).values({ id: conceptId, topicId: value.topicId, ...concept, position: position++, createdAt: now, updatedAt: now });
    ids.push(conceptId);
  }
  if (ids.length) await db.update(topics).set({ updatedAt: now }).where(eq(topics.id, value.topicId));
  return { added: ids.length, skipped: value.concepts.length - ids.length, ids };
}

// ── Checks ──────────────────────────────────────────────────────────────────

export const checkInput = z.strictObject({
  conceptId: id,
  question: line(1000).describe("The open question asked: explain, predict, apply or give an example."),
  answer: line(4000).describe("The member's answer in their own words. Never write an answer they did not give."),
  outcome: z.enum(outcomes).describe("gap: could not explain it or holds a misconception. shaky: partly right but could not justify or apply it. solid: explained it in their own words and applied it to a new case."),
  insight: text(1000).default("").describe("What the answer showed: the misconception, the missing piece, or what they could already do."),
});

/** Records one probe and moves the concept to what it showed. The latest check decides the state. */
export async function recordCheck(db: Database, identity: AppIdentity, input: z.input<typeof checkInput>, now = Date.now()) {
  requireEditor(identity);
  const value = checkInput.parse(input);
  const [concept] = (await db.select().from(concepts).where(eq(concepts.id, value.conceptId))) as Concept[];
  if (!concept) throw missing("Concept");
  const [row] = await db.insert(checks).values({ id: crypto.randomUUID(), ...value, createdAt: now }).returning();
  await db.update(concepts).set({ state: value.outcome, lastCheckedAt: now, revision: concept.revision + 1, updatedAt: now }).where(eq(concepts.id, concept.id));
  await db.update(topics).set({ updatedAt: now }).where(eq(topics.id, concept.topicId));
  return { check: row as Check, concept: { id: concept.id, title: concept.title, from: concept.state, to: value.outcome } };
}
