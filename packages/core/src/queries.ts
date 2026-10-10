import { isCooling, isProcessing } from './datacenter.ts';
import { isRipe, ripeness } from './farm.ts';
import type { SensorValue } from './firmware-host.ts';
import { idiv, MICRO, MILLI } from './fixed.ts';
import { type PopulationCounts, populationCounts } from './housing.ts';
import { pathTo } from './luddites.ts';
import { facilityDemand, plantFacility, priorityOrder } from './power.ts';
import { type BoardKind, type FacilityKind, type Scenario, takesBoard } from './scenario.ts';
import { SENSOR_KEYS, sensorFrame } from './sensors.ts';
import { gameTime, stepsPerDay } from './time.ts';
import {
  type Alert,
  type AlertKind,
  type BoardState,
  type BoardStatus,
  type DatacenterState,
  type EndKind,
  type FacilityCondition,
  type FacilityState,
  type FarmState,
  type FirmwareImage,
  findBoard,
  findFacility,
  type LogLine,
  manhattan,
  type SimContext,
  type TruckStatus,
  type WorldState,
} from './world.ts';

export interface TimeView {
  readonly day: number;
  /** HH:MM within the day. */
  readonly clock: string;
  /** Game seconds since the season started. */
  readonly seconds: number;
}

export function timeView(scenario: Scenario, step: number): TimeView {
  const t = gameTime(scenario.time, step);
  return { day: t.day, clock: `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`, seconds: t.seconds };
}

/** 0: no board, worked by hand; 1: a board the player programs; 2: a board with a comm module, which an agent can program too. */
type Tier = 0 | 1 | 2;

function tierOf(board: BoardState | undefined): Tier {
  if (!board) return 0;
  return board.comm ? 2 : 1;
}

/**
 * Whether a board has power: it works, and the grid supplies it. The power phase skips a board that draws nothing, so a destroyed or
 * rebuilding board keeps the flag it had, which says nothing about it.
 */
function hasPower(b: BoardState): boolean {
  return b.powered && (b.status === 'running' || b.status === 'asleep');
}

/** Whether a facility has power: it stands, and the grid supplies it. A wrecked or repairing facility requests nothing, so its flag says nothing. */
function facilityPowered(f: FacilityState): boolean {
  return f.condition === 'ok' && f.powered;
}

/** Game hours, rounded down: what a repair or a rebuild takes, as the viewer's buttons show it. */
function hoursOf(scenario: Scenario, seconds: number): number {
  return idiv(seconds * 24, scenario.time.secondsPerDay);
}

/** The game hours a repair has left, rounded up, so that a repair with time left never reads 0 hours; null unless repairing. */
function repairHoursLeft(ctx: SimContext, f: FacilityState): number | null {
  if (f.condition !== 'repairing' || f.repairReadyAt === null) return null;
  const left = Math.max(0, f.repairReadyAt - ctx.world.step);
  const perDay = stepsPerDay(ctx.scenario.time);
  return idiv(left * 24 + perDay - 1, perDay);
}

/** Whole food units held in the town: the warehouses' stock, and what the housing blocks have left. */
function foodHeld(world: WorldState): { warehouse: number; housing: number } {
  let warehouse = 0;
  let housing = 0;
  for (const f of world.facilities) {
    const stock = world.warehouses[f.id];
    if (stock) warehouse += idiv(stock.stockMilli, MILLI);
    const home = world.housing[f.id];
    if (home) housing += idiv(home.foodMilli, MILLI);
  }
  return { warehouse, housing };
}

export interface BoardSummary {
  readonly id: string;
  readonly kind: BoardKind;
  readonly x: number;
  readonly y: number;
  readonly tier: Tier;
  readonly condition: FacilityCondition;
  /** The installed board; null at tier 0. */
  readonly board: {
    readonly status: BoardStatus;
    readonly powered: boolean;
    readonly firmwareVersion: number | null;
    readonly pendingVersion: number | null;
    readonly lastError: string | null;
  } | null;
}

/** Every facility that takes a board, in scenario order, with its board when one is installed. */
export function listBoards(world: WorldState): BoardSummary[] {
  const summaries: BoardSummary[] = [];
  for (const f of world.facilities) {
    const kind = f.kind;
    if (!takesBoard(kind)) continue;
    const b = findBoard(world, f.id);
    summaries.push({
      id: f.id,
      kind,
      x: f.x,
      y: f.y,
      tier: tierOf(b),
      condition: f.condition,
      board: b
        ? {
            status: b.status,
            powered: hasPower(b),
            firmwareVersion: b.firmware?.version ?? null,
            pendingVersion: b.pending?.version ?? null,
            lastError: b.lastTick?.error ? `${b.lastTick.error.kind}: ${b.lastTick.error.message}` : null,
          }
        : null,
    });
  }
  return summaries;
}

