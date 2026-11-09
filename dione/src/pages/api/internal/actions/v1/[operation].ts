import type { APIRoute } from "astro";
import { installationDatabase } from "@ai-outfitter/app-sdk/cloudflare/database";
import { actionAPI } from "@ai-outfitter/app-sdk/actions";
import { graphqlAction } from "@ai-outfitter/app-sdk/app-graphql";
import { requestIdentity, respond } from "@ai-outfitter/app-sdk/server";
import { owner } from "../../../../../server/model";
import { graphqlSchema } from "../../../../../server/graphql";
const actions = { "graph.graphql": graphqlAction(graphqlSchema) };
export const ALL: APIRoute = ({ request, params }) => respond(() => { owner(requestIdentity(request)); return actionAPI(request, params.operation ?? "", actions, () => ({ db: installationDatabase })); });
