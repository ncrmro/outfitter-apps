import type { ActionContext } from "@ai-outfitter/app-sdk/actions";
import { installationDatabase } from "@ai-outfitter/app-sdk/cloudflare/database";
import { requestActor, requestIdentity, requestOriginActor } from "@ai-outfitter/app-sdk/server";
import { workflowHost, type WorkflowHost } from "@ai-outfitter/app-sdk/workflow-host";
import type { Database } from "./service";
import { owner } from "./model";

export type DioneContext = ActionContext & { db(): Database; host(): WorkflowHost<"interactive"> };

/** Identity and connectors come from the authenticated installation, never agent input. */
export function dioneContext(request: Request, locals: unknown): DioneContext {
  const identity = requestIdentity(request);
  owner(identity);
  return {
    identity,
    actor: requestActor(request, identity),
    originActor: requestOriginActor(request, identity),
    db: installationDatabase,
    host: () => workflowHost<"interactive">(locals as never),
  };
}
