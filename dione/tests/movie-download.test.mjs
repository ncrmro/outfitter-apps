import test from 'node:test';
import assert from 'node:assert/strict';
import { downloaderMatches, downloadProgress, movieDownload } from '../scripts/movie-download.mjs';

test('download correlation uses provider receipts rather than similar titles', () => {
  assert.deepEqual(downloaderMatches([{ hashString: 'ABC', name: 'Movie' }, { hashString: 'DEF', name: 'Movie' }], ['abc'], 'hashString'), [{ hashString: 'ABC', name: 'Movie' }]);
  assert.deepEqual(downloaderMatches([{ nzo_id: 'other', filename: 'Same movie' }], [], 'nzo_id'), []);
  assert.equal(downloadProgress({ nzo_id: 'one', status: 'Downloading', percentage: '12.5', mbleft: '700', timeleft: '0:02:00' }, 'sabnzbd').percent, 12.5);
  assert.equal(downloadProgress({ hashString: 'abc', percentDone: 0.42, eta: -1 }, 'transmission').percent, 42);
});

test('writes require explicit confirmation before any network access', async () => {
  await assert.rejects(movieDownload({ tmdbId: 811, add: true }, {}, () => { throw Error('Must not contact provider'); }), /confirm/);
});

test('existing movie and active search are reused without another write', async () => {
  const calls = [];
  const transport = async (url, options) => {
    calls.push({ url, method: options.method });
    if (options.method === 'POST') throw Error('Duplicate write');
    const data = url.includes('/api/v3/movie?') ? [{ id: 12, tmdbId: 811, title: 'Silent Running', hasFile: false }]
      : url.endsWith('/command') ? [{ id: 19, name: 'MoviesSearch', status: 'started', body: { movieIds: [12] } }]
      : url.includes('/history/') ? [] : { records: [], totalRecords: 0 };
    return Response.json(data);
  };
  const result = await movieDownload({ tmdbId: 811, add: true, search: true, confirm: true }, { DIONE_RADARR_API_KEY: 'test' }, transport);
  assert.equal(result.added, false);
  assert.equal(result.status, 'searching');
  assert.equal(result.search.id, 19);
  assert.deepEqual(result.downloaders, []);
  assert.ok(calls.every(call => call.method !== 'POST'));
});

test('real downloader progress is joined by Radarr download ID; failures stay explicit', async () => {
  const transport = async url => {
    if (url.includes('transmission')) return new Response('', { status: 503 });
    const data = url.includes('/api/v3/movie?') ? [{ id: 12, tmdbId: 811, hasFile: false }]
      : url.endsWith('/command') ? [] : url.includes('/history/') ? [{ eventType: 'grabbed', downloadId: 'SABnzbd_nzo_123' }]
      : url.includes('/queue?') ? { records: [{ movieId: 12, downloadId: 'SABnzbd_nzo_123' }], totalRecords: 1 }
      : url.includes('mode=queue') ? { queue: { status: 'Downloading', kbpersec: '512', slots: [{ nzo_id: 'SABnzbd_nzo_123', status: 'Downloading', percentage: '21' }, { nzo_id: 'unrelated', percentage: '99' }] } }
      : { history: { slots: [] } };
    return Response.json(data);
  };
  const result = await movieDownload({ tmdbId: 811 }, { DIONE_RADARR_API_KEY: 'test', DIONE_SABNZBD_API_KEY: 'test' }, transport);
  assert.equal(result.status, 'downloading');
  assert.equal(result.downloaders.length, 1);
  assert.equal(result.downloaders[0].percent, 21);
  assert.deepEqual(result.failures, [{ provider: 'transmission', error: 'Download status unavailable' }]);
});

test('a failed history receipt never becomes active download progress', async () => {
  const transport = async url => {
    if (url.includes('transmission')) return new Response('', { status: 503 });
    const data = url.includes('/api/v3/movie?') ? [{ id: 12, tmdbId: 811, hasFile: false }]
      : url.endsWith('/command') ? [] : url.includes('/history/') ? [{ eventType: 'grabbed', downloadId: 'failed', date: '2026-11-13T12:00:00Z' }, { eventType: 'grabbed', downloadId: 'old', date: '2026-11-12T12:00:00Z' }]
      : url.includes('/queue?') ? { records: [], totalRecords: 0 }
      : url.includes('mode=queue') ? { queue: { slots: [] } }
      : url.includes('mode=warnings') ? [] : { history: { slots: [{ nzo_id: 'failed', status: 'Failed' }, { nzo_id: 'old', status: 'Completed' }] } };
    return Response.json(data);
  };
  const result = await movieDownload({ tmdbId: 811 }, { DIONE_RADARR_API_KEY: 'test', DIONE_SABNZBD_API_KEY: 'test' }, transport);
  assert.equal(result.status, 'download-failed');
  assert.equal(result.downloaders.length, 1);
  assert.equal(result.downloaders[0].id, 'failed');
});
