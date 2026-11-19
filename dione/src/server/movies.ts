import { z } from "zod";
import { defineAction, publishActionTools } from "@ai-outfitter/app-sdk/actions";
import { digest } from "@ai-outfitter/app-sdk/proposal-store";
import type { DioneContext } from "./agent-context";
import { owner } from "./model";
import { loadSettings } from "./service";

const id = z.number().int().positive();
const nullableNumber = z.number().nonnegative().nullable();
const timestamp = z.iso.datetime();
const movie = z.object({ movieId: id, tmdbId: id, title: z.string().max(500), year: z.number().int().nullable(), monitored: z.boolean(), hasFile: z.boolean() });
const lookupResult = z.object({ matches: z.array(movie.omit({ movieId: true }).extend({ movieId: id.nullable(), qualityProfileId: id.nullable(), rootFolderPath: z.string().max(2000).nullable() })).max(100), truncated: z.boolean() });
const optionsResult = z.object({ qualityProfiles: z.array(z.object({ id, name: z.string().max(200) })).max(200), rootFolders: z.array(z.object({ path: z.string().max(2000), accessible: z.boolean() })).max(200), defaultQualityProfileId: id.nullable(), defaultRootFolderPath: z.string().max(2000).nullable() });
const progressResult = z.object({ movie: movie.nullable(), search: z.object({ id, status: z.string().max(100) }).nullable(), downloads: z.array(z.object({ downloadId: z.string().max(256), downloadClient: z.string().max(200).nullable(), status: z.string().max(100), remainingBytes: nullableNumber, size: nullableNumber })).max(100), history: z.array(z.object({ eventType: z.string().max(100), date: timestamp, downloadId: z.string().max(256).nullable() })).max(100), truncated: z.boolean(), observedAt: timestamp });
const downloadResult = z.object({ downloads: z.array(z.object({ id: z.string().max(256), location: z.enum(["queue", "history"]), status: z.string().max(100), percent: z.number().min(0).max(100).nullable(), remainingBytes: nullableNumber, bytesPerSecond: nullableNumber, etaSeconds: nullableNumber })).max(40), service: z.object({ status: z.string().max(100).nullable(), bytesPerSecond: nullableNumber, issues: z.array(z.object({ code: z.string().max(100), observedAt: timestamp })).max(100) }), truncated: z.boolean(), observedAt: timestamp });
const requestReceipt = z.object({ movieId: id, tmdbId: id, title: z.string().max(500), year: z.number().int().nullable(), status: z.enum(["in-library", "download-queued", "searching", "search-requested", "added-search-requested", "already-requested"]), observedAt: timestamp, commandId: id.optional(), downloadIds: z.array(z.string().max(256)).max(100).optional() });
const permitted = ({ identity }: DioneContext) => identity.owner.kind === "user" && identity.owner.id === identity.userId && identity.canEdit;
const unavailable = () => new Response("The approved media connection or operation is unavailable. Review Dione settings and permissions.", { status: 409 });

/** Bindings are always loaded from owner settings; every call also passes the host grant check. */
async function source(context: DioneContext, provider: "radarr" | "sabnzbd" | "transmission", operations: string[]) {
  owner(context.identity);
  const binding = (await loadSettings(context.db())).bindings.find(row => row.provider === provider);
  if (!binding) throw unavailable();
  const host = context.host();
  const { connections } = await host.call("snapshot", {});
  if (!connections.some(row => row.id === binding.connectionId && row.provider === provider && row.resource === binding.resource && operations.every(operation => row.operations.includes(operation)))) throw unavailable();
  return { binding, call: async (operation: string, input: unknown) => host.call("connector.execute", { connectionId: binding.connectionId, resource: binding.resource, operation, input } as never) };
}

export const movieLookupInput = z.strictObject({ query: z.string().trim().min(1).max(200) });
export async function lookupMovie(context: DioneContext, input: z.infer<typeof movieLookupInput>) {
  try {
    const radarr = await source(context, "radarr", ["movie.lookup", "movie.options"]);
    const matches = lookupResult.parse(await radarr.call("movie.lookup", input));
    const options = optionsResult.parse(await radarr.call("movie.options", {}));
    return { status: "ok", provider: "radarr", observedAt: new Date().toISOString(), ...matches, options, defaultBasis: "Non-null defaults are inferred from verified existing-library usage, not a Radarr configured default. Review the exact profile and root before approval.", untrusted: true };
  } catch { return { status: "unavailable", provider: "radarr", message: "Movie lookup or approved request options are unavailable. No request was made." }; }
}

