import type { APIRoute } from "astro";
import { installationDatabase } from "@ai-outfitter/app-sdk/cloudflare/database";
import { requestIdentity, respond } from "@ai-outfitter/app-sdk/server";
import { owner } from "../../../../server/model";
import { readReport } from "../../../../server/service";
export const GET: APIRoute = ({ request, url }) => respond(async () => { owner(requestIdentity(request)); return readReport(installationDatabase(), url.searchParams.get("id") ?? ""); });
