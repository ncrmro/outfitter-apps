import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { database } from '../tests/helpers';
import { providers, reportDay, type Binding } from '../src/server/model';
import { settings } from '../src/server/schema';
import { generateReport, overview, type Host } from '../src/server/service';
import { readAllowed } from './capture-production';

type CaptureRead = {
    provider: string; operation: string; input: Record<string, any>;
    status: 'ok' | 'failed'; result?: any; error?: string; detail?: string;
    durationMs?: number; observedAt?: string;
};
type Capture = {
    observedAt: string; providerWrites: false; executionMode: string;
    connectorRevision?: string; platformRevision?: string; reads: CaptureRead[];
};

export function baselineOptions(args: string[]) {
    let context = 'default', capture: string | null = null, positional = false;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index]!;
        if (arg === '--capture') {
            if (capture || !args[index + 1] || args[index + 1]!.startsWith('--')) throw Error('Expected one private capture path');
            capture = resolve(args[++index]!);
        } else if (arg.startsWith('--') || positional) throw Error('Unsupported baseline arguments');
        else { context = arg; positional = true; }
    }
    return { context, capture };
}

export function checkedCapture(value: any): Capture {
    if (!value || value.providerWrites !== false || typeof value.executionMode !== 'string' || !Number.isFinite(Date.parse(value.observedAt)) || !Array.isArray(value.reads))
        throw Error('Invalid read-only capture');
    for (const read of value.reads) {
        if (!read || !readAllowed(read.provider, read.operation) || !read.input || typeof read.input !== 'object' || Array.isArray(read.input) || !['ok', 'failed'].includes(read.status))
            throw Error('Invalid read-only capture observation');
    }
    return value;
}

/** Replay the original query-window reference time, including older captures. */
export function capturedReportTime(capture: Capture) {
    const query = capture.reads.find(read => read.operation === 'briefing.read' && Number.isFinite(Date.parse(read.input.start)));
    return query ? Date.parse(query.input.start) + 86400000 : Date.parse(capture.observedAt);
}

/** Isolated workflow receipts and captured reads only; never calls a provider. */
export function baselineHost(capture: Capture, bindings: Binding[]) {
    const runs = new Map<string, any>();
    const call = async (name: string, input: any): Promise<any> => {
        if (name === 'workflow.read') return runs.get(input.id) ?? null;
        if (name === 'workflow.start') {
            if (runs.has(input.id)) throw Error('Baseline workflow already exists');
            runs.set(input.id, { readiness: { run: 'running', steps: { collect: 'ready', briefing: 'waiting' } }, receipts: {} });
            return { id: input.id };
        }
        if (name === 'workflow.collect') {
            const run = runs.get(input.runId);
            if (!run) throw Error('Baseline workflow does not exist');
            if (input.slot === 'collect.outputs.observations' && run.readiness.steps.collect === 'ready')
                run.readiness = { run: 'running', steps: { collect: 'complete', briefing: 'ready' } };
            else if (input.slot === 'briefing.outputs.briefing' && run.readiness.steps.briefing === 'ready')
                run.readiness = { run: 'complete', steps: { collect: 'complete', briefing: 'complete' } };
            else throw Error('Unsupported baseline workflow receipt');
            run.receipts[input.slot] = input.value;
            return { run: run.readiness.run, steps: run.readiness.steps };
        }
        if (name === 'connector.execute') {
            if (!['briefing.read', 'missing.list', 'queue.list'].includes(input.operation)) throw Error('Baseline rejects provider writes');
            const provider = bindings.find(binding => binding.connectionId === input.connectionId && binding.resource === input.resource)?.provider;
            const read = capture.reads.find(row => row.provider === provider && row.operation === input.operation && (row.input.cursor ?? '') === (input.input.cursor ?? ''));
            if (!read || read.status !== 'ok') throw Error('Captured source failed');
            return read.result;
        }
        throw Error('Unsupported baseline host operation');
    };
    return { host: { call } as Host, runs };
}

