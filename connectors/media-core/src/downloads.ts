import { z } from 'zod';
import type { ConnectorOperationContext, ConnectorOperation } from '@ai-outfitter/connector-core/runtime';

type Row = Record<string, unknown>;
export type DownloadStatusResult = {
  downloads: Array<{ id: string; location: 'queue' | 'history'; status: string; percent: number | null; remainingBytes: number | null; bytesPerSecond: number | null; etaSeconds: number | null }>;
  service: { status: string | null; bytesPerSecond: number | null; issues: Array<{ code: string; observedAt: string }> };
  truncated: boolean;
  observedAt: string;
};
export const downloadStatusInput = z.strictObject({ ids: z.array(z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/)).max(20) });
const row = z.record(z.string(), z.unknown());
const rows = (value: unknown) => z.array(row).parse(value);
const nonnegative = (value: unknown): number | null => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : null;
};
const percentage = (value: unknown): number | null => { const number = nonnegative(value); return number !== null && number <= 100 ? number : null; };
function eta(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{1,6}:\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes, seconds] = value.split(':').map(Number);
  return minutes < 60 && seconds < 60 ? hours * 3600 + minutes * 60 + seconds : null;
}
const sabStates = new Set(['Downloading', 'Queued', 'Paused', 'Idle', 'Propagating', 'Fetching', 'Completed', 'Failed', 'QuickCheck', 'Verifying', 'Repairing', 'Extracting', 'Moving', 'Running', 'Checking']);
const sabStatus = (value: unknown): string => typeof value === 'string' && sabStates.has(value) ? value.toLowerCase() : 'unknown';
const hash = (value: string) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value);
function rejected(): never { throw new Response('Download status unavailable', { status: 502 }); }

export function sabDownloadStatus(request: (context: ConnectorOperationContext, mode: string, query?: Record<string, string>, signal?: AbortSignal) => Promise<unknown>): ConnectorOperation {
  return { input: downloadStatusInput, async execute(raw, context): Promise<DownloadStatusResult> {
    const input = downloadStatusInput.parse(raw), observedAt = new Date().toISOString();
    const signal = AbortSignal.timeout(30_000);
    const ids = new Set(input.ids);
    const query = { start: '0', limit: '100', ...(input.ids.length ? { nzo_ids: [...ids].join(',') } : {}) };
    const [queueData, historyData] = await Promise.all(['queue', 'history'].map(mode => request(context, mode, query, signal)));
    const parse = (value: unknown, key: string) => {
      const data = row.parse(value);
      if (data.status === false || typeof data.error === 'string') return rejected();
      const container = row.parse(data[key]);
      return { container, slots: rows(container.slots) };
    };
    const queue = parse(queueData, 'queue'), history = parse(historyData, 'history');
    const downloads: DownloadStatusResult['downloads'] = [];
    const found = new Set<string>();
    for (const [location, data] of [['queue', queue], ['history', history]] as const) {
      for (const value of data.slots) {
        if (typeof value.nzo_id !== 'string' || !ids.has(value.nzo_id) || found.has(value.nzo_id)) continue;
        found.add(value.nzo_id);
        const status = sabStatus(value.status), remainingMB = nonnegative(value.mbleft);
        downloads.push({ id: value.nzo_id, location, status, percent: location === 'queue' ? percentage(value.percentage) : status === 'completed' ? 100 : null,
          remainingBytes: location === 'queue' && remainingMB !== null ? Math.round(remainingMB * 1024 * 1024) : null,
          // SAB's kbpersec is for the whole service, not this job.
          bytesPerSecond: null, etaSeconds: location === 'queue' ? eta(value.timeleft) : null });
      }
    }
    const issues: DownloadStatusResult['service']['issues'] = [];
    try {
      const response = await request(context, 'warnings', {}, signal);
      const values = Array.isArray(response) ? rows(response) : rows(row.parse(response).warnings);
      for (const warning of values.slice(-100)) {
        const time = nonnegative(warning.time); if (time === null) continue;
        const milliseconds = time * 1000;
        if (milliseconds < Date.now() - 15 * 60000 || milliseconds > Date.now() + 60000 || typeof warning.text !== 'string') continue;
        const code = /Failed login for server|Access denied to your node/i.test(warning.text) ? 'provider-auth-denied' : /Permission denied|Failed making/i.test(warning.text) ? 'storage-permission-denied' : null;
        if (code && !issues.some(value => value.code === code)) issues.push({ code, observedAt: new Date(milliseconds).toISOString() });
      }
    } catch { issues.push({ code: 'service-warnings-unavailable', observedAt }); }
    const kbps = nonnegative(queue.container.kbpersec);
    const truncated = [queue, history].some(value => {
      const total = nonnegative(value.container.noofslots);
      return total === null || total > value.slots.length;
    });
    return { downloads, service: { status: typeof queue.container.status === 'string' ? sabStatus(queue.container.status) : null, bytesPerSecond: kbps === null ? null : kbps * 1024, issues }, truncated, observedAt };
  } };
}

export function transmissionDownloadStatus(request: (context: ConnectorOperationContext, method: string, args: Row, signal?: AbortSignal) => Promise<Row>): ConnectorOperation {
  return { input: downloadStatusInput, async execute(raw, context): Promise<DownloadStatusResult> {
    const input = downloadStatusInput.parse(raw), observedAt = new Date().toISOString();
    const signal = AbortSignal.timeout(30_000);
    const ids = new Set(input.ids.filter(hash).map(value => value.toLowerCase()));
    const fields = ['hashString', 'status', 'percentDone', 'leftUntilDone', 'rateDownload', 'eta', 'error'];
    const [torrentData, service] = await Promise.all([
      ids.size ? request(context, 'torrent-get', { fields, ids: [...ids] }, signal) : Promise.resolve({ torrents: [] }),
      request(context, 'session-stats', {}, signal),
    ]);
    const torrents = rows(torrentData.torrents);
    const states: Record<number, string> = { 0: 'stopped', 1: 'check-waiting', 2: 'checking', 3: 'download-waiting', 4: 'downloading', 5: 'seed-waiting', 6: 'seeding' };
    const seen = new Set<string>();
    const downloads: DownloadStatusResult['downloads'] = torrents.flatMap(value => {
      if (typeof value.hashString !== 'string' || !ids.has(value.hashString.toLowerCase()) || seen.has(value.hashString.toLowerCase())) return [];
      const id = value.hashString.toLowerCase(); seen.add(id);
      const fraction = typeof value.percentDone === 'number' && value.percentDone >= 0 && value.percentDone <= 1 ? value.percentDone : null;
      return [{ id, location: 'queue' as const, status: typeof value.error === 'number' && value.error > 0 ? 'error' : states[Number(value.status)] ?? 'unknown', percent: fraction === null ? null : fraction * 100,
        remainingBytes: nonnegative(value.leftUntilDone), bytesPerSecond: nonnegative(value.rateDownload), etaSeconds: nonnegative(value.eta) }];
    });
    const count = nonnegative(service.activeTorrentCount);
    return { downloads, service: { status: count === null ? null : count > 0 ? 'active' : 'idle', bytesPerSecond: nonnegative(service.downloadSpeed), issues: [] }, truncated: false, observedAt };
  } };
}
