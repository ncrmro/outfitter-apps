// One registry of what Autodidact can do. The pages call it through their own route,
// the sidebar tutor offers it as tools (writes become proposals the member reviews),
// and the platform dispatches it for MCP clients and other apps.
import { defineAction, publishActionTools } from "@ai-outfitter/app-sdk/actions";
import { z } from "zod";
import type { LearningContext } from "./context";
import { readGoals } from "./goals";
import { addConcepts, checkInput, conceptsInput, listTopics, recordCheck, saveTopic, topicDetail, topicInput } from "./store";

const json = z.json();

export const actions = publishActionTools("autodidact", {
  "goals.read": defineAction({
    description: "Read the member's goals from their own Wiki: id, title, summary, status, target and due date. Start a topic from one with autodidact_topic_save and its goal reference.",
    access: "read", input: z.strictObject({}), output: json,
    run: (context: LearningContext) => readGoals(context.host()),
  }),
  "topics.read": defineAction({
    description: "Read every learning topic: its aim, the Wiki goal it serves, status, concept counts by state (unprobed, gap, shaky, solid) and the concept to work on next.",
    access: "read", input: z.strictObject({}), output: json,
    run: (context: LearningContext) => listTopics(context.db()),
  }),
  "topic.read": defineAction({
    description: "Read one topic's concept map in learning order, each concept's state and revision, and the latest Socratic checks (question, the member's answer, outcome, insight), newest first.",
    access: "read", input: z.strictObject({ topicId: z.string().min(1).max(64) }), output: json,
    run: (context: LearningContext, input) => topicDetail(context.db(), input.topicId),
  }),
  "topic.save": defineAction({
    description: "Start a learning topic (omit id) from a Wiki goal or the member's own prompt, or change one's title, aim, goal or status at the revision from autodidact_topic_read.",
    access: "write", input: topicInput, output: json,
    run: (context: LearningContext, input) => saveTopic(context.db(), context.identity, input),
  }),
  "concepts.add": defineAction({
    description: "Add concepts to a topic's map, in learning order with foundations first: the ideas the member must understand to reach the topic's aim. Titles the map already has are skipped.",
    access: "write", input: conceptsInput, output: json,
    run: (context: LearningContext, input) => addConcepts(context.db(), context.identity, input),
  }),
  "check.record": defineAction({
    description: "Record one Socratic check on a concept: the open question asked, the member's answer in their own words, the outcome (gap, shaky or solid) and what the answer showed. The concept takes the outcome as its state.",
    access: "write", input: checkInput, output: json,
    run: (context: LearningContext, input) => recordCheck(context.db(), context.identity, input),
  }),
});

export type ActionName = keyof typeof actions;
export const writeActions = ["topic.save", "concepts.add", "check.record"] as const satisfies ActionName[];
export const readActions = ["goals.read", "topics.read", "topic.read"] as const satisfies ActionName[];
