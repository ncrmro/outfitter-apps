import type { APIRoute } from "astro";
import { agentDatabase, installationDatabase } from "@ai-outfitter/app-sdk/cloudflare/database";
import { readJSON, requestActor, requestIdentity, respond } from "@ai-outfitter/app-sdk/server";
import { z } from "zod";
import { authorizeInitialization, initializeDione } from "../../../server/initialization";

export const POST: APIRoute = ({ request }) => respond(async () => {
  if (import.meta.env.OUTFITTER_APP_MODE !== "operational") throw new Response("Read-only demo", { status: 403 });
  const identity = requestIdentity(request), actor = requestActor(request, identity);
  authorizeInitialization(identity, actor);
  return initializeDione(installationDatabase(), agentDatabase(), identity, actor, await readJSON(request, z.unknown(), 4 * 1024 * 1024));
});
