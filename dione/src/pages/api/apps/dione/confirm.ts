import type { APIRoute } from "astro";
import { z } from "zod";
import { installationDatabase } from "@ai-outfitter/app-sdk/cloudflare/database";
import { readJSON, requestActor, requestIdentity, requestOriginActor, respond } from "@ai-outfitter/app-sdk/server";
import { workflowHost } from "@ai-outfitter/app-sdk/workflow-host";
import { confirmRecommendation } from "../../../../server/service";
export const POST: APIRoute = ({ request, locals }) => respond(async () => { const identity = requestIdentity(request); if (requestActor(request, identity).kind !== "member" || requestOriginActor(request, identity).kind !== "member")
    throw new Response("Confirm this request yourself in Dione", { status: 403 }); const { id, ...value } = await readJSON(request, z.strictObject({ id: z.string().min(1).max(256), confirmed: z.literal(true) }), 1024); return confirmRecommendation(installationDatabase(), identity, workflowHost<"interactive">(locals), id, value); });