function failure(read: CaptureRead) {
    const error = typeof read.error === 'string' && /^(?:Connector HTTP [1-5][0-9]{2}|Connector read failed)$/.test(read.error) ? read.error : 'Connector read failed';
    const detail = ['response-size-bound', 'invalid-connector-input', 'provider-http-failure', 'read-failure'].includes(read.detail ?? '') ? read.detail : 'read-failure';
    return { provider: read.provider, operation: read.operation, error, detail };
}
const markdown = (value: unknown) => String(value ?? '').replace(/[\r\n]/g, ' ').replace(/[\\`*_[\]<>#]/g, '\\$&');

async function main() {
    const options = baselineOptions(process.argv.slice(2));
    const startedAt = Date.now(), runId = new Date(startedAt).toISOString().replaceAll(':', '-');
    const directory = resolve(homedir(), '.local/state/dione/baselines', runId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    let capture: Capture;
    if (options.capture) {
        capture = checkedCapture(JSON.parse(await readFile(options.capture, 'utf8')));
        console.log('Replaying a private read-only capture; no Kubernetes access…');
    } else {
        const kube = ['--context', options.context, '-n', 'outfitter-cloud'];
        const server = execFileSync('kubectl', ['--context', options.context, 'config', 'view', '--minify', '-o', 'jsonpath={.clusters[0].cluster.server}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
        if (server !== 'https://100.64.0.6:6443') throw Error('Refusing a non-Ocean Kubernetes target');
        const bundle = await build({ entryPoints: [new URL('./capture-production.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
        const code = Buffer.from(bundle.outputFiles[0]!.contents).toString('base64');
        const secret = JSON.parse(execFileSync('kubectl', [...kube, 'get', 'secret', 'dione-arr-mcp', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
        const config = JSON.parse(Buffer.from(secret.data['config.yaml'], 'base64').toString('utf8'));
        const bootstrap = "let text='';for await(const chunk of process.stdin)text+=chunk;const p=JSON.parse(text);try{const m=await import('data:text/javascript;base64,'+p.code);process.stdout.write(JSON.stringify(await m.run(p.input)));}catch{process.stdout.write(JSON.stringify({error:'Private baseline operation failed'}));process.exitCode=1;}";
        console.log('Collecting read-only production observations…');
        const raw = execFileSync('kubectl', [...kube, 'exec', '-i', 'deployment/outfitter-webapp', '-c', 'webapp', '--', 'node', '--input-type=module', '-e', bootstrap], {
            input: JSON.stringify({ code, input: { mode: 'capture', services: config.services, start: new Date(startedAt - 86400000).toISOString(), end: new Date(startedAt + 7 * 86400000).toISOString() } }),
            encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 240000, stdio: ['pipe', 'pipe', 'pipe'],
        });
        capture = checkedCapture(JSON.parse(raw));
    }
    await writeFile(resolve(directory, 'capture.json'), JSON.stringify(capture, null, 2) + '\n', { mode: 0o600 });
    if (!capture.reads.some(read => read.operation === 'status.get' && read.status === 'ok')) throw Error('No live provider health reads passed; report evaluation refused');
    console.log(`Captured ${capture.reads.length} reads; generating an isolated report…`);
    const now = capturedReportTime(capture);
    const { db, client, close } = await database();
    const started = performance.now();
    try {
        const bindings = providers.map(provider => ({ provider, connectionId: `baseline-${provider}`, resource: `ocean-${provider}` }));
        await db.insert(settings).values({ id: 'default', timezone: 'America/Chicago', hour: 8, enabled: false, bindings: JSON.stringify(bindings), updatedAt: now });
        const { host, runs } = baselineHost(capture, bindings);
        const report = await generateReport(db, host, { runId: `prod-baseline-${runId}`, now });
        const all = await overview(db);
        const totalRecommendations = Number((await client.execute('SELECT COUNT(*) AS n FROM recommendations')).rows[0]!.n);
        const mcp = capture.reads.filter(read => read.provider === 'arr-mcp').map(read => ({ tool: read.input.tool, status: read.status, returned: read.result?.data?.returned ?? null, total: read.result?.data?.total ?? null, degradedCount: read.result?.data?.degraded?.length ?? 0 }));
        const readBounds = capture.reads.map(read => ({ provider: read.provider, operation: read.operation, tool: read.input.tool ?? null, requestedLimit: read.input.limit ?? read.input.arguments?.limit ?? null, returned: Array.isArray(read.result?.items) ? read.result.items.length : read.result?.data?.returned ?? null, truncated: read.result?.truncated ?? read.result?.data?.truncated ?? null, hasMore: Boolean(read.result?.cursor), observedAt: read.observedAt ?? null, durationMs: read.durationMs ?? null }));
        const sectionCounts = { upcoming: report.sections.upcoming.length, library: report.sections.library.length, attention: report.sections.attention.length };
        const summary = {
            sourceCommit: source, connectorRevision: capture.connectorRevision, platformRevision: capture.platformRevision,
            capturedAt: capture.observedAt, reportGeneratedAt: new Date(now).toISOString(), reportDay: reportDay(now, 'America/Chicago'),
            providerWrites: false, executionMode: capture.executionMode, baselineMode: options.capture ? 'private-capture-replay' : 'live-read',
            workflowMode: 'isolated evaluation harness; not an installed/scheduled workflow',
            workflowReceipts: Object.keys(runs.get(`prod-baseline-${runId}`)?.receipts ?? {}),
            reportStatus: report.report.status, observations: report.items.length, sectionCounts,
            recommendations: totalRecommendations, visibleRecommendations: all.recommendations.length,
            mcp, readCalls: capture.reads.length, readBounds,
            failedReads: capture.reads.filter(read => read.status !== 'ok').map(failure),
            sources: report.sources.map(item => ({ source: item.source, status: item.status, count: item.count, truncated: item.truncated })),
            reportDurationMs: Math.round(performance.now() - started),
        };
        await writeFile(resolve(directory, 'report.json'), JSON.stringify({ report, overview: all }, null, 2) + '\n', { mode: 0o600 });
        await writeFile(resolve(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 });
        const notes = [
            '# Dione production-read baseline', '', `Captured: ${capture.observedAt}`, `Source: ${source}`, '',
            `${options.capture ? 'Replayed recorded provider reads' : 'Real provider reads'}; no provider writes. Deterministic report generated using application services in an isolated evaluation harness. This does not prove an installed owner session, scheduled workflow or graph publication.`, '',
            `## Briefing (${report.report.status})`, '', report.report.summary, '',
        ];
        for (const [key, label] of [['upcoming', 'Upcoming'], ['library', 'Library'], ['attention', 'Needs attention']] as const) {
            const rows = report.sections[key];
            notes.push(`## ${label} (${rows.length})`, '', ...rows.slice(0, 30).map(item => `- ${markdown(item.title)} (${markdown(item.source)}, ${markdown(item.kind)}${item.date ? '; ' + markdown(item.date) : ''}): ${markdown(item.detail)}`));
            if (!rows.length) notes.push('None observed.');
            if (rows.length > 30) notes.push(`Showing 30 of ${rows.length}; full data is in report.json.`);
            notes.push('');
        }
        notes.push('## Source health', '', ...summary.sources.map(item => `- ${item.source}: ${item.status}; ${item.count} observations${item.truncated ? '; bounded/truncated' : ''}`), '',
            '## Evaluation boundaries', '', `${summary.observations} observations; ${summary.recommendations} proposed recommendations. No recommendations were confirmed or submitted.`,
            'Read bounds, source failures and duration: summary.json. Raw reads and timestamps: capture.json. Full report and sections: report.json.');
        await writeFile(resolve(directory, 'report.md'), notes.join('\n') + '\n', { mode: 0o600 });
        console.log(JSON.stringify({ directory, ...summary }, null, 2));
    } finally { close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    main().catch(() => { console.error('Production baseline failed; private subprocess output withheld. Inspect the private capture directory.'); process.exitCode = 1; });
}
