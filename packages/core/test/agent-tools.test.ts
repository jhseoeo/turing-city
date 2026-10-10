import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AGENT_INSTRUCTIONS, AGENT_TOOLS, ALERTS_SHOWN, type GameApi, type StatusWithRun, ToolError } from '../src/agent-tools.ts';
import { LOG_LIMIT } from '../src/boards.ts';
import type { AlertView } from '../src/queries.ts';

// The session does not know the clock; the game API adds `run` from the server's controller.
const STATUS: StatusWithRun = {
  time: { day: 1, clock: '00:36', seconds: 1 },
  seasonDays: 30,
  money: 4999,
  power: { generation: 20, demand: 28, shed: ['DB'] },
  ended: null,
  run: { paused: true, speed: 2 },
};

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
    status: async () => STATUS,
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
    // The tool reads a list from it, as it reads one from the real game.
    alerts: async (...args: unknown[]) => {
      calls.push(['alerts', ...args]);
      return [];
    },
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

  it('lets a ToolError carry the refusal that the viewer says in Korean', () => {
    expect(new ToolError('x').refusal).toBeUndefined();
    expect(new ToolError('connect an agent first', { code: 'noAgent' }).refusal).toEqual({ code: 'noAgent' });
    expect(new ToolError('x', { code: 'noSeason' })).toBeInstanceOf(Error);
  });

  it('turns an unknown board into a ToolError', async () => {
    await expect(tool('get_datasheet').run(fakeApi(), { board: 'ZZ' })).rejects.toBeInstanceOf(ToolError);
  });

  it('tells the agent what is true of efficient firmware and of a smashed board', () => {
    // Quiet firmware draws fewer Luddites, but a datacenter earns by processing: efficiency raises no income.
    expect(AGENT_INSTRUCTIONS).toContain('quieter firmware draws fewer of them');
    expect(AGENT_INSTRUCTIONS).not.toMatch(/earns more|earn more/);
    // Only the player rebuilds a smashed board, for money; the agent has to ask.
    expect(AGENT_INSTRUCTIONS).toContain('a smashed board stays down until the player rebuilds it');
    expect(AGENT_INSTRUCTIONS).toContain('You cannot, so tell the player and ask');
  });

  it("says in deploy_firmware's description that a board that is asleep, smashed, being rebuilt, or without power installs later", () => {
    const { description } = tool('deploy_firmware');
    expect(description).toContain("installs at the board's next tick");
    expect(description).toContain(
      'asleep, smashed, being rebuilt, or without power has no ticks until it wakes, is rebuilt, or gets its power back',
    );
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
      expect(answer, name).toEqual(name === 'get_alerts' ? { alerts: [] } : { answered: call[0] });
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

  it("returns the season's state with how the player has set the clock, and says so", async () => {
    await expect(tool('get_status').run(fakeApi(), {})).resolves.toEqual(STATUS);
    const { description } = tool('get_status');
    expect(description).toContain('run.paused');
    expect(description).toContain('run.speed');
    expect(description).toContain("the player's to set, not yours");
  });

  it('puts no tuning number in a description: the datasheet carries them, from the scenario', () => {
    // The numbers are the length of a board's log, which is the board's own limit, and how many alerts get_alerts shows.
    for (const t of AGENT_TOOLS) {
      const named = t.name === 'read_logs' ? [String(LOG_LIMIT)] : t.name === 'get_alerts' ? [String(ALERTS_SHOWN)] : [];
      expect(t.description.match(/\d+/g) ?? [], t.name).toEqual(named);
    }
    expect(AGENT_INSTRUCTIONS).not.toMatch(/\d/);
    expect(tool('get_map').description).toContain('datasheet');
  });

  describe('get_alerts', () => {
    const alert = (id: number): AlertView => ({
      day: 1,
      clock: '00:00',
      seconds: id,
      id,
      kind: 'powerShortage',
      facility: null,
      message: `alert ${id}`,
    });
    /** A game whose log holds alerts 1..n, one a second, as get_alerts' since filters them. */
    const holding = (n: number): GameApi => ({
      ...fakeApi(),
      alerts: async (since) => Array.from({ length: n }, (_, i) => alert(i + 1)).filter((a) => since === undefined || a.seconds > since),
    });
    const ids = (reply: unknown): number[] => (reply as { alerts: AlertView[] }).alerts.map((a) => a.id);

    it('shows the newest alerts, oldest first, and says how many older ones the log holds and how to read them', async () => {
      const reply = (await tool('get_alerts').run(holding(120), {})) as { olderNotShown: number; note: string };
      expect(ids(reply)).toEqual(Array.from({ length: ALERTS_SHOWN }, (_, i) => 120 - ALERTS_SHOWN + 1 + i));
      expect(reply.olderNotShown).toBe(120 - ALERTS_SHOWN);
      expect(reply.note).toBe(
        `${120 - ALERTS_SHOWN} older alerts are not shown; pass since (game seconds into the season) to read the alerts after that time.`,
      );
    });

    it('shows every alert, and says nothing of older ones, when the log holds no more than it shows', async () => {
      for (const n of [0, 1, ALERTS_SHOWN]) {
        const reply = await tool('get_alerts').run(holding(n), {});
        expect(reply, String(n)).toEqual({ alerts: Array.from({ length: n }, (_, i) => alert(i + 1)) });
      }
      const over = (await tool('get_alerts').run(holding(ALERTS_SHOWN + 1), {})) as { olderNotShown: number };
      expect(over.olderNotShown).toBe(1);
      expect(ids(over)[0]).toBe(2);
    });

    it('gives every alert after the time it is asked for, however many, with no cut and no note', async () => {
      const reply = await tool('get_alerts').run(holding(120), { since: 10 });
      expect(ids(reply)).toEqual(Array.from({ length: 110 }, (_, i) => 11 + i));
      expect(Object.keys(reply as object)).toEqual(['alerts']);
    });

    it('says in its description how many it shows and how to read more', () => {
      const { description } = tool('get_alerts');
      expect(description).toContain(`newest ${ALERTS_SHOWN}`);
      expect(description).toContain('since');
    });
  });

  it("takes the log length it names from the board's own limit", async () => {
    vi.resetModules();
    vi.doMock('../src/boards.ts', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../src/boards.ts')>()),
      LOG_LIMIT: 37,
    }));
    try {
      const fresh = await import('../src/agent-tools.ts');
      expect(fresh.AGENT_TOOLS.find((t) => t.name === 'read_logs')!.description).toContain('up to its last 37 lines');
    } finally {
      vi.doUnmock('../src/boards.ts');
      vi.resetModules();
    }
  });
});
