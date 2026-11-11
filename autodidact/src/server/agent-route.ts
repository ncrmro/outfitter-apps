import { actionAgent } from "@ai-outfitter/app-sdk/action-agent";
import type { AgentPageView } from "@ai-outfitter/app-sdk/agent-page";
import { agentDatabase } from "@ai-outfitter/app-sdk/cloudflare/database";
import { ProposalStore } from "@ai-outfitter/app-sdk/proposal-store";
import { respond } from "@ai-outfitter/app-sdk/server";
import { workflowHost } from "@ai-outfitter/app-sdk/workflow-host";
import { actions, readActions, writeActions } from "./actions";
import { type LearningContext, learningContext } from "./context";
import { focusId } from "../lib/learning";
import { listTopics, topicDetail } from "./store";
import { instructions, routes } from "./tutor";

/** The topic the page claims to show. A claim only: it is re-read from the database. */
function claimedTopic(view?: AgentPageView) {
  if (typeof view?.state?.topicId === "string") return view.state.topicId;
  const [path, query = ""] = view?.location.split("?") ?? [""];
  return /(^|\/)topic$/.test(path) ? new URLSearchParams(query).get("id") : null;
}

/** What the tutor sees with every reply: the member's topics, and the open topic in full. */
export async function agentSummary(context: LearningContext, view?: AgentPageView) {
  const db = context.db();
  const topics = await listTopics(db);
  const openId = claimedTopic(view);
  const open = openId && topics.some((topic) => topic.id === openId) ? await topicDetail(db, openId) : null;
  return {
    topics: topics.slice(0, 20).map(({ id, title, aim, goalTitle, status, progress, next }) => ({ id, title, aim, goal: goalTitle, status, progress, next })),
    openTopic: open && {
      ...open.topic,
      progress: open.progress,
      next: open.next,
      concepts: open.concepts.map(({ id, title, summary, state, revision }) => ({ id, title, summary, state, revision })),
      recentChecks: open.checks.slice(0, 8).map(({ conceptId, question, outcome, insight }) => ({ conceptId, question, outcome, insight })),
    },
  };
}

/** The shared thread service runs inference; the app supplies its records and reviewed writes. */
export function agentRoute(request: Request, operation: string, locals: unknown, internal = false) {
  return respond(async () => {
    if (import.meta.env.OUTFITTER_APP_MODE !== "operational") throw new Response("Read-only demo", { status: 403 });
    const context = learningContext(request, locals);
    const agent = actionAgent({
      store: new ProposalStore(agentDatabase(), context.identity, { table: "autodidact_proposals", guard: "autodidact_agent_guard" }),
      host: workflowHost<"interactive">(locals as never),
      type: "autodidact.conversation",
      contextType: "autodidact.page",
      focusId,
      label: "Autodidact",
      context: async () => context,
      actions: Object.fromEntries(writeActions.map((name) => [name, { action: actions[name], retry: "inspect" as const, prepare: (input: unknown) => input }])),
      reads: Object.fromEntries(readActions.map((name) => [name, actions[name]])),
      instructions,
      routes,
      page: (view) => agentSummary(context, view),
    });
    return internal ? agent.provider(request, operation) : agent.browser(request, operation);
  });
}
