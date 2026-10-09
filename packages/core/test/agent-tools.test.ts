import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AGENT_INSTRUCTIONS, AGENT_TOOLS, type GameApi, ToolError } from '../src/agent-tools.ts';

function fakeApi(): GameApi & { deployed: Array<[string, string]> } {
  const deployed: Array<[string, string]> = [];
  return {
    deployed,
    listBoards: async () => [],
    datasheet: async (board) => (board === 'DA' ? ({ board: 'DA' } as never) : null),
    firmware: async () => null,
    deploy: async (board, code) => {
      deployed.push([board, code]);
      return { ok: true, version: 2, installsAt: "the board's next tick" };
    },
    logs: async () => [],
    map: async () => ({ width: 1, height: 1, facilities: [] }),
    status: async () => ({}) as never,
    alerts: async () => [],
  };
}

/** A GameApi that records each call as [method, ...arguments] and answers with a value that names the method. */
function recordingApi(): { api: GameApi; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const method =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args]);
      return { answered: name } as never;
    };
  const api: GameApi = {
    listBoards: method('listBoards'),
    datasheet: method('datasheet'),
    firmware: method('firmware'),
    deploy: method('deploy'),
    logs: method('logs'),
    map: method('map'),
    status: method('status'),
    alerts: method('alerts'),
  };
  return { api, calls };
}

const tool = (name: string) => AGENT_TOOLS.find((t) => t.name === name)!;

describe('agent tools', () => {
  it('are exactly the tools of spec 7.3, each described', () => {
    expect(AGENT_TOOLS.map((t) => t.name)).toEqual([
      'list_boards',
      'get_datasheet',
      'get_firmware',
      'deploy_firmware',
      'read_logs',
      'get_map',
      'get_status',
      'get_alerts',
    ]);
    for (const t of AGENT_TOOLS) expect(t.description.length).toBeGreaterThan(40);
    expect(AGENT_INSTRUCTIONS).toContain('get_datasheet');
  });

  it('deploys through the game API', async () => {
    const api = fakeApi();
    await expect(tool('deploy_firmware').run(api, { board: 'DA', code: 'function tick() end' })).resolves.toEqual({
      ok: true,
      version: 2,
      installsAt: "the board's next tick",
    });
    expect(api.deployed).toEqual([['DA', 'function tick() end']]);
  });

  it('turns an unknown board into a ToolError', async () => {
    await expect(tool('get_datasheet').run(fakeApi(), { board: 'ZZ' })).rejects.toBeInstanceOf(ToolError);
  });

  it('limits firmware to 64 KB in its schema', () => {
    const schema = tool('deploy_firmware').inputSchema.code as z.ZodString;
    expect(schema.safeParse('x'.repeat(65_536)).success).toBe(true);
    expect(schema.safeParse('x'.repeat(65_537)).success).toBe(false);
  });

  it('refuses firmware with a NUL byte in its schema: the board would cut the source off there, silently', () => {
    const schema = tool('deploy_firmware').inputSchema.code as z.ZodString;
    for (const source of [
      '\u0000',
      '\u0000function tick() end',
      'function tick() end\u0000',
      'function tick() end\u0000\nerror("never runs")',
    ]) {
      const parsed = schema.safeParse(source);
      expect(parsed.success, JSON.stringify(source)).toBe(false);
      expect(parsed.error?.issues[0]?.message ?? '(no issue)').toMatch(/NUL byte/);
    }
    // Only the NUL itself is refused: other control characters, non-ASCII text, and a backslash-zero escape inside a Lua string are fine.
    expect(schema.safeParse('-- 한글, é, 😀\t\r\n\u0001\u007f print("a\\0b")').success).toBe(true);
  });

  it('passes each tool its arguments, and returns what the game answers', async () => {
    const { api, calls } = recordingApi();
    const cases: Array<[string, Record<string, unknown>, unknown[]]> = [
      ['list_boards', {}, ['listBoards']],
      ['get_datasheet', { board: 'DB' }, ['datasheet', 'DB']],
      ['get_firmware', { board: 'DB' }, ['firmware', 'DB']],
      ['deploy_firmware', { board: 'DB', code: 'x = 1' }, ['deploy', 'DB', 'x = 1']],
      ['read_logs', { board: 'DB', since: 3 }, ['logs', 'DB', 3]],
      ['read_logs', { board: 'DB' }, ['logs', 'DB', undefined]],
      ['get_map', {}, ['map']],
      ['get_status', {}, ['status']],
      ['get_alerts', { since: 7 }, ['alerts', 7]],
      ['get_alerts', {}, ['alerts', undefined]],
    ];
    for (const [name, args, call] of cases) {
      calls.length = 0;
      const answer = await tool(name).run(api, args);
      expect(calls, name).toEqual([call]);
      expect(answer, name).toEqual({ answered: call[0] });
    }
  });

  it('refuses an unknown board in every tool that reads one, naming it and pointing to list_boards', async () => {
    const api: GameApi = { ...recordingApi().api, datasheet: async () => null, firmware: async () => null, logs: async () => null };
    for (const name of ['get_datasheet', 'get_firmware', 'read_logs']) {
      const refused = tool(name).run(api, { board: 'ZZ' });
      await expect(refused, name).rejects.toBeInstanceOf(ToolError);
      await expect(refused, name).rejects.toThrow(/unknown board ZZ.*list_boards/);
    }
  });

  it('asks for a board id where a tool needs one, and takes the time to read from as an optional number', () => {
    const accepts = (name: string, args: unknown) => z.object(tool(name).inputSchema).safeParse(args).success;
    for (const name of ['list_boards', 'get_map', 'get_status']) expect(accepts(name, {}), name).toBe(true);
    for (const name of ['get_datasheet', 'get_firmware']) {
      expect(accepts(name, {}), name).toBe(false);
      expect(accepts(name, { board: 7 }), name).toBe(false);
      expect(accepts(name, { board: 'DA' }), name).toBe(true);
    }
    expect(accepts('deploy_firmware', { board: 'DA' })).toBe(false);
    expect(accepts('deploy_firmware', { board: 'DA', code: 'x' })).toBe(true);
    expect(accepts('read_logs', { since: 1 })).toBe(false);
    expect(accepts('read_logs', { board: 'DA' })).toBe(true);
    expect(accepts('read_logs', { board: 'DA', since: 1.5 })).toBe(true);
    expect(accepts('read_logs', { board: 'DA', since: 'now' })).toBe(false);
    expect(accepts('get_alerts', {})).toBe(true);
    expect(accepts('get_alerts', { since: 4 })).toBe(true);
    expect(accepts('get_alerts', { since: '4' })).toBe(false);
  });
});
