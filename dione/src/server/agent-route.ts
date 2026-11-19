import { agentDatabase } from "@ai-outfitter/app-sdk/cloudflare/database";
import { movieProposalStore } from "./movie-review";
import { respond } from "@ai-outfitter/app-sdk/server";
import { dioneContext } from "./agent-context";
import { createDioneAgent } from "./agent";
import { presentAgentResult } from "./agent-presentation";

export function agentRoute(request: Request, operation: string, locals: unknown, internal = false) {
  return respond(async () => {
    if (import.meta.env.OUTFITTER_APP_MODE !== "operational") throw new Response("Read-only demo", { status: 403 });
    const context = dioneContext(request, locals);
    const agent = createDioneAgent(context, movieProposalStore(agentDatabase(), context.identity));
    return internal ? agent.provider(request, operation) : presentAgentResult(await agent.browser(request, operation));
  });
}
