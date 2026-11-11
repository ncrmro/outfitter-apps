// The member's goals, read from their own Wiki. Autodidact never writes to the Wiki:
// a topic keeps the goal's id and title so it still reads when the Wiki is unavailable.
import { readWikiGraph } from "@ai-outfitter/app-sdk/wiki";
import type { WorkflowHost } from "@ai-outfitter/app-sdk/workflow-host";

export type Goal = { id: string; title: string; summary: string; status: string | null; target: string | null; due: string | null };
export type GoalsResult = { available: true; goals: Goal[] } | { available: false; reason: string };

const MAX_GOALS = 100;
const optional = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null);

/** Open goals first (a goal marked done or dropped goes last), then by title. */
const closed = (goal: Goal) => (goal.status && /^(done|achieved|complete|completed|dropped|abandoned|archived)$/i.test(goal.status) ? 1 : 0);

/**
 * The Wiki's Goal records. Reads go through the platform with the member's own
 * authority on every call; a missing or unreachable Wiki is a reason, not an error,
 * so a topic can always start from a prompt instead.
 */
export async function readGoals(host: WorkflowHost<"interactive">): Promise<GoalsResult> {
  let graph: Awaited<ReturnType<typeof readWikiGraph>>;
  try {
    graph = await readWikiGraph(host);
  } catch (error) {
    if (error instanceof Response && error.status < 500)
      return { available: false, reason: error.status === 409 ? "Add the Wiki app to your own apps to start topics from your goals." : "Your Wiki could not be read." };
    throw error;
  }
  const goalTypes = new Set(graph.types.filter((type) => type.attributes.category === "node" && type.attributes.name === "Goal").map((type) => type.ref.id));
  const goals = graph.nodes
    .filter((node) => goalTypes.has(String(node.attributes.typeId)) && !node.attributes.archived)
    .map((node): Goal => {
      const properties = (node.attributes.properties ?? {}) as Record<string, unknown>;
      return {
        id: node.ref.id,
        title: node.title,
        summary: optional(node.attributes.summary) ?? "",
        status: optional(properties.goal_status),
        target: optional(properties.target),
        due: optional(properties.due_date),
      };
    })
    .sort((a, b) => closed(a) - closed(b) || a.title.localeCompare(b.title))
    .slice(0, MAX_GOALS);
  return { available: true, goals };
}
