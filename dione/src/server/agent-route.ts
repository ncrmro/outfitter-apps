import { agentDatabase } from "@ai-outfitter/app-sdk/cloudflare/database";
import { ProposalStore } from "@ai-outfitter/app-sdk/proposal-store";
import { respond } from "@ai-outfitter/app-sdk/server";
import { dioneContext } from "./agent-context";
import { createDioneAgent } from "./agent";

export function agentRoute(request: Request, operation: string, locals: unknown, internal = false) {
  return respond(async () => {
    if (import.meta.env.OUTFITTER_APP_MODE !== "operational") throw new Response("Read-only demo", { status: 403 });
    const context = dioneContext(request, locals);
    const agent = createDioneAgent(context, new ProposalStore(agentDatabase(), context.identity, { table: "dione_proposals", guard: "dione_agent_guard" }));
    return internal ? agent.provider(request, operation) : agent.browser(request, operation);
  });
}
