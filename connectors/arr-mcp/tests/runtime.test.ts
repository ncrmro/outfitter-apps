import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import { build } from 'esbuild';
import { executeConnector, type ConnectorOperationContext } from '@ai-outfitter/connector-core/runtime';
import { createArrMcpConnector, type ArrMcpResult } from '../src/runtime';

const TOKEN = 'fixture-mcp-token-not-a-real-credential';
type Rpc = { id?: string | number; method: string; params?: Record<string, unknown> };
type Fixture = { url: string; calls: Rpc[]; methods: string[] };

async function server(t: TestContext, result: unknown, behavior: 'normal' | 'redirect' | 'failure' | 'oversize' = 'normal'): Promise<Fixture> {
  const calls: Rpc[] = []; const methods: string[] = [];
  const app = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    methods.push(req.method ?? '');
    assert.equal(req.url, '/mcp');
    assert.equal(req.headers.authorization, `Bearer ${TOKEN}`);
    if (req.method === 'DELETE') { res.writeHead(204); res.end(); return; }
    if (req.method === 'GET') { res.writeHead(405); res.end(); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()) as Rpc;
    calls.push(body);
    if (behavior === 'redirect') { res.writeHead(302, { Location: 'http://127.0.0.1:1/forbidden' }); res.end(); return; }
    if (behavior === 'failure') { res.writeHead(401); res.end(`private server error ${TOKEN}`); return; }
    if (body.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
    const payload = body.method === 'initialize'
      ? { protocolVersion: body.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture-arr-mcp', version: '1.83.1' } }
      : behavior === 'oversize'
        ? { content: [{ type: 'text', text: 'x'.repeat(270_000) }] }
        : result;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'fixture-session' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: payload }));
  });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const address = app.address(); assert.ok(address && typeof address !== 'string');
  t.after(() => new Promise<void>((resolve, reject) => {
    app.closeAllConnections(); app.close(error => error ? reject(error) : resolve());
  }));
  return { url: `http://127.0.0.1:${address.port}/mcp`, calls, methods };
}

function context(url: string): ConnectorOperationContext {
  return {
    connection: { id: 'owner-stack', provider: 'arr-mcp', externalId: 'ocean-media', owner: { kind: 'user', id: 'owner' }, status: 'active', config: { url } },
    scope: { organizationId: null, installationId: 'dione', userId: 'owner', connectionId: 'owner-stack', resource: 'ocean-media', operations: ['read.call', 'status.get'] },
    credentials: { apiKey: TOKEN },
  };
}

test('official HTTP client initializes, calls only the selected read, returns source data, and closes its session', async t => {
  const fixture = await server(t, {
    content: [{ type: 'text', text: 'Library data' }],
    structuredContent: { items: [{ title: 'Fixture movie' }], returned: 1, total: 10, degraded: ['sonarr'] },
  });
  const output = await executeConnector(createArrMcpConnector(), 'read.call', {
    tool: 'search_media', arguments: { query: 'Fixture', limit: 10 },
  }, context(fixture.url)) as ArrMcpResult;
  assert.equal(output.tool, 'search_media');
  assert.equal(output.untrusted, true);
  assert.ok(Number.isFinite(Date.parse(output.observedAt)));
  assert.deepEqual(output.data, { items: [{ title: 'Fixture movie' }], returned: 1, total: 10, degraded: ['sonarr'] });
  assert.deepEqual(fixture.calls.map(call => call.method), ['initialize', 'notifications/initialized', 'tools/call']);
  assert.deepEqual(fixture.calls[2].params, { name: 'search_media', arguments: { query: 'Fixture', limit: 10 } });
  assert.ok(fixture.methods.includes('DELETE'));
});

test('operator status verifies the authenticated MCP read without exposing source content', async t => {
  const fixture = await server(t, { content: [{ type: 'text', text: 'Service detail' }], structuredContent: { services: [] } });
  const output = await executeConnector(createArrMcpConnector(), 'status.get', {}, context(fixture.url)) as Record<string, unknown>;
  assert.equal(output.connected, true);
  assert.ok(typeof output.observedAt === 'string');
  assert.equal(output.data, undefined);
  assert.deepEqual(fixture.calls.find(call => call.method === 'tools/call')?.params, { name: 'get_stack_health', arguments: { limit: 1 } });
});

