import type { APIRoute } from "astro";
import { installationDatabase } from "@ai-outfitter/app-sdk/cloudflare/database";
import { readJSON, respond } from "@ai-outfitter/app-sdk/server";
import { workflowHost } from "@ai-outfitter/app-sdk/workflow-host";
import { optionalHealthHost, ownerIdentity } from "../../../../../../apple-health";
import { healthStatus, syncFromHealth, syncInput } from "../../../../server/health";

// The workflow host reaches the app only as trusted dispatch props, which the
// platform supplies on the owner's request to this API (docs/workflow-host.md).

/** Whether Apple Health is connected, and when it last synced. */
export const GET: APIRoute = ({ request, locals }) =>
  respond(async () => {
    const identity = ownerIdentity(request);
    return healthStatus(installationDatabase(), optionalHealthHost(locals), identity);
  });

/** Sync from Apple Health now. */
export const POST: APIRoute = ({ request, locals }) =>
  respond(async () =>
    syncFromHealth(installationDatabase(), ownerIdentity(request), workflowHost<"interactive">(locals), await readJSON(request, syncInput, 1024)));
