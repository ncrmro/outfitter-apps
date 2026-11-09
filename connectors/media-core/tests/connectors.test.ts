import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executeConnector, type ConnectorOperationContext } from '@ai-outfitter/connector-core/runtime';
import { createMediaConnector, type MediaProvider, type MediaPage } from '../src/index';

const window = { start: '2026-11-09T00:00:00-06:00', end: '2026-11-10T00:00:00-06:00', limit: 25 };
function context(provider: MediaProvider, operations = ['briefing.read', 'request.search']): ConnectorOperationContext {
  return {
    connection: { id: `connection-${provider}`, provider, externalId: `ocean-${provider}`, owner: { kind: 'user', id: 'owner' }, status: 'active', config: { baseUrl: `http://${provider}.servarr.svc.cluster.local:8080/`, publicUrl: `https://${provider}.example.test/` } },
    scope: { connectionId: `connection-${provider}`, installationId: 'dione', organizationId: null, userId: 'owner', resource: `ocean-${provider}`, operations },
    credentials: { apiKey: 'test-secret-key', username: 'owner', password: 'test-password' },
  };
}
const invoke = (provider: MediaProvider, fetcher: typeof fetch, operation = 'briefing.read', input: unknown = window, ctx = context(provider), initiation?: 'member') => executeConnector(createMediaConnector(provider, { fetch: fetcher }), operation, input, ctx, undefined, initiation);
const response = (body: unknown): typeof fetch => async () => Response.json(body);
const status = (expected: number) => (error: unknown) => error instanceof Response && error.status === expected;

test('calendar mapping preserves provider IDs, source dates, and safe request proposals', async () => {
  for (const provider of ['radarr', 'sonarr', 'lidarr'] as const) {
    let calls = 0;
    const fetcher: typeof fetch = async (url, init) => {
      calls++;
      const target = new URL(String(url));
      assert.equal(target.pathname, `/api/${provider === 'lidarr' ? 'v1' : 'v3'}/calendar`);
      assert.equal(target.searchParams.get('start'), window.start);
      assert.equal(new Headers(init?.headers).get('X-Api-Key'), 'test-secret-key');
      assert.ok(!target.href.includes('secret'));
      assert.equal(init?.redirect, 'error');
      return Response.json([{ id: 7, title: 'Example', monitored: true, hasFile: false, releaseDate: window.start, airDateUtc: window.start, digitalRelease: window.start, statistics: { trackFileCount: 0 }, series: { title: 'Series', monitored: true }, artist: { artistName: 'Artist' } }]);
    };
    const result = await invoke(provider, fetcher) as MediaPage;
    assert.equal(result.items[0].id, '7');
    assert.equal(result.items[0].date, window.start);
    assert.deepEqual(result.items[0].request, { operation: 'request.search', input: { id: 7 } });
    assert.equal(calls, 1);
  }
});

test('Jellyfin lists recent library pages with an opaque item ID and no request operation', async () => {
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(new URL(String(url)).pathname, '/Items');
    assert.equal(new Headers(init?.headers).get('X-Emby-Token'), 'test-secret-key');
    return Response.json({ Items: [{ Id: 'abc', Name: 'A movie', Type: 'Movie', DateCreated: window.start }], TotalRecordCount: 2 });
  };
  const page = await invoke('jellyfin', fetcher) as MediaPage;
  assert.equal(page.items[0].id, 'abc');
  assert.equal(page.items[0].request, undefined);
  assert.equal(page.cursor, '1');
  assert.equal(page.truncated, true);
});

test('Transmission negotiates session once and requests only torrent read fields', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    calls++;
    assert.equal(JSON.parse(String(init?.body)).method, 'torrent-get');
    const headers = new Headers(init?.headers);
    assert.match(headers.get('Authorization')!, /^Basic /);
    if (calls === 1) return new Response(null, { status: 409, headers: { 'X-Transmission-Session-Id': 'session' } });
    assert.equal(headers.get('X-Transmission-Session-Id'), 'session');
    return Response.json({ result: 'success', arguments: { torrents: [{ id: 9, name: 'Download', status: 4, percentDone: 0.42 }] } });
  };
  const page = await invoke('transmission', fetcher) as MediaPage;
  assert.equal(calls, 2);
  assert.equal(page.items[0].detail, 'Downloading; 42% complete');
});

test('SABnzbd uses bounded queue paging and returns no secret-bearing URLs', async () => {
  const fetcher: typeof fetch = async (url) => {
    const target = new URL(String(url));
    assert.equal(target.searchParams.get('mode'), 'queue');
    assert.equal(target.searchParams.get('limit'), '25');
    return Response.json({ queue: { slots: [{ nzo_id: 'job', filename: 'Download', status: 'Downloading' }], noofslots: 2 } });
  };
  const page = await invoke('sabnzbd', fetcher) as MediaPage;
  assert.equal(page.items[0].title, 'Download');
  assert.ok(!JSON.stringify(page).includes('test-secret'));
  assert.equal(page.cursor, '1');
});

test('revocation, wrong personal owner, wrong resource, and missing capability deny before network', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return Response.json([]); };
  for (const mutate of [
    (ctx: ConnectorOperationContext) => { ctx.connection.status = 'revoked'; },
    (ctx: ConnectorOperationContext) => { ctx.scope.userId = 'intruder'; },
    (ctx: ConnectorOperationContext) => { ctx.scope.resource = 'another-service'; },
    (ctx: ConnectorOperationContext) => { ctx.scope.operations = []; },
  ]) {
    const ctx = context('radarr'); mutate(ctx);
    await assert.rejects(invoke('radarr', fetcher, 'briefing.read', window, ctx), status(403));
  }
  assert.equal(calls, 0);
});

