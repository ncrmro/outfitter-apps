import { connectorManifestSchema } from '@ai-outfitter/connector-core/manifest';
import type { ConnectorOperationContext, RuntimeConnector } from '@ai-outfitter/connector-core/runtime';
import { z } from 'zod';

export type MediaProvider = 'radarr' | 'sonarr' | 'lidarr' | 'jellyfin' | 'transmission' | 'sabnzbd';
export type MediaItem = {
  id: string; title: string; kind: 'movie' | 'episode' | 'album' | 'library' | 'download';
  date: string | null; detail: string; url: string | null;
  request?: { operation: 'request.search'; input: { id: number } };
};
export type MediaPage = { items: MediaItem[]; cursor: string | null; truncated: boolean };
export type MediaTransport = { fetch?: typeof fetch };
export const serviceConfig = z.strictObject({
  baseUrl: z.string().max(2048).refine(validUrl, 'Choose an HTTP service URL without credentials, query or fragment'),
  publicUrl: z.string().max(2048).refine(validUrl, 'Choose an HTTP public URL without credentials, query or fragment').optional(),
});
export const briefingInput = z.strictObject({
  start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }),
  limit: z.number().int().min(1).max(100).default(50), cursor: z.string().regex(/^\d{1,8}$/).optional(),
}).refine(value => Date.parse(value.start) < Date.parse(value.end) && Date.parse(value.end) - Date.parse(value.start) <= 31 * 86400000, 'Choose an increasing window of at most 31 days');
const pageInput = z.strictObject({ limit: z.number().int().min(1).max(100).default(50), cursor: z.string().regex(/^\d{1,8}$/).optional() });
const emptyInput = z.strictObject({});
const requestInput = z.strictObject({ id: z.number().int().positive() });
type Row = Record<string, unknown>;
const rowSchema = z.record(z.string(), z.unknown());
const listSchema = z.array(rowSchema);
const string = (value: unknown) => typeof value === 'string' ? value.slice(0, 2000) : '';
const object = (value: unknown): Row => rowSchema.safeParse(value).success ? value as Row : {};
const identity = (value: unknown): string => typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : typeof value === 'string' ? value.slice(0, 200) : '';
const date = (value: unknown): string | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;

function validUrl(input: string): boolean {
  try { const value = new URL(input); return ['http:', 'https:'].includes(value.protocol) && !value.username && !value.password && !value.search && !value.hash; }
  catch { return false; }
}
function target(base: string, path: string, query: Record<string, string> = {}) {
  const result = new URL(path, base.endsWith('/') ? base : `${base}/`);
  for (const [key, value] of Object.entries(query)) result.searchParams.set(key, value);
  return result;
}
function denied(message: string, status = 502): never { throw new Response(message, { status }); }
function config(context: ConnectorOperationContext) { return serviceConfig.parse(context.connection.config); }
function key(context: ConnectorOperationContext): string {
  const value = context.credentials.apiKey;
  if (!value) denied('Media service credential unavailable', 503);
  return value;
}

/** Reject redirects, bound runtime and response size, and discard all provider error text.
 * SABnzbd's API key is a query argument: request URLs must never be logged. */
