import { z } from 'zod';
import type { ConnectorOperationContext, RuntimeConnector } from '@ai-outfitter/connector-core/runtime';

type Row = Record<string, unknown>;
type Request = (context: ConnectorOperationContext, path: string, query?: Record<string, string>, body?: unknown, method?: string, signal?: AbortSignal) => Promise<unknown>;
function boundedRequest(request: Request): Request {
  const signal = AbortSignal.timeout(30_000);
  return (context, path, query, body, method) => request(context, path, query, body, method, signal);
}
export type MovieIdentity = { movieId: number; tmdbId: number; title: string; year: number | null; monitored: boolean; hasFile: boolean };
export type MovieLookupResult = { matches: Array<Omit<MovieIdentity, 'movieId'> & { movieId: number | null; qualityProfileId: number | null; rootFolderPath: string | null }>; truncated: boolean };
export type MovieOptions = { qualityProfiles: Array<{ id: number; name: string }>; rootFolders: Array<{ path: string; accessible: boolean }>; defaultQualityProfileId: number | null; defaultRootFolderPath: string | null };
export type MovieRequestReceipt = { movieId: number; tmdbId: number; title: string; year: number | null; status: 'in-library' | 'download-queued' | 'searching' | 'search-requested' | 'added-search-requested' | 'already-requested'; commandId?: number; downloadIds?: string[]; observedAt: string };
export type MovieProgress = { movie: MovieIdentity | null; search: { id: number; status: string } | null; downloads: Array<{ downloadId: string; downloadClient: string | null; status: string; remainingBytes: number | null; size: number | null }>; history: Array<{ eventType: string; date: string; downloadId: string | null }>; truncated: boolean; observedAt: string };
const id = z.number().int().positive();
export const movieLookupInput = z.strictObject({ query: z.string().trim().min(1).max(200) });
export const movieRequestInput = z.strictObject({ tmdbId: id, qualityProfileId: id, rootFolderPath: z.string().min(1).max(2048).startsWith('/').refine(value => !/[\u0000-\u001f]/.test(value)), requestId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/), monitorExisting: z.boolean().default(false) });
export const movieProgressInput = z.strictObject({ tmdbId: id });
const row = z.record(z.string(), z.unknown());
const rows = (value: unknown): Row[] => z.array(row).parse(value);
const text = (value: unknown, length = 300): string => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, length) : '';
const positive = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
const bytes = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const year = (value: unknown): number | null => typeof value === 'number' && Number.isInteger(value) && value > 1800 && value < 3000 ? value : null;
const timestamp = (value: unknown): string | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const downloadId = (value: unknown): string => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(text(value, 128)) ? text(value, 128).toLowerCase() : text(value, 128);
function downloadClient(value: Row): string | null {
  const label = text(value.downloadClientType ?? value.downloadClient, 100).toLowerCase();
  return ['sabnzbd', 'transmission'].includes(label) ? label : null;
}
function denied(message: string, status = 502): never { throw new Response(message, { status }); }
function identity(value: Row): MovieIdentity {
  const movieId = positive(value.id), tmdbId = positive(value.tmdbId), title = text(value.title);
  if (!movieId || !tmdbId || !title || typeof value.monitored !== 'boolean' || typeof value.hasFile !== 'boolean') return denied('Invalid movie identity');
  return { movieId, tmdbId, title, year: year(value.year), monitored: value.monitored, hasFile: value.hasFile };
}
function unique<T extends string | number>(values: T[]): T | null {
  const counts = new Map<T, number>(); for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const ordered = [...counts].sort((a, b) => b[1] - a[1]);
  return ordered.length && (ordered.length === 1 || ordered[0][1] > ordered[1][1]) ? ordered[0][0] : null;
}
function actualRoot(movie: Row, roots: Array<{ path: string }>): string | null {
  const direct = text(movie.rootFolderPath, 2048);
  if (direct.startsWith('/')) return direct;
  const path = text(movie.path, 2048);
  return roots.filter(root => path.startsWith(root.path.endsWith('/') ? root.path : `${root.path}/`)).sort((a, b) => b.path.length - a.path.length)[0]?.path ?? null;
}
async function currentMovie(request: Request, context: ConnectorOperationContext, tmdbId: number): Promise<Row | null> {
  const found = rows(await request(context, 'movie', { tmdbId: String(tmdbId) })).filter(value => value.tmdbId === tmdbId);
  if (found.length > 1) return denied('Ambiguous movie identity');
  if (!found.length) return null;
  identity(found[0]); return found[0];
}
async function options(request: Request, context: ConnectorOperationContext, includeDefaults = true): Promise<MovieOptions> {
  const [profiles, roots, movies] = await Promise.all([
    request(context, 'qualityprofile').then(rows), request(context, 'rootfolder').then(rows),
    // Defaults are advisory. A large library must not make verified profile/root
    // choices unusable or expand the shared response limit to load full movies.
    includeDefaults ? request(context, 'movie').then(rows).catch(() => [] as Row[]) : Promise.resolve([] as Row[]),
  ]);
  const qualityProfiles = profiles.flatMap(value => positive(value.id) && text(value.name) ? [{ id: value.id as number, name: text(value.name) }] : []).slice(0, 100);
  const rootFolders = roots.flatMap(value => text(value.path, 2048).startsWith('/') && typeof value.accessible === 'boolean' ? [{ path: text(value.path, 2048), accessible: value.accessible }] : []).slice(0, 100);
  if (profiles.length > 100 || roots.length > 100) return denied('Movie configuration exceeds the supported bound');
  const validProfiles = new Set(qualityProfiles.map(value => value.id));
  const accessible = rootFolders.filter(value => value.accessible).map(value => value.path);
  const movieRoots = movies.flatMap(value => {
    const path = text(value.path, 2048);
    const exact = accessible.find(root => value.rootFolderPath === root);
    const matching = accessible.filter(root => path.startsWith(root.endsWith('/') ? root : `${root}/`)).sort((a, b) => b.length - a.length);
    return exact ? [exact] : matching[0] ? [matching[0]] : [];
  });
  return { qualityProfiles, rootFolders, defaultQualityProfileId: unique(movies.flatMap(value => validProfiles.has(value.qualityProfileId as number) ? [value.qualityProfileId as number] : [])), defaultRootFolderPath: unique(movieRoots) ?? (accessible.length === 1 ? accessible[0] : null) };
}
const commandStates = new Set(['queued', 'started', 'completed', 'failed', 'aborted', 'cancelled']);
function commandsFor(value: unknown, movieId: number): Row[] {
  return rows(value).filter(value => value.name === 'MoviesSearch' && row.safeParse(value.body).success && Array.isArray((value.body as Row).movieIds) && ((value.body as Row).movieIds as unknown[]).includes(movieId) && positive(value.id));
}
function commandOrder(value: Row): number { return Date.parse(String(value.ended ?? value.started ?? value.queued ?? '')) || Number(value.id); }
const active = (value: Row) => ['queued', 'started'].includes(String(value.status));
async function progress(request: Request, context: ConnectorOperationContext, tmdbId: number): Promise<MovieProgress> {
  const observedAt = new Date().toISOString(), movie = await currentMovie(request, context, tmdbId);
  if (!movie) return { movie: null, search: null, downloads: [], history: [], truncated: false, observedAt };
  const parsed = identity(movie);
  const [commandRows, historyRows] = await Promise.all([request(context, 'command').then(value => commandsFor(value, parsed.movieId)), request(context, 'history/movie', { movieId: String(parsed.movieId) }).then(rows)]);
  const commands = commandRows.sort((a, b) => commandOrder(b) - commandOrder(a));
  const search = commands.find(active) ?? commands[0];
  const queue: Row[] = []; let truncated = false;
  for (let page = 1; page <= 20; page++) {
    const result = z.object({ records: z.array(row).max(100), totalRecords: z.number().int().nonnegative() }).parse(await request(context, 'queue', { page: String(page), pageSize: '100', includeUnknownMovieItems: 'true' }));
    queue.push(...result.records.filter(value => value.movieId === parsed.movieId));
    if (page * 100 >= result.totalRecords) break;
    if (result.records.length === 0) return denied('Incomplete movie queue');
    if (page === 20) truncated = true;
  }
  const downloads = queue.flatMap(value => downloadId(value.downloadId) ? [{ downloadId: downloadId(value.downloadId), downloadClient: downloadClient(value), status: text(value.status, 60) || 'unknown', remainingBytes: bytes(value.sizeleft), size: bytes(value.size) }] : []).slice(0, 100);
  if (queue.length > 100 || queue.length !== downloads.length) truncated = true;
  const history = historyRows.flatMap(value => {
    const observed = timestamp(value.date);
    return observed && text(value.eventType, 80) ? [{ eventType: text(value.eventType, 80), date: observed, downloadId: downloadId(value.downloadId) || null }] : [];
  }).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  // A current queue identity wins. Otherwise retain the latest dated receipt's
  // events only; an unrelated historical Completed job must never be joined.
  const queueIds = new Set(downloads.map(value => value.downloadId.toLowerCase()));
  const latest = history.find(value => value.downloadId)?.downloadId?.toLowerCase();
  const correlated = history.filter(value => value.downloadId && (queueIds.size ? queueIds.has(value.downloadId.toLowerCase()) : value.downloadId.toLowerCase() === latest));
  return { movie: parsed, search: search ? { id: search.id as number, status: commandStates.has(String(search.status)) ? String(search.status) : 'unknown' } : null, downloads, history: correlated.slice(0, 30), truncated: truncated || correlated.length > 30, observedAt };
}

