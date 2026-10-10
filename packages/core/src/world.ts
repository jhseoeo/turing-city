import type { FirmwareHost, TickError } from './firmware-host.ts';
import { MICRO, MILLI } from './fixed.ts';
import type { Rng } from './rng.ts';
import type { BoardKind, BoardSpec, FacilityKind, FacilitySpec, Scenario } from './scenario.ts';
import { beatPeriod } from './time.ts';

export type BoardStatus = 'running' | 'asleep' | 'destroyed' | 'rebuilding';

/** A facility works (ok), lies wrecked by Luddites or fire, or is being repaired. */
export type FacilityCondition = 'ok' | 'wrecked' | 'repairing';

/** Every facility of the scenario, with a board or not: the town the player works by hand. */
export interface FacilityState {
  readonly id: string;
  /** Position in the scenario's facility list: board phases and the default priority use it. */
  readonly index: number;
  readonly kind: FacilityKind;
  readonly x: number;
  readonly y: number;
  /** The board this facility takes, from the scenario; null for housing. */
  readonly boardSpec: BoardSpec | null;
  condition: FacilityCondition;
  /** The step a repair finishes; null unless repairing. */
  repairReadyAt: number | null;
  /** Whether the grid supplies the facility this step (set by the power phase; always true for the plant). */
  powered: boolean;
}

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

/** An installed board. It exists only once the player installed it (or the scenario says startsInstalled). */
export interface BoardState {
  /** Its facility's id. */
  readonly id: string;
  /** Its facility's position in the scenario's facility list. */
  readonly index: number;
  readonly kind: BoardKind;
  readonly spec: BoardSpec;
  readonly x: number;
  readonly y: number;
  /** Steps between beats. */
  readonly period: number;
  readonly phase: number;
  status: BoardStatus;
  /** Whether the board's facility got power this step (set by the power phase). */
  powered: boolean;
  /**
   * The last step at which the board was without power while it worked, kept until its "power back" line is logged (that comes only
   * after the quiet time) or until it is smashed. Null when no such line is owed.
   */
  lastCutStep: number | null;
  /** A comm module is mounted: the board is T2, and an agent connected over MCP can reach it. */
  comm: boolean;
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
  /** Processing covers steps busyFrom <= step < busyUntil. */
  busyFrom: number;
  busyUntil: number;
  /**
   * Cooling covers steps coolFrom <= step < coolUntil. The window may hold back-to-back cycles, each coolSteps long from coolFrom: a
   * press at the step after a cycle's last goes on with it. Its length is a whole number of cycles.
   */
  coolFrom: number;
  coolUntil: number;
}

export interface FarmState {
  /** The step the current crop was planted; it is ripe from plantedAt + ripen steps and rots ripen + rot steps after planting. */
  plantedAt: number;
  /** Whole food units waiting for a truck. */
  outbox: number;
}

export type TruckStatus = 'idle' | 'outbound' | 'returning';

export interface TruckJob {
  readonly kind: 'collect' | 'deliver';
  readonly targetId: string;
  readonly amount: number;
}

export interface TruckState {
  /** 1-based. */
  readonly id: number;
  status: TruckStatus;
  job: TruckJob | null;
  /** The cells of the current leg, in order, not counting the cell it starts from. */
  path: Array<[number, number]>;
  /** Cells of `path` already entered. */
  cellsDone: number;
  /** The step the current leg started. */
  legFrom: number;
  x: number;
  y: number;
  /** Whole food units aboard. */
  load: number;
}

export interface WarehouseState {
  stockMilli: number;
  trucks: TruckState[];
}

export interface HousingState {
  foodMilli: number;
  /** Whether its residents ate at the last step. */
  fed: boolean;
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
  tax: number;
  /** Thermal fuel. */
  fuel: number;
  truckFuel: number;
  upkeep: number;
  installs: number;
  repairs: number;
  rebuild: number;
}

export interface Stats {
  raids: number;
  /** Facilities wrecked by Luddites or fire. */
  wrecks: number;
  instructions: number;
  deploys: number;
  /** Actions the player took by hand. */
  handActions: number;
}