export interface FirmwareView {
  readonly version: number | null;
  readonly source: string | null;
  readonly pending: { readonly version: number; readonly source: string } | null;
}

export function firmwareView(world: WorldState, boardId: string): FirmwareView | null {
  const b = findBoard(world, boardId);
  if (!b) return null;
  return { version: b.firmware?.version ?? null, source: b.firmware?.source ?? null, pending: b.pending };
}

export interface LogView extends TimeView {
  readonly kind: LogLine['kind'];
  readonly text: string;
  readonly repeat: number;
}

export function logsView(ctx: SimContext, boardId: string, sinceSeconds?: number): LogView[] | null {
  const b = findBoard(ctx.world, boardId);
  if (!b) return null;
  return b.log
    .map((l) => ({ ...timeView(ctx.scenario, l.step), kind: l.kind, text: l.text, repeat: l.repeat }))
    .filter((l) => sinceSeconds === undefined || l.seconds > sinceSeconds);
}

export interface MapView {
  readonly width: number;
  readonly height: number;
  readonly facilities: ReadonlyArray<{
    readonly id: string;
    readonly kind: FacilityKind;
    readonly x: number;
    readonly y: number;
    readonly tier: Tier;
    readonly condition: FacilityCondition;
    readonly powered: boolean;
    readonly distanceToPlant: number;
  }>;
}

export function mapView(ctx: SimContext): MapView {
  const w = ctx.world;
  const plant = plantFacility(w);
  return {
    width: ctx.scenario.grid.width,
    height: ctx.scenario.grid.height,
    facilities: w.facilities.map((f) => ({
      id: f.id,
      kind: f.kind,
      x: f.x,
      y: f.y,
      tier: tierOf(findBoard(w, f.id)),
      condition: f.condition,
      powered: facilityPowered(f),
      distanceToPlant: manhattan(f.x, f.y, plant.x, plant.y),
    })),
  };
}

export interface StatusView {
  readonly time: TimeView;
  readonly seasonDays: number;
  /** Whole money units. */
  readonly money: number;
  readonly power: { readonly generation: number; readonly demand: number; readonly shed: readonly string[] };
  /** Whole food units: in the warehouse's stock, and left in the housing blocks. */
  readonly food: { readonly warehouse: number; readonly housing: number };
  /** The residents by how they stood at the last step: fed and powered, hungry, or fed but without power. */
  readonly population: PopulationCounts;
  /** How the season ended and when, in game time like `time` (a step means nothing to an agent); null while it goes on. */
  readonly ended: { readonly kind: EndKind; readonly time: TimeView } | null;
}

export function statusView(ctx: SimContext): StatusView {
  const w = ctx.world;
  return {
    time: timeView(ctx.scenario, w.step),
    seasonDays: ctx.scenario.time.seasonDays,
    money: idiv(w.money, MICRO),
    power: { generation: w.plant.generation, demand: w.plant.demand, shed: [...w.plant.shed] },
    food: foodHeld(w),
    population: populationCounts(ctx),
    ended: w.ended ? { kind: w.ended.kind, time: timeView(ctx.scenario, w.ended.step) } : null,
  };
}

export interface AlertView extends TimeView {
  readonly id: number;
  readonly kind: AlertKind;
  readonly facility: string | null;
  readonly message: string;
}

export function alertView(scenario: Scenario, a: Alert): AlertView {
  return { ...timeView(scenario, a.step), id: a.id, kind: a.kind, facility: a.facilityId, message: a.message };
}

export function alertsView(ctx: SimContext, sinceSeconds?: number): AlertView[] {
  return ctx.world.alerts.map((a) => alertView(ctx.scenario, a)).filter((a) => sinceSeconds === undefined || a.seconds > sinceSeconds);
}

/** One facility as the viewer's map draws it and its panel shows it. */
export interface FacilityView {
  readonly id: string;
  readonly kind: FacilityKind;
  readonly x: number;
  readonly y: number;
  readonly tier: Tier;
  readonly condition: FacilityCondition;
  /** Game hours until its repair is done, rounded up; null unless it is being repaired. */
  readonly repairHoursLeft: number | null;
  /** It stands, and the grid supplies it. */
  readonly powered: boolean;
  /** What it requests from the grid now, transmission loss included. */
  readonly demand: number;
  /** Its board; null at tier 0. */
  readonly board: {
    readonly status: BoardStatus;
    readonly powered: boolean;
    readonly hasFirmware: boolean;
    readonly erroring: boolean;
  } | null;
  /** Its temperature, and whether its job and its cooling cycle run now. The temperature reads ambient while the facility is down. */
  readonly datacenter: { readonly tempC: number; readonly processing: boolean; readonly cooling: boolean } | null;
  /** Its crop (0 to 100, and whether it is ripe) and the food in its outbox. The crop reads 0 and not ripe while the facility is down. */
  readonly farm: { readonly ripeness: number; readonly ripe: boolean; readonly outbox: number } | null;
  /** Whole food units in stock. */
  readonly warehouse: { readonly stock: number } | null;
  /** Whole food units left, its residents, and whether they ate at the last step. */
  readonly housing: { readonly food: number; readonly residents: number; readonly fed: boolean } | null;
}