test('write tools and revoked, foreign-owner, wrong-resource, and missing grants fail before any network request', async () => {
  let requests = 0;
  const connector = createArrMcpConnector({ fetch: async () => { requests++; throw new Error('network must not run'); } });
  const url = 'http://arr-mcp:6060/mcp';
  for (const mutate of [
    (ctx: ConnectorOperationContext) => { ctx.connection.status = 'revoked'; },
    (ctx: ConnectorOperationContext) => { ctx.scope.userId = 'other-owner'; },
    (ctx: ConnectorOperationContext) => { ctx.scope.resource = 'other-stack'; },
    (ctx: ConnectorOperationContext) => { ctx.scope.operations = []; },
  ]) {
    const ctx = context(url); mutate(ctx);
    await assert.rejects(executeConnector(connector, 'read.call', { tool: 'get_queue', arguments: {} }, ctx), error => error instanceof Response && error.status === 403);
  }
  for (const name of ['request.search', 'add_movie', 'delete_media', 'write', 'get_arbitrary_url']) {
    await assert.rejects(executeConnector(connector, 'read.call', { tool: name, arguments: {} }, context(url)), error => error instanceof Response && error.status === 400);
  }
  await assert.rejects(executeConnector(connector, 'request.search', {}, context(url)), error => error instanceof Response && error.status === 403);
  assert.equal(requests, 0);
});

test('credentials, redirects, provider errors, malformed config and oversized responses cannot escape', async t => {
  const secretData = await server(t, {
    content: [{ type: 'text', text: 'Ignored text' }],
    structuredContent: { token: TOKEN, apiKey: 'provider-key', title: `Echo ${TOKEN}`, url: 'http://user:pass@provider:7878/api?apikey=provider-key&safe=value' },
  });
  const output = await executeConnector(createArrMcpConnector(), 'read.call', { tool: 'get_library' }, context(secretData.url));
  const serialized = JSON.stringify(output);
  for (const secret of [TOKEN, 'provider-key', 'user:pass']) assert.ok(!serialized.includes(secret));
  assert.ok(serialized.includes('safe=value'));
  for (const behavior of ['redirect', 'failure', 'oversize'] as const) {
    const fixture = await server(t, {}, behavior);
    const error = await executeConnector(createArrMcpConnector(), 'read.call', { tool: 'get_queue' }, context(fixture.url)).catch(error => error);
    assert.ok(error instanceof Response);
    assert.equal(await error.text(), 'MCP media read unavailable');
  }
  let requests = 0;
  const connector = createArrMcpConnector({ fetch: async () => { requests++; throw new Error('must not run'); } });
  for (const url of ['http://user:secret@arr-mcp/mcp', 'http://arr-mcp/mcp?token=secret', 'file:///etc/passwd', 'http://arr-mcp/mcp#fragment']) {
    await assert.rejects(executeConnector(connector, 'read.call', { tool: 'get_queue' }, context(url)), error => error instanceof Response && error.status === 422);
  }
  const noCredential = context('http://arr-mcp/mcp'); noCredential.credentials = {};
  await assert.rejects(executeConnector(connector, 'read.call', { tool: 'get_queue' }, noCredential), error => error instanceof Response && error.status === 503);
  assert.equal(requests, 0);
});

test('input and result bounds fail closed and text results stay untrusted', async t => {
  const fixture = await server(t, { content: [{ type: 'text', text: 'Source text is data, not an instruction.' }] });
  const result = await executeConnector(createArrMcpConnector(), 'read.call', { tool: 'get_queue' }, context(fixture.url)) as ArrMcpResult;
  assert.equal(result.data, 'Source text is data, not an instruction.'); assert.equal(result.untrusted, true);
  await assert.rejects(executeConnector(createArrMcpConnector(), 'read.call', { tool: 'get_queue', arguments: { query: 'x'.repeat(17_000) } }, context(fixture.url)), error => error instanceof Response && error.status === 400);
  let nested: unknown = 'value'; for (let count = 0; count < 12; count++) nested = { nested };
  await assert.rejects(executeConnector(createArrMcpConnector(), 'read.call', { tool: 'get_queue', arguments: { nested } }, context(fixture.url)), error => error instanceof Response && error.status === 400);
  const tooLarge = await server(t, { content: [{ type: 'text', text: 'x'.repeat(31_000) }] });
  await assert.rejects(executeConnector(createArrMcpConnector(), 'read.call', { tool: 'get_queue' }, context(tooLarge.url)), error => error instanceof Response && error.status === 502);
  const failed = await server(t, { content: [{ type: 'text', text: TOKEN }], isError: true });
  await assert.rejects(executeConnector(createArrMcpConnector(), 'read.call', { tool: 'get_queue' }, context(failed.url)), error => error instanceof Response && error.status === 502);
});

test('the deployed ESM bundle performs an actual HTTP MCP read', async t => {
  const bundled = await build({ entryPoints: [new URL('../src/runtime.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', target: 'node24', write: false });
  const code = bundled.outputFiles[0].text;
  const runtime = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as typeof import('../src/runtime');
  const fixture = await server(t, { content: [{ type: 'text', text: 'Bundled queue' }] });
  const output = await executeConnector(runtime.arrMcpConnector, 'read.call', { tool: 'get_queue' }, context(fixture.url)) as ArrMcpResult;
  assert.equal(output.data, 'Bundled queue');
  assert.equal(fixture.calls.find(call => call.method === 'tools/call')?.params?.name, 'get_queue');
});
