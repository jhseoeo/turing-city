import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { EmptyResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { AGENT_INSTRUCTIONS, AGENT_TOOLS, type AgentStatus, type AlertKind, type GameApi } from '@turing-city/core';
import { z } from 'zod';

/** Time control for QA agents. Never part of the game: it exists only with the server's --dev flag. */
export interface DevTools {
  play(): void;
  pause(): void;
  setSpeed(speed: 1 | 2 | 3): void;
  runUntil(goal: { seconds?: number; alertKinds?: readonly AlertKind[] }): Promise<void>;
  newSeason(seed: number): Promise<void>;
  rebuild(board: string): Promise<{ ok: true } | { ok: false; reason: string }>;
}

export interface McpOptions {
  readonly api: GameApi;
  /** Read on every request, so a reissued token takes effect at once. */
  readonly token: () => string;
  readonly onAgent: (status: AgentStatus) => void;
  readonly dev?: DevTools;
  readonly pingEveryMs?: number;
  readonly pingTimeoutMs?: number;
  /** How long a session lives after its stream closes, in case the client reopens it. */
  readonly graceMs?: number;
}

interface McpSession {
  readonly id: string;
  readonly transport: StreamableHTTPServerTransport;
  readonly mcp: McpServer;
  stream: ServerResponse | null;
  misses: number;
  pingTimer: ReturnType<typeof setInterval> | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

function text(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function toolError(error: unknown): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** A tool's result as JSON text; a refusal (ToolError) or any failure becomes a tool error the agent can read. */
async function run(fn: () => Promise<unknown>): Promise<ReturnType<typeof text> | ReturnType<typeof toolError>> {
  try {
    return text(await fn());
  } catch (error) {
    return toolError(error);
  }
}

function deny(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json', ...(status === 401 ? { 'www-authenticate': 'Bearer' } : {}) });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
}

function tokenMatches(header: string | undefined, token: string): boolean {
  const want = Buffer.from(`Bearer ${token}`);
  const got = Buffer.from(header ?? '');
  return got.length === want.length && timingSafeEqual(got, want);
}

export function createMcpEndpoint(options: McpOptions): {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  dropSessions(): Promise<void>;
  close(): Promise<void>;
} {
  const pingEveryMs = options.pingEveryMs ?? 5000;
  const pingTimeoutMs = options.pingTimeoutMs ?? 2000;
  const graceMs = options.graceMs ?? 10_000;
  const sessions = new Map<string, McpSession>();
  let reported: AgentStatus = { connected: false, clientName: null };

  function report(): void {
    const live = [...sessions.values()].find((s) => s.stream !== null && s.misses < 2);
    const next: AgentStatus = { connected: !!live, clientName: live ? (live.mcp.server.getClientVersion()?.name ?? 'agent') : null };
    if (next.connected !== reported.connected || next.clientName !== reported.clientName) {
      reported = next;
      options.onAgent(next);
    }
  }

  function buildServer(): McpServer {
    const mcp = new McpServer({ name: 'turing-city', version: '0.1.0' }, { instructions: AGENT_INSTRUCTIONS });
    for (const tool of AGENT_TOOLS) {
      if (Object.keys(tool.inputSchema).length === 0) {
        mcp.registerTool(tool.name, { description: tool.description }, async () => run(() => tool.run(options.api, {})));
      } else {
        mcp.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, async (args) =>
          run(() => tool.run(options.api, args as Record<string, unknown>)),
        );
      }
    }
    const dev = options.dev;
    if (dev) {
      const ok = { ok: true };
      mcp.registerTool('dev_play', { description: 'DEV: start the clock.' }, async () =>
        run(async () => {
          dev.play();
          return ok;
        }),
      );
      mcp.registerTool('dev_pause', { description: 'DEV: stop the clock.' }, async () =>
        run(async () => {
          dev.pause();
          return ok;
        }),
      );
      mcp.registerTool(
        'dev_set_speed',
        { description: 'DEV: 1x, 2x, or 3x.', inputSchema: { speed: z.union([z.literal(1), z.literal(2), z.literal(3)]) } },
        async ({ speed }) =>
          run(async () => {
            dev.setSpeed(speed);
            return ok;
          }),
      );
      mcp.registerTool(
        'dev_run_until',
        {
          description: 'DEV: run as fast as possible while paused, for some game seconds or until an alert of one of the kinds.',
          inputSchema: { seconds: z.number().positive().optional(), alertKinds: z.array(z.string()).optional() },
        },
        async ({ seconds, alertKinds }) =>
          run(async () => {
            await dev.runUntil({
              ...(seconds === undefined ? {} : { seconds }),
              ...(alertKinds === undefined ? {} : { alertKinds: alertKinds as AlertKind[] }),
            });
            return ok;
          }),
      );
      mcp.registerTool(
        'dev_new_season',
        { description: 'DEV: a new season with a seed.', inputSchema: { seed: z.number().int() } },
        async ({ seed }) =>
          run(async () => {
            await dev.newSeason(seed);
            return ok;
          }),
      );
      mcp.registerTool(
        'dev_rebuild',
        { description: 'DEV: rebuild a destroyed board.', inputSchema: { board: z.string() } },
        async ({ board }) => run(() => dev.rebuild(board)),
      );
    }
    return mcp;
  }

  function startPinging(s: McpSession): void {
    if (s.pingTimer) clearInterval(s.pingTimer);
    let inFlight = false;
    s.pingTimer = setInterval(() => {
      if (inFlight || !s.stream) return;
      inFlight = true;
      s.mcp.server
        .request({ method: 'ping' }, EmptyResultSchema, { timeout: pingTimeoutMs })
        .then(() => {
          s.misses = 0;
        })
        .catch(() => {
          s.misses += 1;
        })
        .finally(() => {
          inFlight = false;
          report();
        });
    }, pingEveryMs);
  }

  /** The SDK answers a stream GET with 200 (open) or an error status; 'close' ends it. */
  function watchStream(s: McpSession, res: ServerResponse): void {
    const writeHead = res.writeHead.bind(res) as (...args: unknown[]) => ServerResponse;
    res.writeHead = ((...args: unknown[]) => {
      const result = writeHead(...args);
      if (res.statusCode === 200 && s.stream === null) {
        s.stream = res;
        s.misses = 0;
        if (s.graceTimer) clearTimeout(s.graceTimer);
        startPinging(s);
        report();
      }
      return result;
    }) as ServerResponse['writeHead'];
    res.on('close', () => {
      if (s.stream !== res) return;
      s.stream = null;
      if (s.pingTimer) clearInterval(s.pingTimer);
      report();
      if (sessions.has(s.id)) s.graceTimer = setTimeout(() => void s.transport.close(), graceMs);
    });
  }

  async function newSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const mcp = buildServer();
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { id, transport, mcp, stream: null, misses: 0, pingTimer: null, graceTimer: null });
      },
    });
    // Before connect(): connect() chains onto an existing onclose; set afterwards, this would replace the SDK's own.
    transport.onclose = () => {
      const id = transport.sessionId;
      const s = id === undefined ? undefined : sessions.get(id);
      if (!s) return;
      if (s.pingTimer) clearInterval(s.pingTimer);
      if (s.graceTimer) clearTimeout(s.graceTimer);
      sessions.delete(s.id);
      report();
    };
    // The SDK's transports don't satisfy its own Transport type under exactOptionalPropertyTypes.
    await mcp.connect(transport as Transport);
    await transport.handleRequest(req, res);
    if (!transport.sessionId) await mcp.close();
  }

  return {
    async handle(req, res) {
      try {
        if (req.headers.origin !== undefined) return deny(res, 403, 'Forbidden: browser requests are not allowed');
        if (!tokenMatches(req.headers.authorization, options.token())) return deny(res, 401, 'Unauthorized');
        const header = req.headers['mcp-session-id'];
        const sessionId = Array.isArray(header) ? header[0] : header;
        if (!sessionId) {
          if (req.method !== 'POST') return deny(res, 400, 'Bad Request: Mcp-Session-Id header is required');
          return await newSession(req, res);
        }
        const s = sessions.get(sessionId);
        if (!s) return deny(res, 404, 'Session not found');
        if (req.method === 'GET') watchStream(s, res);
        await s.transport.handleRequest(req, res);
      } catch {
        if (!res.headersSent) deny(res, 500, 'Internal error');
      }
    },
    async dropSessions() {
      for (const s of [...sessions.values()]) await s.transport.close();
      sessions.clear();
      report();
    },
    async close() {
      for (const s of [...sessions.values()]) await s.transport.close();
      sessions.clear();
    },
  };
}
