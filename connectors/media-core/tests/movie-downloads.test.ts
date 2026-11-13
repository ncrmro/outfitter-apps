import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executeConnector, type ConnectorOperationContext } from '@ai-outfitter/connector-core/runtime';
import { createMediaConnector, type MediaProvider, type MovieLookupResult, type MovieOptions, type MovieRequestReceipt, type MovieProgress, type DownloadStatusResult } from '../src/index';

const HASH = 'ABCDEF0123456789'.repeat(2) + 'ABCDEF01';
const input = { tmdbId: 811, qualityProfileId: 2, rootFolderPath: '/media/movies', requestId: 'owner-request-1' };
const movie = (extra: Record<string, unknown> = {}) => ({ id: 17, tmdbId: 811, title: 'Silent Running', year: 1972, monitored: true, hasFile: false, qualityProfileId: 2, path: '/media/movies/Silent Running (1972)', ...extra });
function context(provider: MediaProvider, operation: string): ConnectorOperationContext {
  return { connection: { id: `connection-${provider}`, provider, externalId: `ocean-${provider}`, owner: { kind: 'user', id: 'owner' }, status: 'active', config: { baseUrl: `http://${provider}.internal` } }, scope: { organizationId: null, installationId: 'dione', userId: 'owner', connectionId: `connection-${provider}`, resource: `ocean-${provider}`, operations: [operation] }, credentials: { apiKey: 'fixture-provider-secret' } };
}
function radarrFixture() {
  const state = { movies: [] as Record<string, unknown>[], lookup: [movie({ id: 0, qualityProfileId: undefined, path: undefined })], roots: [{ path: '/media/movies', accessible: true }], profiles: [{ id: 2, name: 'HD' }], commands: [] as Record<string, unknown>[], queue: [] as Record<string, unknown>[], history: [] as Record<string, unknown>[], posts: [] as { path: string; body: Record<string, unknown> }[], puts: [] as Record<string, unknown>[], calls: [] as string[], ambiguousPost: false, oversizedLibrary: false };
  const fetcher: typeof fetch = async (url, init) => {
    const target = new URL(String(url)), path = target.pathname.replace('/api/v3/', '');
    state.calls.push(`${init?.method ?? 'GET'} ${path}${target.search}`);
    assert.equal(new Headers(init?.headers).get('X-Api-Key'), 'fixture-provider-secret'); assert.equal(init?.redirect, 'error');
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)); state.puts.push(body); state.movies = state.movies.map(value => value.id === body.id ? body : value); return Response.json(body);
    }
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)); state.posts.push({ path, body });
      if (state.ambiguousPost) throw new Error('fixture-provider-secret uncertain private transport error');
      if (path === 'movie') { const added = movie(body); state.movies.push(added); state.commands.push({ id: 33, name: 'MoviesSearch', body: { movieIds: [17] }, status: 'queued' }); return Response.json(added); }
      if (path === 'command') { const command = { id: 33, ...body, body, status: 'queued' }; state.commands.push(command); return Response.json(command); }
      throw Error('Unexpected write');
    }
    if (path === 'qualityprofile') return Response.json(state.profiles);
    if (path === 'rootfolder') return Response.json(state.roots);
    if (path === 'movie/lookup') return Response.json(state.lookup);
    if (path === 'movie') {
      if (!target.searchParams.has('tmdbId') && state.oversizedLibrary) return new Response('x', { headers: { 'Content-Length': String(5 * 1024 * 1024) } });
      return Response.json(target.searchParams.has('tmdbId') ? state.movies.filter(value => value.tmdbId === Number(target.searchParams.get('tmdbId'))) : state.movies);
    }
    if (path.startsWith('movie/')) return Response.json(state.movies.find(value => value.id === Number(path.split('/')[1])));
    if (path === 'command') return Response.json(state.commands);
    if (path === 'history/movie') return Response.json(state.history);
    if (path === 'queue') return Response.json({ records: state.queue, totalRecords: state.queue.length });
    throw Error(`Unexpected path ${path}`);
  };
  const connector = createMediaConnector('radarr', { fetch: fetcher });
  return { state, invoke: (operation: string, data: unknown, member = true) => executeConnector(connector, operation, data, context('radarr', operation), undefined, member ? 'member' : undefined) };
}

