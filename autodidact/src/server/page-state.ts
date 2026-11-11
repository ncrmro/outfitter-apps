import { installationDatabase } from "@ai-outfitter/app-sdk/cloudflare/database";
import { requestIdentity } from "@ai-outfitter/app-sdk/server";
import { workflowHost } from "@ai-outfitter/app-sdk/workflow-host";
import { personal } from "./context";
import { type GoalsResult, readGoals } from "./goals";
import { listTopics, type TopicDetail, topicDetail, type TopicSummary } from "./store";

export type DemoState = { topics: TopicSummary[]; details: Record<string, TopicDetail>; goals: GoalsResult };
type Page = { demo: boolean; canEdit: boolean; signedOut?: boolean };

const demoMode = () => import.meta.env.OUTFITTER_APP_MODE !== "operational";
const fixture = async () => (await import("../../fixtures/demo.json")).default as unknown as DemoState;

/** The member, or null for a request without one (the platform's deploy check gets the empty shell). */
function member(request: Request) {
  try {
    return personal(requestIdentity(request));
  } catch (cause) {
    if (cause instanceof Response && cause.status === 401) return null;
    throw cause;
  }
}

/**
 * The overview: topics and the member's Wiki goals. The demo build reads the
 * synthetic fixture and never writes; the operational app reads its own
 * database, and the Wiki through the platform as the member.
 */
export async function overviewState(request: Request, locals: unknown): Promise<Page & { topics: TopicSummary[]; goals: GoalsResult }> {
  if (demoMode()) {
    const { topics, goals } = await fixture();
    return { demo: true, canEdit: false, topics, goals };
  }
  const identity = member(request);
  if (!identity) return { demo: false, canEdit: false, signedOut: true, topics: [], goals: { available: false, reason: "Sign in to see your goals." } };
  const [topics, goals] = await Promise.all([
    listTopics(installationDatabase()),
    readGoals(workflowHost<"interactive">(locals as never)).catch((): GoalsResult => ({ available: false, reason: "Your Wiki could not be read just now." })),
  ]);
  return { demo: false, canEdit: identity.canEdit, topics, goals };
}

/** One topic, or null when it does not exist (or nobody is signed in). */
export async function topicState(request: Request, id: string): Promise<Page & { detail: TopicDetail | null }> {
  if (demoMode()) return { demo: true, canEdit: false, detail: (await fixture()).details[id] ?? null };
  const identity = member(request);
  if (!identity) return { demo: false, canEdit: false, signedOut: true, detail: null };
  try {
    return { demo: false, canEdit: identity.canEdit, detail: await topicDetail(installationDatabase(), id) };
  } catch (cause) {
    if (cause instanceof Response && cause.status === 404) return { demo: false, canEdit: identity.canEdit, detail: null };
    throw cause;
  }
}