export function movieOperations(baseRequest: Request): RuntimeConnector['operations'] {
  // Serialize same-process confirmations. The app also persists proposal claims;
  // this is not a replacement for its durable requestId/outcome handling.
  const pending = new Map<string, Promise<unknown>>();
  async function requestMovie(raw: unknown, context: ConnectorOperationContext): Promise<MovieRequestReceipt> {
    const input = movieRequestInput.parse(raw), lock = `${context.connection.id}:${input.tmdbId}`;
    const previous = pending.get(lock);
    const work = Promise.resolve(previous).catch(() => {}).then(async (): Promise<MovieRequestReceipt> => {
      const request = boundedRequest(baseRequest);
      const selection = await options(request, context, false);
      if (!selection.qualityProfiles.some(value => value.id === input.qualityProfileId) || !selection.rootFolders.some(value => value.path === input.rootFolderPath && value.accessible)) return denied('Movie profile or accessible root folder changed', 409);
      let movie = await currentMovie(request, context, input.tmdbId);
      const receipt = (value: Row, status: MovieRequestReceipt['status'], extra: Partial<MovieRequestReceipt> = {}): MovieRequestReceipt => {
        const found = identity(value); return { movieId: found.movieId, tmdbId: found.tmdbId, title: found.title, year: found.year, status, observedAt: new Date().toISOString(), ...extra };
      };
      if (movie) {
        const found = identity(movie);
        if (movie.qualityProfileId !== input.qualityProfileId || actualRoot(movie, selection.rootFolders) !== input.rootFolderPath) return denied('Existing movie profile or root folder differs from the reviewed request', 409);
        if (found.hasFile) return receipt(movie, 'in-library');
        if (!found.monitored && !input.monitorExisting) return denied('Movie monitoring confirmation required', 409);
        const state = await progress(request, context, input.tmdbId);
        if (state.truncated) return denied('Movie queue verification incomplete', 409);
        if (state.downloads.length) return receipt(movie, 'download-queued', { downloadIds: state.downloads.map(value => value.downloadId) });
        if (state.search && ['queued', 'started'].includes(state.search.status)) return receipt(movie, 'searching', { commandId: state.search.id });
        if (!found.monitored) {
          // The complete authoritative record is read again immediately before
          // the confirmed monitoring change; caller data never supplies it.
          const fresh = row.parse(await request(context, `movie/${found.movieId}`));
          const live = identity(fresh);
          if (live.tmdbId !== input.tmdbId || live.movieId !== found.movieId || fresh.qualityProfileId !== input.qualityProfileId || actualRoot(fresh, selection.rootFolders) !== input.rootFolderPath) return denied('Movie identity or configuration changed', 409);
          if (live.hasFile) return receipt(fresh, 'in-library');
          movie = live.monitored ? fresh : row.parse(await request(context, `movie/${found.movieId}`, {}, { ...fresh, monitored: true }, 'PUT'));
          const updated = identity(movie); if (updated.tmdbId !== input.tmdbId || !updated.monitored) return denied('Movie monitoring outcome unavailable');
          const latest = await progress(request, context, input.tmdbId);
          if (latest.truncated) return denied('Movie queue verification incomplete', 409);
          if (latest.movie?.hasFile) return receipt(movie, 'in-library');
          if (latest.downloads.length) return receipt(movie, 'download-queued', { downloadIds: latest.downloads.map(value => value.downloadId) });
          if (latest.search && ['queued', 'started'].includes(latest.search.status)) return receipt(movie, 'searching', { commandId: latest.search.id });
        }
        const result = row.parse(await request(context, 'command', {}, { name: 'MoviesSearch', movieIds: [found.movieId] }));
        const commandId = positive(result.id); if (!commandId) return denied('Movie search receipt unavailable');
        return receipt(movie, 'search-requested', { commandId });
      }
      const metadata = rows(await request(context, 'movie/lookup', { term: `tmdb:${input.tmdbId}` })).filter(value => value.tmdbId === input.tmdbId);
      if (metadata.length !== 1 || !text(metadata[0].title)) return denied('Movie metadata could not be verified', 409);
      const selected = metadata[0];
      const body = { tmdbId: input.tmdbId, title: text(selected.title), titleSlug: text(selected.titleSlug), year: year(selected.year), images: Array.isArray(selected.images) ? selected.images : [], qualityProfileId: input.qualityProfileId, rootFolderPath: input.rootFolderPath, monitored: true, minimumAvailability: 'released', addOptions: { searchForMovie: true } };
      movie = row.parse(await request(context, 'movie', {}, body));
      if (identity(movie).tmdbId !== input.tmdbId) return denied('Movie addition receipt unavailable');
      return receipt(movie, 'added-search-requested');
    });
    pending.set(lock, work);
    try { return await work; } finally { if (pending.get(lock) === work) pending.delete(lock); }
  }
  return {
    'movie.lookup': { input: movieLookupInput, async execute(raw, context): Promise<MovieLookupResult> {
      const request = boundedRequest(baseRequest);
      const input = movieLookupInput.parse(raw);
      const [found, rootRows] = await Promise.all([request(context, 'movie/lookup', { term: input.query }).then(rows), request(context, 'rootfolder').then(rows)]);
      const roots = rootRows.flatMap(value => text(value.path, 2048).startsWith('/') ? [{ path: text(value.path, 2048) }] : []);
      const selected = found.filter(value => positive(value.tmdbId) && text(value.title)).slice(0, 20);
      const existing = await Promise.all(selected.map(value => currentMovie(request, context, value.tmdbId as number)));
      const matches = selected.flatMap((value, index) => {
        const tmdbId = positive(value.tmdbId), title = text(value.title); if (!tmdbId || !title) return [];
        const present = existing[index];
        const current = present ? identity(present) : null;
        return [{ tmdbId, title, year: year(value.year), movieId: current?.movieId ?? null, monitored: current?.monitored ?? false, hasFile: current?.hasFile ?? false, qualityProfileId: present ? positive(present.qualityProfileId) : null, rootFolderPath: present ? actualRoot(present, roots) : null }];
      });
      return { matches, truncated: found.length > selected.length };
    } },
    'movie.options': { input: z.strictObject({}), execute: (_input, context) => options(boundedRequest(baseRequest), context) },
    'movie.request': { input: movieRequestInput, initiation: 'member', execute: requestMovie },
    'movie.progress': { input: movieProgressInput, execute: (raw, context) => progress(boundedRequest(baseRequest), context, movieProgressInput.parse(raw).tmdbId) },
  };
}
