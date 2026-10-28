import type { APIRoute } from "astro";
import { installationDatabase } from "@ai-outfitter/app-sdk/cloudflare/database";
import { readJSON, respond } from "@ai-outfitter/app-sdk/server";
import { ownerIdentity } from "../../../../../../../apple-health";
import { deleteSession, revisionInput, sessionChange, updateSession } from "../../../../../server/practice";

export const PUT: APIRoute = ({ request, params }) =>
  respond(async () =>
    updateSession(installationDatabase(), ownerIdentity(request), params.id ?? "", await readJSON(request, sessionChange, 4096)),
  );

/** A JSON body with the revision, like every change: a stale page cannot delete. */
export const DELETE: APIRoute = ({ request, params }) =>
  respond(async () =>
    deleteSession(installationDatabase(), ownerIdentity(request), params.id ?? "", await readJSON(request, revisionInput, 1024)),
  );
