import type { APIRoute } from "astro";
import { installationDatabase } from "@ai-outfitter/app-sdk/cloudflare/database";
import { readJSON, respond } from "@ai-outfitter/app-sdk/server";
import { ownerIdentity } from "../../../../../../apple-health";
import { listSessions, saveSession, sessionInput } from "../../../../server/training";

/** Every logged session, newest first. */
export const GET: APIRoute = ({ request }) =>
  respond(async () => {
    ownerIdentity(request);
    return listSessions(installationDatabase());
  });

/** Log the next session: the reps of each set. */
export const POST: APIRoute = ({ request }) =>
  respond(async () => saveSession(installationDatabase(), ownerIdentity(request), await readJSON(request, sessionInput, 4096)));
