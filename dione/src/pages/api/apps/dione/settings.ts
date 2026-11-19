import type { APIRoute } from "astro";
import { installationDatabase } from "@ai-outfitter/app-sdk/cloudflare/database";
import { readJSON, requestIdentity, respond } from "@ai-outfitter/app-sdk/server";
import { workflowHost } from "@ai-outfitter/app-sdk/workflow-host";
import { owner, settingsInput } from "../../../../server/model";
import { connections, stackConnections, loadSettings, saveSettings } from "../../../../server/service";
export const GET: APIRoute = ({ request, locals }) => respond(async () => { owner(requestIdentity(request)); const host = workflowHost<"interactive">(locals); return { settings: await loadSettings(installationDatabase()), connections: await connections(host), stackConnections: await stackConnections(host), schedules: await host.call("schedules", {}) }; });
export const PUT: APIRoute = ({ request, locals }) => respond(async () => saveSettings(installationDatabase(), requestIdentity(request), workflowHost<"interactive">(locals), await readJSON(request, settingsInput, 16000)));
