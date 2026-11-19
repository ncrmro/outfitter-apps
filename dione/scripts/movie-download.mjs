// Trusted operator tool. Run inside Ocean's webapp Pod; credentials never leave
// its environment. This is separate from Dione's read-only sidebar grants.
import { pathToFileURL } from 'node:url';

export function downloaderMatches(rows, downloadIds, idField) {
  const ids = new Set(downloadIds.filter(Boolean).map(id => String(id).toLowerCase()));
  return rows.filter(row => ids.has(String(row[idField] ?? '').toLowerCase()));
}
export function downloadProgress(row, provider) {
  if (provider === 'sabnzbd') return {
    provider, id: row.nzo_id, status: row.status,
    percent: row.percentage == null ? null : Number(row.percentage),
    remainingMB: row.mbleft == null ? null : Number(row.mbleft), eta: row.timeleft ?? null,
  };
  return { provider, id: row.hashString, status: row.status,
    percent: typeof row.percentDone === 'number' ? row.percentDone * 100 : null,
    remainingBytes: row.leftUntilDone ?? null, bytesPerSecond: row.rateDownload ?? null,
    etaSeconds: row.eta >= 0 ? row.eta : null, error: row.error || 0 };
}

export async function movieDownload(options, env = process.env, transport = fetch) {
  if (!Number.isSafeInteger(options.tmdbId) || options.tmdbId < 1) throw Error('A positive TMDb ID is required');
  if ((options.add || options.search) && !options.confirm) throw Error('Writes require --confirm');
  const base = env.RADARR_URL || 'http://radarr.servarr.svc.cluster.local:7878';
  const radarrHeaders = { 'X-Api-Key': env.DIONE_RADARR_API_KEY, 'Content-Type': 'application/json' };
  if (!env.DIONE_RADARR_API_KEY) throw Error('Radarr credential is unavailable');
  async function json(url, init = {}) {
    const response = await transport(url, { ...init, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error(`Provider HTTP ${response.status}`);
    return response.json();
  }
  const radarr = (path, body) => json(`${base}/api/v3/${path}`, { headers: radarrHeaders,
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  let movie = (await radarr(`movie?tmdbId=${options.tmdbId}`)).find(row => row.tmdbId === options.tmdbId);
  let added = false, search = null;
  if (!movie && options.add) {
    if (!Number.isSafeInteger(options.qualityProfileId) || options.qualityProfileId < 1 || !options.rootFolderPath?.startsWith('/')) throw Error('Adding requires an explicit quality profile and root folder');
    const [matches, profiles, roots] = await Promise.all([radarr(`movie/lookup?term=tmdb:${options.tmdbId}`), radarr('qualityprofile'), radarr('rootfolder')]);
    const match = matches.find(row => row.tmdbId === options.tmdbId);
    if (!match || !profiles.some(row => row.id === options.qualityProfileId) || !roots.some(row => row.path === options.rootFolderPath && row.accessible)) throw Error('Movie, profile or root folder could not be verified');
    // Do not retry a POST on timeout: its outcome may be unknown. A later run
    // resolves the existing TMDb ID before considering another add.
    movie = await radarr('movie', { ...match, qualityProfileId: options.qualityProfileId,
      rootFolderPath: options.rootFolderPath, monitored: true, minimumAvailability: 'released',
      addOptions: { searchForMovie: options.search === true } });
    added = true;
  }
  if (!movie) return { observedAt: new Date().toISOString(), status: 'not-in-radarr', tmdbId: options.tmdbId };
  const commands = (await radarr('command')).filter(row => row.name === 'MoviesSearch' && row.body?.movieIds?.includes(movie.id));
  search = commands.find(row => ['queued', 'started'].includes(row.status)) ?? commands.sort((a, b) => b.id - a.id)[0] ?? null;
  const history = await radarr(`history/movie?movieId=${movie.id}`);
  const queue = [];
  let queueTruncated = false;
  for (let page = 1; page <= 20; page++) {
    const result = await radarr(`queue?page=${page}&pageSize=100&includeUnknownMovieItems=true`);
    queue.push(...result.records.filter(row => row.movieId === movie.id));
    if (page * 100 >= result.totalRecords) break;
    if (page === 20) queueTruncated = true;
  }
  if (options.search && !added && !movie.hasFile && !queue.length && !queueTruncated && !commands.some(row => ['queued', 'started'].includes(row.status))) {
    search = await radarr('command', { name: 'MoviesSearch', movieIds: [movie.id] });
  }
  const latestReceipt = history.filter(row => row.downloadId).sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
  const ids = queue.length ? queue.map(row => row.downloadId) : [latestReceipt?.downloadId];
  const downloaders = [], failures = [], serviceIssues = [];
  if (ids.some(Boolean)) {
    try {
      if (!env.DIONE_SABNZBD_API_KEY) throw Error();
      const sab = env.SABNZBD_URL || 'http://sabnzbd.servarr.svc.cluster.local:8085';
      for (const mode of ['queue', 'history']) {
        const params = new URLSearchParams({ mode, output: 'json', apikey: env.DIONE_SABNZBD_API_KEY, limit: '1000' });
        const result = await json(`${sab}/api?${params}`);
        if (!result[mode]?.slots) throw Error();
        downloaders.push(...downloaderMatches(result[mode].slots, ids, 'nzo_id').map(row => ({ ...downloadProgress(row, 'sabnzbd'), location: mode,
          ...(mode === 'queue' ? { queueStatus: result.queue.status, queueSpeedKBps: Number(result.queue.kbpersec) } : {}) })));
      }
      const params = new URLSearchParams({ mode: 'warnings', output: 'json', apikey: env.DIONE_SABNZBD_API_KEY });
      const warnings = await json(`${sab}/api?${params}`);
      for (const warning of (Array.isArray(warnings) ? warnings : warnings.warnings ?? [])) {
        if (!Number.isFinite(warning.time) || warning.time * 1000 < Date.now() - 15 * 60000) continue;
        const code = /Failed login for server|Access denied to your node/i.test(warning.text) ? 'provider-auth-denied'
          : /Permission denied|Failed making/i.test(warning.text) ? 'storage-permission-denied' : null;
        if (code && !serviceIssues.some(row => row.code === code)) serviceIssues.push({ provider: 'sabnzbd', scope: 'service', code, observedAt: new Date(warning.time * 1000).toISOString() });
      }
    } catch { failures.push({ provider: 'sabnzbd', error: 'Download status unavailable' }); }
    try {
      const url = `${env.TRANSMISSION_URL || 'http://transmission.transmission.svc.cluster.local:9091'}/transmission/rpc`;
      const body = JSON.stringify({ method: 'torrent-get', arguments: { fields: ['hashString', 'status', 'percentDone', 'leftUntilDone', 'rateDownload', 'eta', 'error'] } });
      let response = await transport(url, { method: 'POST', body, signal: AbortSignal.timeout(15000) });
      if (response.status === 409) response = await transport(url, { method: 'POST', body, headers: { 'X-Transmission-Session-Id': response.headers.get('X-Transmission-Session-Id') }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error();
      const result = await response.json();
      if (result.result !== 'success' || !Array.isArray(result.arguments?.torrents)) throw Error();
      downloaders.push(...downloaderMatches(result.arguments.torrents, ids, 'hashString').map(row => ({ ...downloadProgress(row, 'transmission'), location: 'queue' })));
    } catch { failures.push({ provider: 'transmission', error: 'Download status unavailable' }); }
  }
  const current = downloaders.filter(row => row.location === 'queue');
  const transferring = current.some(row => row.provider === 'sabnzbd' ? row.status === 'Downloading' && row.queueStatus === 'Downloading' && row.queueSpeedKBps > 0 : row.status === 4 && row.bytesPerSecond > 0);
  const blocked = current.some(row => row.provider === 'sabnzbd' && row.queueSpeedKBps === 0) && serviceIssues.some(row => row.code === 'provider-auth-denied');
  const status = movie.hasFile ? 'in-library' : transferring ? 'downloading' : blocked ? 'download-blocked'
    : current.length ? 'download-queued' : downloaders.some(row => row.status === 'Failed') ? 'download-failed'
    : downloaders.some(row => row.status === 'Completed') ? 'awaiting-import' : queue.length ? 'downloader-unverified'
    : ['queued', 'started'].includes(search?.status) ? 'searching' : latestReceipt ? 'grabbed-awaiting-downloader' : 'awaiting-release';
  return { observedAt: new Date().toISOString(), movie: { id: movie.id, tmdbId: movie.tmdbId, title: movie.title, year: movie.year, monitored: movie.monitored, hasFile: movie.hasFile }, added,
    status,
    search: search ? { id: search.id, status: search.status } : null,
    radarrQueue: queue.map(row => ({ downloadId: row.downloadId, downloadClient: row.downloadClient, status: row.status, size: row.size, remainingBytes: row.sizeleft })), queueTruncated,
    history: history.map(row => ({ eventType: row.eventType, date: row.date, downloadId: row.downloadId })), downloaders, failures, serviceIssues };
}

async function main() {
  const args = process.argv.slice(2), options = {};
  const fields = { '--tmdb-id': 'tmdbId', '--quality-profile-id': 'qualityProfileId', '--root-folder': 'rootFolderPath' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--add', '--search', '--confirm'].includes(arg)) options[arg.slice(2)] = true;
    else if (fields[arg] && args[i + 1]) options[fields[arg]] = arg === '--root-folder' ? args[++i] : Number(args[++i]);
    else throw Error('Unsupported argument');
  }
  console.log(JSON.stringify(await movieDownload(options)));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Movie operation failed; verify configuration and read current state before retrying a write'); process.exitCode = 1; });
}
