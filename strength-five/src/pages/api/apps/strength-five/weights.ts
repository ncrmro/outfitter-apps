import type { APIRoute } from "astro";
import { installationDatabase } from "@ai-outfitter/app-sdk/cloudflare/database";
import { readJSON, respond } from "@ai-outfitter/app-sdk/server";
import { ownerIdentity } from "../../../../../../apple-health";
import { currentWeights, setWeights, weightsInput } from "../../../../server/training";

/** Each lift's next working weight. */
export const GET: APIRoute = ({ request }) =>
  respond(async () => {
    ownerIdentity(request);
    return currentWeights(installationDatabase());
  });

/** Set starting weights, or the next weights of some lifts. */
export const PUT: APIRoute = ({ request }) =>
  respond(async () => setWeights(installationDatabase(), ownerIdentity(request), await readJSON(request, weightsInput, 4096)));