test('movie lookup uses exact filtered identities and reports existing profile/root rather than library defaults', async () => {
  const fixture = radarrFixture(); fixture.state.movies = [movie({ qualityProfileId: 9, path: '/media/movies-4k/Silent Running (1972)' })];
  fixture.state.roots.push({ path: '/media/movies-4k', accessible: true }); fixture.state.lookup.push(movie({ id: 0, tmdbId: 812, title: 'Another movie' }));
  fixture.state.oversizedLibrary = true;
  const result = await fixture.invoke('movie.lookup', { query: 'Silent' }) as MovieLookupResult;
  assert.deepEqual(result.matches.map(value => [value.tmdbId, value.movieId, value.qualityProfileId, value.rootFolderPath]), [[811, 17, 9, '/media/movies-4k'], [812, null, null, null]]);
  assert.ok(fixture.state.calls.includes('GET movie?tmdbId=811')); assert.ok(!fixture.state.calls.includes('GET movie'));
});

test('movie options infer only verified modal defaults and keep choices usable when full library exceeds the response cap', async () => {
  const fixture = radarrFixture(); fixture.state.movies = [movie(), movie({ id: 18, tmdbId: 812 })];
  let result = await fixture.invoke('movie.options', {}) as MovieOptions;
  assert.equal(result.defaultQualityProfileId, 2); assert.equal(result.defaultRootFolderPath, '/media/movies');
  fixture.state.oversizedLibrary = true;
  result = await fixture.invoke('movie.options', {}) as MovieOptions;
  assert.deepEqual(result.qualityProfiles, [{ id: 2, name: 'HD' }]); assert.equal(result.defaultQualityProfileId, null);
  assert.equal(result.defaultRootFolderPath, '/media/movies');
});

test('movie request requires member initiation, verifies authoritative metadata/selections, and adds/searches exactly once', async () => {
  const fixture = radarrFixture();
  await assert.rejects(fixture.invoke('movie.request', input, false), error => error instanceof Response && error.status === 403);
  assert.equal(fixture.state.calls.length, 0);
  const receipts = await Promise.all([fixture.invoke('movie.request', input), fixture.invoke('movie.request', input), fixture.invoke('movie.request', input)]) as MovieRequestReceipt[];
  assert.equal(fixture.state.posts.filter(value => value.path === 'movie').length, 1);
  assert.equal(fixture.state.posts.filter(value => value.path === 'command').length, 0);
  assert.equal(receipts[0].status, 'added-search-requested'); assert.equal(receipts[1].status, 'searching'); assert.equal(receipts[2].status, 'searching');
  assert.equal(fixture.state.posts[0].body.tmdbId, 811); assert.deepEqual(fixture.state.posts[0].body.addOptions, { searchForMovie: true });
  assert.ok(!fixture.state.calls.includes('GET movie'));
  assert.ok(!JSON.stringify(receipts).includes('fixture-provider-secret'));
});

test('existing downloaded/current queued movies do not trigger duplicate searches and profile/root changes are refused', async () => {
  const fixture = radarrFixture(); fixture.state.movies = [movie({ hasFile: true })];
  assert.equal((await fixture.invoke('movie.request', input) as MovieRequestReceipt).status, 'in-library');
  fixture.state.movies = [movie()]; fixture.state.queue = [{ movieId: 17, downloadId: HASH, downloadClient: 'Transmission', status: 'downloading', size: 100, sizeleft: 70 }];
  const queued = await fixture.invoke('movie.request', input) as MovieRequestReceipt;
  assert.equal(queued.status, 'download-queued'); assert.deepEqual(queued.downloadIds, [HASH.toLowerCase()]);
  fixture.state.movies = [movie({ qualityProfileId: 9 })];
  await assert.rejects(fixture.invoke('movie.request', input), error => error instanceof Response && error.status === 409);
  assert.equal(fixture.state.posts.length, 0); assert.equal(fixture.state.puts.length, 0);
});

test('existing unmonitored movies require explicit monitoring confirmation and preserve verified provider state', async () => {
  const fixture = radarrFixture(); fixture.state.movies = [movie({ monitored: false })];
  await assert.rejects(fixture.invoke('movie.request', input), error => error instanceof Response && error.status === 409);
  const result = await fixture.invoke('movie.request', { ...input, monitorExisting: true }) as MovieRequestReceipt;
  assert.equal(result.status, 'search-requested'); assert.equal(fixture.state.puts.length, 1);
  assert.equal(fixture.state.puts[0].monitored, true); assert.equal(fixture.state.puts[0].qualityProfileId, 2);
  assert.equal(fixture.state.posts.filter(value => value.path === 'command').length, 1);
});

test('unknown POST outcomes are surfaced without automatic retries', async () => {
  const fixture = radarrFixture(); fixture.state.ambiguousPost = true;
  await assert.rejects(fixture.invoke('movie.request', input), error => error instanceof Response && error.status === 502);
  assert.equal(fixture.state.posts.length, 1);
});

