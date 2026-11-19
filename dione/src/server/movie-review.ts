import { ProposalStore, type BatchDatabase } from "@ai-outfitter/app-sdk/proposal-store";
import { stableThreadId } from "@ai-outfitter/app-sdk/threads";
import { z } from "zod";
import { focusId } from "./agent";
import type { DioneContext } from "./agent-context";
import { owner } from "./model";
import { movieActions, movieRequestInput, prepareMovieRequest } from "./movies";

export const movieReviewInput = movieRequestInput.pick({ tmdbId: true, qualityProfileId: true, rootFolderPath: true })
  .extend({ requestKey: z.uuid() });

export function movieProposalStore(db: BatchDatabase, identity: DioneContext["identity"]) {
  return new ProposalStore(db, identity, { table: "dione_proposals", guard: "dione_agent_guard" });
}

export async function stageMovieReview(context: DioneContext, input: z.output<typeof movieReviewInput>, store: ProposalStore) {
  owner(context.identity);
  const { installationId, userId } = context.identity;
  const threadId = await stableThreadId("dione.movie.reviews", installationId, userId);
  const requestId = await stableThreadId("dione.movie.request", installationId, userId, input.requestKey);
  const { requestKey, ...selection } = input;
  const changes = await prepareMovieRequest(context, selection, requestId);
  const thread = await context.host().call("threads.create", {
    id: threadId, type: "dione.conversation", title: "Movie requests", visibility: "private",
    context: { type: "dione.page", id: focusId },
  });
  if (thread.id !== threadId || thread.createdBy !== userId || thread.installationId !== installationId ||
      thread.visibility !== "private" || thread.type !== "dione.conversation" || thread.context?.id !== focusId ||
      thread.context.type !== "dione.page") throw new Response("Private movie review unavailable", { status: 403 });
  const row = await store.create({ threadId, action: "movie.request", requestKey: "graph:" + requestKey,
    identity: selection, data: { action: "movie.request", requestId, targetId: focusId, targetRevision: 1,
      before: {}, changes, schema: movieActions["movie.request"].input, recovery: "inspect" } });
  return { proposalId: row.id, threadId, status: row.status };
}
