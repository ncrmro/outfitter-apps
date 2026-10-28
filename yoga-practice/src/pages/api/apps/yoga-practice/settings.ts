import type { APIRoute } from "astro";
import { installationDatabase } from "@ai-outfitter/app-sdk/cloudflare/database";
import { readJSON, respond } from "@ai-outfitter/app-sdk/server";
import { ownerIdentity } from "../../../../../../apple-health";
import { changeTarget, loadSettings, targetInput } from "../../../../server/practice";

export const GET: APIRoute = ({ request }) =>
  respond(async () => {
    ownerIdentity(request);
    return loadSettings(installationDatabase());
  });

/** Change the weekly target. */
export const PUT: APIRoute = ({ request }) =>
  respond(async () => changeTarget(installationDatabase(), ownerIdentity(request), await readJSON(request, targetInput, 1024)));
