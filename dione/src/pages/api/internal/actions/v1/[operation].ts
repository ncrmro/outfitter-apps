import type { APIRoute } from "astro";
import { movieProposalStore } from "../../../../../server/movie-review";
import { agentDatabase, installationDatabase } from "@ai-outfitter/app-sdk/cloudflare/database";
import { workflowHost } from "@ai-outfitter/app-sdk/workflow-host";
import { movieReads } from "../../../../../server/movies";
import { actionAPI } from "@ai-outfitter/app-sdk/actions";
import { graphqlAction, mutateAction } from "@ai-outfitter/app-sdk/app-graphql";
import { requestIdentity, respond } from "@ai-outfitter/app-sdk/server";
import { owner } from "../../../../../server/model";
import { graphqlSchema } from "../../../../../server/graphql";
const actions = { "graph.graphql": graphqlAction(graphqlSchema), "graph.mutate": mutateAction(graphqlSchema), ...movieReads };
export const ALL: APIRoute = ({ request, params, locals }) => respond(() => {
  const identity = requestIdentity(request);
  owner(identity);
  return actionAPI(request, params.operation ?? "", actions, () => ({
    db: installationDatabase,
    proposals: () => movieProposalStore(agentDatabase(), identity),
    host: () => workflowHost<"interactive">(locals as never),
  }));
});
