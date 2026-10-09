import { facilityDemand, plantBoard } from './power.ts';
import type { FacilityKind, SensorName } from './scenario.ts';
import { SENSOR_KEYS } from './sensors.ts';
import { findBoard, manhattan, type SimContext } from './world.ts';

export const SENSOR_DOCS: Record<SensorName, { unit: string; meaning: string }> = {
  wind: { unit: 'power units', meaning: "the wind module's output right now; it costs nothing" },
  demand: { unit: 'power units', meaning: 'everything the town requests this step, transmission loss included' },
  fuelPrice: { unit: 'money per unit per day', meaning: 'what each unit of thermal output costs, redrawn every day' },
  temp: { unit: '°C', meaning: "this datacenter's temperature; above 90 it can catch fire, and fire destroys the board" },
  powerHeadroom: { unit: 'power units', meaning: 'generation minus demand; negative means the plant is shedding facilities' },
  price: { unit: 'money per second of processing', meaning: 'the current job price, which drifts over time' },
  emf: { unit: 'EMF units', meaning: "the EMF in this board's cell; Luddites hunt the strongest" },
  ludditeDist: { unit: 'cells', meaning: 'the distance to the nearest Luddite group, nil when none is on the map' },
};

const TIME_READS = [
  { name: 'day', unit: 'day', meaning: 'the season day, from 1' },
  { name: 'clock', unit: 'seconds', meaning: 'game seconds since the season started' },
];

export const ACTION_DOCS: Record<FacilityKind | 'any', ReadonlyArray<{ call: string; meaning: string }>> = {
  datacenter: [
    {
      call: 'io.process()',
      meaning: 'run one job until your next tick: earns price x seconds, draws 150 power, and heats the datacenter (+2 °C/s)',
    },
    { call: 'io.cool(level)', meaning: 'set cooling to level 0-3; each level takes 0.8 °C/s off and draws 20 power; it stays set' },
  ],
  power: [
    {
      call: 'io.set_thermal(output)',
      meaning: 'set the thermal module to 0-300 power units; it stays set and costs fuel_price per unit per day',
    },
    {
      call: 'io.set_priority({ids})',
      meaning: 'who keeps power in a shortage, highest first, such as {"DA", "DB"}; the unlisted come after',
    },
  ],
  any: [
    { call: 'io.log(...)', meaning: 'log a line (print does the same); 20 lines per tick, 200 characters each' },
    { call: 'io.sleep(seconds)', meaning: 'deep sleep for 1-40 s: silent and nearly powerless, but RAM (mem and globals) is wiped' },
  ],
};

export const FIRMWARE_RULES: readonly string[] = [
  "Define function tick(io, mem). It runs once per beat of the board's clock while the board is powered and awake.",
  'mem persists across ticks and deploys (hot reload); globals reset on every deploy. Deep sleep and destruction wipe both.',
  'Only mem carries over a deploy; each install gets a fresh io.',
  'Actions queue during the tick and apply when it returns. A tick that errors, runs out of RAM, or exceeds the instruction cap is aborted: its actions are dropped, and a capped tick counts as the whole cap toward EMF.',
  'RAM is firmware data beyond a fixed baseline: mem, globals, and what a tick allocates. Code doesn\'t count. After "out of RAM", mem still holds its data, so deploy firmware that frees what it no longer needs from mem first thing (its first tick gets a little extra room to do that).',
  'EMF per tick = instructions / 100 + 10 per action; an awake board also emits its base EMF every second. Efficient firmware is quieter.',
  'Available: the base library (pairs, pcall, setmetatable, ...), string, table, math, coroutine. Missing: os, io (the library), load, require, debug, collectgarbage, utf8.',
  "string.find searches plain text only; string.match, gmatch, and gsub don't exist. math.randomseed doesn't exist; math.random is seeded per board.",
  'tostring of a table or function gives just its type, and setmetatable refuses __gc and __mode.',
  'string.format refuses %p, and tostring never shows an address.',
  "coroutine.close isn't available. A coroutine that errors is never closed, so its <close> handlers don't run.",
  'An xpcall handler runs after the stack has unwound, and never once the instruction cap is hit.',
  'Adding keys to a table while traversing it with pairs or next gives an undefined order.',
];

export interface Datasheet {
  readonly board: string;
  readonly facility: { readonly kind: FacilityKind; readonly x: number; readonly y: number; readonly distanceToPlant: number };
  readonly parts: { readonly clockHz: number; readonly instructionsPerTick: number; readonly ramBytes: number };
  readonly io: {
    readonly reads: ReadonlyArray<{ readonly name: string; readonly unit: string; readonly meaning: string }>;
    readonly actions: ReadonlyArray<{ readonly call: string; readonly meaning: string }>;
  };
  readonly powerDrawNow: number;
  readonly baseEmfPerSecond: number;
  readonly firmware: {
    readonly version: number | null;
    readonly pendingVersion: number | null;
    readonly lastInstructions: number | null;
    readonly lastError: string | null;
    readonly ramUsedBytes: number | null;
  };
  readonly rules: readonly string[];
}

export function datasheet(ctx: SimContext, boardId: string): Datasheet | null {
  const board = findBoard(ctx.world, boardId);
  if (!board) return null;
  const plant = plantBoard(ctx.world);
  const reads = [...board.spec.sensors.map((s) => ({ name: SENSOR_KEYS[s], ...SENSOR_DOCS[s] })), ...TIME_READS];
  const last = board.lastTick;
  return {
    board: board.id,
    facility: { kind: board.kind, x: board.x, y: board.y, distanceToPlant: manhattan(board.x, board.y, plant.x, plant.y) },
    parts: { clockHz: board.spec.clockHz, instructionsPerTick: board.spec.instructionCap, ramBytes: board.spec.ramKb * 1024 },
    io: { reads, actions: [...ACTION_DOCS[board.kind], ...ACTION_DOCS.any] },
    powerDrawNow: facilityDemand(ctx, board, ctx.world.step),
    baseEmfPerSecond: board.spec.baseEmfPerSecond,
    firmware: {
      version: board.firmware?.version ?? null,
      pendingVersion: board.pending?.version ?? null,
      lastInstructions: last?.instructions ?? null,
      lastError: last?.error ? `${last.error.kind}: ${last.error.message}` : null,
      ramUsedBytes: last?.ramUsedBytes ?? null,
    },
    rules: FIRMWARE_RULES,
  };
}
