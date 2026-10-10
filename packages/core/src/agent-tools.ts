import { z } from 'zod';
import { LOG_LIMIT } from './boards.ts';
import type { Datasheet } from './datasheet.ts';
import type { AlertView, BoardSummary, FirmwareView, LogView, MapView, StatusView } from './queries.ts';
import type { Refusal } from './refusal.ts';

export type DeployOutcome =
  | { readonly ok: true; readonly version: number; readonly installsAt: string }
  | { readonly ok: false; readonly error: string };

/** How the player has set the clock. The session does not know it (the server's controller does), so the game API supplies it. */
export interface RunView {
  /** Whether game time stands still. */
  readonly paused: boolean;
  /** How many times as fast as normal game time runs while it goes. */
  readonly speed: 1 | 2 | 3;
}

/** What get_status returns: the season's state, and how the player has set the clock. */
export interface StatusWithRun extends StatusView {
  readonly run: RunView;
}

/** What the tools need from the game; the server implements it on top of the session. */
export interface GameApi {
  listBoards(): Promise<BoardSummary[]>;
  datasheet(board: string): Promise<Datasheet | null>;
  firmware(board: string): Promise<FirmwareView | null>;
  deploy(board: string, code: string): Promise<DeployOutcome>;
  logs(board: string, sinceSeconds: number | undefined): Promise<LogView[] | null>;
  map(): Promise<MapView>;
  status(): Promise<StatusWithRun>;
  alerts(sinceSeconds: number | undefined): Promise<AlertView[]>;
}

/**
 * How many alerts get_alerts shows when it is asked for no time: the newest. The log holds 500, which are some 70 KB of JSON,
 * and an agent that polls would read them all again at every call.
 */
export const ALERTS_SHOWN = 50;

/** What get_alerts returns. */
export interface AlertsReply {
  /** Oldest first. */
  readonly alerts: readonly AlertView[];
  /** How many older alerts the log holds that are not in `alerts`; present only when the answer was cut short. */
  readonly olderNotShown?: number;
  /** How to read them; present with olderNotShown. */
  readonly note?: string;
}

/**
 * A tool call the game refuses (an unknown board, for instance); the server reports it as a tool error. A refusal the viewer can say
 * in Korean carries its code (see refusal.ts).
 */
export class ToolError extends Error {
  readonly refusal: Refusal | undefined;

  constructor(message: string, refusal?: Refusal) {
    super(message);
    this.refusal = refusal;
  }
}

export interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodRawShape;
  run(api: GameApi, args: Record<string, unknown>): Promise<unknown>;
}

const board = z.string().describe('A board id, such as "DA". list_boards lists them.');
const since = z.number().optional().describe('Only entries after this many game seconds into the season.');
// A board's Lua state takes the source as a C string, which ends at the first NUL byte: the code after it would vanish
// without an error, and a syntax error behind it would pass the check.
const code = z
  .string()
  .max(65_536)
  .refine(
    (source) => !source.includes('\u0000'),
    'the source contains a NUL byte (\\u0000); the board would cut the code off there, so remove it',
  )
  .describe('The Lua source, up to 64 KB.');

function known<T>(value: T | null, id: unknown): T {
  if (value === null) throw new ToolError(`unknown board ${String(id)}; list_boards lists the boards`);
  return value;
}

export const AGENT_TOOLS: readonly AgentTool[] = [
  {
    name: 'list_boards',
    description:
      'Every board in the town: its facility, position, state (running, asleep, destroyed, rebuilding), whether it has power, its firmware version, and its latest error.',
    inputSchema: {},
    run: (api) => api.listBoards(),
  },
  {
    name: 'get_datasheet',
    description:
      "A board's datasheet: its clock and instruction cap, RAM, the io fields its sensors give and the actions it can take, its power draw and base EMF, and the firmware rules. Everything needed to write its firmware.",
    inputSchema: { board },
    run: async (api, args) => known(await api.datasheet(args.board as string), args.board),
  },
  {
    name: 'get_firmware',
    description:
      "The Lua source deployed on a board, and the one waiting to install at its next tick, if any. Read it before editing a board's firmware.",
    inputSchema: { board },
    run: async (api, args) => known(await api.firmware(args.board as string), args.board),
  },
  {
    name: 'deploy_firmware',
    description:
      "Deploy Lua firmware to a board. It must define function tick(io, mem). A syntax error is refused with Lua's message and the old firmware keeps running; otherwise the new code installs at the board's next tick, keeping mem. A board that is asleep, smashed, being rebuilt, or without power has no ticks until it wakes, is rebuilt, or gets its power back, and the answer says when the code installs.",
    inputSchema: { board, code },
    run: (api, args) => api.deploy(args.board as string, args.code as string),
  },
  {
    name: 'read_logs',
    description: `A board's log, up to its last ${LOG_LIMIT} lines: what its firmware logged, its errors (runtime, CPU limit, out of RAM), and system events such as deploys, power loss, sleep, and destruction.`,
    inputSchema: { board, since },
    run: async (api, args) => known(await api.logs(args.board as string, args.since as number | undefined), args.board),
  },
  {
    name: 'get_map',
    description:
      'The town map: each facility, its position on the grid, its state, and its distance to the power plant (power is lost in transmission over distance; the datasheet gives the rate). EMF and Luddites are not on it: boards learn of them through their sensors.',
    inputSchema: {},
    run: (api) => api.map(),
  },
  {
    name: 'get_status',
    description:
      "The season's state: day and time, money, power generation and demand, which facilities are shed, and whether the season has ended. run.paused says whether the player has stopped the clock, and run.speed how many times as fast as normal it runs; pausing and speed are the player's to set, not yours.",
    inputSchema: {},
    run: (api) => api.status(),
  },
  {
    name: 'get_alerts',
    description: `Alerts: raids, Luddites approaching, destroyed boards, fires, overheating, power shortages, firmware errors, money below zero. Without since, the newest ${ALERTS_SHOWN}, oldest first, and how many older ones the log holds; with since, every alert after that time. The game does not push alerts to you; poll this.`,
    inputSchema: { since },
    run: async (api, args): Promise<AlertsReply> => {
      const since = args.since as number | undefined;
      const all = await api.alerts(since);
      if (since !== undefined || all.length <= ALERTS_SHOWN) return { alerts: all };
      const older = all.length - ALERTS_SHOWN;
      return {
        alerts: all.slice(-ALERTS_SHOWN),
        olderNotShown: older,
        note: `${older} older alerts are not shown; pass since (game seconds into the season) to read the alerts after that time.`,
      };
    },
  },
];

export const AGENT_INSTRUCTIONS = [
  'You are the firmware engineer of a small town in turing-city, a game. The player places the hardware and directs you; you write the Lua firmware that runs on its boards.',
  'Start with list_boards and get_datasheet for each board: a datasheet tells you the io fields, the actions, the caps, and the rules.',
  'Every board runs tick(io, mem) on its own clock. Work leaks EMF, and Luddites hunt the loudest board: quieter firmware draws fewer of them. It raises no income, though: a datacenter earns by processing.',
  'Deploy with deploy_firmware; read_logs and get_alerts tell you what happened. Money comes from the datacenters; fuel and rebuilds cost it.',
  'Luddites smash boards: a smashed board stays down until the player rebuilds it, for money. You cannot, so tell the player and ask.',
].join('\n');