export const movieProgressInput = z.strictObject({ tmdbId: id });
export async function movieProgress(context: DioneContext, input: z.infer<typeof movieProgressInput>) {
  owner(context.identity);
  let result: z.infer<typeof progressResult>;
  try { result = progressResult.parse(await (await source(context, "radarr", ["movie.progress"])).call("movie.progress", input)); }
  catch { return { status: "unavailable", provider: "radarr", tmdbId: input.tmdbId, message: "Movie progress is unavailable; no download outcome can be confirmed." }; }
  if (result.movie && result.movie.tmdbId !== input.tmdbId) throw new Response("Movie identity mismatch", { status: 502 });
  // The shared thread tool result is bounded even when queue/history pages are large.
  result.truncated ||= result.downloads.length > 20 || result.history.length > 20;
  result.downloads = result.downloads.slice(0, 20);
  result.history = result.history.slice(0, 20);
  const clients: Array<{ provider: string; status: string; observedAt?: string; downloads?: z.infer<typeof downloadResult>["downloads"]; truncated?: boolean; service?: z.infer<typeof downloadResult>["service"]; message?: string }> = [];
  for (const provider of ["sabnzbd", "transmission"] as const) {
    // Client labels are provider attribution, never filename matching. An unknown label is not guessed.
    const exact = result.downloads.filter(row => row.downloadClient?.toLowerCase().replace(/[^a-z0-9]/g, "") === provider);
    const ids = [...new Set(exact.map(row => row.downloadId))];
    if (!ids.length) continue;
    try {
      const client = await source(context, provider, ["download.status"]);
      const data = downloadResult.parse(await client.call("download.status", { ids: ids.slice(0, 20) }));
      clients.push({ provider, status: "ok", observedAt: data.observedAt, downloads: data.downloads.filter(row => ids.includes(row.id)), truncated: data.truncated || ids.length > 20,
        // Global warnings are relevant only to this movie's active queue; history does not inherit them.
        ...(data.downloads.some(row => ids.includes(row.id) && row.location === "queue") ? { service: data.service } : {}),
      });
    } catch { clients.push({ provider, status: "unavailable", message: "The attributed download client could not be read. Radarr evidence remains available." }); }
  }
  const unattributed = result.downloads.filter(row => !["sabnzbd", "transmission"].some(provider => row.downloadClient?.toLowerCase().replace(/[^a-z0-9]/g, "") === provider)).map(row => row.downloadId);
  const state = result.movie?.hasFile ? "imported" : result.downloads.length ? "download-observed" : result.search && ["queued", "started"].includes(result.search.status.toLowerCase()) ? "searching" : result.movie ? "monitored-without-active-transfer" : "not-in-radarr";
  const output = { status: "ok", provider: "radarr", tmdbId: input.tmdbId, state, ...result, clients, unattributedDownloadIds: unattributed, untrusted: true, note: "A search receipt does not prove a download. Client rows are joined only by Radarr download IDs and attributed clients. Missing or truncated evidence cannot establish absence or completion." };
  while (new TextEncoder().encode(JSON.stringify(output)).byteLength > 23700) {
    output.truncated = true;
    if (output.history.length) { output.history.pop(); continue; }
    const client = output.clients.find(row => row.downloads?.length);
    if (client?.downloads) { client.downloads.pop(); client.truncated = true; continue; }
    if (output.downloads.length) { output.downloads.pop(); continue; }
    // Only fixed-size metadata remains after these bounded arrays are exhausted.
    return { status: "partial", provider: "radarr", tmdbId: input.tmdbId, truncated: true, message: "Progress exceeded the response limit; use a narrower provider read." };
  }
  return output;
}

