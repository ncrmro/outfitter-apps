// The tutor on the REAL platform thread service, with the built operational Worker
// answering its provider callbacks and a synthetic Wiki behind the platform host.
// Tests pass a scripted model; the eval (evals/tutor) passes a real one.
import type { WorkflowHostScope, WorkflowHostStub } from "@ai-outfitter/app-sdk/workflow-host";
import { appArtifact } from "@ai-outfitter/app-test/prepare";
import { threadTestHost } from "@ai-outfitter/app-test/threads";
import { appWorker } from "@ai-outfitter/app-test/worker";
import type { LanguageModel } from "ai";
import { focusId } from "../../src/lib/learning";
import { wikiHost } from "./fixtures";

const api = "/api/apps/autodidact";
/** The owner of a personal app: no organization, the owner header names the user. */
export const tutorOwner = { userId: "member-1", organizationId: "", role: "owner", owner: { kind: "user" as const, id: "member-1" } };
const principal = { userId: "member-1", organizationId: null, installationId: "autodidact" };

export type Part = { type: string; text?: string; name?: string; input?: unknown; output?: unknown; callId?: string; [key: string]: unknown };
export type Entry = { id: string; role: string; parts: Part[] };
export type Proposal = { id: string; action: string; status: string; revision: number; changes: Record<string, unknown> };

export async function tutorHost(model: () => LanguageModel, appDirectory = new URL("../..", import.meta.url)) {
  const wiki = wikiHost();
  // eslint-disable-next-line prefer-const
  let threads: Awaited<ReturnType<typeof threadTestHost>>;
  // The app's host on each dispatch: the thread service for threads.*, the Wiki for the rest.
  const host = (scope: WorkflowHostScope): WorkflowHostStub => ({
    call: (operation, input) => (operation.startsWith("threads.") ? threads.stub(principal).call(operation, input) : wiki.stub(scope).call(operation, input)),
  });
  const app = await appWorker("autodidact", appArtifact(appDirectory, "operational"), "autodidact", { workflowHost: host });
  const scope: WorkflowHostScope = { organizationId: null, installationId: "autodidact", userId: "member-1", packageHash: "hash", phase: "interactive", expiresAt: Date.now() + 3_600_000 };
  threads = await threadTestHost({
    model, installations: ["autodidact"], users: ["member-1"],
    provider: async ({ operation, input }) => {
      const response = await app.call(`/api/internal/threads/v1/${operation}`, tutorOwner, { method: "POST", body: input, workflowHost: scope });
      const text = await response.text();
      if (!response.ok) throw new Response(text, { status: response.status });
      return text ? JSON.parse(text) : null;
    },
  });
  async function call<T>(operation: string, input: unknown): Promise<T> {
    const result = await threads.stub(principal).call(operation, input);
    if (!result.ok) throw new Response(result.message, { status: result.status });
    return result.value as T;
  }
  /** A request to the app as the owner, with the platform host on it. */
  async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const response = await app.call(path, tutorOwner, { method, ...(body === undefined ? {} : { body }), workflowHost: scope });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`);
    return JSON.parse(text) as T;
  }
  const action = <T>(name: string, input: unknown) => request<T>(`${api}/${name}`, "POST", input);
  const conversation = () => call<{ id: string }>("threads.create", { type: "autodidact.conversation", title: "Tutor", context: { type: "autodidact.page", id: focusId } });
  /** One member turn; resolves once the reply has finished. `page` is what the sidebar claims the member is looking at. */
  async function send(threadId: string, text: string, page?: { location: string; title?: string; topicId?: string }) {
    const submissionId = crypto.randomUUID();
    const metadata = page ? { "app.page": { location: page.location, ...(page.title ? { title: page.title } : {}), ...(page.topicId ? { state: { topicId: page.topicId } } : {}) } } : undefined;
    await call("threads.send", { threadId, submissionId, text, ...(metadata ? { metadata } : {}) });
    await threads.settle();
    return call<{ state: string }>("threads.submission", { threadId, submissionId });
  }
  const entries = async (threadId: string) => (await call<{ entries: Entry[] }>("threads.entries", { ref: { id: threadId }, limit: 200 })).entries;
  const proposals = async (threadId: string) => (await request<{ proposals: Proposal[] }>(`${api}/agent/proposals?thread=${threadId}`)).proposals;
  const decide = (proposal: Proposal, decision: "approve" | "reject") => request(`${api}/agent/proposals/${proposal.id}/${decision}`, "POST", { revision: proposal.revision });
  return { app, action, request, conversation, send, entries, proposals, decide, dispose: () => app.dispose() };
}
export type TutorHost = Awaited<ReturnType<typeof tutorHost>>;