/** How a season ends. There is no fall: a wrecked town can be repaired as long as the money lasts. */
export type EndKind = 'completed' | 'bankrupt';

/** Every kind of alert. Whatever names a kind from outside (the dev tools, the viewer's auto-pause) refuses any other. */
export const ALERT_KINDS = [
  'raid',
  'ludditesNear',
  'wrecked',
  'fire',
  'overheat',
  'powerShortage',
  'hunger',
  'firmwareError',
  'moneyBelowZero',
  'seasonEnd',
  // Raised by the server's controller when the player's agent drops, never by core.
  'agentLost',
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
  /** Every facility, in scenario order. */
  facilities: FacilityState[];
  /** Installed boards, kept in scenario (facility index) order whatever order they were installed in. */
  boards: BoardState[];
  plant: PlantState;
  datacenters: Record<string, DatacenterState>;
  farms: Record<string, FarmState>;
  warehouses: Record<string, WarehouseState>;
  housing: Record<string, HousingState>;
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

/** A new board for a facility: running, with no firmware. Its beat's phase is its facility's index, as every board's is. */
export function createBoard(scenario: Scenario, facility: FacilitySpec, index: number): BoardState {
  if (facility.board === null || facility.kind === 'housing') throw new Error(`${facility.id} takes no board`);
  const period = beatPeriod(scenario.time, facility.board.clockHz);
  return {
    id: facility.id,
    index,
    kind: facility.kind,
    spec: facility.board,
    x: facility.x,
    y: facility.y,
    period,
    phase: index % period,
    status: 'running',
    powered: true,
    lastCutStep: null,
    comm: false,
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
}

export function createWorld(scenario: Scenario): WorldState {
  const t = scenario.tuning;
  const facilities = scenario.facilities.map(
    (f, index): FacilityState => ({
      id: f.id,
      index,
      kind: f.kind,
      x: f.x,
      y: f.y,
      boardSpec: f.board,
      condition: 'ok',
      repairReadyAt: null,
      powered: true,
    }),
  );
  const boards = scenario.facilities.flatMap((f, index) => (f.board?.startsInstalled ? [createBoard(scenario, f, index)] : []));
  const datacenters: Record<string, DatacenterState> = {};
  const farms: Record<string, FarmState> = {};
  const warehouses: Record<string, WarehouseState> = {};
  const housing: Record<string, HousingState> = {};
  for (const f of scenario.facilities) {
    if (f.kind === 'datacenter') {
      datacenters[f.id] = { tempMilli: t.datacenter.ambientMilli, busyFrom: -1, busyUntil: -1, coolFrom: -1, coolUntil: -1 };
    } else if (f.kind === 'farm') {
      farms[f.id] = { plantedAt: 0, outbox: 0 };
    } else if (f.kind === 'warehouse') {
      const trucks = Array.from(
        { length: t.warehouse.trucks },
        (_, i): TruckState => ({ id: i + 1, status: 'idle', job: null, path: [], cellsDone: 0, legFrom: 0, x: f.x, y: f.y, load: 0 }),
      );
      warehouses[f.id] = { stockMilli: 0, trucks };
    } else if (f.kind === 'housing') {
      housing[f.id] = { foodMilli: t.housing.startFood * MILLI, fed: true };
    }
  }
  return {
    step: 0,
    money: scenario.startMoney * MICRO,
    belowZeroSince: null,
    ended: null,
    facilities,
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
    farms,
    warehouses,
    housing,
    jobPrice: t.jobPrice.start,
    emf: new Array<number>(scenario.grid.width * scenario.grid.height).fill(0),
    rumour: 0,
    luddites: [],
    nextLudditeId: 1,
    ledger: { datacenterIncome: 0, tax: 0, fuel: 0, truckFuel: 0, upkeep: 0, installs: 0, repairs: 0, rebuild: 0 },
    stats: { raids: 0, wrecks: 0, instructions: 0, deploys: 0, handActions: 0 },
    alerts: [],
    nextAlertId: 1,
    flags: {},
  };
}

export function findFacility(world: WorldState, id: string): FacilityState | undefined {
  return world.facilities.find((f) => f.id === id);
}

/** An installed board; undefined for a facility without one (T0, or housing) and for an unknown id. */
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
