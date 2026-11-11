import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { connectorManifestSchema } from '@ai-outfitter/connector-core/manifest';
import type { ConnectorOperationContext, RuntimeConnector } from '@ai-outfitter/connector-core/runtime';
import { z } from 'zod';
import { version } from '../package.json';

/** Fixed upstream read operations. Discovery can never expand this surface. */
export const arrMcpTools = ['get_library', 'search_media', 'get_media_details', 'get_calendar', 'get_queue', 'get_wanted', 'get_stack_health'] as const;
const MAX_ARGUMENT_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_RESULT_CHARACTERS = 30_000;
const REQUEST_MS = 15_000;
const configSchema = z.strictObject({
  url: z.string().max(2048).refine(value => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  }, 'Choose an HTTP MCP endpoint without credentials, query, or fragment'),
});

function boundedJson(value: unknown, depth = 0): boolean {
  if (depth > 10) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(item => boundedJson(item, depth + 1));
  if (typeof value === 'object') return Object.values(value).every(item => boundedJson(item, depth + 1));
  return false;
}

export const arrMcpReadInput = z.strictObject({
  tool: z.enum(arrMcpTools),
  arguments: z.record(z.string(), z.unknown()).default({}).refine(value => {
    if (!boundedJson(value)) return false;
    try { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_ARGUMENT_BYTES; }
    catch { return false; }
  }, 'Choose JSON arguments of at most 16 KiB and depth 10'),
});

export type ArrMcpResult = {
  tool: (typeof arrMcpTools)[number];
  observedAt: string;
  data: unknown;
  untrusted: true;
};
function denied(message: string, status = 502): never { throw new Response(message, { status }); }

/** Keys, URLs, and echoed access tokens do not cross the connector boundary. */
function redact(value: unknown, token: string, depth = 0): unknown {
  if (depth > 20) return '[nested data omitted]';
  if (typeof value === 'string') return value.replaceAll(token, '[redacted]').replace(/https?:\/\/[^\s<>"']+/g, text => {
    try {
      const url = new URL(text);
      url.username = ''; url.password = '';
      for (const key of [...url.searchParams.keys()]) {
        if (/key|token|pass|secret|auth/i.test(key)) url.searchParams.set(key, '[redacted]');
      }
      return url.href;
    } catch { return '[invalid URL]'; }
  });
  if (Array.isArray(value)) return value.map(item => redact(item, token, depth + 1));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key, /^(?:api[-_]?key|access[-_]?token|authorization|password|secret|token|credential[s]?)$/i.test(key)
      ? '[redacted]' : redact(item, token, depth + 1),
  ]));
  return value;
}

/** The official client implements MCP. This fetch only constrains its HTTP boundary. */
function boundedFetch(fetcher: typeof fetch, endpoint: string, signal: AbortSignal): typeof fetch {
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url).href !== new URL(endpoint).href) return denied('MCP endpoint denied', 403);
    const headers = new Headers(init?.headers);
    // arr-mcp supports JSON Streamable HTTP; refuse open-ended event streams.
    headers.set('Accept', 'application/json');
    const requestSignal = init?.signal ? AbortSignal.any([signal, init.signal]) : signal;
    const response = await fetcher(input, { ...init, headers, redirect: 'error', signal: requestSignal });
    if (!response.body) return response;
    if (Number(response.headers.get('content-length') ?? 0) > MAX_RESPONSE_BYTES) {
      await response.body.cancel(); return denied('MCP response too large');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        length += next.value.byteLength;
        if (length > MAX_RESPONSE_BYTES) { await reader.cancel(); return denied('MCP response too large'); }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}

async function read(input: z.infer<typeof arrMcpReadInput>, context: ConnectorOperationContext, fetcher: typeof fetch): Promise<ArrMcpResult> {
  const { url } = configSchema.parse(context.connection.config);
  const token = context.credentials.apiKey;
  if (!token) return denied('MCP credential unavailable', 503);
  const signal = AbortSignal.timeout(REQUEST_MS);
  let client: MCPClient | undefined;
  try {
    client = await createMCPClient({
      clientName: 'dione-read-only', protocolVersionDiscovery: false, maxRetries: 0,
      transport: { type: 'http', url, headers: { Authorization: `Bearer ${token}` }, redirect: 'error', fetch: boundedFetch(fetcher, url, signal) },
      initializationOptions: { signal, timeout: REQUEST_MS, maxTotalTimeout: REQUEST_MS },
      onUncaughtError() { /* Provider errors may contain credentials; never log them. */ },
    });
    const result = await client.callTool({ name: input.tool, arguments: input.arguments, options: { signal, timeout: REQUEST_MS, maxTotalTimeout: REQUEST_MS } });
    if (result.isError) return denied('MCP media read failed');
    const envelope = z.object({
      structuredContent: z.unknown().optional(),
      content: z.array(z.object({ type: z.string(), text: z.string().optional() })).default([]),
    }).parse(result);
    const raw = envelope.structuredContent ?? envelope.content.filter(part => part.type === 'text').map(part => part.text ?? '').join('\n');
    if (raw === '') return denied('MCP read returned no data');
    const data = redact(raw, token);
    if (JSON.stringify(data).length > MAX_RESULT_CHARACTERS) return denied('MCP result too large; narrow the query');
    return { tool: input.tool, observedAt: new Date().toISOString(), data, untrusted: true };
  } catch {
    return denied('MCP media read unavailable');
  } finally {
    // A close failure must not expose provider errors or replace a safe result.
    await client?.close().catch(() => {});
  }
}

export function createArrMcpConnector(transport: { fetch?: typeof fetch } = {}): RuntimeConnector {
  return {
    descriptor: connectorManifestSchema.parse({
      schemaVersion: 1, id: 'arr-mcp', displayName: 'Media stack MCP', implementationVersion: version,
      contractVersion: 'connector.runtime.v1', operations: ['read.call', 'status.get'],
      authentication: { type: 'access-token', ownership: 'organization' },
    }),
    config: configSchema, account: { config: configSchema, operations: ['read.call', 'status.get'] }, events: {}, verifyWebhook: null,
    operations: {
      'read.call': { input: arrMcpReadInput, execute: (input, context) => read(input as z.infer<typeof arrMcpReadInput>, context, transport.fetch ?? fetch) },
      'status.get': { input: z.strictObject({}), async execute(_input, context) {
        const result = await read({ tool: 'get_stack_health', arguments: { limit: 1 } }, context, transport.fetch ?? fetch);
        return { connected: true, observedAt: result.observedAt };
      } },
    },
    async coversResource(connection, resource) { return connection.provider === 'arr-mcp' && connection.status === 'active' && connection.externalId === resource; },
  };
}
export const arrMcpConnector = createArrMcpConnector();
