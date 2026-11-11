import type { APIRoute } from "astro";
import { actionAPI } from "@ai-outfitter/app-sdk/actions";
import { respond } from "@ai-outfitter/app-sdk/server";
import { actions } from "../../../../../server/actions";
import { learningServices, personal } from "../../../../../server/context";

// The reserved actions route: only platform dispatch reaches it, for MCP clients and other apps.
export const ALL: APIRoute = ({ request, params, locals }) =>
  respond(() => actionAPI(request, params.operation ?? "", actions, (identity) => (personal(identity), learningServices(locals))));