/** Whether a facility is wrecked or being repaired. */
function isDown(f: FacilityState): boolean {
  return f.condition !== 'ok';
}

/**
 * A datacenter's temperature in milli-degrees, as the views read it. A wrecked or repairing facility is read as its repair will leave
 * it: nothing runs on it while it is down, so the world keeps the heat the wreck froze, and the repair resets it to ambient. Until then
 * the views read ambient, so that no frozen reading looks live.
 */
function temperatureMilli(ctx: SimContext, f: FacilityState, dc: DatacenterState): number {
  return isDown(f) ? ctx.scenario.tuning.datacenter.ambientMilli : dc.tempMilli;
}

/**
 * How far a farm's crop has grown, as the views read it. The same rule: a farm's repair plants a new crop, so the old planting the world
 * keeps would read as a crop that went on growing and is ripe. While the farm is down it reads 0, and not ripe. What a wreck leaves
 * alone is read as it is: a farm's outbox, a warehouse's stock, the food in a housing block.
 */
function cropOf(ctx: SimContext, f: FacilityState, farm: FarmState, step: number): { ripeness: number; ripe: boolean } {
  if (isDown(f)) return { ripeness: 0, ripe: false };
  return { ripeness: ripeness(ctx, farm, step), ripe: isRipe(ctx, farm, step) };
}

function facilityView(ctx: SimContext, f: FacilityState): FacilityView {
  const w = ctx.world;
  const step = w.step;
  const b = findBoard(w, f.id);
  const dc = w.datacenters[f.id];
  const farm = w.farms[f.id];
  const stock = w.warehouses[f.id];
  const home = w.housing[f.id];
  return {
    id: f.id,
    kind: f.kind,
    x: f.x,
    y: f.y,
    tier: tierOf(b),
    condition: f.condition,
    repairHoursLeft: repairHoursLeft(ctx, f),
    powered: facilityPowered(f),
    demand: facilityDemand(ctx, f, step),
    board: b
      ? {
          status: b.status,
          powered: hasPower(b),
          hasFirmware: b.firmware !== null || b.pending !== null,
          erroring: b.lastTick?.error != null,
        }
      : null,
    datacenter: dc
      ? { tempC: idiv(temperatureMilli(ctx, f, dc), MILLI), processing: isProcessing(ctx, f.id, step), cooling: isCooling(ctx, f.id, step) }
      : null,
    farm: farm ? { ...cropOf(ctx, f, farm, step), outbox: farm.outbox } : null,
    warehouse: stock ? { stock: idiv(stock.stockMilli, MILLI) } : null,
    housing: home ? { food: idiv(home.foodMilli, MILLI), residents: ctx.scenario.tuning.housing.residents, fed: home.fed } : null,
  };
}

/** Everything the viewer draws in one frame. */
export interface Snapshot {
  readonly step: number;
  readonly time: TimeView;
  readonly seasonDays: number;
  readonly money: number;
  readonly ended: WorldState['ended'];
  readonly grid: { readonly width: number; readonly height: number };
  /** What the player pays, in whole money units, and the game hours a repair and a rebuild take, rounded down. */
  readonly prices: {
    readonly board: Record<BoardKind, number>;
    readonly comm: number;
    readonly repair: Record<BoardKind, number>;
    readonly repairHours: number;
    readonly rebuild: number;
    readonly rebuildHours: number;
  };
  readonly plant: {
    readonly wind: number;
    readonly thermal: number;
    /** The highest thermal output the player can set. */
    readonly thermalMax: number;
    readonly fuelPrice: number;
    readonly generation: number;
    readonly demand: number;
    readonly shed: readonly string[];
    readonly priority: readonly string[];
  };
  /** Every facility, in scenario order. */
  readonly facilities: readonly FacilityView[];
  /** Every warehouse's trucks: where they are, what they carry, and where they are bound (null while idle). */
  readonly trucks: ReadonlyArray<{
    readonly warehouse: string;
    readonly id: number;
    readonly x: number;
    readonly y: number;
    readonly status: TruckStatus;
    readonly load: number;
    readonly targetId: string | null;
  }>;
  /** The top bar's figures: the food in the warehouse, in whole units, and the residents. */
  readonly town: { readonly food: number; readonly population: PopulationCounts };
  readonly luddites: ReadonlyArray<{
    readonly id: number;
    readonly x: number;
    readonly y: number;
    readonly size: number;
    readonly targetId: string | null;
    readonly leaving: boolean;
    readonly path: ReadonlyArray<readonly [number, number]>;
  }>;
  /** Whole EMF units per cell, row-major. */
  readonly emf: readonly number[];
}