test('progress correlates exact current queue IDs first, otherwise only the latest dated receipt, not stale successful jobs', async () => {
  const fixture = radarrFixture(); fixture.state.movies = [movie()]; fixture.state.history = [
    { eventType: 'downloadFolderImported', date: '2025-01-01T00:00:00Z', downloadId: 'old-success' },
    { eventType: 'grabbed', date: '2026-11-13T10:00:00Z', downloadId: 'new-receipt' },
    { eventType: 'downloadFailed', date: '2026-11-13T10:01:00Z', downloadId: 'new-receipt' },
  ];
  let result = await fixture.invoke('movie.progress', { tmdbId: 811 }) as MovieProgress;
  assert.deepEqual(result.history.map(value => value.downloadId), ['new-receipt', 'new-receipt']);
  fixture.state.queue = [{ movieId: 17, downloadId: HASH, downloadClientType: 'Transmission', status: 'downloading' }, { movieId: 18, downloadId: 'unrelated' }];
  fixture.state.history.push({ eventType: 'grabbed', date: '2026-11-12T00:00:00Z', downloadId: HASH });
  result = await fixture.invoke('movie.progress', { tmdbId: 811 }) as MovieProgress;
  assert.deepEqual(result.downloads.map(value => [value.downloadId, value.downloadClient]), [[HASH.toLowerCase(), 'transmission']]);
  assert.deepEqual(result.history.map(value => value.downloadId), [HASH.toLowerCase()]);
});

test('SAB download status matches exact IDs, exposes service rate separately and redacts fresh provider warnings into codes', async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async url => {
    const target = new URL(String(url)), mode = target.searchParams.get('mode')!; calls.push(mode);
    if (mode !== 'warnings') assert.equal(target.searchParams.get('nzo_ids'), 'SABnzbd_nzo_requested');
    return Response.json(mode === 'queue' ? { queue: { status: 'Downloading', kbpersec: '12.5', noofslots: 2, slots: [
      { nzo_id: 'SABnzbd_nzo_requested', status: 'Downloading', percentage: '25', mbleft: '2', timeleft: '0:01:30', password: 'never-return' },
      { nzo_id: 'SABnzbd_nzo_requested-suffix', status: 'Completed' },
    ] } } : mode === 'history' ? { history: { noofslots: 2, slots: [{ nzo_id: 'old-success', status: 'Completed' }, { nzo_id: 'SABnzbd_nzo_requested', status: 'Completed' }] } } : [
      { time: Date.now() / 1000 - 10, text: 'Failed login for server private-host credential fixture-provider-secret' },
      { time: Date.now() / 1000 - 86400, text: 'Permission denied old failure' },
    ]);
  };
  const result = await executeConnector(createMediaConnector('sabnzbd', { fetch: fetcher }), 'download.status', { ids: ['SABnzbd_nzo_requested'] }, context('sabnzbd', 'download.status')) as DownloadStatusResult;
  assert.equal(result.downloads.length, 1); assert.equal(result.downloads[0].bytesPerSecond, null); assert.equal(result.downloads[0].remainingBytes, 2 * 1024 * 1024); assert.equal(result.downloads[0].etaSeconds, 90);
  assert.equal(result.service.bytesPerSecond, 12.5 * 1024); assert.deepEqual(result.service.issues.map(value => value.code), ['provider-auth-denied']);
  assert.ok(!JSON.stringify(result).includes('fixture-provider-secret')); assert.ok(!JSON.stringify(result).includes('never-return')); assert.deepEqual(calls.sort(), ['history', 'queue', 'warnings']);
});

test('Transmission exact hash correlation is case insensitive and only live per-job telemetry supplies its rate', async () => {
  const fetcher: typeof fetch = async (_url, init) => {
    const call = JSON.parse(String(init?.body));
    if (call.method === 'session-stats') return Response.json({ result: 'success', arguments: { activeTorrentCount: 1, downloadSpeed: 99 } });
    assert.deepEqual(call.arguments.ids, [HASH.toLowerCase()]);
    return Response.json({ result: 'success', arguments: { torrents: [
      { hashString: HASH, status: 4, percentDone: 0.3, leftUntilDone: 70, rateDownload: 12, eta: 7, error: 0 },
      { hashString: 'f'.repeat(40), status: 6, percentDone: 1, rateDownload: 999999 },
    ] } });
  };
  const result = await executeConnector(createMediaConnector('transmission', { fetch: fetcher }), 'download.status', { ids: [HASH.toLowerCase()] }, context('transmission', 'download.status')) as DownloadStatusResult;
  assert.deepEqual(result.downloads, [{ id: HASH.toLowerCase(), location: 'queue', status: 'downloading', percent: 30, remainingBytes: 70, bytesPerSecond: 12, etaSeconds: 7 }]);
  assert.equal(result.service.bytesPerSecond, 99); assert.equal(result.downloads.length, 1);
});
