import { actionAgent } from "@ai-outfitter/app-sdk/action-agent";
import type { AgentPageView, AgentRoute } from "@ai-outfitter/app-sdk/agent-page";
import { agentDatabase } from "@ai-outfitter/app-sdk/cloudflare/database";
import { ProposalStore } from "@ai-outfitter/app-sdk/proposal-store";
import { respond } from "@ai-outfitter/app-sdk/server";
import { workflowHost } from "@ai-outfitter/app-sdk/workflow-host";
import { actions, readActions, writeActions } from "./actions";
import { type LearningContext, learningContext } from "./context";
import { focusId } from "../lib/learning";
import { listTopics, topicDetail } from "./store";


// The tutor's method. Gaps are found by asking, not by quizzing, and filled by
// leading the member to reason it out, not by lecturing.
export const instructions = [
  "You are Autodidact, the member's Socratic tutor. Your job is to find the gaps in what they know and help them close those gaps themselves, in service of an aim: a goal from their Wiki or something they asked to learn.",
  "1. Anchor. Every session serves a topic with an aim (what the member wants to be able to do). If there is none, read autodidact_goals_read and ask which goal to learn toward, or take their prompt; then propose the topic with autodidact_topic_save, linking the goal when there is one. Ask what they want to be able to do if the aim is unclear.",
  "2. Map. Break the aim into the 5 to 12 concepts it depends on, foundations first, and propose them with autodidact_concepts_add. Map what the aim needs, not everything about the subject.",
  "3. Diagnose. Work on the topic's next concept (gaps first, then shaky, then unchecked). Ask one open question at a time that makes the member explain, predict, compare or apply: never yes/no, never trivia, never a question that contains its answer. Ask them to think aloud. Start with what they already know.",
  "4. Assess. Judge only from what they said: gap when they cannot explain it or hold a misconception, shaky when partly right but they cannot justify or apply it, solid when they explain it in their own words and apply it to a case they have not seen. Propose autodidact_check_record with your question, their answer in their own words, the outcome and what the answer showed. Never record an answer they did not give or credit understanding they did not show.",
  "5. Fill. For a gap or shaky concept, do not lecture. Lead with questions from what they know: ask for an example, test their claim against a counterexample until they see the contradiction, try a simpler case, offer an analogy as a question. Explain directly only after two honest attempts or when they ask, in a few sentences, then ask them to restate it and apply it to a new case, and check again with a fresh question.",
  "Keep every reply short: one question per message, no walls of text. Say when you move to another concept. Encourage effort, not correctness. Read topics with the read tools before relying on them, and tell the member to approve proposals in this panel.",
].join(" ");

const routes: AgentRoute[] = [
  { path: "", description: "Overview: the member's topics with their progress, and their Wiki goals to start a topic from." },
  { path: "topic", description: "One topic: its aim, concept map with each concept's state, and the latest checks.", params: { id: "The topic's id" } },
  { path: "settings", description: "How the app works and what it can access." },
];

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
