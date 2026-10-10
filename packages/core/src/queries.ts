import { isProcessing } from './datacenter.ts';
import { type Datasheet, datasheet } from './datasheet.ts';
import { idiv, MICRO, MILLI } from './fixed.ts';
import { pathTo } from './luddites.ts';
import { facilityDemand, plantBoard, priorityOrder } from './power.ts';
import type { FacilityKind, Scenario } from './scenario.ts';
import { sensorFrame } from './sensors.ts';
import { gameTime } from './time.ts';
import {
  type Alert,
  type AlertKind,
  type BoardState,
  type BoardStatus,
  findBoard,
  type LogLine,
  manhattan,
  type SimContext,
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

/**
 * Whether a board has power: it works, and the grid supplies it. The power phase skips a board that draws nothing, so a destroyed or
 * rebuilding board keeps the flag it had, which says nothing about it.
 */
function hasPower(b: BoardState): boolean {
  return b.powered && (b.status === 'running' || b.status === 'asleep');
}

export interface BoardSummary {
  readonly id: string;
  readonly kind: FacilityKind;
  readonly x: number;
  readonly y: number;
  readonly status: BoardStatus;
  readonly powered: boolean;
  readonly firmwareVersion: number | null;
  readonly pendingVersion: number | null;
  readonly lastError: string | null;
}

export function listBoards(world: WorldState): BoardSummary[] {
  return world.boards.map((b) => ({
    id: b.id,
    kind: b.kind,
    x: b.x,
    y: b.y,
    status: b.status,
    powered: hasPower(b),
    firmwareVersion: b.firmware?.version ?? null,
    pendingVersion: b.pending?.version ?? null,
    lastError: b.lastTick?.error ? `${b.lastTick.error.kind}: ${b.lastTick.error.message}` : null,
  }));
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
    readonly status: BoardStatus;
    readonly powered: boolean;
    readonly distanceToPlant: number;
  }>;
}

export function mapView(ctx: SimContext): MapView {
  const plant = plantBoard(ctx.world);
  return {
    width: ctx.scenario.grid.width,
    height: ctx.scenario.grid.height,
    facilities: ctx.world.boards.map((b) => ({
      id: b.id,
      kind: b.kind,
      x: b.x,
      y: b.y,
      status: b.status,
      powered: hasPower(b),
      distanceToPlant: manhattan(b.x, b.y, plant.x, plant.y),
    })),
  };
}

export interface StatusView {
  readonly time: TimeView;
  readonly seasonDays: number;
  /** Whole money units. */
  readonly money: number;
  readonly power: { readonly generation: number; readonly demand: number; readonly shed: readonly string[] };
  readonly ended: WorldState['ended'];
}

export function statusView(ctx: SimContext): StatusView {
  const w = ctx.world;
  return {
    time: timeView(ctx.scenario, w.step),
    seasonDays: ctx.scenario.time.seasonDays,
    money: idiv(w.money, MICRO),
    power: { generation: w.plant.generation, demand: w.plant.demand, shed: [...w.plant.shed] },
    ended: w.ended,
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

/** Everything the viewer draws in one frame. */
export interface Snapshot {
  readonly step: number;
  readonly time: TimeView;
  readonly seasonDays: number;
  readonly money: number;
  readonly ended: WorldState['ended'];
  readonly grid: { readonly width: number; readonly height: number };
  /** What rebuilding a destroyed board costs, in whole money units, and how many game hours it takes. */
  readonly rebuild: { readonly cost: number; readonly hours: number };
  readonly plant: {
    readonly wind: number;
    readonly thermal: number;
    readonly fuelPrice: number;
    readonly generation: number;
    readonly demand: number;
    readonly shed: readonly string[];
    readonly priority: readonly string[];
  };
  readonly boards: ReadonlyArray<{
    readonly id: string;
    readonly kind: FacilityKind;
    readonly x: number;
    readonly y: number;
    readonly status: BoardStatus;
    readonly powered: boolean;
    readonly hasFirmware: boolean;
    readonly erroring: boolean;
    readonly tempC: number | null;
    readonly processing: boolean;
    readonly cooling: number;
    readonly demand: number;
  }>;
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
  return {
    step: s,
    time: timeView(ctx.scenario, s),
    seasonDays: ctx.scenario.time.seasonDays,
    money: idiv(w.money, MICRO),
    ended: w.ended,
    grid: { ...ctx.scenario.grid },
    rebuild: {
      cost: ctx.scenario.tuning.rebuild.cost,
      hours: idiv(ctx.scenario.tuning.rebuild.seconds * 24, ctx.scenario.time.secondsPerDay),
    },
    plant: {
      wind: w.plant.wind,
      thermal: w.plant.thermalSetting,
      fuelPrice: w.plant.fuelPrice,
      generation: w.plant.generation,
      demand: w.plant.demand,
      shed: [...w.plant.shed],
      priority: priorityOrder(w).map((b) => b.id),
    },
    boards: w.boards.map((b) => {
      const dc = w.datacenters[b.id];
      return {
        id: b.id,
        kind: b.kind,
        x: b.x,
        y: b.y,
        status: b.status,
        powered: hasPower(b),
        hasFirmware: b.firmware !== null || b.pending !== null,
        erroring: b.lastTick?.error != null,
        tempC: dc ? idiv(dc.tempMilli, MILLI) : null,
        processing: dc ? isProcessing(ctx, b.id, s) : false,
        cooling: dc?.cooling ?? 0,
        demand: facilityDemand(ctx, b, s),
      };
    }),
    luddites: w.luddites.map((g) => {
      const target = g.targetId === null ? undefined : findBoard(w, g.targetId);
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

/** The viewer's panel for one board. */
export interface BoardInspection {
  readonly datasheet: Datasheet;
  readonly firmware: { readonly version: number; readonly source: string } | null;
  readonly pending: FirmwareView['pending'];
  readonly logs: readonly LogView[];
  readonly sensors: Readonly<Record<string, number | undefined>>;
}

export function inspectBoard(ctx: SimContext, boardId: string): BoardInspection | null {
  const board = findBoard(ctx.world, boardId);
  const sheet = datasheet(ctx, boardId);
  if (!board || !sheet) return null;
  return {
    datasheet: sheet,
    firmware: board.firmware,
    pending: board.pending,
    logs: (logsView(ctx, boardId) ?? []).slice(-50),
    sensors: sensorFrame(ctx, board),
  };
}