async function readJson(fetcher: typeof fetch, url: URL, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try { response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
  catch { return denied('Media service unavailable'); }
  if (!response.ok) { await response.body?.cancel(); return denied(`Media service HTTP ${response.status}`); }
  if (Number(response.headers.get('content-length') ?? 0) > 4 * 1024 * 1024) { await response.body?.cancel(); return denied('Media service response too large'); }
  if (!response.body) return denied('Invalid media service response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 4 * 1024 * 1024) { await reader.cancel(); return denied('Media service response too large'); }
      chunks.push(next.value);
    }
    const buffer = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch (error) { if (error instanceof Response) throw error; return denied('Invalid media service response'); }
  finally { reader.releaseLock(); }
}
async function validatedList(data: unknown): Promise<Row[]> {
  const parsed = listSchema.safeParse(data); if (!parsed.success) return denied('Invalid media service response'); return parsed.data;
}
function page(items: MediaItem[], offset: number, limit: number, total = items.length + offset): MediaPage {
  if (items.length === 0 && total > offset) return denied('Incomplete media service page');
  const next = offset + items.length;
  return { items, cursor: next < total ? String(next) : null, truncated: next < total };
}
function fullPage(items: MediaItem[], input: z.infer<typeof pageInput>): MediaPage {
  const offset = Number(input.cursor ?? 0); return page(items.slice(offset, offset + input.limit), offset, input.limit, items.length);
}
function itemUrl(context: ConnectorOperationContext, path: string): string | null {
  const { publicUrl } = config(context); return publicUrl ? target(publicUrl, path).href : null;
}
const arrVersion = (provider: MediaProvider) => provider === 'lidarr' ? 'v1' : 'v3';
async function arrRequest(provider: MediaProvider, fetcher: typeof fetch, context: ConnectorOperationContext, path: string, query = {}, body?: unknown) {
  return readJson(fetcher, target(config(context).baseUrl, `api/${arrVersion(provider)}/${path}`, query), {
    headers: { 'X-Api-Key': key(context), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
}
function arrItem(provider: MediaProvider, context: ConnectorOperationContext, raw: Row, calendar: boolean, window?: { start: string; end: string }): MediaItem {
  const positiveId = typeof raw.id === 'number' && Number.isSafeInteger(raw.id) && raw.id > 0 ? raw.id : 0;
  const parent = object(provider === 'sonarr' ? raw.series : raw.artist);
  const parentTitle = string(provider === 'sonarr' ? parent.title : parent.artistName);
  const title = parentTitle ? `${parentTitle}: ${string(raw.title)}` : string(raw.title);
  const hasFile = provider === 'lidarr' ? (typeof object(raw.statistics).trackFileCount === 'number' && Number(object(raw.statistics).trackFileCount) > 0) : raw.hasFile === true;
  const missing = provider === 'sonarr' ? raw.hasFile === false : provider === 'radarr' ? raw.hasFile === false : raw.monitored === true && Number(object(raw.statistics).trackFileCount) === 0;
  const monitored = raw.monitored === true && (provider !== 'sonarr' || parent.monitored !== false);
  const mediaPath = provider === 'radarr' ? `movie/${encodeURIComponent(string(raw.titleSlug) || String(raw.tmdbId ?? positiveId))}` : provider === 'sonarr' ? `series/${encodeURIComponent(string(parent.titleSlug) || String(raw.seriesId ?? ''))}` : `artist/${encodeURIComponent(string(parent.foreignArtistId) || string(raw.foreignArtistId))}`;
  const releaseDates = [raw.digitalRelease, raw.physicalRelease, raw.inCinemas].map(date).filter((value): value is string => value !== null);
  const releaseDate = window ? releaseDates.find(value => Date.parse(value) >= Date.parse(window.start) && Date.parse(value) < Date.parse(window.end)) ?? releaseDates[0] : releaseDates[0];
  return {
    id: identity(raw.id), title, kind: provider === 'radarr' ? 'movie' : provider === 'sonarr' ? (calendar ? 'episode' : 'library') : 'album',
    date: date(provider === 'sonarr' ? raw.airDateUtc : provider === 'lidarr' ? raw.releaseDate : releaseDate),
    detail: hasFile ? 'In library' : missing ? (monitored ? 'Monitored; not in library' : 'Not in library') : 'Library status unknown',
    url: itemUrl(context, mediaPath),
    ...(positiveId && monitored && missing ? { request: { operation: 'request.search' as const, input: { id: positiveId } } } : {}),
  };
}
async function arrRead(provider: MediaProvider, fetcher: typeof fetch, context: ConnectorOperationContext, raw: unknown, calendar: boolean): Promise<MediaPage> {
  const input = calendar ? briefingInput.parse(raw) : pageInput.parse(raw);
  const path = calendar ? 'calendar' : provider === 'radarr' ? 'movie' : provider === 'sonarr' ? 'series' : 'album';
  const query = calendar ? { start: (input as z.infer<typeof briefingInput>).start, end: (input as z.infer<typeof briefingInput>).end } : {};
  const rows = await validatedList(await arrRequest(provider, fetcher, context, path, query));
  return fullPage(rows.map(value => arrItem(provider, context, value, calendar, calendar ? input as z.infer<typeof briefingInput> : undefined)).filter(value => value.id && value.title), input);
}
async function arrMissing(provider: MediaProvider, fetcher: typeof fetch, context: ConnectorOperationContext, raw: unknown): Promise<MediaPage> {
  const input = pageInput.parse(raw), pageNumber = Number(input.cursor ?? 1);
  const data = object(await arrRequest(provider, fetcher, context, 'wanted/missing', { page: String(pageNumber), pageSize: String(input.limit), monitored: 'true', includeSeries: 'true', includeArtist: 'true' }));
  const rows = await validatedList(data.records);
  const items = rows.map(value => arrItem(provider, context, value, true)).filter(value => value.id && value.title);
  const more = typeof data.totalRecords === 'number' && pageNumber * input.limit < data.totalRecords;
  return { items, cursor: more ? String(pageNumber + 1) : null, truncated: more };
}
async function arrQueue(provider: MediaProvider, fetcher: typeof fetch, context: ConnectorOperationContext, raw: unknown): Promise<MediaPage> {
  const input = pageInput.parse(raw), offset = Number(input.cursor ?? 0);
  // Arr paging is one-based. Cursors represent pages for queue.list, not item offsets.
  const pageNumber = offset || 1;
  const data = object(await arrRequest(provider, fetcher, context, 'queue', { page: String(pageNumber), pageSize: String(input.limit), includeUnknownMovieItems: 'false', includeUnknownSeriesItems: 'false' }));
  const rows = await validatedList(data.records);
  const items: MediaItem[] = rows.map(value => ({ id: identity(value.id), title: string(value.title), kind: 'download', date: date(value.estimatedCompletionTime), detail: string(value.trackedDownloadStatus ?? value.status) || 'Queued', url: itemUrl(context, 'activity/queue') }));
  const more = typeof data.totalRecords === 'number' && pageNumber * input.limit < data.totalRecords;
  return { items, cursor: more ? String(pageNumber + 1) : null, truncated: more };
}
async function arrSearch(provider: MediaProvider, fetcher: typeof fetch, context: ConnectorOperationContext, raw: unknown) {
  const input = requestInput.parse(raw);
  const noun = provider === 'radarr' ? 'movie' : provider === 'sonarr' ? 'episode' : 'album';
  const media = object(await arrRequest(provider, fetcher, context, `${noun}/${input.id}`));
  if (media.id !== input.id || media.monitored !== true) return denied('Only existing monitored media can be requested', 409);
  if (provider === 'sonarr') {
    if (typeof media.seriesId !== 'number' || media.seriesId <= 0) return denied('Episode series is unknown', 409);
    const series = object(await arrRequest(provider, fetcher, context, `series/${media.seriesId}`));
    if (series.monitored !== true) return denied('Only existing monitored media can be requested', 409);
  }
  if (provider === 'lidarr') {
    const stats = object(media.statistics);
    if (typeof stats.trackFileCount !== 'number' || stats.trackFileCount !== 0) return denied('Album is present or its file status is unknown', 409);
  } else if (media.hasFile !== false) return denied('Media is present or its file status is unknown', 409);
  const command = provider === 'radarr' ? { name: 'MoviesSearch', movieIds: [input.id] } : provider === 'sonarr' ? { name: 'EpisodeSearch', episodeIds: [input.id] } : { name: 'AlbumSearch', albumIds: [input.id] };
  const result = object(await arrRequest(provider, fetcher, context, 'command', {}, command));
  if (!identity(result.id)) return denied('Invalid media request receipt');
  return { id: identity(result.id), mediaId: String(input.id), status: string(result.status) || 'queued' };
}
async function jellyfinRead(fetcher: typeof fetch, context: ConnectorOperationContext, raw: unknown, briefing: boolean): Promise<MediaPage> {
  const input = briefing ? briefingInput.parse(raw) : pageInput.parse(raw), offset = Number(input.cursor ?? 0);
  const data = object(await readJson(fetcher, target(config(context).baseUrl, 'Items', {
    Recursive: 'true', SortBy: 'DateCreated', SortOrder: 'Descending', StartIndex: String(offset), Limit: String(input.limit), Fields: 'DateCreated', IncludeItemTypes: 'Movie,Episode,MusicAlbum',
  }), { headers: { 'X-Emby-Token': key(context) } }));
  const rows = await validatedList(data.Items);
  const items: MediaItem[] = rows.map(value => ({ id: identity(value.Id), title: string(value.Name), kind: 'library', date: date(value.DateCreated), detail: string(value.Type) || 'Recently added', url: itemUrl(context, `web/index.html#!/details?id=${encodeURIComponent(identity(value.Id))}`) }));
  // Items are recently added library context, not a claim they were added in the report window.
  const total = typeof data.TotalRecordCount === 'number' ? data.TotalRecordCount : offset + items.length;
  return page(items, offset, input.limit, total);
}
async function transmissionRpc(fetcher: typeof fetch, context: ConnectorOperationContext, method: string, args: Row) {
  const base = config(context).baseUrl;
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (context.credentials.username !== undefined || context.credentials.password !== undefined) {
    if (!context.credentials.username || !context.credentials.password) return denied('Transmission credential unavailable', 503);
    headers.set('Authorization', `Basic ${Buffer.from(`${context.credentials.username}:${context.credentials.password}`).toString('base64')}`);
  }
  const url = target(base, 'transmission/rpc'); const body = JSON.stringify({ method, arguments: args });
  const send = () => fetcher(url, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(15000) });
  let response: Response;
  try {
    response = await send();
    if (response.status === 409) {
      const session = response.headers.get('X-Transmission-Session-Id'); await response.body?.cancel();
      if (!session || session.length > 1024) return denied('Transmission session unavailable');
      headers.set('X-Transmission-Session-Id', session); response = await send();
    }
  } catch (error) { if (error instanceof Response) throw error; return denied('Media service unavailable'); }
  // Reuse the bounded JSON decoder without issuing another network call.
  const data = object(await readJson(async () => response, url));
  if (data.result !== 'success') return denied('Transmission RPC failed');
  return object(data.arguments);
}
async function transmissionRead(fetcher: typeof fetch, context: ConnectorOperationContext, raw: unknown, briefing: boolean): Promise<MediaPage> {
  const input = briefing ? briefingInput.parse(raw) : pageInput.parse(raw);
  const data = await transmissionRpc(fetcher, context, 'torrent-get', { fields: ['id', 'name', 'status', 'percentDone', 'addedDate'] });
  const rows = await validatedList(data.torrents);
  const states: Record<number, string> = { 0: 'Stopped', 1: 'Check waiting', 2: 'Checking', 3: 'Download waiting', 4: 'Downloading', 5: 'Seed waiting', 6: 'Seeding' };
  return fullPage(rows.map(value => ({ id: identity(value.id), title: string(value.name), kind: 'download', date: typeof value.addedDate === 'number' && Number.isFinite(value.addedDate) && value.addedDate > 0 ? new Date(value.addedDate * 1000).toISOString() : null, detail: `${states[Number(value.status)] ?? 'Unknown'}; ${typeof value.percentDone === 'number' ? Math.round(Math.min(1, Math.max(0, value.percentDone)) * 100) : 0}% complete`, url: itemUrl(context, '') })), input);
}
async function sabRead(fetcher: typeof fetch, context: ConnectorOperationContext, raw: unknown, briefing: boolean, history = false): Promise<MediaPage> {
  const input = briefing ? briefingInput.parse(raw) : pageInput.parse(raw), offset = Number(input.cursor ?? 0);
  const data = object(await readJson(fetcher, target(config(context).baseUrl, 'api', { mode: history ? 'history' : 'queue', output: 'json', apikey: key(context), start: String(offset), limit: String(input.limit) })));
  if (data.status === false || typeof data.error === 'string') return denied('SABnzbd request refused');
  const container = object(data[history ? 'history' : 'queue']); const rows = await validatedList(container.slots);
  const items: MediaItem[] = rows.map(value => ({ id: identity(value.nzo_id), title: string(value.name ?? value.filename), kind: 'download', date: typeof value.completed === 'number' && value.completed > 0 ? new Date(value.completed * 1000).toISOString() : null, detail: string(value.status) || 'Queued', url: itemUrl(context, '') }));
  const total = typeof container.noofslots === 'number' ? container.noofslots : Number(container.noofslots) || offset + items.length;
  return page(items, offset, input.limit, total);
}

/** Package-owned provider adapters; the host supplies per-operation credentials and
 * derives the authorization context. The endpoint comes only from an approved connection. */
export function createMediaConnector(provider: MediaProvider, transport: MediaTransport = {}, implementationVersion = "0.1.0"): RuntimeConnector {
  const fetcher = transport.fetch ?? fetch;
  const arr = ['radarr', 'sonarr', 'lidarr'].includes(provider);
  const read = (input: unknown, context: ConnectorOperationContext): Promise<MediaPage> => arr ? arrRead(provider, fetcher, context, input, true) : provider === 'jellyfin' ? jellyfinRead(fetcher, context, input, true) : provider === 'transmission' ? transmissionRead(fetcher, context, input, true) : sabRead(fetcher, context, input, true);
  const operations: RuntimeConnector['operations'] = {
    'briefing.read': { input: briefingInput, execute: read },
    'status.get': { input: emptyInput, async execute(_input, context) {
      let result: Row;
      if (arr) result = object(await arrRequest(provider, fetcher, context, 'system/status'));
      else if (provider === 'jellyfin') result = object(await readJson(fetcher, target(config(context).baseUrl, 'System/Info'), { headers: { 'X-Emby-Token': key(context) } }));
      else if (provider === 'transmission') result = await transmissionRpc(fetcher, context, 'session-get', {});
      else {
        // SABnzbd's version/auth modes are public, so they cannot verify this key.
        // A bounded queue read checks authentication and the expected response shape.
        await sabRead(fetcher, context, { limit: 1 }, false);
        return { connected: true, version: null };
      }
      return { connected: true, version: string(result.version ?? result.Version) || null };
    } },
    ...(arr ? {
      'calendar.list': { input: briefingInput, execute: read },
      'library.list': { input: pageInput, execute: (input, context) => arrRead(provider, fetcher, context, input, false) },
      'queue.list': { input: pageInput, execute: (input, context) => arrQueue(provider, fetcher, context, input) },
      'missing.list': { input: pageInput, execute: (input, context) => arrMissing(provider, fetcher, context, input) },
      'request.search': { input: requestInput, initiation: 'member', execute: (input, context) => arrSearch(provider, fetcher, context, input) },
    } as RuntimeConnector['operations'] : provider === 'jellyfin' ? {
      'library.list': { input: pageInput, execute: (input, context) => jellyfinRead(fetcher, context, input, false) },
    } as RuntimeConnector['operations'] : provider === 'transmission' ? {
      'queue.list': { input: pageInput, execute: (input, context) => transmissionRead(fetcher, context, input, false) },
    } as RuntimeConnector['operations'] : {
      'queue.list': { input: pageInput, execute: (input, context) => sabRead(fetcher, context, input, false) },
      'history.list': { input: pageInput, execute: (input, context) => sabRead(fetcher, context, input, false, true) },
    } as RuntimeConnector['operations']),
  };
  const names = Object.keys(operations);
  return {
    descriptor: connectorManifestSchema.parse({ schemaVersion: 1, id: provider, displayName: provider === 'sabnzbd' ? 'SABnzbd' : provider[0].toUpperCase() + provider.slice(1), implementationVersion, contractVersion: 'connector.runtime.v1', operations: names, authentication: { type: 'access-token', ownership: 'organization' } }),
    config: serviceConfig, account: { config: serviceConfig, operations: names }, events: {}, verifyWebhook: null, operations,
    async coversResource(connection, resource) { return connection.provider === provider && connection.status === 'active' && connection.externalId === resource; },
  };
}
