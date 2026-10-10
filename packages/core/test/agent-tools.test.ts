import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AGENT_INSTRUCTIONS, AGENT_TOOLS, ALERTS_SHOWN, type GameApi, type StatusWithRun, ToolError } from '../src/agent-tools.ts';
import { LOG_LIMIT } from '../src/boards.ts';
import type { AlertView } from '../src/queries.ts';
import { ALERT_KINDS, type AlertKind, type BoardStatus, type FacilityCondition } from '../src/world.ts';

// The session does not know the clock; the game API adds `run` from the server's controller.
const STATUS: StatusWithRun = {
  time: { day: 1, clock: '00:36', seconds: 1 },
  seasonDays: 30,
  money: 4999,
  power: { generation: 20, demand: 28, shed: ['DB'] },
  food: { warehouse: 12, housing: 240 },
  population: { fed: 40, hungry: 40, unpowered: 0 },
  ended: null,
  run: { paused: true, speed: 2 },
};

const MANUAL = '# DA 보드 매뉴얼: 데이터센터\n\n...';

function fakeApi(): GameApi & { deployed: Array<[string, string]> } {
  const deployed: Array<[string, string]> = [];
  return {
    deployed,
    listBoards: async () => [],
    manual: async (board) => (board === 'DA' ? MANUAL : null),
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
    manual: method('manual'),
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
/** What an argument says of itself to the agent: zod keeps a description in its global registry. */
const describedAs = (name: string, argument: string): string | undefined =>
  z.globalRegistry.get(tool(name).inputSchema[argument]!)?.description;
const BOARD_TOOLS = ['get_datasheet', 'get_firmware', 'deploy_firmware', 'read_logs'];

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

  it("hands over a board's manual as the game gives it, and refuses an unknown board", async () => {
    await expect(tool('get_datasheet').run(fakeApi(), { board: 'DA' })).resolves.toBe(MANUAL);
    await expect(tool('get_datasheet').run(fakeApi(), { board: 'ZZ' })).rejects.toBeInstanceOf(ToolError);
  });

  it('says what the manual holds, in get_datasheet', () => {
    const { description } = tool('get_datasheet');
    expect(description).toContain("A board's manual, as markdown in Korean");
    expect(description).toContain("with the town's own numbers");
  });

  it('says in each board tool that it reaches only a board with a comm module, and how to get one', () => {
    for (const name of BOARD_TOOLS) {
      expect(tool(name).description, name).toContain('It reaches only a board with a comm module (tier 2)');
      expect(tool(name).description, name).toContain('ask the player to install one');
    }
    for (const name of ['list_boards', 'get_map', 'get_status', 'get_alerts']) {
      expect(tool(name).description, name).not.toContain('It reaches only');
    }
  });

  it('explains the tiers in list_boards', () => {
    const { description } = tool('list_boards');
    expect(description).toContain('0: no board, the player works it by hand');
    expect(description).toContain('1: a board the player programs in the game');
    expect(description).toContain('2: a board with a comm module, which you can program');
    expect(description).toContain('ok, wrecked, or being repaired');
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
    expect(new ToolError('x', { code: 'noComm', board: 'DA' }).refusal).toEqual({ code: 'noComm', board: 'DA' });
    expect(new ToolError('x', { code: 'noSeason' })).toBeInstanceOf(Error);
  });

  it('tells the agent where it stands: the player runs the town and hands it boards with a comm module', () => {
    expect(AGENT_INSTRUCTIONS).toContain('The player runs the town: they work its facilities by hand, buy and install boards');
    expect(AGENT_INSTRUCTIONS).toContain('the ones with a comm module; for any other, ask the player to install one');
    expect(AGENT_INSTRUCTIONS).toContain("get_datasheet gives a board's manual, in Korean");
    expect(AGENT_INSTRUCTIONS).toContain('read get_firmware before you edit it');
  });

  it('tells the agent what is true of quiet firmware and of a wrecked facility', () => {
    // Quiet firmware draws fewer Luddites, but a datacenter earns by processing: efficiency raises no income.
    expect(AGENT_INSTRUCTIONS).toContain('quieter firmware draws fewer of them');
    expect(AGENT_INSTRUCTIONS).not.toMatch(/earns more|earn more/);
    // Only the player repairs a wrecked facility and rebuilds its board, for money; the agent has to ask.
    expect(AGENT_INSTRUCTIONS).toContain('Luddites and fire wreck a whole facility, board and all');
    expect(AGENT_INSTRUCTIONS).toContain('Only the player can repair a facility and rebuild its board');
    expect(AGENT_INSTRUCTIONS).toContain('You cannot, so tell the player and ask');
  });

  it('tells the agent how the town earns, what leaks EMF, and where to start', () => {
    expect(AGENT_INSTRUCTIONS).toContain(
      'You help the player of turing-city, a game, by writing the Lua firmware of the boards in their small town',
    );
    expect(AGENT_INSTRUCTIONS).toContain('Start with list_boards');
    expect(AGENT_INSTRUCTIONS).toContain('A board with a comm module is one they have handed to you');
    expect(AGENT_INSTRUCTIONS).toContain('Every board runs tick(io, mem) on its own clock');
    expect(AGENT_INSTRUCTIONS).toContain('Boards and busy datacenters leak EMF, and Luddites come for the loudest machines');
    expect(AGENT_INSTRUCTIONS).toContain('a datacenter earns by processing, and housing pays tax when its residents are fed and powered');
    expect(AGENT_INSTRUCTIONS).toContain('Deploy with deploy_firmware; read_logs and get_alerts tell you what happened');
    expect(AGENT_INSTRUCTIONS).toContain('its io fields, its actions, its caps, and the rules, with the town');
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
    expect(schema.safeParse('-- 한글, é, 😀\t\r\n\u0001\u007f print("a\\0b")').success).toBe(true);
  });

  it('passes each tool its arguments, and returns what the game answers', async () => {
    const { api, calls } = recordingApi();
    const cases: Array<[string, Record<string, unknown>, unknown[]]> = [
      ['list_boards', {}, ['listBoards']],
      ['get_datasheet', { board: 'DB' }, ['manual', 'DB']],
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
    const api: GameApi = { ...recordingApi().api, manual: async () => null, firmware: async () => null, logs: async () => null };
    for (const name of ['get_datasheet', 'get_firmware', 'read_logs']) {
      const refused = tool(name).run(api, { board: 'ZZ' });
      await expect(refused, name).rejects.toBeInstanceOf(ToolError);
      await expect(refused, name).rejects.toThrow(/unknown board ZZ.*list_boards/);
    }
  });

  it('describes its arguments to the agent: the board ids, the time to read from, and the size of the source', () => {
    for (const name of ['get_datasheet', 'get_firmware', 'deploy_firmware', 'read_logs']) {
      expect(describedAs(name, 'board'), name).toBe('A board id, such as "DA". list_boards lists them.');
    }
    for (const name of ['read_logs', 'get_alerts']) {
      expect(describedAs(name, 'since'), name).toBe('Only entries after this many game seconds into the season.');
    }
    expect(describedAs('deploy_firmware', 'code')).toBe('The Lua source, up to 64 KB.');
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

  it("returns the season's state with the food, the residents, and how the player has set the clock, and says so", async () => {
    await expect(tool('get_status').run(fakeApi(), {})).resolves.toEqual(STATUS);
    const { description } = tool('get_status');
    expect(description).toContain('the food in the warehouse and in the housing');
    expect(description).toContain('the residents who are fed, hungry, or without power');
    expect(description).toContain('run.paused');
    expect(description).toContain('run.speed');
    expect(description).toContain("the player's to set, not yours");
  });

  it('names every kind of alert the game raises, in get_alerts', () => {
    // The server's controller raises agentLost for the viewer alone: it is never in the log that get_alerts reads.
    const named: Record<Exclude<AlertKind, 'agentLost'>, string> = {
      raid: 'raids',
      ludditesNear: 'Luddites approaching',
      wrecked: 'wrecked facilities',
      fire: 'fires',
      overheat: 'overheating',
      powerShortage: 'power shortages',
      hunger: 'hunger',
      firmwareError: 'firmware errors',
      moneyBelowZero: 'money below zero',
      seasonEnd: "the season's end",
    };
    const { description } = tool('get_alerts');
    for (const kind of ALERT_KINDS) {
      if (kind !== 'agentLost') expect(description, kind).toContain(named[kind]);
    }
  });

  it('names the states of a facility and of its board that list_boards reports', () => {
    const boards: Record<BoardStatus, string> = { running: 'running', asleep: 'asleep', destroyed: 'destroyed', rebuilding: 'rebuilding' };
    const facilities: Record<FacilityCondition, string> = { ok: 'ok', wrecked: 'wrecked', repairing: 'being repaired' };
    const { description } = tool('list_boards');
    for (const phrase of [...Object.values(boards), ...Object.values(facilities)]) expect(description, phrase).toContain(phrase);
  });

  it('says what each tool returns or does, clause by clause', () => {
    const says: Record<string, string[]> = {
      list_boards: [
        'Every facility of the town that can take a board',
        'its kind, its position, and its tier',
        "its board's state",
        'power, firmware version, and latest error',
      ],
      get_datasheet: [
        'what the board is for, its parts, every io field it reads and every action it can take',
        "its facility's rules, and the rules every board runs under",
        'Everything needed to write its firmware',
      ],
      get_firmware: [
        'The Lua source deployed on a board',
        'the one waiting to install at its next tick',
        "The player can change a board's firmware too, so read it before you edit it",
      ],
      deploy_firmware: [
        'It must define function tick(io, mem)',
        "A syntax error is refused with Lua's message and the old firmware keeps running",
        'keeping mem',
        'the answer says when the code installs',
      ],
      read_logs: [
        'what its firmware logged',
        'its errors (runtime, CPU limit, out of RAM)',
        'system events such as deploys, power loss, sleep, and destruction',
      ],
      get_map: [
        'each facility, its kind, its position on the grid, its tier, whether it stands and has power, and its distance to the power plant',
        'EMF and Luddites are not on it',
      ],
      get_status: ['day and time, money, power generation and demand, which facilities are shed', 'whether the season has ended'],
      get_alerts: [
        'oldest first, and how many older ones the log holds',
        'every alert after that time',
        'The game does not push alerts to you; poll this',
      ],
    };
    expect(Object.keys(says).sort()).toEqual(AGENT_TOOLS.map((t) => t.name).sort());
    for (const [name, phrases] of Object.entries(says)) {
      for (const phrase of phrases) expect(tool(name).description, `${name}: ${phrase}`).toContain(phrase);
    }
  });

  it('puts no tuning number in a description: the manual carries them, from the scenario', () => {
    // The numbers are the tiers, the length of a board's log, which is the board's own limit, and how many alerts get_alerts shows.
    const named: Record<string, string[]> = {
      list_boards: ['0', '1', '2'],
      get_datasheet: ['2'],
      get_firmware: ['2'],
      deploy_firmware: ['2'],
      read_logs: [String(LOG_LIMIT), '2'],
      get_alerts: [String(ALERTS_SHOWN)],
    };
    for (const t of AGENT_TOOLS) expect(t.description.match(/\d+/g) ?? [], t.name).toEqual(named[t.name] ?? []);
    expect(AGENT_INSTRUCTIONS).not.toMatch(/\d/);
    expect(tool('get_map').description).toContain('the manual gives the rate');
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
