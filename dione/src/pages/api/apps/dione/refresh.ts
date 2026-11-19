import type { APIRoute } from "astro";
import { z } from "zod";
import { installationDatabase } from "@ai-outfitter/app-sdk/cloudflare/database";
import { readJSON, requestIdentity, respond } from "@ai-outfitter/app-sdk/server";
import { workflowHost } from "@ai-outfitter/app-sdk/workflow-host";
import { owner } from "../../../../server/model";
import { generateReport } from "../../../../server/service";
export const POST: APIRoute = ({ request, locals }) => respond(async () => { owner(requestIdentity(request)); await readJSON(request, z.strictObject({}), 1024); return generateReport(installationDatabase(), workflowHost<"interactive">(locals)); });
