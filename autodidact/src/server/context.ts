// What the app's server code runs with: the member's verified identity and actors,
// its installation database and the platform host (for reading the member's Wiki).
import type { ActionContext } from "@ai-outfitter/app-sdk/actions";
import { installationDatabase } from "@ai-outfitter/app-sdk/cloudflare/database";
import { type AppIdentity, requestActor, requestIdentity, requestOriginActor } from "@ai-outfitter/app-sdk/server";
import { type WorkflowHost, workflowHost } from "@ai-outfitter/app-sdk/workflow-host";
import type { Database } from "./store";

export type LearningContext = ActionContext & { db: () => Database; host: () => WorkflowHost<"interactive"> };

/** A personal app: only its owner, on their own installation, gets in. */
export function personal(identity: AppIdentity) {
  if (identity.owner.kind !== "user")
    throw new Response("This is a personal app and only works as your own. Add it from Apps as your own app to use it.", { status: 403 });
  if (identity.userId !== identity.owner.id) throw new Response("Not found", { status: 404 });
  return identity;
}

export const learningServices = (locals: unknown): Omit<LearningContext, keyof ActionContext> => ({
  db: installationDatabase,
  host: () => workflowHost<"interactive">(locals as never),
});

/** A route's full context: the request's verified identity and actors with the database and host. */
export function learningContext(request: Request, locals: unknown): LearningContext {
  const identity = personal(requestIdentity(request));
  return { identity, actor: requestActor(request, identity), originActor: requestOriginActor(request, identity), ...learningServices(locals) };
}
