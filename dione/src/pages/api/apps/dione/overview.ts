import type { APIRoute } from "astro";
import { installationDatabase } from "@ai-outfitter/app-sdk/cloudflare/database";
import { requestIdentity, respond } from "@ai-outfitter/app-sdk/server";
import { owner } from "../../../../server/model";
import { overview } from "../../../../server/service";
export const GET: APIRoute = ({ request }) => respond(async () => { owner(requestIdentity(request)); return overview(installationDatabase()); });
