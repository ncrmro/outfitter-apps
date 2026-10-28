import type { APIRoute } from "astro";
import { installationDatabase } from "@ai-outfitter/app-sdk/cloudflare/database";
import { respond } from "@ai-outfitter/app-sdk/server";
import { ownerIdentity } from "../../../../../../apple-health";
import { today } from "../../../../server/training";

/** The next workout, its target weights and the latest bodyweight. */
export const GET: APIRoute = ({ request }) => respond(async () => today(installationDatabase(), ownerIdentity(request)));
