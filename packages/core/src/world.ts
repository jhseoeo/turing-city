import type { FirmwareHost, TickError } from './firmware-host.ts';
import { MICRO } from './fixed.ts';
import type { Rng } from './rng.ts';
import type { BoardSpec, FacilityKind, Scenario } from './scenario.ts';
import { beatPeriod } from './time.ts';

export type BoardStatus = 'running' | 'asleep' | 'destroyed' | 'rebuilding';

export interface LogLine {
  /** The step of the latest occurrence. */
  step: number;
  readonly kind: 'log' | 'error' | 'system';
  readonly text: string;
  /** How many times in a row this line occurred. */
  repeat: number;
}

export interface FirmwareImage {
  readonly version: number;
  readonly source: string;
}

export interface BoardState {
  readonly id: string;
  /** Position in the scenario's facility list. */
  readonly index: number;
  readonly kind: FacilityKind;
  readonly spec: BoardSpec;
  readonly x: number;
  readonly y: number;
  /** Steps between beats. */
  readonly period: number;
  readonly phase: number;
  status: BoardStatus;
  /** Whether the board's facility got power this step (set by the power phase). */
  powered: boolean;
  vmBooted: boolean;
  bootCount: number;
  firmware: FirmwareImage | null;
  /** Deployed, installed at the board's next tick (or at its reboot). */
  pending: FirmwareImage | null;
  nextVersion: number;
  wakeAt: number | null;
  readyAt: number | null;
  lastTick: { step: number; instructions: number; actions: number; ramUsedBytes: number; error: TickError | null } | null;
  log: LogLine[];
}

export interface PlantState {
  wind: number;
  thermalSetting: number;
  /** Money per unit of thermal output per day. */
  fuelPrice: number;
  /** Facility ids, highest priority first; null means the scenario order. */
  priority: readonly string[] | null;
  generation: number;
  /** Power requested this step, transmission loss included. */
  demand: number;
  shed: string[];
  /** The last step at which a facility was shed, or null before the first: the shortage alert's quiet time counts from it. */
  lastShedStep: number | null;
}

export interface DatacenterState {
  tempMilli: number;
  /** The current job covers steps jobFrom..jobUntil (inclusive). */
  jobFrom: number;
  jobUntil: number;
  cooling: number;
}

export interface LudditeGroup {
  readonly id: number;
  x: number;
  y: number;
  readonly size: number;
  targetId: string | null;
  /** Step since when no board has carried detectable EMF. */
  quietSince: number | null;
  leaving: boolean;
  /** Boards this group has already raised an approach alert for. */
  warned: string[];
}

/** Season totals in micro-units. */
export interface Ledger {
  datacenterIncome: number;
  fuel: number;
  upkeep: number;
  rebuild: number;
}

export interface Stats {
  raids: number;
  boardsLost: number;
  instructions: number;
  deploys: number;
}

export type EndKind = 'completed' | 'bankrupt' | 'fallen';

/** Every kind of alert. Whatever names a kind from outside (the dev tools, the viewer's auto-pause) refuses any other. */
export const ALERT_KINDS = [
  'raid',
  'ludditesNear',
  'boardDestroyed',
  'fire',
  'overheat',
  'powerShortage',
  'firmwareError',
  'moneyBelowZero',
  'seasonEnd',
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export interface Alert {
  readonly id: number;
  readonly step: number;
  readonly kind: AlertKind;
  readonly facilityId: string | null;
  /** Korean: the viewer shows it, and agents read it through get_alerts. */
  readonly message: string;
}

export interface WorldState {
  step: number;
  /** Micro-units. */
  money: number;
  belowZeroSince: number | null;
  ended: { kind: EndKind; step: number } | null;
  /** In scenario order. */
  boards: BoardState[];
  plant: PlantState;
  datacenters: Record<string, DatacenterState>;
  /** Money per second of processing. */
  jobPrice: number;
  /** Milli-EMF per cell, row-major (y * width + x). */
  emf: number[];
  /** EMF collected toward the next raid. */
  rumour: number;
  luddites: LudditeGroup[];
  nextLudditeId: number;
  ledger: Ledger;
  stats: Stats;
  alerts: Alert[];
  nextAlertId: number;
  /** Alert episodes in progress, for raising an alert once until it ends. */
  flags: Record<string, true>;
}

/** The seeded random streams, one per subsystem so that one subsystem's draws don't shift another's. */
export interface Streams {
  readonly weather: Rng;
  readonly market: Rng;
  readonly fire: Rng;
  readonly luddites: Rng;
}

/** What every phase of a step reads and changes. */
export interface SimContext {
  readonly scenario: Scenario;
  readonly world: WorldState;
  readonly host: FirmwareHost;
  readonly seed: number;
  readonly rng: Streams;
}

export function createWorld(scenario: Scenario): WorldState {
  const t = scenario.tuning;
  const boards = scenario.facilities.map((f, index): BoardState => {
    const period = beatPeriod(scenario.time, f.board.clockHz);
    return {
      id: f.id,
      index,
      kind: f.kind,
      spec: f.board,
      x: f.x,
      y: f.y,
      period,
      phase: index % period,
      status: 'running',
      powered: true,
      vmBooted: false,
      bootCount: 0,
      firmware: null,
      pending: null,
      nextVersion: 1,
      wakeAt: null,
      readyAt: null,
      lastTick: null,
      log: [],
    };
  });
  const datacenters: Record<string, DatacenterState> = {};
  for (const f of scenario.facilities) {
    if (f.kind === 'datacenter') datacenters[f.id] = { tempMilli: t.datacenter.ambientMilli, jobFrom: -1, jobUntil: -1, cooling: 0 };
  }
  return {
    step: 0,
    money: scenario.startMoney * MICRO,
    belowZeroSince: null,
    ended: null,
    boards,
    plant: {
      wind: t.wind.start,
      thermalSetting: 0,
      fuelPrice: t.fuelPrice.start,
      priority: null,
      generation: 0,
      demand: 0,
      shed: [],
      lastShedStep: null,
    },
    datacenters,
    jobPrice: t.jobPrice.start,
    emf: new Array<number>(scenario.grid.width * scenario.grid.height).fill(0),
    rumour: 0,
    luddites: [],
    nextLudditeId: 1,
    ledger: { datacenterIncome: 0, fuel: 0, upkeep: 0, rebuild: 0 },
    stats: { raids: 0, boardsLost: 0, instructions: 0, deploys: 0 },
    alerts: [],
    nextAlertId: 1,
    flags: {},
  };
}

export function findBoard(world: WorldState, id: string): BoardState | undefined {
  return world.boards.find((b) => b.id === id);
}

export function cellIndex(scenario: Scenario, x: number, y: number): number {
  return y * scenario.grid.width + x;
}

export function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

/** A firmware-supplied number as an integer; NaN and infinities become the fallback. */
export function toInt(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}
