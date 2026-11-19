import type { APIRoute } from "astro";
import { installationDatabase } from "@ai-outfitter/app-sdk/cloudflare/database";
import { scheduleInput, workflowPhaseHandler, type PhaseInput } from "@ai-outfitter/app-sdk/workflow-host";
import { generateReport, workflow } from "../../../../server/service";
const phases = workflowPhaseHandler({ schedule: async (input, host): Promise<PhaseInput> => { const occurrence = scheduleInput.parse(input); if (occurrence.schedule.workflowId !== workflow)
        return { outcome: "declined", reason: "Unknown workflow" }; await generateReport(installationDatabase(), host, { runId: occurrence.runId, now: occurrence.scheduledFor }); return { outcome: "started" }; } });
export const POST: APIRoute = ({ request, locals }) => phases(request, locals as never);