test('writes need the member initiation marker, current monitored state, and provider receipt', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    if (new URL(String(url)).pathname.endsWith('/movie/7')) return Response.json({ id: 7, monitored: true, hasFile: false });
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), { name: 'MoviesSearch', movieIds: [7] });
    return Response.json({ id: 88, status: 'queued' });
  };
  await assert.rejects(invoke('radarr', fetcher, 'request.search', { id: 7 }), status(403));
  assert.equal(calls, 0);
  const receipt = await invoke('radarr', fetcher, 'request.search', { id: 7 }, context('radarr'), 'member');
  assert.deepEqual(receipt, { id: '88', mediaId: '7', status: 'queued' });
  assert.equal(calls, 2);
  await assert.rejects(invoke('radarr', response({ id: 7, monitored: false, hasFile: false }), 'request.search', { id: 7 }, context('radarr'), 'member'), status(409));
  await assert.rejects(invoke('radarr', response({ id: 7, monitored: true, hasFile: true }), 'request.search', { id: 7 }, context('radarr'), 'member'), status(409));
});

test('malformed input, missing credentials, and malformed provider JSON are refused', async () => {
  await assert.rejects(invoke('radarr', response([]), 'briefing.read', { ...window, baseUrl: 'http://untrusted' }), status(400));
  await assert.rejects(invoke('radarr', response([]), 'briefing.read', { ...window, end: window.start }), status(400));
  const ctx = context('radarr'); ctx.credentials = {};
  await assert.rejects(invoke('radarr', response([]), 'briefing.read', window, ctx), status(503));
  await assert.rejects(invoke('radarr', response({ error: 'provider detail secret' })), status(502));
  const invalid = context('radarr'); invalid.connection.config.baseUrl = 'http://username:password@radarr';
  await assert.rejects(invoke('radarr', response([]), 'briefing.read', window, invalid), status(422));
});

test('provider errors and network exceptions never disclose keys or error bodies', async () => {
  for (const fetcher of [
    (async () => new Response('test-secret-key in body', { status: 401 })) as typeof fetch,
    (async () => { throw new Error('test-secret-key in URL'); }) as typeof fetch,
  ]) {
    try { await invoke('sabnzbd', fetcher); assert.fail('expected error'); }
    catch (error) { assert.ok(error instanceof Response); assert.ok(!(await error.text()).includes('test-secret')); }
  }
});

test('array responses page deterministically instead of silently dropping later rows', async () => {
  const fetcher = response(Array.from({ length: 3 }, (_, index) => ({ id: index + 1, title: `Film ${index}`, hasFile: false, monitored: true })));
  const first = await invoke('radarr', fetcher, 'briefing.read', { ...window, limit: 2 }) as MediaPage;
  assert.equal(first.cursor, '2');
  const second = await invoke('radarr', fetcher, 'briefing.read', { ...window, limit: 2, cursor: first.cursor }) as MediaPage;
  assert.deepEqual(second.items.map(value => value.id), ['3']);
  assert.equal(second.truncated, false);
});

test('calendar selects the release date inside the requested window', async () => {
  const page = await invoke('radarr', response([{ id: 1, title: 'Theatrical release', digitalRelease: '2026-12-10T00:00:00Z', inCinemas: window.start }])) as MediaPage;
  assert.equal(page.items[0].date, window.start);
});

test('missing list preserves provider paging and monitored request proposals', async () => {
  const fetcher: typeof fetch = async (url) => {
    const target = new URL(String(url));
    assert.equal(target.pathname, '/api/v3/wanted/missing');
    assert.equal(target.searchParams.get('page'), '2');
    assert.equal(target.searchParams.get('monitored'), 'true');
    return Response.json({ records: [{ id: 3, title: 'Missing film', monitored: true, hasFile: false }], totalRecords: 4 });
  };
  const page = await invoke('radarr', fetcher, 'missing.list', { limit: 1, cursor: '2' }, context('radarr', ['missing.list'])) as MediaPage;
  assert.equal(page.cursor, '3');
  assert.deepEqual(page.items[0].request?.input, { id: 3 });
});

test('response body cap cancels oversized media data', async () => {
  const fetcher: typeof fetch = async () => new Response('x', { headers: { 'Content-Length': '5000000' } });
  try { await invoke('radarr', fetcher); assert.fail('expected size refusal'); }
  catch (error) { assert.ok(error instanceof Response); assert.equal(error.status, 502); assert.equal(await error.text(), 'Media service response too large'); }
});

test('Sonarr search rechecks the owning series before issuing the command', async () => {
  let commands = 0;
  const fetcher: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/episode/7')) return Response.json({ id: 7, monitored: true, hasFile: false, seriesId: 4 });
    if (path.endsWith('/series/4')) return Response.json({ id: 4, monitored: false });
    if (init?.method === 'POST') commands++;
    return Response.json({ id: 1 });
  };
  await assert.rejects(invoke('sonarr', fetcher, 'request.search', { id: 7 }, context('sonarr'), 'member'), status(409));
  assert.equal(commands, 0);
});
