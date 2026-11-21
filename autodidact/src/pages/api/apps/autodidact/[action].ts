import type { APIRoute } from "astro";
import { readJSON, respond } from "@ai-outfitter/app-sdk/server";
import { z } from "zod";
import { actions } from "../../../../server/actions";
import { learningContext } from "../../../../server/context";

// The pages run the same actions the tutor and MCP clients do, as the member.
export const POST: APIRoute = ({ request, params, locals }) =>
  respond(async () => {
    const name = params.action ?? "";
    if (!Object.hasOwn(actions, name)) throw new Response("Unknown action", { status: 404 });
    const context = learningContext(request, locals);
    return actions[name as keyof typeof actions].invoke(context, await readJSON(request, z.json(), 64 * 1024));
  });