export function snapshot(ctx: SimContext): Snapshot {
  const w = ctx.world;
  const s = w.step;
  const t = ctx.scenario.tuning;
  return {
    step: s,
    time: timeView(ctx.scenario, s),
    seasonDays: ctx.scenario.time.seasonDays,
    money: idiv(w.money, MICRO),
    ended: w.ended,
    grid: { ...ctx.scenario.grid },
    prices: {
      board: { ...t.install.boardPrice },
      comm: t.install.commPrice,
      repair: { ...t.repair.cost },
      repairHours: hoursOf(ctx.scenario, t.repair.seconds),
      rebuild: t.rebuild.cost,
      rebuildHours: hoursOf(ctx.scenario, t.rebuild.seconds),
    },
    plant: {
      wind: w.plant.wind,
      thermal: w.plant.thermalSetting,
      thermalMax: t.thermal.max,
      fuelPrice: w.plant.fuelPrice,
      generation: w.plant.generation,
      demand: w.plant.demand,
      shed: [...w.plant.shed],
      priority: priorityOrder(w).map((f) => f.id),
    },
    facilities: w.facilities.map((f) => facilityView(ctx, f)),
    trucks: w.facilities.flatMap((f) =>
      (w.warehouses[f.id]?.trucks ?? []).map((truck) => ({
        warehouse: f.id,
        id: truck.id,
        x: truck.x,
        y: truck.y,
        status: truck.status,
        load: truck.load,
        targetId: truck.job?.targetId ?? null,
      })),
    ),
    town: { food: foodHeld(w).warehouse, population: populationCounts(ctx) },
    luddites: w.luddites.map((g) => {
      const target = g.targetId === null ? undefined : findFacility(w, g.targetId);
      return {
        id: g.id,
        x: g.x,
        y: g.y,
        size: g.size,
        targetId: g.targetId,
        leaving: g.leaving,
        path: target ? pathTo(g.x, g.y, target.x, target.y) : [],
      };
    }),
    emf: w.emf.map((v) => idiv(v, MILLI)),
  };
}

/** The viewer's panel for a facility's board. */
export interface BoardInspection {
  /** The board's parts, and the RAM its last tick used (null before its first tick). */
  readonly parts: {
    readonly clockHz: number;
    readonly instructionsPerTick: number;
    readonly ramBytes: number;
    readonly ramUsedBytes: number | null;
  };
  /** What it gives off each second while it runs with power, a comm module's share included. */
  readonly baseEmfPerSecond: number;
  readonly firmware: FirmwareImage | null;
  readonly pending: FirmwareImage | null;
  readonly logs: readonly LogView[];
  /** What its firmware reads in io now; while its facility is down, the facility as the views read it (ambient, and no crop). */
  readonly sensors: Readonly<Record<string, SensorValue>>;
}

/**
 * A board's sensors as the panel shows them: what its firmware reads, except that a board whose facility is down reads that facility as
 * the views do (ambient, and no crop). A destroyed board runs no firmware, so only the panel sees the difference.
 */
function panelSensors(ctx: SimContext, board: BoardState): Record<string, SensorValue> {
  const sensors = sensorFrame(ctx, board);
  const facility = findFacility(ctx.world, board.id);
  if (facility && isDown(facility)) {
    if (SENSOR_KEYS.temp in sensors) sensors[SENSOR_KEYS.temp] = ctx.scenario.tuning.datacenter.ambientMilli / MILLI;
    if (SENSOR_KEYS.ripeness in sensors) sensors[SENSOR_KEYS.ripeness] = 0;
  }
  return sensors;
}

/** The board on a facility, for the panel; null for an id that names no installed board. */
export function inspectBoard(ctx: SimContext, boardId: string): BoardInspection | null {
  const board = findBoard(ctx.world, boardId);
  if (!board) return null;
  const spec = board.spec;
  return {
    parts: {
      clockHz: spec.clockHz,
      instructionsPerTick: spec.instructionCap,
      ramBytes: spec.ramKb * 1024,
      ramUsedBytes: board.lastTick?.ramUsedBytes ?? null,
    },
    baseEmfPerSecond: spec.baseEmfPerSecond + (board.comm ? ctx.scenario.tuning.install.commBaseEmfPerSecond : 0),
    firmware: board.firmware,
    pending: board.pending,
    logs: (logsView(ctx, boardId) ?? []).slice(-50),
    sensors: panelSensors(ctx, board),
  };
}
