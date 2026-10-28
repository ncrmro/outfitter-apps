import type { APIRoute } from "astro";
import { installationDatabase } from "@ai-outfitter/app-sdk/cloudflare/database";
import { readJSON, respond } from "@ai-outfitter/app-sdk/server";
import { ownerIdentity } from "../../../../../../apple-health";
import { createSession, listSessions, sessionInput } from "../../../../server/practice";

export const GET: APIRoute = ({ request }) =>
  respond(async () => {
    const identity = ownerIdentity(request);
    return { now: Date.now(), canEdit: identity.canEdit, sessions: await listSessions(installationDatabase()) };
  });

export const POST: APIRoute = ({ request }) =>
  respond(async () => createSession(installationDatabase(), ownerIdentity(request), await readJSON(request, sessionInput, 4096)));