// The same schema describes the owner's review. Server-derived fields are recomputed by prepare, never trusted from a model.
export const movieRequestInput = z.strictObject({
  tmdbId: id.meta({ title: "TMDb ID" }),
  qualityProfileId: id.nullable().default(null).meta({ title: "Quality profile ID" }),
  rootFolderPath: z.string().max(2000).nullable().default(null).meta({ title: "Root folder" }),
  title: z.string().max(500).default("").meta({ title: "Movie title", readOnly: true }),
  year: z.number().int().nullable().default(null).meta({ title: "Release year", readOnly: true }),
  qualityProfile: z.string().max(200).default("").meta({ title: "Quality profile", readOnly: true }),
  intent: z.enum(["Add and search", "Monitor and search", "Search"]).default("Add and search").meta({ title: "Confirm operation", readOnly: true }),
  monitorExisting: z.boolean().default(false).meta({ title: "Enable monitoring for this existing movie", readOnly: true }),
  bindingDigest: z.string().max(64).default("").meta({ title: "Approved connection revision", readOnly: true }),
  requestId: z.string().max(256).default("").meta({ title: "Request receipt ID", readOnly: true }),
});
export async function prepareMovieRequest(context: DioneContext, raw: unknown, requestId: string) {
  const input = movieRequestInput.parse(raw);
  const radarr = await source(context, "radarr", ["movie.lookup", "movie.options", "movie.request"]);
  const lookup = lookupResult.parse(await radarr.call("movie.lookup", { query: `tmdb:${input.tmdbId}` }));
  const matches = lookup.matches.filter(row => row.tmdbId === input.tmdbId);
  if (matches.length !== 1 || lookup.truncated) throw new Response("An exact movie match is required before review", { status: 409 });
  const match = matches[0];
  const options = optionsResult.parse(await radarr.call("movie.options", {}));
  const qualityProfileId = input.qualityProfileId ?? (match.movieId ? match.qualityProfileId : options.defaultQualityProfileId);
  const rootFolderPath = input.rootFolderPath ?? (match.movieId ? match.rootFolderPath : options.defaultRootFolderPath);
  if (match.movieId && (!match.qualityProfileId || !match.rootFolderPath || qualityProfileId !== match.qualityProfileId || rootFolderPath !== match.rootFolderPath)) throw new Response("Existing movie settings must be preserved; this request cannot move it or change its quality profile", { status: 409 });
  const profile = options.qualityProfiles.find(row => row.id === qualityProfileId);
  if (!profile || !options.rootFolders.some(row => row.path === rootFolderPath && row.accessible)) throw new Response("Choose a verified quality profile and accessible root folder before review; no defaults were assumed", { status: 409 });
  return { tmdbId: match.tmdbId, qualityProfileId, rootFolderPath, title: match.title, year: match.year, qualityProfile: profile.name, intent: match.movieId ? !match.monitored ? "Monitor and search" as const : "Search" as const : "Add and search" as const, monitorExisting: Boolean(match.movieId && !match.monitored), bindingDigest: await digest(radarr.binding), requestId };
}
export async function applyMovieRequest(context: DioneContext, input: z.infer<typeof movieRequestInput>) {
  owner(context.identity);
  if (context.actor.kind !== "member" || context.actor.id !== context.identity.userId || context.originActor?.kind !== "member" || context.originActor.id !== context.identity.userId) throw new Response("Explicit owner confirmation is required", { status: 403 });
  const verified = await prepareMovieRequest(context, input, input.requestId);
  if (!input.requestId || input.bindingDigest !== verified.bindingDigest || input.title !== verified.title || input.year !== verified.year || input.qualityProfile !== verified.qualityProfile || input.intent !== verified.intent || input.monitorExisting !== verified.monitorExisting) throw new Response("Movie, connection or request options changed; prepare and review a new proposal", { status: 409 });
  const radarr = await source(context, "radarr", ["movie.request"]);
  if (await digest(radarr.binding) !== input.bindingDigest) throw unavailable();
  try {
    const receipt = requestReceipt.parse(await radarr.call("movie.request", { tmdbId: input.tmdbId, qualityProfileId: input.qualityProfileId, rootFolderPath: input.rootFolderPath, requestId: input.requestId, monitorExisting: input.monitorExisting }));
    if (receipt.tmdbId !== input.tmdbId) throw Error("Mismatched receipt");
    return { ...receipt, requestId: input.requestId, operation: input.intent };
  } catch { throw new Response("Request outcome is unconfirmed. Inspect live movie progress before another request; do not assume it failed or repeat it.", { status: 502 }); }
}
export const movieReads = publishActionTools("dione", {
  "movie.lookup": defineAction<DioneContext, typeof movieLookupInput, ReturnType<typeof z.json>>({ description: "Find exact movie identities and verified Radarr quality profiles/root folders for owner review. Never auto-select an ambiguous title. Non-null defaults are inferred from verified existing-library usage, not a Radarr configured default; they remain visible for owner review. Null defaults require the owner to choose verified options. This is read-only.", access: "read", input: movieLookupInput, output: z.json(), canInvoke: permitted, run: lookupMovie }),
  "movie.progress": defineAction<DioneContext, typeof movieProgressInput, ReturnType<typeof z.json>>({ description: "Read current Radarr movie/search/queue/import state by exact TMDb ID and attributed SABnzbd/Transmission progress by exact download IDs. Show active transfers, waiting/paused/failed/imported state, throughput and ETA only when returned. Explain unavailable/truncated evidence; old history and search receipts do not prove an active transfer.", access: "read", input: movieProgressInput, output: z.json(), canInvoke: permitted, run: movieProgress }),
});
export const movieActions = publishActionTools("dione", {
  "movie.request": defineAction<DioneContext, typeof movieRequestInput, ReturnType<typeof z.json>>({ description: "Prepare an owner-only review to add and search a specific movie, or explicitly monitor and search an existing unmonitored movie. The private proposal shows verified title/year/TMDb ID/profile/root/monitoring intent. No provider write happens until the owner clicks Approve changes in the browser. Use lookup first; ask the owner to disambiguate titles and choose options when verified defaults are absent.", access: "write", input: movieRequestInput, output: z.json(), canInvoke: permitted, run: applyMovieRequest }),
});
