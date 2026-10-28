import type { APIRoute } from "astro";
import { installationDatabase } from "@ai-outfitter/app-sdk/cloudflare/database";
import { respond } from "@ai-outfitter/app-sdk/server";
import { ownerIdentity } from "../../../../../../apple-health";
import { practiceOverview } from "../../../../server/practice";

/** This week, the streak and the last eight weeks, in the member's time zone (`?timeZone=`). */
export const GET: APIRoute = ({ request }) =>
  respond(async () => {
    ownerIdentity(request);
    return practiceOverview(installationDatabase(), Date.now(), new URL(request.url).searchParams.get("timeZone") ?? "UTC");
  });
