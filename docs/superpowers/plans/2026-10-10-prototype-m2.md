# Prototype milestone 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build milestone 2 of the prototype, the early stage. The whole small town (farms, the warehouse and its trucks, housing, the power plant, two datacenters) starts with no boards, and the player works it by hand. Buying a board (T1) lets firmware written in the game's own editor take a facility over, guided by a dense board manual. Buying a comm module (T2) lets the player's agent take the board over by MCP.

**Architecture:** The milestone-1 workspace grows.
- **`core`** gains:
  - facilities that exist with or without a board;
  - installs, repairs, and the player's hand actions, recorded like deploys;
  - the datacenter's 0.5 s jobs and cooling cycles;
  - farms, the warehouse with its trucks, and housing;
  - EMF from busy datacenters, and Luddites that wreck whole facilities;
  - a markdown manual generated from the scenario.
- **`firmware`** writes structured sensors (lists and records) into `io`, and gains the farm's and the warehouse's actions.
- **`server`**:
  - the worker and the controller take the player's new commands;
  - MCP's board tools reach only T2 boards;
  - the viewer socket carries deploys from the editor.
- **`viewer`** draws the whole town and the panel's hand controls, and adds a manual window and a CodeMirror editor that survive the 20 snapshots a second.

**Tech Stack:** As milestone 1, with the same exact versions: Node 24.0.1, pnpm 10.30.3, TypeScript 7.0.2, Vitest 5.0.3, Biome 2.5.15, zod 4.6.5, wasmoon 1.16.0, @modelcontextprotocol/sdk 1.32.1, ws 8.22.0, Vite 8.3.4, Phaser 4.2.1, and playwright-core 1.64.0. New in the viewer: codemirror 6.0.2, @codemirror/language 6.13.1, @codemirror/legacy-modes 6.5.5, @codemirror/state 6.7.6, and @codemirror/view 6.43.14.

**Spec:**
- **`docs/superpowers/specs/2026-10-10-early-stage-design.md`** (the "10-10 spec"). It changes `docs/superpowers/specs/2026-10-09-prototype-design.md` (the "10-09 spec"), which stays the reference for everything the 10-10 spec leaves alone.
- **The game design** is in `docs/design.md`.
- **Base:** main at 8587077, milestone 1 with 552 tests.

**How this plan was made.** Five drafts were written in parallel against main 8587077 and the shared interfaces below, then reconciled. How much of it ran:
- **Tasks 1 to 4** ran on a scratch copy of main, each passing `pnpm check`: 559, 583, 594, and 605 tests.
- **Tasks 10 to 12** ran only in part:
  - task 12's VM tests ran against a copy of the VM;
  - task 11's manual tests ran against stand-in core modules.
- **Task 21's script** typechecked against stubs of the new API.
- **Everything else** was written without running.

Where drafts overlapped or a decision came later, the affected task opens with **"Corrections from assembling the plan (read first)"**. Those notes override the task's own text. Where a step still fails or misleads, the implementer stops and reports (NEEDS_CONTEXT, or DONE_WITH_CONCERNS with the exact output) rather than improvising a different design.

**Three decisions made while assembling** (in the shared interfaces):
- **D1. Hand actions apply at once,** between steps, with no queue, so a paused game shows them.
- **D2. The town's starting tuning** lets its economy run: crops ripen in a day for 40 food, cooling draws 250, a raid needs 200,000 of rumour, and each home starts with 120 food.
- **D3. `ControllerStatus.season`** counts seasons, so the viewer knows when a new one starts.

## Global Constraints

- **Imports and syntax.** Imports inside the workspace carry the `.ts` suffix, and code uses only erasable TypeScript syntax (no `enum`, `namespace`, or constructor parameter properties). Node runs the server's worker thread with its own type stripping, which needs both.
- **`core`'s purity.**
  - It uses no Node and no DOM API.
  - It holds every quantity as an integer: money in micro-units; temperature, EMF, and warehouse and housing food in milli-units.
  - It draws randomness only from its seeded streams: no `Math.random`, `Date.now`, or timers.
  - `firmware`'s `src` uses no Node API.
- **Determinism.**
  - The same scenario, seed, and recorded inputs give the same `stateHash` at every step. The inputs are deploys, installs, repairs, rebuilds, hand actions, pauses, and resumes.
  - Only `Session.step()` touches a board's Lua state.
  - One `WasmoonHost` serves one session.
  - Deploy-time syntax checks run in a separate runtime (`SyntaxChecker`).
- **Tuning numbers come from the scenario.** Every number that tunes the game is read from the scenario file, never hard-coded. Runtime and transport limits (log length, firmware size, alerts shown, the watchdog, the MCP port, pings, the socket's message size) are constants in the code that enforces them.
- **The firmware sandbox** is unchanged from milestone 1 (10-09 §6.5). Structured sensors are written by the host outside the step, as the milestone-1 sensors were.
- **Nothing a client sends may crash the game server.**
  - Every HTTP handler turns errors into responses.
  - Every WebSocket has an `error` listener.
  - The viewer socket accepts only exact commands and answers anything else with `badCommand`.
- **MCP security** is unchanged (10-09 §7.1): 127.0.0.1, a bearer token, any `Origin` refused, and firmware source at most 64 KB. Board tools reach only T2 boards.
- **Time.** In the user's language, time is seconds, hours, and days. "Step" is the world's unit and "tick" a board's beat.
- **Language.**
  - Game text the player reads is Korean: alerts, the viewer, and the board manual.
  - Logs, errors, agent-tool keys, and code identifiers are English.
- **Before each commit:** `pnpm fix`, then `pnpm check` passes. Commit messages claim only what was verified, and end with the trailer lines the dispatch gives.
- **A known flake.** On a loaded machine, `packages/server/test/main.test.ts`'s tests can pass Vitest's 5 s timeout: they start Node processes. On 2026-10-10, "says in one line when --port is not a port" took 6.7 s at a load average of 13, then passed alone. Rerun the file alone before treating such a timeout as a failure.
- **Out of scope for milestone 2:**
  - firmware at T0 and `io.notify`;
  - tiers past T2;
  - fuel as a stock;
  - the season wrap-up's breakdown and past seasons;
  - and, as in milestone 1, the Electron shell, art, research, part assembly, and the news feed.

## Review Focus

These are the five input classes or failure modes the spec implies but no single task's unit tests exercise. They are the most likely to bite the person playing. Each line names the test that pins it.

1. **The editor keeps the player's text.** Snapshots arrive 20 times a second while the clock runs, and the milestone-1 screens rebuild their DOM on each one. The editor window must be mounted once and never rebuilt by a snapshot. A half-typed firmware survives a running game, a selection change, and closing and reopening the window for the same board. Test: Task 21's "the editor keeps its text while the game runs".
2. **The game's keys stay quiet while the player types.** Typing `1`, `2`, `3`, `h`, or a space in the editor must not change the speed, toggle the heatmap, or pause the game. Escape in the editor closes nothing but the editor. Test: Task 21's "the game's keys do nothing while the editor has the focus: they type into the code", and its Escape checks.
3. **A hand and firmware act on the same thing.** The hand applies at once, between steps. Firmware acting in the coming step comes later, so it wins that step, deterministically, and replays keep the order. Tests: Task 4's "lets the last writer win, in the order things happen: the hand after a tick, and the next tick after the hand", and Task 16's replay with hand actions.
4. **A full-size deploy from the editor.** A 64 KB firmware with Korean comments (up to 3 bytes per character, more when JSON escapes it) must reach the server without closing the socket. A source over the limit is refused with a reason, not a dropped connection. Test: Task 15's "accepts a 64 KB deploy with Korean text and refuses a larger one".
5. **The agent cannot drive a board below T2.** The agent's deploy, `get_firmware`, `read_logs`, and `get_datasheet` to a T0 or T1 board are refused with the comm-module message, and the player's own deploy to a T1 board works. Tests: Task 13's gating test, and Task 14's MCP round trip.

## Task order

| # | Task | Package |
|---|---|---|
| 1 | The scenario format for the whole town, and `scenarios/m2-town.json` | core |
| 2 | Facilities, installed boards, and installs | core |
| 3 | The board is only automation: sleep, shedding, wrecks, repairs, rebuilds, and the endings | core |
| 4 | Facility actions from firmware and from the player's hand | core |
| 5 | Datacenters by hand and by firmware: jobs, cooling cycles, heat | core |
| 6 | EMF from boards and busy datacenters; Luddites hunt machines | core |
| 7 | Farms | core |
| 8 | The warehouse and its trucks | core |
| 9 | Housing: food, power, tax, hunger | core |
| 10 | Views and the snapshot for the whole town; the agent tools at T2 | core |
| 11 | The board manual | core |
| 12 | Firmware: structured sensors and the new actions | firmware |
| 13 | The worker and the controller: the player's commands, deploys by player or agent, no agent rule | server |
| 14 | MCP: board tools at T2, the manual as the datasheet, dev tools for the hand | server |
| 15 | The viewer hub: the new commands, and hello with the scenario | server |
| 16 | Seasons with installs, reference firmware for the town, season checks, `pnpm sim --install` | core, server |
| 17 | Viewer: store, start screen, guide card, top bar, feed, refusals | viewer |
| 18 | Viewer: the map of the whole town | viewer |
| 19 | Viewer: the panel and its hand controls | viewer |
| 20 | Viewer: the manual window and the editor | viewer |
| 21 | Headless screenshots for milestone 2 | server, viewer |
| 22 | Milestone 2: docs and the playtest checklist | docs |

## Shared interfaces

Every task uses these names, types, and files exactly. A task that needs more adds it in its own module and lists it under its own "Produces".


This is the binding contract for the milestone-2 plan (`docs/superpowers/plans/2026-10-10-prototype-m2.md`). Every task's code uses these names, types, and files exactly. A task that needs something not here adds it in its own module and lists it under its own "Produces"; it never renames or reshapes what is here.

Spec: `docs/superpowers/specs/2026-10-10-early-stage-design.md` (the "10-10 spec"), over `docs/superpowers/specs/2026-10-09-prototype-design.md` (the "10-09 spec"). Base: main at 8587077 (milestone 1, 552 tests).

## 0. Conventions kept from milestone 1

- **Imports and syntax:**
  - Imports carry `.ts`.
  - Only erasable TypeScript syntax.
  - `core` uses no Node or DOM API. Its quantities are integers: money in micro-units (`MICRO`), temperature, EMF, and food in milli-units (`MILLI`).
  - Randomness comes only from the seeded streams.
- **Tuning numbers come from the scenario.** Runtime and transport limits are code constants.
- **Game text the player reads is Korean:** alerts, the viewer, and now the board manual. Logs, errors, and identifiers are English.
- **Determinism.** The same scenario, seed, and recorded inputs give the same `stateHash` at every step. `stateHash` serializes the whole `WorldState`, so every new field is hashed by construction.

## 1. The scenario (core/src/scenario.ts)

```ts
export const FACILITY_KINDS = ['power', 'datacenter', 'farm', 'warehouse', 'housing'] as const;
export type FacilityKind = (typeof FACILITY_KINDS)[number];
/** The kinds that take a board: every kind but housing. */
export const BOARD_KINDS = ['power', 'datacenter', 'farm', 'warehouse'] as const;
export type BoardKind = (typeof BOARD_KINDS)[number];
export function takesBoard(kind: FacilityKind): kind is BoardKind; // kind !== 'housing'

export const ALL_SENSORS = [
  'wind', 'demand', 'fuelPrice',                                  // power
  'temp', 'powerHeadroom', 'price', 'emf', 'ludditeDist',          // datacenter
  'ripeness', 'outbox',                                            // farm
  'stock', 'farms', 'housing', 'trucks',                           // warehouse
] as const;
export type SensorName = (typeof ALL_SENSORS)[number];
export const SENSORS_BY_KIND: Record<BoardKind, readonly SensorName[]>;
```

**A facility.** It is `{ id, kind, x, y, board }`, where `board` is a `BoardSchema` object for a board kind and `null` for housing (validated). `BoardSchema` gains one optional field:
- `startsInstalled?: boolean` (default `false`): the board is installed at step 0, for test scenarios.
- The game's scenario (`m2-town.json`) sets it nowhere. The test scenario `m1-power.json` sets it on its three boards, so milestone-1 tests keep their boards.

**`TuningSchema`, milestone 2.** Every key is required. The values below are `scenarios/m2-town.json`'s; `m1-power.json` carries the same keys.

```jsonc
"tuning": {
  "transmissionLossPctPerCell": 2,
  "shortageQuietSeconds": 10,
  "wind": { "max": 220, "start": 120, "maxChangePerSecond": 8 },
  "thermal": { "max": 300 },
  "fuelPrice": { "start": 7, "min": 5, "max": 9 },
  "jobPrice": { "start": 40, "min": 15, "max": 80, "maxChangePerSecond": 2 },
  "datacenter": {
    "processPower": 150,
    "ambientMilli": 25000,
    "heatMilliPerSecond": 2000,
    "passiveCoolingPermillePerSecond": 3,
    "jobMs": 500,
    "coolingCycleMs": 4000,
    "coolingDropMilli": 15000,
    "coolingPower": 250,
    "overheatAlertMilli": 85000,
    "fireThresholdMilli": 90000,
    "firePermillePerDegreePerSecond": 5
  },
  "farm": { "ripenSeconds": 40, "rotSeconds": 20, "yield": 40, "outboxCapacity": 80 },
  "warehouse": { "trucks": 2, "truckCapacity": 40, "truckCellsPerSecond": 2, "fuelPerCell": 1, "spoilagePctPerDay": 2 },
  "housing": { "residents": 40, "foodPerPersonPerDay": 1, "power": 70, "taxPerPersonPerDay": 5, "startFood": 120 },
  "boardUpkeepPerDay": 10,
  "sleepPower": 1,
  "maxSleepSeconds": 40,
  "emf": {
    "instructionsPerUnit": 100, "perAction": 10, "processingPerSecond": 50,
    "diffusionPctPerSecond": 10, "decayPctPerSecond": 10, "detectionThreshold": 5, "rumourThreshold": 200000
  },
  "luddites": { "groupSize": 3, "cellsPerSecond": 1, "quietSecondsToLeave": 10, "approachCells": 5 },
  "install": { "boardPrice": { "farm": 200, "warehouse": 400, "power": 400, "datacenter": 600 }, "commPrice": 300, "commBaseEmfPerSecond": 5 },
  "repair": { "cost": { "farm": 150, "warehouse": 300, "power": 300, "datacenter": 500 }, "seconds": 20 },
  "rebuild": { "cost": 500, "seconds": 20 },
  "bankruptcyDays": 3
}
```

**Removed from milestone 1:** `datacenter.passiveCoolingPctPerSecond`, `coolingMilliPerLevelPerSecond`, `coolingPowerPerLevel`, and `maxCoolingLevel`.

**Added validation (superRefine):**
- `jobMs` and `coolingCycleMs` must each give a whole number of steps: `ms * stepsPerSecond % 1000 === 0`.
- `stepsPerSecond % truckCellsPerSecond === 0`.
- Housing has `board: null`; every other kind has a board.
- At most one warehouse; exactly one power plant (as now).

**`scenarios/m2-town.json`** (`"id": "m2-town"`, `"name": "작은 마을"`) uses the 10-09 §9 map: a 20 × 12 grid, `startMoney` 5000, and the facilities in this order:

| id | kind | x, y | board |
|---|---|---|---|
| H1 | housing | 2, 1 | null |
| H2 | housing | 17, 1 | null |
| P | power | 4, 4 | clock 4, cap 1500, ram 4, sensors wind demand fuelPrice, power 5, base EMF 20 |
| DA | datacenter | 5, 4 | clock 5, cap 2000, ram 8, sensors temp powerHeadroom price emf ludditeDist, power 10, base EMF 25 |
| W | warehouse | 11, 6 | clock 2, cap 3000, ram 16, sensors stock farms housing trucks, power 8, base EMF 15 |
| DB | datacenter | 16, 8 | as DA |
| F1 | farm | 2, 9 | clock 1, cap 500, ram 2, sensors ripeness outbox, power 3, base EMF 10 |
| F2 | farm | 3, 9 | as F1 |
| F3 | farm | 4, 9 | as F1 |

**`scenarios/m1-power.json`** stays as the small test scenario: P, DA, DB with `startsInstalled: true` and the full milestone-2 tuning.

**Helpers.**
- `packages/core/test/helpers/scenarios.ts` keeps `m1Scenario(change?)` and adds `m2Scenario(change?)`, same shape.
- The game server's default scenario becomes `scenarios/m2-town.json`, and so does `pnpm sim`'s.

## 2. The world (core/src/world.ts)

```ts
export type FacilityCondition = 'ok' | 'wrecked' | 'repairing';

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

export type BoardStatus = 'running' | 'asleep' | 'destroyed' | 'rebuilding';

/** An installed board. It exists only once the player installed it (or the scenario says startsInstalled). */
export interface BoardState {
  readonly id: string;            // the facility's id
  readonly index: number;         // the facility's index
  readonly kind: BoardKind;
  readonly spec: BoardSpec;
  readonly x: number;
  readonly y: number;
  readonly period: number;
  readonly phase: number;         // index % period, as in milestone 1
  status: BoardStatus;
  powered: boolean;               // mirrors its facility's flag, for its own log and ticks
  lastCutStep: number | null;
  /** A comm module is mounted: T2. */
  comm: boolean;
  vmBooted: boolean;
  bootCount: number;
  firmware: FirmwareImage | null;
  pending: FirmwareImage | null;
  nextVersion: number;
  wakeAt: number | null;
  readyAt: number | null;         // a board rebuild finishes
  lastTick: { step: number; instructions: number; actions: number; ramUsedBytes: number; error: TickError | null } | null;
  log: LogLine[];
}

export interface DatacenterState {
  tempMilli: number;
  /** Processing covers steps busyFrom <= step < busyUntil. */
  busyFrom: number;
  busyUntil: number;
  /** A cooling cycle covers steps coolFrom <= step < coolUntil. */
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
export interface TruckJob { readonly kind: 'collect' | 'deliver'; readonly targetId: string; readonly amount: number }
export interface TruckState {
  readonly id: number;            // 1-based
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

export interface Ledger {           // micro-units
  datacenterIncome: number;
  tax: number;
  fuel: number;                     // thermal fuel
  truckFuel: number;
  upkeep: number;
  installs: number;
  repairs: number;
  rebuild: number;
}

export interface Stats { raids: number; wrecks: number; instructions: number; deploys: number; handActions: number }

export type EndKind = 'completed' | 'bankrupt';   // the fall is gone (10-10 §7)

export const ALERT_KINDS = [
  'raid', 'ludditesNear', 'wrecked', 'fire', 'overheat', 'powerShortage', 'hunger',
  'firmwareError', 'moneyBelowZero', 'seasonEnd', 'agentLost',
] as const;
// 'boardDestroyed' is renamed 'wrecked'. 'agentLost' is raised by the server's controller, never by core.

export interface WorldState {
  step: number;
  money: number;
  belowZeroSince: number | null;
  ended: { kind: EndKind; step: number } | null;
  /** Every facility, in scenario order. */
  facilities: FacilityState[];
  /** Installed boards, kept in scenario (facility index) order whatever order they were installed in. */
  boards: BoardState[];
  plant: PlantState;              // unchanged from milestone 1
  datacenters: Record<string, DatacenterState>;
  farms: Record<string, FarmState>;
  warehouses: Record<string, WarehouseState>;
  housing: Record<string, HousingState>;
  /** Hand actions the player queued since the last step, applied in the next step's phase 5 after the firmware's. */
  // No hand queue: a hand action applies at once (§4, decision D1).
  jobPrice: number;
  emf: number[];
  rumour: number;
  luddites: LudditeGroup[];       // LudditeGroup.targetId now names a facility
  nextLudditeId: number;
  ledger: Ledger;
  stats: Stats;
  alerts: Alert[];
  nextAlertId: number;
  flags: Record<string, true>;
}

export function findFacility(world: WorldState, id: string): FacilityState | undefined;
export function findBoard(world: WorldState, id: string): BoardState | undefined;   // as now: installed boards only
// plantFacility(world) lives in power.ts (§7).
```

**`createWorld(scenario)`** builds:
- every facility, with `condition` `ok`, `powered` `true`, and `repairReadyAt` `null`;
- a board for each facility whose spec says `startsInstalled`;
- `datacenters[id]` for each datacenter: `{ tempMilli: ambient, busyFrom: -1, busyUntil: -1, coolFrom: -1, coolUntil: -1 }`;
- `farms[id]` for each farm: `{ plantedAt: 0, outbox: 0 }`;
- `warehouses[id]` for each warehouse: `{ stockMilli: 0, trucks }`, with `tuning.warehouse.trucks` idle trucks at the warehouse's cell, ids 1..n;
- `housing[id]` for each housing block: `{ foodMilli: 0, fed: true }`;
- each housing block starts with `foodMilli = tuning.housing.startFood * MILLI`.

## 3. Actions (core/src/firmware-host.ts)

```ts
export type FacilityAction =
  | { readonly kind: 'process' }
  | { readonly kind: 'cool' }                                            // no level: one cooling cycle (10-10 §4.3)
  | { readonly kind: 'setThermal'; readonly output: number }
  | { readonly kind: 'setPriority'; readonly order: readonly string[] }
  | { readonly kind: 'harvest' }
  | { readonly kind: 'dispatch'; readonly truck: number; readonly from: string; readonly to: string; readonly amount: number };

/** What firmware can ask for: the facility actions, plus sleep. */
export type Action = FacilityAction | { readonly kind: 'sleep'; readonly seconds: number };

/** The actions that count toward a board's action EMF (machine labor): all but process and sleep (10-10 §5). */
export function countsAsAction(kind: Action['kind']): boolean;

/** A sensor value as firmware sees it in io: numbers, strings, lists, and records of them. */
export type SensorValue = number | string | undefined | readonly SensorValue[] | { readonly [key: string]: SensorValue };
export interface TickInput {
  readonly sensors: Readonly<Record<string, SensorValue>>;
  readonly newSource: string | null;
}
```

**`BootInfo`** is unchanged, apart from `kind: BoardKind`.

## 4. Applying actions (core/src/actions.ts)

```ts
/**
 * Applies one facility action, from firmware or from the player's hand. startStep is the first step it affects: the hand acts between
 * steps, at world.step (decision D1: at once, no queue), and firmware acts in phase 5 of step s, so its startStep is s + 1. Invalid ones do nothing.
 */
export function applyFacilityAction(ctx: SimContext, facility: FacilityState, action: FacilityAction, startStep: number): void;
/** Why an action is not its facility's kind's ("P: process is a datacenter's action"), or null. */
export function kindProblem(facility: FacilityState, action: FacilityAction): string | null;
/** Phase 5: every ticked board's actions, with startStep = step + 1 (a sleep stops the rest of its list). */
export function applyActions(ctx: SimContext, step: number, ticked: readonly Ticked[]): void;
```

**A wrecked facility ignores every action.** The kinds act like this:

| Action | Facility kind | What it does |
|---|---|---|
| `process` | datacenter | `dc.busyFrom = (busyFrom <= startStep && startStep < busyUntil) ? busyFrom : startStep; dc.busyUntil = max(busyUntil, startStep + jobSteps)`, where `jobSteps = jobMs * sps / 1000`. |
| `cool` | datacenter | If no cycle covers `startStep`, set `coolFrom = startStep` and `coolUntil = startStep + coolSteps`; otherwise nothing. |
| `setThermal`, `setPriority` | power | As in milestone 1. |
| `harvest` | farm | See §8. |
| `dispatch` | warehouse | See §9. |

## 5. The session (core/src/session.ts)

```ts
export type RecordedInput =
  | { readonly step: number; readonly kind: 'deploy'; readonly boardId: string; readonly version: number; readonly source: string; readonly by: DeployedBy }
  | { readonly step: number; readonly kind: 'install'; readonly facilityId: string; readonly part: InstallPart }
  | { readonly step: number; readonly kind: 'repair'; readonly facilityId: string }
  | { readonly step: number; readonly kind: 'rebuild'; readonly boardId: string }
  | { readonly step: number; readonly kind: 'hand'; readonly facilityId: string; readonly action: FacilityAction }
  | { readonly step: number; readonly kind: 'pause' | 'resume' };

export type DeployedBy = 'player' | 'agent';
export type InstallPart = 'board' | 'comm';

/** Every command of the player answers this: done, or why not (English for agents and logs, a code for the viewer's Korean). */
export type CommandResult = { readonly ok: true } | { readonly ok: false; readonly reason: string; readonly refusal: Refusal };
// RebuildResult (milestone 1) becomes an alias of CommandResult.

class Session {
  deploy(boardId: string, source: string, by?: DeployedBy): { version: number };   // throws for a facility with no board
  install(facilityId: string, part: InstallPart): CommandResult;
  repair(facilityId: string): CommandResult;
  rebuild(boardId: string): CommandResult;
  hand(facilityId: string, action: FacilityAction): CommandResult;
  mark(kind: 'pause' | 'resume'): void;
}
export function replay(scenario, seed, record, host, untilStep): Session;   // handles every input kind
```

**Every command** refuses once the season has ended (`seasonEnded`). Each accepted one is recorded at `world.step`, and replay calls the same method at that step.

**A hand action applies at once** (decision D1). `Session.hand` checks, in order: the season has not ended, the facility is known, it is not wrecked or repairing, the action is its kind's (`kindProblem`), and the kind's own check (`harvestProblem`, `dispatchProblem`). It then records the action and applies it with `startStep = world.step`. A paused game shows the result. Firmware acting in the coming step's phase 5 comes later in real order, so it wins that step.

**The step's phases:**
1. `runTransitions`: sleeps end, board rebuilds finish, facility repairs finish.
2. `runSeries`: weather and market.
3. `runPower`.
4. `runBoardTicks`.
5. `applyActions`.
6. The facilities' own processes:
   - `runDatacenters`;
   - `runFarms` (core/src/farm.ts);
   - `runWarehouses` (core/src/warehouse.ts);
   - `runHousing` (core/src/housing.ts).
7. `runEmf`, then `runRumour`.
8. `runLuddites`.
9. `runFires`.
10. `runEconomy`, then `checkEnd`.

## 6. Refusals (core/src/refusal.ts)

The milestone-1 codes stay: `noAgent` (unused now, kept for compatibility), `noSeason`, `crashed`, `seasonEnded`, `unknownBoard`, `notDestroyed`, `tooPoor`, `badCommand`. Added:

```ts
  | { readonly code: 'unknownFacility'; readonly facility: string }
  | { readonly code: 'noBoard'; readonly facility: string }              // a board command to a facility without one
  | { readonly code: 'takesNoBoard'; readonly facility: string }         // housing
  | { readonly code: 'alreadyInstalled'; readonly facility: string; readonly part: 'board' | 'comm' }
  | { readonly code: 'boardDown'; readonly facility: string }            // comm on a destroyed or rebuilding board
  | { readonly code: 'wrecked'; readonly facility: string }              // the facility is wrecked or being repaired
  | { readonly code: 'notWrecked'; readonly facility: string }
  | { readonly code: 'repairFirst'; readonly facility: string }          // rebuild a board before its facility is repaired
  | { readonly code: 'noComm'; readonly board: string }                  // agent board tools below T2
  | { readonly code: 'cannotAct'; readonly facility: string; readonly detail: string }  // a hand action that cannot apply now
```

`tooPoor` stays with no fields. The viewer gives every code its Korean text (`viewer/src/refusals.ts`, a `never`-checked switch).

## 7. Power (core/src/power.ts)

```ts
export function plantFacility(world: WorldState): FacilityState;
/** What a facility requests this step, transmission loss included. */
export function facilityDemand(ctx: SimContext, facility: FacilityState, step: number): number;
/** Consumers (every facility but the plant), highest priority first: the plant's list, then the rest in scenario order. */
export function priorityOrder(world: WorldState): FacilityState[];
export function runPower(ctx: SimContext, step: number): void;
```

**Demand by facility.**
- A wrecked or repairing facility requests nothing.
- Otherwise it requests the sum of:
  - its board's draw: `spec.power` when running, `sleepPower` when asleep, 0 when destroyed or rebuilding, or no board at all;
  - a datacenter's `processPower` on a step its busy window covers, and `coolingPower` on a step its cool window covers;
  - housing's `tuning.housing.power`.
- Transmission loss applies on top, as now.

**The plant.**
- Its own board's draw is subtracted from generation, and that board is never shed.
- `generation = wind + thermalSetting`. The thermal module follows the setting whatever its board is doing (10-10 §4.2), but makes nothing while the plant facility is wrecked or repairing.

**Shedding.** It goes by `priorityOrder`, as now. Shedding sets `facility.powered` for every consumer, and each board's `powered` from its facility. A board's power log lines are as in milestone 1. The shortage alert is as now; `shed` holds facility ids.

## 8. Farms (core/src/farm.ts)

```ts
export function ripenSteps(ctx: SimContext): number;     // farm.ripenSeconds * sps
export function rotSteps(ctx: SimContext): number;
export function isRipe(ctx: SimContext, farm: FarmState, step: number): boolean;  // step - plantedAt >= ripenSteps
export function ripeness(ctx: SimContext, farm: FarmState, step: number): number; // 0..100, min(100, idiv((step - plantedAt) * 100, ripenSteps))
/** Phase 5 (via applyFacilityAction): a ripe crop goes to the outbox (whatever passes outboxCapacity is wasted) and the field replants (plantedAt = step). */
export function harvest(ctx: SimContext, farmId: string, step: number): void;
/** Phase 6: a crop left ripe for rotSeconds rots: it is lost and the field replants at that step. A wrecked or repairing farm is skipped. */
export function runFarms(ctx: SimContext, step: number): void;
```

When a farm's repair finishes, its field replants (`plantedAt` = that step).

## 9. The warehouse and its trucks (core/src/warehouse.ts)

```ts
export function stepsPerCell(ctx: SimContext): number;    // sps / truckCellsPerSecond
/** Why a dispatch cannot start now, or null. Used by Session.hand (to refuse) and by the action (to skip). */
export function dispatchProblem(ctx: SimContext, warehouseId: string, d: Extract<FacilityAction, { kind: 'dispatch' }>): string | null;
export function dispatch(ctx: SimContext, warehouseId: string, d: Extract<FacilityAction, { kind: 'dispatch' }>, step: number): void;
/** Phase 6: trucks move a cell every stepsPerCell steps along row-then-column paths (luddites.ts pathTo), paying fuelPerCell for each cell entered (ledger.truckFuel); stock spoils. */
export function runWarehouses(ctx: SimContext, step: number): void;
```

**A dispatch is valid when:**
- the truck exists and is idle;
- the amount is 1..`truckCapacity`;
- the warehouse is not wrecked;
- the trip is one of two kinds:
  - **collect:** `from` is a farm and `to` is this warehouse;
  - **deliver:** `from` is this warehouse, `to` is a housing block, and the stock holds at least 1 whole unit.

**A collect:**
1. The truck drives the warehouse-to-farm path.
2. On arriving it takes `min(amount, farm.outbox, capacity)` whole units.
3. It drives back and adds the load to `stockMilli` (`× MILLI`).

**A deliver:**
1. The truck loads `min(amount, floor(stockMilli / MILLI), capacity)` whole units at dispatch.
2. It drives to the housing block and adds the load to its `foodMilli`.
3. It drives back empty.

**How the legs run.**
- A leg starts at `legFrom` and enters one cell every `stepsPerCell` steps.
- On the step its last cell is entered, the arrival happens, and the next leg starts with `legFrom` = that step.
- At the end of the return leg the truck is idle.

**Trucks and the warehouse.** Trucks already on the road finish their trips even when their warehouse is wrecked. A wrecked warehouse refuses new dispatches.

**Spoilage, each step:** `stockMilli -= idiv(stockMilli * spoilagePctPerDay, 100 * stepsPerDay)`.

## 10. Housing (core/src/housing.ts)

```ts
/** Phase 6: each block eats residents * foodPerPersonPerDay per day from its foodMilli; fed when it could, else hungry (foodMilli 0). Fed and powered residents pay tax (ledger.tax). */
export function runHousing(ctx: SimContext, step: number): void;
```

**Eating, each step.**
- A block needs `mulDiv(residents * foodPerPersonPerDay, MILLI, stepsPerDay)`.
- If `foodMilli >= need`, it subtracts the need and sets `fed = true`.
- Otherwise it sets `foodMilli = 0` and `fed = false`.

**Tax, each step, when fed and the facility is powered:** `mulDiv(residents * taxPerPersonPerDay, MICRO, stepsPerDay)`.

**The hunger alert:** `raiseOnce(world, 'hunger:<id>', step, 'hunger', id, '<id> 주민이 굶고 있어요')` when the block turns hungry, and `clearFlag` when it is fed again.

## 11. EMF, Luddites, wrecks (core/src/emf.ts, luddites.ts, boards.ts)

- **Emission per tick:** `tickEmission = instructions / instructionsPerUnit + perAction × (actions that countsAsAction)`.
- **Base EMF:** each board that is running and powered emits `baseEmfPerSecond`, plus `commBaseEmfPerSecond` with a comm module, per second.
- **Processing EMF:** each datacenter emits `processingPerSecond` per second on a step it processes (`isProcessing`).
- **Machines.** `isMachine(world, facility)` is true when the facility is `ok` and either has a board that is running or asleep, or is a datacenter. The capability that makes a facility a machine in its own right is "processes", and only datacenters have it.
- **Targets.** `strongestTarget(ctx): FacilityState | null` is the machine whose cell carries the strongest EMF at or above the threshold.
- **Warnings.** Approach warnings go to machines.
- **Arrival.** A group arriving at its target wrecks it.

```ts
/** Wrecks a facility (Luddites or fire): condition 'wrecked'; its board, if any, is destroyed (VM shut down, stats.wrecks += 1 once per facility);
 *  a datacenter's busy and cool windows end; alert 'wrecked' "<id> 시설이 부서졌어요 (러다이트|화재)". */
export function wreckFacility(ctx: SimContext, facility: FacilityState, step: number, cause: 'fire' | 'luddites'): void;
```

`destroyBoard` stays internal to `wreckFacility`.

## 12. Installs, repairs, rebuilds, sleep (core/src/economy.ts and boards.ts)

```ts
export function installPart(ctx: SimContext, facilityId: string, part: InstallPart, step: number): CommandResult;
export function startRepair(ctx: SimContext, facilityId: string, step: number): CommandResult;
export function startRebuild(ctx: SimContext, boardId: string, step: number): CommandResult;   // now takes the id
```

**Installs.**
- **A board:**
  - It is refused for a facility that takes none (`takesNoBoard`), for one that already has a board (`alreadyInstalled`), and for a wrecked or repairing one (`wrecked`).
  - It pays `install.boardPrice[kind]` (`ledger.installs`), refusing with `tooPoor` when the money is short.
  - It creates the board: running, powered as its facility, with no firmware, and logs "board installed".
- **A comm module:**
  - It is refused without a board (`noBoard`), with a destroyed or rebuilding board (`boardDown`), and when one is already mounted (`alreadyInstalled`).
  - It pays `install.commPrice`, sets `comm = true`, and logs "comm module installed".

**Repairs.**
- Only a `wrecked` facility can be repaired; anything else is refused (`notWrecked`).
- A repair pays `repair.cost[kind]` (`ledger.repairs`), sets `repairing` with `repairReadyAt = step + repair.seconds * sps`, and becomes `ok` in phase 1.
- When it is done:
  - a datacenter comes back at ambient temperature with its windows ended;
  - a farm replants.

**Rebuilds.**
- A rebuild needs the board `destroyed` (otherwise `notDestroyed`) and its facility `ok` (otherwise `repairFirst`).
- It pays `rebuild.cost` (`ledger.rebuild`) and becomes running in phase 1, as in milestone 1.

**Upkeep** (phase 10) counts boards that are running or asleep, as now.

**Sleep.** `startSleep` stops only the board: the VM shuts down and `mem` is wiped. The facility's work, by hand or from windows already set, goes on.

## 13. Views (core/src/queries.ts)

**For agents** (agent tools; all English keys):

```ts
export interface BoardSummary {          // list_boards: every facility that takes a board
  readonly id: string; readonly kind: BoardKind; readonly x: number; readonly y: number;
  readonly tier: 0 | 1 | 2;              // 0 no board, 1 board, 2 board + comm module
  readonly condition: FacilityCondition;
  readonly board: { readonly status: BoardStatus; readonly powered: boolean; readonly firmwareVersion: number | null;
                    readonly pendingVersion: number | null; readonly lastError: string | null } | null;
}
export interface MapView { width; height; facilities: Array<{ id; kind: FacilityKind; x; y; tier: 0 | 1 | 2; condition; powered; distanceToPlant }> }
export interface StatusView {
  time; seasonDays; money; power: { generation; demand; shed };
  food: { warehouse: number; housing: number };            // whole units
  population: { fed: number; hungry: number; unpowered: number };
  ended: { kind: EndKind; time: TimeView } | null;
}
// firmwareView, logsView, alertsView: as now (boards only for the first two).
```

**For the viewer:**

```ts
export interface FacilityView {
  readonly id: string; readonly kind: FacilityKind; readonly x: number; readonly y: number;
  readonly tier: 0 | 1 | 2; readonly condition: FacilityCondition; readonly repairHoursLeft: number | null;
  readonly powered: boolean; readonly demand: number;
  readonly board: { readonly status: BoardStatus; readonly powered: boolean; readonly hasFirmware: boolean; readonly erroring: boolean } | null;
  readonly datacenter: { readonly tempC: number; readonly processing: boolean; readonly cooling: boolean } | null;
  readonly farm: { readonly ripeness: number; readonly ripe: boolean; readonly outbox: number } | null;
  readonly warehouse: { readonly stock: number } | null;
  readonly housing: { readonly food: number; readonly residents: number; readonly fed: boolean } | null;
}
export interface Snapshot {
  readonly step; readonly time; readonly seasonDays; readonly money; readonly ended; readonly grid;
  readonly prices: { readonly board: Record<BoardKind, number>; readonly comm: number; readonly repair: Record<BoardKind, number>;
                     readonly repairHours: number; readonly rebuild: number; readonly rebuildHours: number };
  readonly plant: { wind; thermal; thermalMax; fuelPrice; generation; demand; shed; priority };   // as now plus thermalMax
  readonly facilities: readonly FacilityView[];
  readonly trucks: ReadonlyArray<{ readonly warehouse: string; readonly id: number; readonly x: number; readonly y: number;
                                   readonly status: TruckStatus; readonly load: number; readonly targetId: string | null }>;
  readonly town: { readonly food: number; readonly population: { readonly fed: number; readonly hungry: number; readonly unpowered: number } };
  readonly luddites; readonly emf;                                                    // as now (targetId names a facility)
}
/** The panel's board details (boards only); null for a facility with no board. */
export interface BoardInspection {
  readonly parts: { readonly clockHz: number; readonly instructionsPerTick: number; readonly ramBytes: number; readonly ramUsedBytes: number | null };
  readonly baseEmfPerSecond: number;
  readonly firmware: FirmwareImage | null; readonly pending: FirmwareImage | null;
  readonly logs: readonly LogView[]; readonly sensors: Readonly<Record<string, SensorValue>>;
}
```

## 14. The manual (core/src/manual.ts)

```ts
/** The common rules, in Korean markdown; every number from the scenario. */
export function commonManual(scenario: Scenario): string;
/** One board slot's manual: the common rules first, then the board's own sections. Null for an unknown id or housing. */
export function boardManual(scenario: Scenario, facilityId: string): string | null;
/** The index: a list of every board slot, then the common rules. */
export function manualIndex(scenario: Scenario): string;
```

**What it replaces.** `datasheet.ts` and its `Datasheet` type go. `get_datasheet` returns `boardManual` (a string) for T2 boards.

**Markdown it may use**, and nothing else:
- `#`, `##`, and `###` headings;
- paragraphs;
- `- ` lists;
- pipe tables with a header row;
- fenced ```` ```lua ```` blocks;
- inline `` `code` `` and `**bold**`.

The viewer's renderer handles exactly this subset.

## 15. Firmware (packages/firmware)

**The VM's sensors.** `BoardVm.tick(sensors: Record<string, SensorValue>, newSource)` writes nested tables (arrays as 1-based sequences, records as string-keyed tables), strings, numbers (integer or float), and nil into `io`, fresh every tick.

**Action codes:**

```ts
export const ACTION_CODES = { process: 1, cool: 2, setThermal: 3, setPriority: 4, sleep: 5, harvest: 6, dispatch: 7 } as const;
```

**The prelude's actions by kind.**

| Kind | Lua actions |
|---|---|
| datacenter | `io.process()`, `io.cool()` (no argument) |
| power | `io.set_thermal(output)`, `io.set_priority({ids})` |
| farm | `io.harvest()` |
| warehouse | `io.dispatch(truck, from, to, amount)` |

- `dispatch` pushes `7, truck, fidx[from], fidx[to], amount`.
- An unknown facility id raises `"unknown facility: <id>"` at level 2.
- Every board also has `io.log` and `io.sleep`.

`decodeActions` maps code 2 to `{ kind: 'cool' }`, 6 to `harvest`, and 7 to `dispatch`.

**Sensor keys in io**, from `SENSOR_KEYS`:
- `ripeness` and `outbox`;
- `stock` and `farms`, a list of `{ id, outbox, distance }`;
- `housing`, a list of `{ id, food, residents, distance }`;
- `trucks`, a list of `{ id, status, x, y, load, target }`, where `status` is "idle", "outbound", or "returning" and `target` is an id or nil.

`day` and `clock` stay on every board.

## 16. Server protocol (core/src/protocol.ts)

```ts
export type Query = ... | { kind: 'manual'; board: string } ;            // 'datasheet' is removed
export type WorkerRequest = ...
  | { type: 'deploy'; id: number; board: string; code: string; by: DeployedBy }
  | { type: 'install'; id: number; facility: string; part: InstallPart }
  | { type: 'repair'; id: number; facility: string }
  | { type: 'hand'; id: number; facility: string; action: FacilityAction };
export interface ControllerStatus { state; speed; agent; crash; autoPause; scenarioName; season: number }   // blockedByAgent removed; season: 0, then +1 per startSeason (D3)
export type ControllerEvent = ...
  | { kind: 'deploy'; board: string; version: number; time: TimeView; by: DeployedBy };     // `by` added
export type ServerToViewer = ...
  | { type: 'hello'; connect: string; port: number; scenario: Scenario }                     // scenario added: the viewer renders manuals
  | { type: 'deploy'; board: string; version: number; time: TimeView; by: DeployedBy }
  | { type: 'deployResult'; board: string; outcome: DeployOutcome };                         // the editor's answer
export type ViewerToServer = ...
  | { type: 'deploy'; board: string; code: string }
  | { type: 'hand'; facility: string; action: FacilityAction }
  | { type: 'install'; facility: string; part: InstallPart }
  | { type: 'repair'; facility: string };
```

**Refusals cross the worker boundary.**
- `WorkerResponse`'s `refused` gains `refusal?: Refusal`.
- The worker throws core's `ToolError(message, refusal)` for a request it refuses, and `reply()` sends both.
- The controller rejects with `new ToolError(message, refusal)`.
- `install`, `repair`, `rebuild`, and `hand` answer a `CommandResult` rather than throwing. The hub turns `{ ok: false }` into `{ type: 'error', message: reason, refusal }`, as it does for a rebuild in milestone 1.

**The worker** gates the agent:
- An agent's deploy (`by: 'agent'`) and the agent's `manual`, `firmware`, and `logs` queries need a T2 board (`comm`). Otherwise the worker refuses with "<id> has no comm module: the player installs one from the board's panel".
- A player's deploy needs a board (`noBoard`).

**The controller:**
- **No agent rule:** `startSeason` and `play` no longer need an agent.
- **`agentLost`:** when the agent goes from connected to not connected while a season is in play, it emits an `alerts` event with one `AlertView` of kind `agentLost` ("에이전트 연결이 끊겼어요", id -1, facility null, the current time). It pauses a running game when `autoPause` includes `agentLost`.
- **The default `autoPause`:** `raid`, `wrecked`, `fire`, `firmwareError`, and `agentLost`.

**`/ws`'s `maxPayload`** becomes 512 KiB. A firmware source is up to 65,536 UTF-16 units, and JSON can spend 6 bytes on one. `core` exports the source schema as `FIRMWARE_SOURCE`, a zod string schema, which both MCP and the hub use.

## 17. The viewer (packages/viewer)

**New files:**
- `src/markdown.ts`: `renderMarkdown(md: string): DocumentFragment`, the subset of §14 built with `el()`, never innerHTML.
- `src/editor.ts`: `createLuaEditor(parent: HTMLElement, doc: string): { getText(): string; setText(t: string): void; focus(): void; destroy(): void }`, with CodeMirror 6 and `StreamLanguage.define(lua)`.
- `src/ui/guide.ts`: the guide card.
- `src/ui/manual-window.ts`.
- `src/ui/editor-window.ts`.
- `src/ui/controls.ts`: the hand controls per facility kind.

**New dependencies (exact):** `codemirror@6.0.2`, `@codemirror/language@6.13.1`, `@codemirror/legacy-modes@6.5.5`, `@codemirror/state@6.7.6`, `@codemirror/view@6.43.14`.

**The windows live in `#windows`** over the map. The manual window takes the left half and the editor window the right half. A window is mounted once and kept across renders: the editor is never rebuilt by a snapshot. It closes with [×] or Escape. The game's keys do nothing while focus is in the editor.

**Store additions:**
- `guideOpen: boolean`, with "다시 보지 않기" kept in localStorage under `turing-city:guide-dismissed`, inside try/catch;
- `manualFor: string | 'index' | null`;
- `editorFor: string | null`;
- `deployResult: { board: string; outcome: DeployOutcome } | null`;
- `scenario: Scenario | null`, from hello.

## 18. Seasons (core/src/season.ts, server/src/sim-cli.ts)

`SeasonOptions` gains `install?: 'all' | readonly string[]`: those boards are installed (and paid for) at step 0, before the firmware is deployed. `autoRebuild` now also repairs a wrecked facility as soon as the money allows, then rebuilds its board. `pnpm sim` gains `--install <all|ids,comma-separated>`.

**Reference firmware** is in `scenarios/firmware/m2/careless/` and `scenarios/firmware/m2/careful/`, one `.lua` per board: P, DA, DB, W, F1, F2, F3. `scenarios/firmware/m1/` and its season checks are removed.

## 19. Names the tasks add beyond this contract

The tasks that make each name say so under their "Produces"; this list is the index.

- **Task 2:**
  - `createBoard`, `installPart`, `CommandResult` (with `RebuildResult` as an alias), `DeployedBy`, `InstallPart`;
  - every refusal code of §6, with its Korean text in `viewer/src/refusals.ts`;
  - interim datacenter windows, `coolSteps`, `isCooling`.
- **Task 3:**
  - `wreckFacility`, `startRepair`, `startRebuild(ctx, boardId, step)`, and `standInForThePlayer(session)` (season.ts);
  - the worker's `repair` request, and `GameController.repair()`;
  - `wrecked` in the default auto-pause;
  - the `hunger` and `agentLost` alert kinds;
  - `stats.wrecks`.
- **Task 4:** `applyFacilityAction(…, startStep)`, `kindProblem`, `jobSteps`, `countsAsAction`, `SensorValue`, `stats.handActions`.
- **Task 5:** `datacenterDraw`, `coolingDrop`, and `datacenter.ts` replaced whole.
- **Task 6:** `baseEmission(ctx, board)`, `processingEmission(ctx)`, and `isMachine(world, facility)` with a private `MACHINE_KINDS`.
- **Task 7:** `harvestProblem`. A rotted crop logs "crop rotted" on the farm's board.
- **Task 8:** `warehouseReading`, and `dispatchProblem`'s messages.
- **Task 9:** `mealMilli`, `taxMicro`, `housingDraw`, `populationCounts`, `PopulationCounts`.
- **Task 10:**
  - a wrecked or repairing facility reports `powered: false`;
  - `baseEmfPerSecond` includes the comm module's;
  - `town.food` is the warehouse's food.
- **Task 11:** `GameApi.manual(board): Promise<string | null>` in place of `datasheet`, the `manual` query, `GameController.manual()`, and `gameApi.manual`. `datasheet.ts` is removed.
- **Task 12:** host-owned sensor tables rewritten in place each tick, and new ones on each deploy. Boot info lists every facility id.
- **Task 13:**
  - `GameController`: `deploy(board, code, by = 'player')`, `install`, `hand` (`repair`, `rebuild`, and `manual` are already there);
  - `ControllerStatus.season` (D3);
  - the worker refusal texts (§16).
- **Task 14:** `core/src/commands.ts` (`FIRMWARE_SOURCE`, `FACILITY_ACTION`, `INSTALL_PART`); `DevTools.install`, `.hand`, `.repair`; the tools `dev_install`, `dev_hand`, `dev_repair`.
- **Task 16:** `SeasonOptions.install`. Without `--install`, `pnpm sim` installs the boards its firmware is for.
- **Tasks 17 to 20** (viewer):
  - `Store`: `editorDrafts`, `dispatchDraft`, `setDispatchDraft`, `clearDeployResult`, `openGuide`, `closeGuide(dontShowAgain)`, `openManual`, `closeManual`, `openEditor`, `closeEditor(text?)`, and `Store(storage)` with `browserStorage()`;
  - `format.ts`: `ledOf(f): Led | null`;
  - the modules `map-rules.ts`, `panel-rules.ts`, and `window-rules.ts`;
  - `markdown.ts`'s `parseMarkdown`, and `editor.ts`'s `LuaEditor`;
  - `MapScene.show(snapshot, selected, heatmap, overheatC)`.

---

### Task 1: The scenario format for the whole town, and `scenarios/m2-town.json`

> **Corrections from assembling the plan (read first).**
> - In `scenarios/m1-power.json`, the test scenario, `datacenter.passiveCoolingPermillePerSecond` is **20**, not 3. 20 per mille per second is milestone 1's 2% per second, so the milestone-1 season checks keep their behaviour when Task 5 moves passive cooling to per mille. `scenarios/m2-town.json` keeps 3. If a test of this task pins the m1 value, it pins 20.


The 10-10 spec plays the whole small town of 10-09 §9: two housing blocks, the power plant, two datacenters, the warehouse, and three farms. Every facility starts without a board (10-10 §4.1, §12). This task teaches the scenario format the three new kinds, the sensors their boards carry, a board that may be missing (housing takes none) or installed from the start (`startsInstalled`, for test scenarios), and the new tuning groups of contract §1. Nothing simulates the new kinds yet: Tasks 2-9 do.

Three milestone-1 things stay as they are, so that every check still passes:
- `scenarios/m1-power.json` stays the small test scenario. Its three boards say `startsInstalled: true`, and its tuning gains the new keys with the contract's values.
- The datacenter keeps milestone 1's four cooling keys (`passiveCoolingPctPerSecond`, `coolingMilliPerLevelPerSecond`, `coolingPowerPerLevel`, `maxCoolingLevel`) beside the new ones. Task 2 stops reading the three cooling-level keys, and Task 5 removes all four when it moves passive cooling to `passiveCoolingPermillePerSecond`.
- The server and `pnpm sim` keep `m1-power.json` as their default. Task 15 makes the town the server's default, and Task 16 `pnpm sim`'s.

The town's values follow contract §1, except four that the coordinator set on 2026-10-10:
- `farm`: `ripenSeconds` 40, `rotSeconds` 20, `yield` 40, `outboxCapacity` 80;
- `datacenter.coolingPower` 250;
- `emf.rumourThreshold` 200000;
- `housing.startFood` 120, a new key: the whole food each housing block holds at the start, since the first crops ripen only later.

**Files:**
- Modify: `packages/core/src/scenario.ts`
- Create: `scenarios/m2-town.json`
- Modify: `scenarios/m1-power.json`
- Modify (the schema change breaks them): `packages/core/src/world.ts` (`createWorld`), `packages/core/src/sensors.ts`, `packages/core/src/datasheet.ts`, `packages/viewer/src/format.ts`, `packages/firmware/test/host.test.ts`
- Test: `packages/core/test/scenario.test.ts`, `packages/core/test/helpers/scenarios.ts`

**Interfaces:**
- Consumes: milestone 1's `scenario.ts` (`parseScenario`, `ScenarioError`, `Scenario`, `Tuning`).
- Produces:
  - `FACILITY_KINDS` (`'power' | 'datacenter' | 'farm' | 'warehouse' | 'housing'`), `FacilityKind`; `BOARD_KINDS`, `BoardKind`; `takesBoard(kind): kind is BoardKind`.
  - `ALL_SENSORS` and `SensorName` with `ripeness`, `outbox`, `stock`, `farms`, `housing`, `trucks`; `SENSORS_BY_KIND: Record<BoardKind, readonly SensorName[]>`.
  - `FacilitySpec.board: BoardSpec | null`, and `BoardSpec = NonNullable<FacilitySpec['board']>` with `startsInstalled?: boolean`.
  - `Tuning` with contract §1's groups: `datacenter` (`passiveCoolingPermillePerSecond`, `jobMs`, `coolingCycleMs`, `coolingDropMilli`, `coolingPower`, beside milestone 1's keys), `farm`, `warehouse`, `housing` (with `startFood`), `emf.processingPerSecond`, `install` (`boardPrice` per board kind, `commPrice`, `commBaseEmfPerSecond`), and `repair` (`cost` per board kind, `seconds`).
  - The scenario's own checks: housing takes no board and every other kind needs one; at most one warehouse; `jobMs` and `coolingCycleMs` give whole steps; `truckCellsPerSecond` divides `stepsPerSecond`.
  - `scenarios/m2-town.json`, and `m2Scenario(change?)` in the core test helpers, shaped like `m1Scenario`.
  - `SENSOR_KEYS` names the six new sensors in Lua (`ripeness`, `outbox`, `stock`, `farms`, `housing`, `trucks`); they read nil until Task 7 and Task 8 give them values.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/helpers/scenarios.ts` becomes:

```ts
import m1 from '../../../../scenarios/m1-power.json' with { type: 'json' };
import m2 from '../../../../scenarios/m2-town.json' with { type: 'json' };
import { parseScenario, type Scenario } from '../../src/scenario.ts';

/** The milestone-1 scenario, optionally changed by a callback on a deep copy of its JSON. */
export function m1Scenario(change?: (json: typeof m1) => void): Scenario {
  const json = JSON.parse(JSON.stringify(m1)) as typeof m1;
  change?.(json);
  return parseScenario(json);
}

/** The town of milestone 2, optionally changed by a callback on a deep copy of its JSON. */
export function m2Scenario(change?: (json: typeof m2) => void): Scenario {
  const json = JSON.parse(JSON.stringify(m2)) as typeof m2;
  change?.(json);
  return parseScenario(json);
}
```

In `packages/core/test/scenario.test.ts`, replace the imports and the copy helper at the top with:

```ts
import { describe, expect, it } from 'vitest';
import m1 from '../../../scenarios/m1-power.json' with { type: 'json' };
import m2 from '../../../scenarios/m2-town.json' with { type: 'json' };
import { BOARD_KINDS, parseScenario, ScenarioError, takesBoard } from '../src/scenario.ts';
import { m2Scenario } from './helpers/scenarios.ts';

/** A deep copy of the milestone-1 scenario to break in one place. */
function m1Copy(): typeof m1 {
  return JSON.parse(JSON.stringify(m1)) as typeof m1;
}

/** A deep copy of the town to break in one place. */
function m2Copy(): typeof m2 {
  return JSON.parse(JSON.stringify(m2)) as typeof m2;
}
```

Replace the test "names the path of a missing tuning value" with:

```ts
  it('names the path of a missing tuning value', () => {
    const s = m1Copy() as Record<string, unknown>;
    delete (s.tuning as Record<string, unknown>).bankruptcyDays;
    expect(problems(s)).toContain('tuning.bankruptcyDays');
    for (const group of ['farm', 'warehouse', 'housing', 'install', 'repair']) {
      const t = m1Copy() as Record<string, unknown>;
      delete (t.tuning as Record<string, unknown>)[group];
      expect(problems(t), group).toContain(`tuning.${group}`);
    }
  });
});
```

and add, after it:

```ts
describe('the town', () => {
  it('has the nine facilities of the map, every one of them without a board at the start', () => {
    const s = parseScenario(m2);
    expect(s.facilities.map((f) => `${f.id}:${f.kind}`)).toEqual([
      'H1:housing',
      'H2:housing',
      'P:power',
      'DA:datacenter',
      'W:warehouse',
      'DB:datacenter',
      'F1:farm',
      'F2:farm',
      'F3:farm',
    ]);
    expect(s.facilities.filter((f) => f.board === null).map((f) => f.id)).toEqual(['H1', 'H2']);
    expect(s.facilities.some((f) => f.board?.startsInstalled)).toBe(false);
    expect(s.tuning.install.boardPrice).toEqual({ farm: 200, warehouse: 400, power: 400, datacenter: 600 });
    expect(s.tuning.farm).toEqual({ ripenSeconds: 40, rotSeconds: 20, yield: 40, outboxCapacity: 80 });
    expect(s.tuning.housing.startFood).toBe(120);
    expect(s.tuning.datacenter.coolingPower).toBe(250);
    expect(s.tuning.emf.rumourThreshold).toBe(200_000);
    expect(m2Scenario().id).toBe('m2-town');
  });

  it('starts the test scenario with its three boards installed', () => {
    expect(parseScenario(m1).facilities.map((f) => f.board?.startsInstalled)).toEqual([true, true, true]);
  });

  it('takes a board on every kind but housing', () => {
    expect(BOARD_KINDS.filter((k) => takesBoard(k))).toEqual(['power', 'datacenter', 'farm', 'warehouse']);
    expect(takesBoard('housing')).toBe(false);
  });

  it('refuses a board on housing, and a board kind without one', () => {
    const housed = m2Copy();
    Object.assign(housed.facilities[0]!, { board: housed.facilities[6]!.board });
    expect(problems(housed)).toContain('facilities.0.board: a housing takes no board');
    const bare = m2Copy();
    Object.assign(bare.facilities[6]!, { board: null });
    expect(problems(bare)).toContain('facilities.6.board: a farm needs a board');
  });

  it('refuses a sensor a farm or the warehouse does not offer', () => {
    const s = m2Copy();
    s.facilities[6]!.board!.sensors.push('temp');
    s.facilities[4]!.board!.sensors.push('ripeness');
    const text = problems(s);
    expect(text).toContain('facilities.6.board.sensors.2: a farm board has no temp sensor');
    expect(text).toContain('facilities.4.board.sensors.4: a warehouse board has no ripeness sensor');
  });

  it('allows at most one warehouse', () => {
    const s = m2Copy();
    s.facilities.push({ ...s.facilities[4]!, id: 'W2', x: 12, y: 6 });
    expect(problems(s)).toContain('facilities: at most one warehouse is allowed');
  });

  it('needs a press, a cooling cycle, and a truck cell to last whole steps', () => {
    const s = m2Copy();
    s.tuning.datacenter.jobMs = 525; // 10.5 steps at 20 a second
    s.tuning.datacenter.coolingCycleMs = 4010;
    s.tuning.warehouse.truckCellsPerSecond = 3;
    const text = problems(s);
    expect(text).toContain('tuning.datacenter.jobMs: jobMs 525 is not a whole number of steps at 20 steps per second');
    expect(text).toContain('tuning.datacenter.coolingCycleMs: coolingCycleMs 4010 is not a whole number of steps at 20 steps per second');
    expect(text).toContain('tuning.warehouse.truckCellsPerSecond: truckCellsPerSecond 3 must divide stepsPerSecond 20');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/test/scenario.test.ts`
Expected: FAIL, 8 tests. The first ones read `Error: facilities.0.kind: Invalid option: expected one of "power"|"datacenter"` (the town's housing is no kind yet), `expected [ undefined, undefined, undefined ] to deeply equal [ true, true, true ]`, and `TypeError: Cannot read properties of undefined (reading 'filter')` (`BOARD_KINDS` does not exist).

- [ ] **Step 3: Write the scenario format**

`packages/core/src/scenario.ts` becomes:

```ts
import { z } from 'zod';

export const FACILITY_KINDS = ['power', 'datacenter', 'farm', 'warehouse', 'housing'] as const;
export type FacilityKind = (typeof FACILITY_KINDS)[number];

/** The kinds that take a board: every kind but housing. */
export const BOARD_KINDS = ['power', 'datacenter', 'farm', 'warehouse'] as const;
export type BoardKind = (typeof BOARD_KINDS)[number];

export function takesBoard(kind: FacilityKind): kind is BoardKind {
  return kind !== 'housing';
}

export const ALL_SENSORS = [
  'wind',
  'demand',
  'fuelPrice',
  'temp',
  'powerHeadroom',
  'price',
  'emf',
  'ludditeDist',
  'ripeness',
  'outbox',
  'stock',
  'farms',
  'housing',
  'trucks',
] as const;
export type SensorName = (typeof ALL_SENSORS)[number];

/** The sensors a board can carry, by the kind of facility it sits in. */
export const SENSORS_BY_KIND: Record<BoardKind, readonly SensorName[]> = {
  power: ['wind', 'demand', 'fuelPrice'],
  datacenter: ['temp', 'powerHeadroom', 'price', 'emf', 'ludditeDist'],
  farm: ['ripeness', 'outbox'],
  warehouse: ['stock', 'farms', 'housing', 'trucks'],
};

const int = (min: number) => z.number().int().min(min);
const perBoardKind = z.object({ farm: int(0), warehouse: int(0), power: int(0), datacenter: int(0) });

const BoardSchema = z.object({
  clockHz: int(1),
  instructionCap: int(100),
  ramKb: int(1),
  sensors: z.array(z.enum(ALL_SENSORS)),
  /** Power the board itself draws, every step it's awake. */
  power: int(0),
  baseEmfPerSecond: int(0),
  /** The board is installed at step 0. For test scenarios: the game's scenario starts every facility without a board. */
  startsInstalled: z.boolean().optional(),
});

const FacilitySchema = z.object({
  id: z.string().regex(/^[A-Z][A-Z0-9]{0,7}$/, 'an id is 1-8 capital letters or digits, starting with a letter'),
  kind: z.enum(FACILITY_KINDS),
  x: int(0),
  y: int(0),
  /** The board this facility takes; null for a kind that takes none (housing). */
  board: BoardSchema.nullable(),
});

const TuningSchema = z.object({
  transmissionLossPctPerCell: int(0),
  /**
   * How long the grid, or a board, must be steady before an outage is over: a shortage alert is raised again only after the grid has
   * had no shed facility for this long, and a board logs "power back" only after it has had power, unbroken, for this long.
   */
  shortageQuietSeconds: int(0),
  wind: z.object({ max: int(0), start: int(0), maxChangePerSecond: int(0) }),
  thermal: z.object({ max: int(0) }),
  fuelPrice: z.object({ start: int(0), min: int(0), max: int(0) }),
  jobPrice: z.object({ start: int(0), min: int(0), max: int(0), maxChangePerSecond: int(0) }),
  datacenter: z.object({
    processPower: int(0),
    ambientMilli: int(0),
    heatMilliPerSecond: int(0),
    // Milestone 1's four cooling keys stay until Task 5 replaces passive cooling and removes them.
    passiveCoolingPctPerSecond: int(0),
    coolingMilliPerLevelPerSecond: int(0),
    coolingPowerPerLevel: int(0),
    maxCoolingLevel: int(0),
    passiveCoolingPermillePerSecond: int(0),
    /** How long one press of [처리], or one process(), runs the datacenter. */
    jobMs: int(1),
    coolingCycleMs: int(1),
    /** What one cooling cycle takes off the temperature, spread evenly over the cycle. */
    coolingDropMilli: int(0),
    /** What a cooling cycle draws while it runs. */
    coolingPower: int(0),
    overheatAlertMilli: int(0),
    fireThresholdMilli: int(0),
    firePermillePerDegreePerSecond: int(0),
  }),
  farm: z.object({ ripenSeconds: int(1), rotSeconds: int(1), yield: int(1), outboxCapacity: int(1) }),
  warehouse: z.object({
    trucks: int(1),
    truckCapacity: int(1),
    truckCellsPerSecond: int(1),
    fuelPerCell: int(0),
    spoilagePctPerDay: int(0),
  }),
  housing: z.object({
    residents: int(0),
    foodPerPersonPerDay: int(0),
    power: int(0),
    taxPerPersonPerDay: int(0),
    /** Whole food units each block holds at the season's start: the first crops ripen only later. */
    startFood: int(0),
  }),
  boardUpkeepPerDay: int(0),
  sleepPower: int(0),
  maxSleepSeconds: int(1),
  emf: z.object({
    instructionsPerUnit: int(1),
    perAction: int(0),
    /** What a datacenter emits per second of processing, whoever started the job. */
    processingPerSecond: int(0),
    diffusionPctPerSecond: int(0),
    decayPctPerSecond: int(0),
    detectionThreshold: int(0),
    rumourThreshold: int(1),
  }),
  luddites: z.object({ groupSize: int(1), cellsPerSecond: int(1), quietSecondsToLeave: int(1), approachCells: int(1) }),
  install: z.object({ boardPrice: perBoardKind, commPrice: int(0), commBaseEmfPerSecond: int(0) }),
  repair: z.object({ cost: perBoardKind, seconds: int(1) }),
  rebuild: z.object({ cost: int(0), seconds: int(1) }),
  bankruptcyDays: int(1),
});

const ScenarioSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    grid: z.object({ width: z.number().int().min(1).max(64), height: z.number().int().min(1).max(64) }),
    time: z.object({ stepsPerSecond: int(1), secondsPerDay: int(1), seasonDays: int(1) }),
    startMoney: int(0),
    facilities: z.array(FacilitySchema).min(1),
    tuning: TuningSchema,
  })
  .superRefine((s, ctx) => {
    const ids = new Set<string>();
    const cells = new Set<string>();
    s.facilities.forEach((f, i) => {
      if (ids.has(f.id)) ctx.addIssue({ code: 'custom', path: ['facilities', i, 'id'], message: `duplicate facility id ${f.id}` });
      ids.add(f.id);
      if (f.x >= s.grid.width || f.y >= s.grid.height) {
        ctx.addIssue({
          code: 'custom',
          path: ['facilities', i],
          message: `(${f.x}, ${f.y}) is outside the ${s.grid.width}x${s.grid.height} grid`,
        });
      }
      const cell = `${f.x},${f.y}`;
      if (cells.has(cell)) ctx.addIssue({ code: 'custom', path: ['facilities', i], message: `two facilities at (${cell})` });
      cells.add(cell);
      if (!takesBoard(f.kind)) {
        if (f.board !== null) ctx.addIssue({ code: 'custom', path: ['facilities', i, 'board'], message: `a ${f.kind} takes no board` });
        return;
      }
      if (f.board === null) {
        ctx.addIssue({ code: 'custom', path: ['facilities', i, 'board'], message: `a ${f.kind} needs a board` });
        return;
      }
      if (s.time.stepsPerSecond % f.board.clockHz !== 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['facilities', i, 'board', 'clockHz'],
          message: `clockHz ${f.board.clockHz} must divide stepsPerSecond ${s.time.stepsPerSecond}`,
        });
      }
      const offered = SENSORS_BY_KIND[f.kind];
      f.board.sensors.forEach((sensor, j) => {
        if (!offered.includes(sensor)) {
          ctx.addIssue({
            code: 'custom',
            path: ['facilities', i, 'board', 'sensors', j],
            message: `a ${f.kind} board has no ${sensor} sensor`,
          });
        }
      });
    });
    if (s.facilities.filter((f) => f.kind === 'power').length !== 1) {
      ctx.addIssue({ code: 'custom', path: ['facilities'], message: 'exactly one power plant is required' });
    }
    if (s.facilities.filter((f) => f.kind === 'warehouse').length > 1) {
      ctx.addIssue({ code: 'custom', path: ['facilities'], message: 'at most one warehouse is allowed' });
    }
    // A press of [처리] and a cooling cycle last a whole number of steps, and a truck enters a cell on a whole step.
    const sps = s.time.stepsPerSecond;
    for (const key of ['jobMs', 'coolingCycleMs'] as const) {
      const ms = s.tuning.datacenter[key];
      if ((ms * sps) % 1000 !== 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['tuning', 'datacenter', key],
          message: `${key} ${ms} is not a whole number of steps at ${sps} steps per second`,
        });
      }
    }
    const cellsPerSecond = s.tuning.warehouse.truckCellsPerSecond;
    if (sps % cellsPerSecond !== 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['tuning', 'warehouse', 'truckCellsPerSecond'],
        message: `truckCellsPerSecond ${cellsPerSecond} must divide stepsPerSecond ${sps}`,
      });
    }
    // A series starts inside its range and stays there (the wind's range is 0..max). An inverted range or a start
    // outside it is a mistake in the file, so it is refused here rather than met in the middle of a session.
    const { wind, fuelPrice, jobPrice } = s.tuning;
    const series = [
      ['wind', 0, wind.max, wind.start],
      ['fuelPrice', fuelPrice.min, fuelPrice.max, fuelPrice.start],
      ['jobPrice', jobPrice.min, jobPrice.max, jobPrice.start],
    ] as const;
    for (const [name, min, max, start] of series) {
      if (min > max) {
        ctx.addIssue({ code: 'custom', path: ['tuning', name], message: `min ${min} is above max ${max}` });
      } else if (start < min || start > max) {
        ctx.addIssue({ code: 'custom', path: ['tuning', name, 'start'], message: `start ${start} is outside the range ${min}..${max}` });
      }
    }
  });

export type Scenario = z.infer<typeof ScenarioSchema>;
export type FacilitySpec = Scenario['facilities'][number];
export type BoardSpec = NonNullable<FacilitySpec['board']>;
export type Tuning = Scenario['tuning'];

export class ScenarioError extends Error {}

/** Validates a scenario (parsed JSON). Throws ScenarioError listing every problem as "path: problem". */
export function parseScenario(input: unknown): Scenario {
  const result = ScenarioSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new ScenarioError(lines.join('\n'));
  }
  return result.data;
}
```

- [ ] **Step 4: Write the town and migrate the test scenario**

`scenarios/m2-town.json`:

```json
{
  "id": "m2-town",
  "name": "작은 마을",
  "grid": { "width": 20, "height": 12 },
  "time": { "stepsPerSecond": 20, "secondsPerDay": 40, "seasonDays": 30 },
  "startMoney": 5000,
  "facilities": [
    { "id": "H1", "kind": "housing", "x": 2, "y": 1, "board": null },
    { "id": "H2", "kind": "housing", "x": 17, "y": 1, "board": null },
    {
      "id": "P",
      "kind": "power",
      "x": 4,
      "y": 4,
      "board": {
        "clockHz": 4,
        "instructionCap": 1500,
        "ramKb": 4,
        "sensors": ["wind", "demand", "fuelPrice"],
        "power": 5,
        "baseEmfPerSecond": 20
      }
    },
    {
      "id": "DA",
      "kind": "datacenter",
      "x": 5,
      "y": 4,
      "board": {
        "clockHz": 5,
        "instructionCap": 2000,
        "ramKb": 8,
        "sensors": ["temp", "powerHeadroom", "price", "emf", "ludditeDist"],
        "power": 10,
        "baseEmfPerSecond": 25
      }
    },
    {
      "id": "W",
      "kind": "warehouse",
      "x": 11,
      "y": 6,
      "board": {
        "clockHz": 2,
        "instructionCap": 3000,
        "ramKb": 16,
        "sensors": ["stock", "farms", "housing", "trucks"],
        "power": 8,
        "baseEmfPerSecond": 15
      }
    },
    {
      "id": "DB",
      "kind": "datacenter",
      "x": 16,
      "y": 8,
      "board": {
        "clockHz": 5,
        "instructionCap": 2000,
        "ramKb": 8,
        "sensors": ["temp", "powerHeadroom", "price", "emf", "ludditeDist"],
        "power": 10,
        "baseEmfPerSecond": 25
      }
    },
    {
      "id": "F1",
      "kind": "farm",
      "x": 2,
      "y": 9,
      "board": { "clockHz": 1, "instructionCap": 500, "ramKb": 2, "sensors": ["ripeness", "outbox"], "power": 3, "baseEmfPerSecond": 10 }
    },
    {
      "id": "F2",
      "kind": "farm",
      "x": 3,
      "y": 9,
      "board": { "clockHz": 1, "instructionCap": 500, "ramKb": 2, "sensors": ["ripeness", "outbox"], "power": 3, "baseEmfPerSecond": 10 }
    },
    {
      "id": "F3",
      "kind": "farm",
      "x": 4,
      "y": 9,
      "board": { "clockHz": 1, "instructionCap": 500, "ramKb": 2, "sensors": ["ripeness", "outbox"], "power": 3, "baseEmfPerSecond": 10 }
    }
  ],
  "tuning": {
    "transmissionLossPctPerCell": 2,
    "shortageQuietSeconds": 10,
    "wind": { "max": 220, "start": 120, "maxChangePerSecond": 8 },
    "thermal": { "max": 300 },
    "fuelPrice": { "start": 7, "min": 5, "max": 9 },
    "jobPrice": { "start": 40, "min": 15, "max": 80, "maxChangePerSecond": 2 },
    "datacenter": {
      "processPower": 150,
      "ambientMilli": 25000,
      "heatMilliPerSecond": 2000,
      "passiveCoolingPctPerSecond": 2,
      "coolingMilliPerLevelPerSecond": 800,
      "coolingPowerPerLevel": 20,
      "maxCoolingLevel": 3,
      "passiveCoolingPermillePerSecond": 3,
      "jobMs": 500,
      "coolingCycleMs": 4000,
      "coolingDropMilli": 15000,
      "coolingPower": 250,
      "overheatAlertMilli": 85000,
      "fireThresholdMilli": 90000,
      "firePermillePerDegreePerSecond": 5
    },
    "farm": { "ripenSeconds": 40, "rotSeconds": 20, "yield": 40, "outboxCapacity": 80 },
    "warehouse": { "trucks": 2, "truckCapacity": 40, "truckCellsPerSecond": 2, "fuelPerCell": 1, "spoilagePctPerDay": 2 },
    "housing": { "residents": 40, "foodPerPersonPerDay": 1, "power": 70, "taxPerPersonPerDay": 5, "startFood": 120 },
    "boardUpkeepPerDay": 10,
    "sleepPower": 1,
    "maxSleepSeconds": 40,
    "emf": {
      "instructionsPerUnit": 100,
      "perAction": 10,
      "processingPerSecond": 50,
      "diffusionPctPerSecond": 10,
      "decayPctPerSecond": 10,
      "detectionThreshold": 5,
      "rumourThreshold": 200000
    },
    "luddites": { "groupSize": 3, "cellsPerSecond": 1, "quietSecondsToLeave": 10, "approachCells": 5 },
    "install": {
      "boardPrice": { "farm": 200, "warehouse": 400, "power": 400, "datacenter": 600 },
      "commPrice": 300,
      "commBaseEmfPerSecond": 5
    },
    "repair": { "cost": { "farm": 150, "warehouse": 300, "power": 300, "datacenter": 500 }, "seconds": 20 },
    "rebuild": { "cost": 500, "seconds": 20 },
    "bankruptcyDays": 3
  }
}
```

`scenarios/m1-power.json` becomes:

```json
{
  "id": "m1-power",
  "name": "발전소와 데이터센터",
  "grid": { "width": 20, "height": 12 },
  "time": { "stepsPerSecond": 20, "secondsPerDay": 40, "seasonDays": 30 },
  "startMoney": 5000,
  "facilities": [
    {
      "id": "P",
      "kind": "power",
      "x": 4,
      "y": 4,
      "board": {
        "clockHz": 4,
        "instructionCap": 1500,
        "ramKb": 4,
        "sensors": ["wind", "demand", "fuelPrice"],
        "power": 5,
        "baseEmfPerSecond": 20,
        "startsInstalled": true
      }
    },
    {
      "id": "DA",
      "kind": "datacenter",
      "x": 5,
      "y": 4,
      "board": {
        "clockHz": 5,
        "instructionCap": 2000,
        "ramKb": 8,
        "sensors": ["temp", "powerHeadroom", "price", "emf", "ludditeDist"],
        "power": 10,
        "baseEmfPerSecond": 25,
        "startsInstalled": true
      }
    },
    {
      "id": "DB",
      "kind": "datacenter",
      "x": 16,
      "y": 8,
      "board": {
        "clockHz": 5,
        "instructionCap": 2000,
        "ramKb": 8,
        "sensors": ["temp", "powerHeadroom", "price", "emf", "ludditeDist"],
        "power": 10,
        "baseEmfPerSecond": 25,
        "startsInstalled": true
      }
    }
  ],
  "tuning": {
    "transmissionLossPctPerCell": 2,
    "shortageQuietSeconds": 10,
    "wind": { "max": 220, "start": 120, "maxChangePerSecond": 8 },
    "thermal": { "max": 300 },
    "fuelPrice": { "start": 7, "min": 5, "max": 9 },
    "jobPrice": { "start": 40, "min": 15, "max": 80, "maxChangePerSecond": 2 },
    "datacenter": {
      "processPower": 150,
      "ambientMilli": 25000,
      "heatMilliPerSecond": 2000,
      "passiveCoolingPctPerSecond": 2,
      "coolingMilliPerLevelPerSecond": 800,
      "coolingPowerPerLevel": 20,
      "maxCoolingLevel": 3,
      "passiveCoolingPermillePerSecond": 20,
      "jobMs": 500,
      "coolingCycleMs": 4000,
      "coolingDropMilli": 15000,
      "coolingPower": 400,
      "overheatAlertMilli": 85000,
      "fireThresholdMilli": 90000,
      "firePermillePerDegreePerSecond": 5
    },
    "farm": { "ripenSeconds": 120, "rotSeconds": 40, "yield": 24, "outboxCapacity": 50 },
    "warehouse": { "trucks": 2, "truckCapacity": 40, "truckCellsPerSecond": 2, "fuelPerCell": 1, "spoilagePctPerDay": 2 },
    "housing": { "residents": 40, "foodPerPersonPerDay": 1, "power": 70, "taxPerPersonPerDay": 5, "startFood": 120 },
    "boardUpkeepPerDay": 10,
    "sleepPower": 1,
    "maxSleepSeconds": 40,
    "emf": {
      "instructionsPerUnit": 100,
      "perAction": 10,
      "processingPerSecond": 50,
      "diffusionPctPerSecond": 10,
      "decayPctPerSecond": 10,
      "detectionThreshold": 5,
      "rumourThreshold": 100000
    },
    "luddites": { "groupSize": 3, "cellsPerSecond": 1, "quietSecondsToLeave": 10, "approachCells": 5 },
    "install": {
      "boardPrice": { "farm": 200, "warehouse": 400, "power": 400, "datacenter": 600 },
      "commPrice": 300,
      "commBaseEmfPerSecond": 5
    },
    "repair": { "cost": { "farm": 150, "warehouse": 300, "power": 300, "datacenter": 500 }, "seconds": 20 },
    "rebuild": { "cost": 500, "seconds": 20 },
    "bankruptcyDays": 3
  }
}
```

- [ ] **Step 5: Patch what the schema change breaks**

The new kinds and sensors reach every `Record` keyed by them, and `FacilitySpec.board` can now be null.

In `packages/core/src/world.ts`, `createWorld` builds a board only for a facility that has one (Task 2 rewrites this function):

```ts
export function createWorld(scenario: Scenario): WorldState {
  const t = scenario.tuning;
  const boards: BoardState[] = [];
  scenario.facilities.forEach((f, index) => {
    if (f.board === null) return; // housing takes no board
    const period = beatPeriod(scenario.time, f.board.clockHz);
    boards.push({
      id: f.id,
      index,
      kind: f.kind,
      spec: f.board,
      // ... the rest of milestone 1's board literal, unchanged ...
    });
  });
```

Keep the board literal's other fields exactly as they are; only `map` becomes `forEach` with `push`, and housing is skipped.

In `packages/core/src/sensors.ts`, `SENSOR_KEYS` gains the six names, and `read()` answers nil for them until Tasks 7 and 8:

```ts
export const SENSOR_KEYS: Record<SensorName, string> = {
  wind: 'wind',
  demand: 'demand',
  fuelPrice: 'fuel_price',
  temp: 'temp',
  powerHeadroom: 'power_headroom',
  price: 'price',
  emf: 'emf',
  ludditeDist: 'luddite_dist',
  ripeness: 'ripeness',
  outbox: 'outbox',
  stock: 'stock',
  farms: 'farms',
  housing: 'housing',
  trucks: 'trucks',
};
```

and, at the end of `read()`'s switch:

```ts
    case 'ludditeDist':
      return nearestLudditeDistance(ctx, board);
    // Farms and the warehouse have no rules yet: their sensors read nil until Task 7 (farms) and Task 8 (the warehouse).
    case 'ripeness':
    case 'outbox':
    case 'stock':
    case 'farms':
    case 'housing':
    case 'trucks':
      return undefined;
  }
```

In `packages/core/src/datasheet.ts`, `sensorDocs` gains the six sensors after `ludditeDist`:

```ts
    ripeness: { unit: 'percent', meaning: 'how far the crop has grown; 100 is ripe' },
    outbox: { unit: 'food units', meaning: `harvested food waiting for a truck, up to ${t.farm.outboxCapacity}` },
    stock: { unit: 'food units', meaning: `the food the warehouse holds; ${t.warehouse.spoilagePctPerDay}% of it spoils every day` },
    farms: { unit: 'list', meaning: 'each farm as {id, outbox, distance}' },
    housing: { unit: 'list', meaning: 'each housing block as {id, food, residents, distance}' },
    trucks: { unit: 'list', meaning: 'each truck as {id, status, x, y, load, target}' },
```

and `actionDocs` gains, before `any`:

```ts
    farm: [
      {
        call: 'io.harvest()',
        meaning: `move a ripe crop to the outbox (${t.farm.yield} food, up to ${t.farm.outboxCapacity} in all) and replant`,
      },
    ],
    warehouse: [
      {
        call: 'io.dispatch(truck, from, to, amount)',
        meaning: `send an idle truck (up to ${t.warehouse.truckCapacity} food): from a farm to this warehouse collects, from this warehouse to a housing block delivers`,
      },
    ],
    housing: [],
```

In `packages/viewer/src/format.ts`:

```ts
export const KIND_LABELS: Record<FacilityKind, string> = {
  power: '발전소',
  datacenter: '데이터센터',
  farm: '밭',
  warehouse: '물류창고',
  housing: '주거지',
};
```

In `packages/firmware/test/host.test.ts`, the boot helper's spec is never null for a board it boots:

```ts
    return { boardId, kind: f.kind, spec: f.board!, facilityIds: scenario.facilities.map((x) => x.id), seed: 1 };
```

- [ ] **Step 6: Run the tests to verify they pass, then the whole check**

Run: `pnpm vitest run packages/core/test/scenario.test.ts`
Expected: PASS, 16 tests.

Run: `pnpm fix && pnpm check`
Expected: every package typechecks, Biome is clean, and every test passes (559).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/scenario.ts scenarios/m2-town.json scenarios/m1-power.json packages/core/src/world.ts packages/core/src/sensors.ts packages/core/src/datasheet.ts packages/viewer/src/format.ts packages/firmware/test/host.test.ts packages/core/test/scenario.test.ts packages/core/test/helpers/scenarios.ts
git commit -m "Describe the whole town in the scenario format: farms, the warehouse, housing, and their tuning"
```

---

### Task 2: Facilities, installed boards, and installs

In milestone 1 a facility existed only through its board. In milestone 2 every facility is there from the start and is worked by hand; a board is something the player buys (10-10 §4.1, §12). This task:
- gives the world its facilities (`world.facilities`, each with a condition and a power flag) and keeps only installed boards in `world.boards`, in the town's order whatever order they were bought in;
- adds the state of the new kinds (farms, the warehouse and its trucks, housing), set up but not yet simulated: Tasks 7, 8, and 9 run them;
- lets the player install a board (T1) or a board's comm module (T2) for its price, recorded and replayed like a deploy;
- powers facilities rather than boards: demand by facility, housing's own draw, and shedding that sets each facility's flag and its board's from it;
- puts the datacenter on its busy and cool windows (contract §2).

**The datacenter stays close to milestone 1 until Tasks 4 and 5.**
- `process()` keeps a job running until the board's next tick, as in milestone 1. Task 4 makes it the contract's job of `jobMs`, from firmware or the hand.
- `cool(level)` with a level above 0 starts one cooling cycle of `coolingCycleMs`, unless a cycle covers the next step; a level of 0 does nothing. The cycle takes `coolingDropMilli` off in even steps and draws `coolingPower` while it runs. Task 4 drops the level.
- Passive cooling stays milestone 1's percentage (`passiveCoolingPctPerSecond`) until Task 5.
- A board that sleeps or is destroyed still ends its datacenter's job and cooling, as in milestone 1. Task 3 makes a sleep stop only the board.

**The careful reference firmware stops cooling.** A cooling cycle draws 400 in the test scenario, where milestone 1's level 1 drew 20. The careful set kept cooling on from 70 °C down to 50 °C, so on seeds 1 and 3 its fuel bill outran its income and it went bankrupt. It now never cools and rests below 75 °C instead. The season checks still hold it to completing seeds 1 to 3 and ending more than 1,000 richer than the careless set.

**Two smaller things.**
- Housing's food starts at `housing.startFood` (Task 1), so a town is not hungry at step 0.
- The fall (every board destroyed) stays until Task 3 removes it, but a town with no boards at all does not fall.

**Files:**
- Modify: `packages/core/src/world.ts`, `packages/core/src/refusal.ts`, `packages/core/src/economy.ts`, `packages/core/src/session.ts`, `packages/core/src/power.ts`, `packages/core/src/datacenter.ts`, `packages/core/src/actions.ts`, `packages/core/src/boards.ts`, `packages/core/src/ticks.ts`, `packages/core/src/firmware-host.ts`, `packages/core/src/queries.ts`, `packages/core/src/datasheet.ts`
- Modify: `packages/viewer/src/refusals.ts` (its `never`-checked switch needs the new codes)
- Modify: `scenarios/firmware/m1/careful/DA.lua`, `scenarios/firmware/m1/careful/DB.lua`, `packages/server/scripts/shots.ts` (one comment)
- Test: `packages/core/test/facilities.test.ts` (new)
- Test (milestone 1's, brought to facilities and windows): `packages/core/test/power.test.ts`, `packages/core/test/datacenter.test.ts`, `packages/core/test/session.test.ts`, `packages/core/test/economy.test.ts`, `packages/core/test/queries.test.ts`, `packages/firmware/test/host.test.ts`, `packages/viewer/test/refusals.test.ts`

**Interfaces:**
- Consumes: Task 1's scenario (`BoardKind`, `takesBoard`, `FacilitySpec.board` that may be null, `startsInstalled`, `tuning.install`, `tuning.housing`, `tuning.warehouse.trucks`, `tuning.datacenter.coolingCycleMs`, `coolingDropMilli`, `coolingPower`), and `m2Scenario` in the test helpers.
- Produces:
  - `world.ts`:
    - `FacilityCondition`, `FacilityState`;
    - `BoardState.kind: BoardKind` and `BoardState.comm`;
    - `DatacenterState` with `busyFrom`, `busyUntil`, `coolFrom`, `coolUntil` (half-open windows);
    - `FarmState`, `TruckStatus`, `TruckJob`, `TruckState`, `WarehouseState`, `HousingState`;
    - `Ledger` with `tax`, `truckFuel`, `installs`, and `repairs`;
    - `WorldState.facilities`, `farms`, `warehouses`, and `housing`;
    - `createBoard(scenario, facilitySpec, index)` and `findFacility(world, id)`.
  - `refusal.ts`: every code of contract §6.
  - `session.ts`:
    - `DeployedBy`, `InstallPart`, `CommandResult`, with `RebuildResult` now an alias of `CommandResult`;
    - `deploy(boardId, source, by = 'player')`, which throws "<id> has no board" for a facility without one;
    - `install(facilityId, part): CommandResult`;
    - the recorded input kinds `install`, and `deploy` with `by`.
  - `economy.ts`: `installPart(ctx, facilityId, part, step): CommandResult`.
  - `power.ts`:
    - `plantFacility(world)`, which replaces `plantBoard`;
    - `facilityDemand(ctx, facility, step)` takes a `FacilityState`;
    - `priorityOrder(world): FacilityState[]`;
    - `plant.shed` holds facility ids.
  - `datacenter.ts`:
    - `coolSteps(ctx)`;
    - `isProcessing(ctx, facilityId, step)` and `isCooling(ctx, facilityId, step)`: the facility is ok and powered, and the window covers the step.
  - The viewer's Korean text for every refusal code. `tooPoor` now reads "자금이 모자라서 할 수 없어요." because it answers installs as well as rebuilds.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/facilities.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MICRO } from '../src/fixed.ts';
import { stateHash } from '../src/hash.ts';
import { priorityOrder } from '../src/power.ts';
import { replay, Session } from '../src/session.ts';
import { findBoard, findFacility } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario, m2Scenario } from './helpers/scenarios.ts';

const DAY = 800;

/** The town, with no raids and a steady wind that powers everything, so that only what a test does changes it. */
function town(host = new FakeHost()): Session {
  return new Session(
    m2Scenario((j) => {
      j.tuning.emf.rumourThreshold = 1_000_000_000;
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
    }),
    1,
    host,
  );
}

function steps(s: Session, n: number): void {
  for (let i = 0; i < n; i++) s.step();
}

describe('facilities and installed boards', () => {
  it('lays out every facility of the town, each one working and powered, with no board until one is installed', () => {
    const s = town();
    expect(s.world.facilities.map((f) => [f.id, f.kind, f.condition, f.powered])).toEqual([
      ['H1', 'housing', 'ok', true],
      ['H2', 'housing', 'ok', true],
      ['P', 'power', 'ok', true],
      ['DA', 'datacenter', 'ok', true],
      ['W', 'warehouse', 'ok', true],
      ['DB', 'datacenter', 'ok', true],
      ['F1', 'farm', 'ok', true],
      ['F2', 'farm', 'ok', true],
      ['F3', 'farm', 'ok', true],
    ]);
    expect(s.world.facilities.map((f) => f.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(findFacility(s.world, 'H1')!.boardSpec).toBeNull();
    expect(findFacility(s.world, 'F1')!.boardSpec).toMatchObject({ clockHz: 1, instructionCap: 500, ramKb: 2 });
    expect(s.world.boards).toEqual([]);
  });

  it('starts the test scenario with its three boards installed, in scenario order', () => {
    const s = new Session(m1Scenario(), 1, new FakeHost());
    expect(s.world.boards.map((b) => [b.id, b.index, b.status, b.comm])).toEqual([
      ['P', 0, 'running', false],
      ['DA', 1, 'running', false],
      ['DB', 2, 'running', false],
    ]);
  });

  it('installs a board for its price: running, with no firmware, the facility worked by hand until a deploy', () => {
    const s = town();
    expect(s.install('F1', 'board')).toEqual({ ok: true });
    expect(s.world.money).toBe((5000 - 200) * MICRO);
    expect(s.world.ledger.installs).toBe(200 * MICRO);
    expect(findBoard(s.world, 'F1')).toMatchObject({
      id: 'F1',
      index: 6,
      kind: 'farm',
      status: 'running',
      comm: false,
      firmware: null,
      pending: null,
      period: 20,
      phase: 6,
    });
    expect(findBoard(s.world, 'F1')!.log.map((l) => l.text)).toEqual(['board installed']);
  });

  it("keeps the boards in the town's order, whatever order they were installed in", () => {
    const s = town();
    for (const id of ['F1', 'DB', 'P', 'W']) expect(s.install(id, 'board'), id).toEqual({ ok: true });
    expect(s.world.boards.map((b) => b.id)).toEqual(['P', 'W', 'DB', 'F1']);
  });

  it("ticks a board installed later on the beats its facility's place gives it, and names every facility to its firmware", () => {
    const host = new FakeHost();
    const src = host.program('noop', () => ({}));
    const s = town(host);
    s.install('DA', 'board'); // DA is facility 3: 5 Hz, period 4, phase 3 -> beats at steps 1, 5, 9, ...
    s.deploy('DA', src);
    steps(s, 1);
    expect(host.calls).toEqual([]);
    steps(s, 1);
    expect(host.calls).toEqual(['boot:DA', 'tick:DA']);
    expect(host.boots[0]!.facilityIds).toEqual(['H1', 'H2', 'P', 'DA', 'W', 'DB', 'F1', 'F2', 'F3']);
  });

  it('installs a comm module on a board for its price', () => {
    const s = town();
    s.install('P', 'board');
    expect(s.install('P', 'comm')).toEqual({ ok: true });
    expect(findBoard(s.world, 'P')!.comm).toBe(true);
    expect(s.world.money).toBe((5000 - 400 - 300) * MICRO);
    expect(s.world.ledger.installs).toBe(700 * MICRO);
    expect(findBoard(s.world, 'P')!.log.map((l) => l.text)).toEqual(['board installed', 'comm module installed']);
  });

  it('refuses an install it cannot make, with a code for the viewer, and changes nothing', () => {
    const s = town();
    s.install('P', 'board');
    s.install('P', 'comm');
    s.install('DB', 'board');
    findBoard(s.world, 'DB')!.status = 'destroyed';
    findFacility(s.world, 'W')!.condition = 'wrecked';
    const before = stateHash(s.world);
    expect(s.install('ZZ', 'board')).toEqual({
      ok: false,
      reason: 'unknown facility ZZ',
      refusal: { code: 'unknownFacility', facility: 'ZZ' },
    });
    expect(s.install('H1', 'board')).toEqual({ ok: false, reason: 'H1 takes no board', refusal: { code: 'takesNoBoard', facility: 'H1' } });
    expect(s.install('H1', 'comm')).toEqual({ ok: false, reason: 'H1 takes no board', refusal: { code: 'takesNoBoard', facility: 'H1' } });
    expect(s.install('P', 'board')).toEqual({
      ok: false,
      reason: 'P already has a board',
      refusal: { code: 'alreadyInstalled', facility: 'P', part: 'board' },
    });
    expect(s.install('P', 'comm')).toEqual({
      ok: false,
      reason: 'P already has a comm module',
      refusal: { code: 'alreadyInstalled', facility: 'P', part: 'comm' },
    });
    expect(s.install('F1', 'comm')).toEqual({ ok: false, reason: 'F1 has no board', refusal: { code: 'noBoard', facility: 'F1' } });
    expect(s.install('DB', 'comm')).toEqual({ ok: false, reason: "DB's board is down", refusal: { code: 'boardDown', facility: 'DB' } });
    expect(s.install('W', 'board')).toEqual({ ok: false, reason: 'W is wrecked', refusal: { code: 'wrecked', facility: 'W' } });
    expect(stateHash(s.world)).toBe(before);
    const money = s.world.money;
    s.world.money = 199 * MICRO;
    const poor = stateHash(s.world);
    expect(s.install('F1', 'board')).toEqual({ ok: false, reason: 'not enough money', refusal: { code: 'tooPoor' } });
    expect(stateHash(s.world)).toBe(poor);
    s.world.money = money;
    expect(s.record.inputs.filter((i) => i.kind === 'install')).toHaveLength(3); // only the three that went through
  });

  it('refuses an install once the season has ended', () => {
    const s = new Session(
      m2Scenario((j) => {
        j.time.secondsPerDay = 1;
        j.time.seasonDays = 1;
      }),
      1,
      new FakeHost(),
    );
    steps(s, 20);
    expect(s.world.ended?.kind).toBe('completed');
    expect(s.install('P', 'board')).toEqual({ ok: false, reason: 'the season has ended', refusal: { code: 'seasonEnded' } });
  });

  it('takes no firmware for a facility without a board, and records who deployed', () => {
    const s = town();
    expect(() => s.deploy('F1', 'x')).toThrow('F1 has no board');
    expect(() => s.deploy('ZZ', 'x')).toThrow('unknown board ZZ');
    s.install('F1', 'board');
    s.deploy('F1', 'a');
    s.deploy('F1', 'b', 'agent');
    expect(s.record.inputs.filter((i) => i.kind === 'deploy').map((i) => (i.kind === 'deploy' ? i.by : null))).toEqual(['player', 'agent']);
  });

  it('charges upkeep for installed boards only', () => {
    const bare = town();
    steps(bare, DAY);
    expect(bare.world.ledger.upkeep).toBe(0);
    const two = town();
    two.install('F1', 'board');
    two.install('F2', 'board');
    steps(two, DAY);
    expect(two.world.ledger.upkeep).toBe(20 * MICRO);
  });

  it('counts every facility but the plant as a consumer, in the order of the town', () => {
    const s = town();
    expect(priorityOrder(s.world).map((f) => f.id)).toEqual(['H1', 'H2', 'DA', 'W', 'DB', 'F1', 'F2', 'F3']);
    s.world.plant.priority = ['F3', 'DA'];
    expect(priorityOrder(s.world).map((f) => f.id)).toEqual(['F3', 'DA', 'H1', 'H2', 'W', 'DB', 'F1', 'F2']);
  });

  it('gives a board the power of its facility', () => {
    const s = new Session(
      m2Scenario((j) => {
        j.tuning.wind.start = 0;
        j.tuning.wind.maxChangePerSecond = 0;
      }),
      1,
      new FakeHost(),
    );
    s.install('F1', 'board');
    steps(s, 1);
    expect(findFacility(s.world, 'F1')!.powered).toBe(false);
    expect(findBoard(s.world, 'F1')!.powered).toBe(false);
    expect(s.world.plant.shed).toEqual(['H1', 'H2', 'F1']); // housing draws power of its own
  });

  it('does not end the season of a town that has no boards', () => {
    const s = town();
    steps(s, 10);
    expect(s.world.ended).toBeNull();
  });

  it('replays installs into the same state', () => {
    const live = town();
    live.install('P', 'board');
    steps(live, 10);
    live.install('P', 'comm');
    live.install('DA', 'board');
    steps(live, 30);
    const again = replay(live.scenario, live.seed, live.record, new FakeHost(), live.world.step);
    expect(stateHash(again.world)).toBe(stateHash(live.world));
    expect(live.record.inputs).toEqual([
      { step: 0, kind: 'install', facilityId: 'P', part: 'board' },
      { step: 10, kind: 'install', facilityId: 'P', part: 'comm' },
      { step: 10, kind: 'install', facilityId: 'DA', part: 'board' },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/test/facilities.test.ts`
Expected: FAIL, 13 of 14 tests, with messages such as:
- `TypeError: s.install is not a function`;
- `TypeError: Cannot read properties of undefined (reading 'map')`, because `world.facilities` does not exist;
- `AssertionError: expected [Function] to throw an error`, because Task 1 still builds a board for every facility, so a deploy to F1 goes through;
- `AssertionError: expected 70000000 to be +0`, the upkeep of those boards.

The one that passes, "does not end the season of a town that has no boards", passes for the same reason: Task 1's town has boards. It covers Step 4's guard on the fall. Without the guard it fails with `expected { kind: 'fallen', step: +0 } to be null`, because `every` over no boards is true.

- [ ] **Step 3: Give the world its facilities**

`packages/core/src/world.ts` becomes:

```ts
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
  /** A cooling cycle covers steps coolFrom <= step < coolUntil. */
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
    stats: { raids: 0, boardsLost: 0, instructions: 0, deploys: 0 },
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
```

- [ ] **Step 4: Refusals, installs, and the session's commands**

`packages/core/src/refusal.ts` becomes:

```ts
/**
 * Why the server refused a command of the viewer. It travels with the English message, which agents and logs read, so that the viewer
 * can say it in Korean: every code has its text in the viewer (viewer/src/refusals.ts), where a new code is a type error until its
 * text is written. A refusal with no code is shown in a Korean sentence that carries the English one.
 */
export type Refusal =
  | { readonly code: 'noAgent' }
  | { readonly code: 'noSeason' }
  | { readonly code: 'crashed'; readonly reason: string }
  | { readonly code: 'seasonEnded' }
  | { readonly code: 'unknownBoard'; readonly board: string }
  | { readonly code: 'notDestroyed'; readonly board: string }
  | { readonly code: 'tooPoor' }
  | { readonly code: 'badCommand'; readonly detail: string }
  | { readonly code: 'unknownFacility'; readonly facility: string }
  /** A board command to a facility without one. */
  | { readonly code: 'noBoard'; readonly facility: string }
  /** An install on a facility that takes no board (housing). */
  | { readonly code: 'takesNoBoard'; readonly facility: string }
  | { readonly code: 'alreadyInstalled'; readonly facility: string; readonly part: 'board' | 'comm' }
  /** A comm module for a board that is destroyed or being rebuilt. */
  | { readonly code: 'boardDown'; readonly facility: string }
  /** The facility is wrecked or being repaired. */
  | { readonly code: 'wrecked'; readonly facility: string }
  | { readonly code: 'notWrecked'; readonly facility: string }
  /** A board's rebuild before its facility is repaired. */
  | { readonly code: 'repairFirst'; readonly facility: string }
  /** An agent's board tool on a board below T2. */
  | { readonly code: 'noComm'; readonly board: string }
  /** A hand action that cannot apply now. */
  | { readonly code: 'cannotAct'; readonly facility: string; readonly detail: string };
```

`packages/core/src/economy.ts` becomes:

```ts
import { clearFlag, raiseAlert, raiseOnce } from './alerts.ts';
import { appendLog } from './boards.ts';
import { MICRO, mulDiv } from './fixed.ts';
import type { Refusal } from './refusal.ts';
import { takesBoard } from './scenario.ts';
import type { CommandResult, InstallPart } from './session.ts';
import { seasonSteps, stepsForSeconds, stepsPerDay } from './time.ts';
import { type BoardState, createBoard, type EndKind, findBoard, findFacility, type SimContext } from './world.ts';

/** Phase 10a: fuel for the thermal output the power phase made this step, and upkeep for every running or sleeping board. */
export function runEconomy(ctx: SimContext): void {
  const w = ctx.world;
  const spd = stepsPerDay(ctx.scenario.time);
  // Generation is the wind plus the thermal output, and phase 3 left both. The plant's firmware (phase 5) or a smash (phase 8)
  // may have changed the setting or the board since, but the module ran as phase 3 found it.
  const thermal = w.plant.generation - w.plant.wind;
  const fuel = mulDiv(thermal * w.plant.fuelPrice, MICRO, spd);
  const intact = w.boards.filter((b) => b.status === 'running' || b.status === 'asleep').length;
  const upkeep = mulDiv(intact * ctx.scenario.tuning.boardUpkeepPerDay, MICRO, spd);
  w.money -= fuel + upkeep;
  w.ledger.fuel += fuel;
  w.ledger.upkeep += upkeep;
}

function end(ctx: SimContext, step: number, kind: EndKind, message: string): void {
  ctx.world.ended = { kind, step };
  raiseAlert(ctx.world, step, 'seasonEnd', null, message);
}

/** Phase 10b: bankruptcy, then the town's fall, then the season's last step. */
export function checkEnd(ctx: SimContext, step: number): void {
  const w = ctx.world;
  if (w.ended) return;
  if (w.money < 0) {
    w.belowZeroSince ??= step;
    raiseOnce(w, 'belowZero', step, 'moneyBelowZero', null, '자금이 바닥났어요');
  } else {
    w.belowZeroSince = null;
    clearFlag(w, 'belowZero');
  }
  const spd = stepsPerDay(ctx.scenario.time);
  if (w.belowZeroSince !== null && step - w.belowZeroSince + 1 >= ctx.scenario.tuning.bankruptcyDays * spd) {
    end(ctx, step, 'bankrupt', '파산했어요');
  } else if (w.boards.length > 0 && w.boards.every((b) => b.status === 'destroyed' || b.status === 'rebuilding')) {
    end(ctx, step, 'fallen', '마을이 함락됐어요');
  } else if (step + 1 >= seasonSteps(ctx.scenario.time)) {
    end(ctx, step, 'completed', '시즌이 끝났어요');
  }
}

function refuse(reason: string, refusal: Refusal): CommandResult {
  return { ok: false, reason, refusal };
}

/** Takes money for something the player bought, or answers false when there isn't enough. */
function pay(ctx: SimContext, amount: number, line: 'installs' | 'repairs' | 'rebuild'): boolean {
  const cost = amount * MICRO;
  if (ctx.world.money < cost) return false;
  ctx.world.money -= cost;
  ctx.world.ledger[line] += cost;
  return true;
}

/**
 * The player buys a facility's board (T1) or its board's comm module (T2). A new board runs with no firmware, so the facility goes
 * on by hand until the player deploys some; it joins the boards in its facility's place, whatever order the boards came in.
 */
export function installPart(ctx: SimContext, facilityId: string, part: InstallPart, step: number): CommandResult {
  const w = ctx.world;
  const facility = findFacility(w, facilityId);
  if (!facility) return refuse(`unknown facility ${facilityId}`, { code: 'unknownFacility', facility: facilityId });
  const spec = ctx.scenario.facilities[facility.index]!;
  if (!takesBoard(facility.kind) || spec.board === null) {
    return refuse(`${facilityId} takes no board`, { code: 'takesNoBoard', facility: facilityId });
  }
  if (facility.condition !== 'ok') return refuse(`${facilityId} is wrecked`, { code: 'wrecked', facility: facilityId });
  const board = findBoard(w, facilityId);
  const prices = ctx.scenario.tuning.install;
  if (part === 'board') {
    if (board) return refuse(`${facilityId} already has a board`, { code: 'alreadyInstalled', facility: facilityId, part });
    if (!pay(ctx, prices.boardPrice[facility.kind], 'installs')) return refuse('not enough money', { code: 'tooPoor' });
    const created = createBoard(ctx.scenario, spec, facility.index);
    created.powered = facility.powered;
    const at = w.boards.findIndex((b) => b.index > facility.index);
    w.boards.splice(at === -1 ? w.boards.length : at, 0, created);
    appendLog(created, step, 'system', 'board installed');
    return { ok: true };
  }
  if (!board) return refuse(`${facilityId} has no board`, { code: 'noBoard', facility: facilityId });
  if (board.status === 'destroyed' || board.status === 'rebuilding') {
    return refuse(`${facilityId}'s board is down`, { code: 'boardDown', facility: facilityId });
  }
  if (board.comm) return refuse(`${facilityId} already has a comm module`, { code: 'alreadyInstalled', facility: facilityId, part });
  if (!pay(ctx, prices.commPrice, 'installs')) return refuse('not enough money', { code: 'tooPoor' });
  board.comm = true;
  appendLog(board, step, 'system', 'comm module installed');
  return { ok: true };
}

/** The human's rebuild of a destroyed board: it pays now and comes back after the rebuild time. */
export function startRebuild(ctx: SimContext, board: BoardState, step: number): CommandResult {
  const t = ctx.scenario.tuning.rebuild;
  if (board.status !== 'destroyed')
    return { ok: false, reason: `${board.id} is not destroyed`, refusal: { code: 'notDestroyed', board: board.id } };
  if (!pay(ctx, t.cost, 'rebuild')) return { ok: false, reason: 'not enough money', refusal: { code: 'tooPoor' } };
  board.status = 'rebuilding';
  board.readyAt = step + stepsForSeconds(ctx.scenario.time, t.seconds);
  appendLog(board, step, 'system', `rebuilding (ready in ${t.seconds} s)`);
  return { ok: true };
}
```

`packages/core/src/session.ts` becomes:

```ts
import { applyActions } from './actions.ts';
import { deployFirmware, runTransitions } from './boards.ts';
import { runDatacenters, runFires } from './datacenter.ts';
import { checkEnd, installPart, runEconomy, startRebuild } from './economy.ts';
import { runEmf } from './emf.ts';
import type { FirmwareHost } from './firmware-host.ts';
import { runLuddites, runRumour } from './luddites.ts';
import { runPower } from './power.ts';
import type { Refusal } from './refusal.ts';
import { createRng, deriveSeed } from './rng.ts';
import type { Scenario } from './scenario.ts';
import { runSeries } from './series.ts';
import { runBoardTicks } from './ticks.ts';
import { type Alert, createWorld, findBoard, findFacility, type SimContext, type Streams, type WorldState } from './world.ts';

/** Who deployed a firmware: the player from the game's editor, or an agent over MCP. */
export type DeployedBy = 'player' | 'agent';

/** What the player buys for a facility: its board (T1), or the board's comm module (T2). */
export type InstallPart = 'board' | 'comm';

/** Every command of the player answers this: done, or why not (English for agents and logs, a code for the viewer's Korean). */
export type CommandResult = { readonly ok: true } | { readonly ok: false; readonly reason: string; readonly refusal: Refusal };

/** Milestone 1's name for a rebuild's answer. */
export type RebuildResult = CommandResult;

export type RecordedInput =
  | {
      readonly step: number;
      readonly kind: 'deploy';
      readonly boardId: string;
      readonly version: number;
      readonly source: string;
      readonly by: DeployedBy;
    }
  | { readonly step: number; readonly kind: 'install'; readonly facilityId: string; readonly part: InstallPart }
  | { readonly step: number; readonly kind: 'rebuild'; readonly boardId: string }
  | { readonly step: number; readonly kind: 'pause' | 'resume' };

const SEASON_ENDED: CommandResult = { ok: false, reason: 'the season has ended', refusal: { code: 'seasonEnded' } };

export interface SessionRecord {
  readonly scenarioId: string;
  readonly seed: number;
  readonly inputs: RecordedInput[];
}

export interface StepReport {
  /** The world's step after this one. */
  readonly step: number;
  readonly alerts: readonly Alert[];
  readonly ended: WorldState['ended'];
}

export class Session {
  readonly scenario: Scenario;
  readonly seed: number;
  readonly world: WorldState;
  readonly record: SessionRecord;
  /** What every phase reads and changes; the server's queries read it too. */
  readonly ctx: SimContext;

  constructor(scenario: Scenario, seed: number, host: FirmwareHost) {
    this.scenario = scenario;
    this.seed = seed;
    this.world = createWorld(scenario);
    this.record = { scenarioId: scenario.id, seed, inputs: [] };
    const rng: Streams = {
      weather: createRng(deriveSeed(seed, 'weather')),
      market: createRng(deriveSeed(seed, 'market')),
      fire: createRng(deriveSeed(seed, 'fire')),
      luddites: createRng(deriveSeed(seed, 'luddites')),
    };
    this.ctx = { scenario, world: this.world, host, seed, rng };
  }

  /** Advances the world by one step and reports the alerts raised during it. */
  step(): StepReport {
    const w = this.world;
    if (w.ended) return { step: w.step, alerts: [], ended: w.ended };
    const s = w.step;
    const firstAlert = w.nextAlertId;
    runTransitions(this.ctx, s);
    runSeries(this.ctx, s);
    runPower(this.ctx, s);
    const ticked = runBoardTicks(this.ctx, s);
    applyActions(this.ctx, s, ticked);
    runDatacenters(this.ctx, s);
    runEmf(this.ctx, ticked);
    runRumour(this.ctx, s);
    runLuddites(this.ctx, s);
    runFires(this.ctx, s);
    runEconomy(this.ctx);
    checkEnd(this.ctx, s);
    w.step = s + 1;
    return { step: w.step, alerts: w.alerts.filter((a) => a.id >= firstAlert), ended: w.ended };
  }

  /** Queues firmware for a board; it becomes current at the board's next tick. A facility without a board takes no firmware. */
  deploy(boardId: string, source: string, by: DeployedBy = 'player'): { version: number } {
    const board = findBoard(this.world, boardId);
    if (!board) throw new Error(findFacility(this.world, boardId) ? `${boardId} has no board` : `unknown board ${boardId}`);
    const version = deployFirmware(board, source);
    this.record.inputs.push({ step: this.world.step, kind: 'deploy', boardId, version, source, by });
    return { version };
  }

  /** The player buys a facility's board or its board's comm module. Refused once the season has ended: money is the score. */
  install(facilityId: string, part: InstallPart): CommandResult {
    if (this.world.ended) return SEASON_ENDED;
    const result = installPart(this.ctx, facilityId, part, this.world.step);
    if (result.ok) this.record.inputs.push({ step: this.world.step, kind: 'install', facilityId, part });
    return result;
  }

  /** The human's rebuild of a destroyed board. Refused once the season has ended: money is the score, and a replay stops there. */
  rebuild(boardId: string): CommandResult {
    if (this.world.ended) return SEASON_ENDED;
    const board = findBoard(this.world, boardId);
    if (!board) return { ok: false, reason: `unknown board ${boardId}`, refusal: { code: 'unknownBoard', board: boardId } };
    const result = startRebuild(this.ctx, board, this.world.step);
    if (result.ok) this.record.inputs.push({ step: this.world.step, kind: 'rebuild', boardId });
    return result;
  }

  /** Records a pause or a resume; the world doesn't change. */
  mark(kind: 'pause' | 'resume'): void {
    this.record.inputs.push({ step: this.world.step, kind });
  }

  close(): void {
    this.ctx.host.close();
  }
}

/** Rebuilds a session from its record, up to (not including) the given step. */
export function replay(scenario: Scenario, seed: number, record: SessionRecord, host: FirmwareHost, untilStep: number): Session {
  const session = new Session(scenario, seed, host);
  let next = 0;
  while (session.world.step < untilStep && !session.world.ended) {
    while (next < record.inputs.length && record.inputs[next]!.step === session.world.step) {
      const input = record.inputs[next]!;
      if (input.kind === 'deploy') session.deploy(input.boardId, input.source, input.by);
      else if (input.kind === 'install') session.install(input.facilityId, input.part);
      else if (input.kind === 'rebuild') session.rebuild(input.boardId);
      else session.mark(input.kind);
      next += 1;
    }
    session.step();
  }
  return session;
}
```

- [ ] **Step 5: Power by facility**

`packages/core/src/power.ts` becomes:

```ts
import { clearFlag, raiseOnce } from './alerts.ts';
import { appendLog } from './boards.ts';
import { mulDiv } from './fixed.ts';
import { stepsForSeconds } from './time.ts';
import { type BoardState, type FacilityState, findBoard, manhattan, type SimContext, type WorldState } from './world.ts';

/** The town's one power plant (the scenario guarantees it). */
export function plantFacility(world: WorldState): FacilityState {
  const plant = world.facilities.find((f) => f.kind === 'power');
  if (!plant) throw new Error('the scenario has no power plant');
  return plant;
}

/** What a board itself draws: its parts while running, sleep power while asleep, nothing while destroyed or being rebuilt. */
function boardDraw(ctx: SimContext, board: BoardState | undefined): number {
  if (!board) return 0;
  if (board.status === 'running') return board.spec.power;
  if (board.status === 'asleep') return ctx.scenario.tuning.sleepPower;
  return 0;
}

/**
 * What a facility requests this step, transmission loss included: its board's draw, a datacenter's job and cooling on the steps
 * their windows cover, and housing's own use. A wrecked or repairing facility requests nothing.
 */
export function facilityDemand(ctx: SimContext, facility: FacilityState, step: number): number {
  if (facility.condition !== 'ok') return 0;
  const t = ctx.scenario.tuning;
  let base = boardDraw(ctx, findBoard(ctx.world, facility.id));
  const dc = ctx.world.datacenters[facility.id];
  if (dc) {
    if (dc.busyFrom <= step && step < dc.busyUntil) base += t.datacenter.processPower;
    if (dc.coolFrom <= step && step < dc.coolUntil) base += t.datacenter.coolingPower;
  }
  if (facility.kind === 'housing') base += t.housing.power;
  const plant = plantFacility(ctx.world);
  const distance = manhattan(facility.x, facility.y, plant.x, plant.y);
  return base + mulDiv(base, t.transmissionLossPctPerCell * distance, 100);
}

/** Consumers (every facility but the plant), highest priority first: the plant's list, then the rest in scenario order. */
export function priorityOrder(world: WorldState): FacilityState[] {
  const consumers = world.facilities.filter((f) => f.kind !== 'power');
  const listed = world.plant.priority ?? [];
  const first = listed.map((id) => consumers.find((f) => f.id === id)).filter((f): f is FacilityState => f !== undefined);
  return [...first, ...consumers.filter((f) => !first.includes(f))];
}

/**
 * What a board's own log says of its power. A cut is logged as it happens, so a plant that flickers leaves one folded "power lost" line
 * and not a line a step; "power back" comes only once the board has had power, unbroken, for the quiet time since its last cut, so it
 * never interleaves with a flicker. A board that is smashed or being rebuilt owes no "power back" (its own lines say what happened),
 * and one that is rebuilt starts fresh.
 */
function logPower(ctx: SimContext, board: BoardState, wasPowered: boolean, step: number): void {
  if (board.status !== 'running' && board.status !== 'asleep') {
    board.lastCutStep = null;
    return;
  }
  const quietSeconds = ctx.scenario.tuning.shortageQuietSeconds;
  if (!board.powered) {
    if (wasPowered) appendLog(board, step, 'system', 'power lost');
    board.lastCutStep = step;
  } else if (board.lastCutStep !== null && step - board.lastCutStep >= stepsForSeconds(ctx.scenario.time, quietSeconds)) {
    appendLog(board, step, 'system', quietSeconds > 0 ? `power back (steady for ${quietSeconds} s)` : 'power back');
    board.lastCutStep = null;
  }
}

/** Phase 3: generation, demand, and shedding. The grid sheds whole facilities; a facility's board has power when its facility has. */
export function runPower(ctx: SimContext, step: number): void {
  const w = ctx.world;
  const plant = plantFacility(w);
  const plantBoard = findBoard(w, plant.id);
  const thermal = plantBoard?.status === 'running' ? w.plant.thermalSetting : 0;
  const generation = w.plant.wind + thermal;
  const plantDraw = facilityDemand(ctx, plant, step);
  const order = priorityOrder(w);
  const demands = order.map((f) => facilityDemand(ctx, f, step));
  const available = generation - plantDraw;
  let load = demands.reduce((a, b) => a + b, 0);
  const powered = order.map(() => true);
  for (let i = order.length - 1; i >= 0 && load > available; i--) {
    if (demands[i] === 0) continue;
    powered[i] = false;
    load -= demands[i]!;
  }
  // The plant's own board is never shed, even when nothing is generated, so its firmware can always start the thermal module.
  plant.powered = true;
  if (plantBoard) plantBoard.powered = true;
  order.forEach((f, i) => {
    f.powered = powered[i]!;
    const board = findBoard(w, f.id);
    if (!board) return;
    const was = board.powered;
    board.powered = f.powered;
    logPower(ctx, board, was, step);
  });
  w.plant.generation = generation;
  w.plant.demand = plantDraw + demands.reduce((a, b) => a + b, 0);
  w.plant.shed = order.filter((_, i) => !powered[i] && demands[i]! > 0).map((f) => f.id);
  if (w.plant.shed.length > 0) {
    w.plant.lastShedStep = step;
    raiseOnce(w, 'shortage', step, 'powerShortage', null, `전력 부족: ${w.plant.shed.join(', ')} 정전`);
  } else if (
    w.plant.lastShedStep !== null &&
    step - w.plant.lastShedStep >= stepsForSeconds(ctx.scenario.time, ctx.scenario.tuning.shortageQuietSeconds)
  ) {
    // The episode ends only after the grid has been quiet for a while: a plant that sheds and re-powers again and again would
    // otherwise raise an alert at every turn, flood get_alerts and push the older alerts out of the buffer.
    clearFlag(w, 'shortage');
  }
}
```

- [ ] **Step 6: The datacenter on its busy and cool windows**

`packages/core/src/datacenter.ts` becomes:

```ts
import { clearFlag, raiseAlert, raiseOnce } from './alerts.ts';
import { destroyBoard } from './boards.ts';
import { idiv, MICRO, MILLI, mulDiv } from './fixed.ts';
import { findFacility, type SimContext } from './world.ts';

/** Steps one cooling cycle lasts. The scenario makes it a whole number. */
export function coolSteps(ctx: SimContext): number {
  return idiv(ctx.scenario.tuning.datacenter.coolingCycleMs * ctx.scenario.time.stepsPerSecond, 1000);
}

/** Whether a datacenter works at this step: it stands, the grid supplies it, and its busy window covers the step. */
export function isProcessing(ctx: SimContext, facilityId: string, step: number): boolean {
  const facility = findFacility(ctx.world, facilityId);
  const dc = ctx.world.datacenters[facilityId];
  return !!facility && !!dc && facility.condition === 'ok' && facility.powered && dc.busyFrom <= step && step < dc.busyUntil;
}

/** Whether a datacenter cools at this step: the same, for its cool window. */
export function isCooling(ctx: SimContext, facilityId: string, step: number): boolean {
  const facility = findFacility(ctx.world, facilityId);
  const dc = ctx.world.datacenters[facilityId];
  return !!facility && !!dc && facility.condition === 'ok' && facility.powered && dc.coolFrom <= step && step < dc.coolUntil;
}

/** Phase 6: income, heat, and cooling for every datacenter. */
export function runDatacenters(ctx: SimContext, step: number): void {
  const t = ctx.scenario.tuning.datacenter;
  const sps = ctx.scenario.time.stepsPerSecond;
  const w = ctx.world;
  for (const facility of w.facilities) {
    const dc = w.datacenters[facility.id];
    if (!dc) continue;
    let temp = dc.tempMilli;
    if (isProcessing(ctx, facility.id, step)) {
      const income = mulDiv(w.jobPrice, MICRO, sps);
      w.money += income;
      w.ledger.datacenterIncome += income;
      temp += idiv(t.heatMilliPerSecond, sps);
    }
    temp -= idiv((temp - t.ambientMilli) * t.passiveCoolingPctPerSecond, 100 * sps);
    if (isCooling(ctx, facility.id, step)) temp -= idiv(t.coolingDropMilli, coolSteps(ctx));
    dc.tempMilli = Math.max(temp, t.ambientMilli);
    if (dc.tempMilli >= t.overheatAlertMilli) {
      raiseOnce(w, `overheat:${facility.id}`, step, 'overheat', facility.id, `${facility.id} 과열 ${idiv(dc.tempMilli, MILLI)}°C`);
    } else if (dc.tempMilli < t.overheatAlertMilli - 5 * MILLI) {
      clearFlag(w, `overheat:${facility.id}`);
    }
  }
}

/** Phase 9: a datacenter above the fire threshold rolls for fire every step. */
export function runFires(ctx: SimContext, step: number): void {
  const t = ctx.scenario.tuning.datacenter;
  const sps = ctx.scenario.time.stepsPerSecond;
  for (const board of ctx.world.boards) {
    const dc = ctx.world.datacenters[board.id];
    if (!dc || board.status === 'destroyed' || board.status === 'rebuilding') continue;
    if (dc.tempMilli <= t.fireThresholdMilli) continue;
    const ppm = idiv((dc.tempMilli - t.fireThresholdMilli) * t.firePermillePerDegreePerSecond, sps);
    if (ctx.rng.fire.chancePpm(ppm)) {
      raiseAlert(ctx.world, step, 'fire', board.id, `${board.id}에 불이 났어요`);
      destroyBoard(ctx, board, step, 'fire');
    }
  }
}
```

`packages/core/src/actions.ts` becomes:

```ts
import { startSleep } from './boards.ts';
import { coolSteps } from './datacenter.ts';
import { clamp } from './fixed.ts';
import type { Ticked } from './ticks.ts';
import { type SimContext, toInt } from './world.ts';

/** Phase 5: applies what each tick asked for. A failed tick asks for nothing. */
export function applyActions(ctx: SimContext, step: number, ticked: readonly Ticked[]): void {
  const t = ctx.scenario.tuning;
  // A priority list names facilities, with a board or not: housing is a consumer too.
  const known = new Set(ctx.world.facilities.map((f) => f.id));
  for (const { board, outcome } of ticked) {
    let processed = false;
    for (const action of outcome.actions) {
      if (board.status !== 'running') break; // a sleep stops the rest of the list
      const dc = ctx.world.datacenters[board.id];
      switch (action.kind) {
        case 'process':
          if (dc && !processed) {
            processed = true;
            // The power phase charged this step under the old window, so a job still running at it goes on: no step is lost.
            // It runs until the board's next tick, as in milestone 1.
            const running = dc.busyFrom <= step && step < dc.busyUntil;
            if (!running) dc.busyFrom = step + 1;
            dc.busyUntil = step + board.period + 1;
          }
          break;
        case 'cool':
          // A level above 0 starts a cooling cycle at the next step, unless one covers that step; level 0 does nothing.
          if (dc && toInt(action.level) > 0 && !(dc.coolFrom <= step + 1 && step + 1 < dc.coolUntil)) {
            dc.coolFrom = step + 1;
            dc.coolUntil = step + 1 + coolSteps(ctx);
          }
          break;
        case 'setThermal':
          if (board.kind === 'power') ctx.world.plant.thermalSetting = clamp(toInt(action.output), 0, t.thermal.max);
          break;
        case 'setPriority':
          if (board.kind === 'power') ctx.world.plant.priority = [...new Set(action.order.filter((id) => known.has(id)))];
          break;
        case 'sleep':
          startSleep(ctx, board, step, action.seconds);
          break;
      }
    }
  }
}
```

In `packages/core/src/boards.ts`, `shutdownVm` ends both windows:

```ts
export function shutdownVm(ctx: SimContext, board: BoardState): void {
  if (board.vmBooted) {
    ctx.host.shutdown(board.id);
    board.vmBooted = false;
  }
  // A datacenter works only through its board here: a board that sleeps or is destroyed ends its job and its cooling.
  const dc = ctx.world.datacenters[board.id];
  if (dc) {
    dc.busyFrom = -1;
    dc.busyUntil = -1;
    dc.coolFrom = -1;
    dc.coolUntil = -1;
  }
}
```

and in `runTransitions`, a finished rebuild resets only the temperature. The board's destruction already ended the windows:

```ts
      board.status = 'running';
      board.readyAt = null;
      // A rebuilt datacenter is new hardware: the wreck's heat doesn't come back with it.
      const dc = ctx.world.datacenters[board.id];
      if (dc) dc.tempMilli = ctx.scenario.tuning.datacenter.ambientMilli;
      appendLog(board, step, 'system', 'rebuilt');
```

In `packages/core/src/ticks.ts`, `runBoardTicks` names every facility to the firmware, not only the ones with boards:

```ts
  // Firmware names facilities by id (set_priority, dispatch): every facility of the town, with a board or not.
  const facilityIds = ctx.world.facilities.map((f) => f.id);
```

In `packages/core/src/firmware-host.ts`, `BootInfo.kind` is a board kind. Import `BoardKind` in place of `FacilityKind`:

```ts
import type { BoardKind, BoardSpec } from './scenario.ts';
```

and declare:

```ts
  readonly kind: BoardKind;
```

- [ ] **Step 7: The views and the datasheet**

In `packages/core/src/queries.ts`, the imports become:

```ts
import { isCooling, isProcessing } from './datacenter.ts';
import { type Datasheet, datasheet } from './datasheet.ts';
import { idiv, MICRO, MILLI } from './fixed.ts';
import { pathTo } from './luddites.ts';
import { facilityDemand, plantFacility, priorityOrder } from './power.ts';
import type { FacilityKind, Scenario } from './scenario.ts';
import { sensorFrame } from './sensors.ts';
import { gameTime } from './time.ts';
import {
  type Alert,
  type AlertKind,
  type BoardState,
  type BoardStatus,
  type EndKind,
  findBoard,
  findFacility,
  type LogLine,
  manhattan,
  type SimContext,
  type WorldState,
} from './world.ts';
```

`mapView` finds the plant with `const plant = plantFacility(ctx.world);`, and the snapshot's board rows read the windows:

```ts
        processing: dc ? isProcessing(ctx, b.id, s) : false,
        cooling: dc && isCooling(ctx, b.id, s) ? 1 : 0,
        demand: facilityDemand(ctx, findFacility(w, b.id)!, s),
```

In `packages/core/src/datasheet.ts`, the imports become:

```ts
import { idiv, MILLI } from './fixed.ts';
import { facilityDemand, plantFacility } from './power.ts';
import type { BoardKind, SensorName, Tuning } from './scenario.ts';
import { SENSOR_KEYS } from './sensors.ts';
import type { TimeConfig } from './time.ts';
import { findBoard, findFacility, manhattan, type SimContext } from './world.ts';
```

Then make four changes:
- `actionDocs` returns `Record<BoardKind | 'any', ReadonlyArray<{ call: string; meaning: string }>>`, and its `housing: []` entry goes, since housing takes no board.
- `Datasheet.facility.kind` is a `BoardKind`.
- In `datasheet()`, `const plant = plantFacility(ctx.world);`, and `powerDrawNow: facilityDemand(ctx, findFacility(ctx.world, board.id)!, ctx.world.step),`.
- The datacenter's `io.cool(level)` entry and the sleep rule describe the cycle:

```ts
      {
        call: 'io.cool(level)',
        meaning: `a cooling cycle (level above 0; 0 does nothing): it takes ${milli(dc.coolingDropMilli)} °C off over ${dc.coolingCycleMs / 1000} s, in even steps, and draws ${dc.coolingPower} power while it runs; a call during a cycle does nothing`,
      },
```

```ts
    "A facility's setting (the thermal output, the priority list) keeps its value through a sleep, while mem and globals are wiped. A sleep ends the datacenter's job and its cooling cycle, and the thermal module only works while its board is awake.",
```

- [ ] **Step 8: The viewer's Korean for the new refusals**

`packages/viewer/src/refusals.ts` becomes:

```ts
import type { Refusal } from '@turing-city/core';

/** What the player reads when the server refuses something with no code of its own, or with one this viewer has no text for. */
const unknown = (message: string): string => `서버가 명령을 받아들이지 않았어요: ${message}`;

/**
 * A refusal of the server, in Korean (the server's own words are English, for agents and logs). Every code of core's Refusal has its
 * text here: a new code is a type error at the end of the switch until it gets one. A refusal with no code, or a code of a newer
 * server, is a Korean sentence that carries the server's English text.
 */
export function refusalText(message: string, refusal: Refusal | undefined): string {
  if (!refusal) return unknown(message);
  switch (refusal.code) {
    case 'noAgent':
      return '에이전트가 연결돼 있지 않아요. 에이전트를 연결한 뒤에 다시 해보세요.';
    case 'noSeason':
      return '시즌이 아직 시작되지 않았어요.';
    case 'crashed':
      return `시즌이 멈췄어요 (${refusal.reason}). 새 시즌을 시작할 수 있어요.`;
    case 'seasonEnded':
      return '시즌이 이미 끝나서 할 수 없어요.';
    case 'unknownBoard':
      return `'${refusal.board}' 보드는 없어요.`;
    case 'notDestroyed':
      return `'${refusal.board}' 보드는 부서진 상태가 아니라서 재건할 수 없어요.`;
    case 'tooPoor':
      return '자금이 모자라서 할 수 없어요.';
    case 'badCommand':
      return `서버가 알아듣지 못하는 명령이에요 (${refusal.detail}).`;
    case 'unknownFacility':
      return `'${refusal.facility}' 시설은 없어요.`;
    case 'noBoard':
      return `'${refusal.facility}'에는 보드가 없어요. 먼저 보드를 설치하세요.`;
    case 'takesNoBoard':
      return `'${refusal.facility}'에는 보드를 달 수 없어요.`;
    case 'alreadyInstalled':
      return `'${refusal.facility}'에는 이미 ${refusal.part === 'board' ? '보드가' : '통신 모듈이'} 있어요.`;
    case 'boardDown':
      return `'${refusal.facility}'의 보드가 부서져 있어서 통신 모듈을 달 수 없어요.`;
    case 'wrecked':
      return `'${refusal.facility}' 시설이 부서져 있어요. 먼저 복구하세요.`;
    case 'notWrecked':
      return `'${refusal.facility}' 시설은 부서진 상태가 아니에요.`;
    case 'repairFirst':
      return `'${refusal.facility}' 시설을 먼저 복구해야 보드를 재건할 수 있어요.`;
    case 'noComm':
      return `'${refusal.board}' 보드에는 통신 모듈이 없어요.`;
    case 'cannotAct':
      return `'${refusal.facility}'에서 지금은 할 수 없어요 (${refusal.detail}).`;
    default:
      return exhausted(refusal, message);
  }
}

/** Reached only with a code this viewer does not know; the parameter's type is `never` so that a handled code is not missing above. */
function exhausted(_refusal: never, message: string): string {
  return unknown(message);
}
```

In `packages/viewer/test/refusals.test.ts`, `SAMPLES` gains the new codes:

```ts
const SAMPLES: Record<Refusal['code'], Refusal> = {
  noAgent: { code: 'noAgent' },
  noSeason: { code: 'noSeason' },
  crashed: { code: 'crashed', reason: 'the simulator stopped responding; the session stopped' },
  seasonEnded: { code: 'seasonEnded' },
  unknownBoard: { code: 'unknownBoard', board: 'ZZ' },
  notDestroyed: { code: 'notDestroyed', board: 'DA' },
  tooPoor: { code: 'tooPoor' },
  badCommand: { code: 'badCommand', detail: 'speed: Invalid input' },
  unknownFacility: { code: 'unknownFacility', facility: 'ZZ' },
  noBoard: { code: 'noBoard', facility: 'F1' },
  takesNoBoard: { code: 'takesNoBoard', facility: 'H1' },
  alreadyInstalled: { code: 'alreadyInstalled', facility: 'DA', part: 'comm' },
  boardDown: { code: 'boardDown', facility: 'DB' },
  wrecked: { code: 'wrecked', facility: 'W' },
  notWrecked: { code: 'notWrecked', facility: 'F2' },
  repairFirst: { code: 'repairFirst', facility: 'DA' },
  noComm: { code: 'noComm', board: 'P' },
  cannotAct: { code: 'cannotAct', facility: 'F3', detail: 'nothing is ripe' },
};
```

Replace the test "names the board, the reason, or what was wrong, where the refusal has one" with:

```ts
  it('names the board, the reason, or what was wrong, where the refusal has one', () => {
    expect(refusalText('x', SAMPLES.unknownBoard)).toContain('ZZ');
    expect(refusalText('x', SAMPLES.notDestroyed)).toContain('DA');
    expect(refusalText('x', SAMPLES.crashed)).toContain('the simulator stopped responding; the session stopped');
    expect(refusalText('x', SAMPLES.badCommand)).toContain('speed: Invalid input');
    for (const code of [
      'unknownFacility',
      'noBoard',
      'takesNoBoard',
      'alreadyInstalled',
      'boardDown',
      'wrecked',
      'notWrecked',
      'repairFirst',
    ] as const) {
      const refusal = SAMPLES[code] as { facility: string };
      expect(refusalText('x', SAMPLES[code]), code).toContain(refusal.facility);
    }
    expect(refusalText('x', SAMPLES.noComm)).toContain('P');
    expect(refusalText('x', SAMPLES.cannotAct)).toContain('nothing is ripe');
  });
```

Replace the test "says what each of the five that the player meets says: no agent, not destroyed, too little money, the season over, a bad message" with:

```ts
  it('says what each of the five that the player meets says: no agent, not destroyed, too little money, the season over, a bad message', () => {
    expect(refusalText('x', SAMPLES.noAgent)).toBe('에이전트가 연결돼 있지 않아요. 에이전트를 연결한 뒤에 다시 해보세요.');
    expect(refusalText('x', SAMPLES.notDestroyed)).toBe("'DA' 보드는 부서진 상태가 아니라서 재건할 수 없어요.");
    expect(refusalText('x', SAMPLES.tooPoor)).toBe('자금이 모자라서 할 수 없어요.');
    expect(refusalText('x', SAMPLES.seasonEnded)).toBe('시즌이 이미 끝나서 할 수 없어요.');
    expect(refusalText('x', SAMPLES.badCommand)).toBe('서버가 알아듣지 못하는 명령이에요 (speed: Invalid input).');
  });
```

- [ ] **Step 9: Bring milestone 1's tests to facilities and windows**

The windows are half-open, so a milestone-1 job `jobFrom..jobUntil` is `busyFrom = jobFrom`, `busyUntil = jobUntil + 1`. Functions that took a board now take its facility. An open-ended cooling window (`coolUntil = Number.MAX_SAFE_INTEGER`) stands in for milestone 1's cooling level where a test needs cooling to stay on.

In `packages/core/test/power.test.ts`, the power import loses `plantBoard`, and the world import comes in:

```ts
import { facilityDemand, priorityOrder, runPower } from '../src/power.ts';
import { Session } from '../src/session.ts';
import { stepsForSeconds } from '../src/time.ts';
import { findBoard, type WorldState } from '../src/world.ts';
```

`sheddable()` sets busy windows:

```ts
  for (const id of ['DA', 'DB']) {
    s.world.datacenters[id]!.busyFrom = 0;
    s.world.datacenters[id]!.busyUntil = 100_000;
  }
  return s;
```

and a local `plantBoard` follows `shortages`, for the tests that read the plant's board:

```ts
const shortages = (s: Session) => s.world.alerts.filter((a) => a.kind === 'powerShortage');
/** The plant's board: the test scenario starts with its three boards installed. */
const plantBoard = (world: WorldState) => findBoard(world, 'P')!;
```

Replace the test "adds 2% per cell from the plant to a facility's draw" with:

```ts
  it("adds 2% per cell from the plant to a facility's draw", () => {
    const s = calm(120);
    const ctx = s.ctx;
    const [p, da, db] = s.world.facilities;
    expect(facilityDemand(ctx, p!, 0)).toBe(5);
    expect(facilityDemand(ctx, da!, 0)).toBe(10); // 1 cell: 10 + floor(10 * 2 / 100)
    expect(facilityDemand(ctx, db!, 0)).toBe(13); // 16 cells: 10 + floor(10 * 32 / 100)
  });
```

Replace the test "adds a running job and cooling to a datacenter's draw" with this one, renamed:

```ts
  it("adds a running job and a cooling cycle to a datacenter's draw on the steps their windows cover", () => {
    const s = calm(120);
    const ctx = s.ctx;
    const dc = s.world.datacenters.DA!;
    dc.busyFrom = 5;
    dc.busyUntil = 9;
    dc.coolFrom = 4;
    dc.coolUntil = 6;
    const da = s.world.facilities[1]!;
    expect(facilityDemand(ctx, da, 3)).toBe(10); // the board alone, 1 cell from the plant: 10 + floor(10 * 2 / 100)
    expect(facilityDemand(ctx, da, 4)).toBe(410 + 8); // + 400 for the cooling cycle, + 2%
    expect(facilityDemand(ctx, da, 5)).toBe(560 + 11); // + 150 for the job
    expect(facilityDemand(ctx, da, 6)).toBe(160 + 3); // the cycle's window is over
    expect(facilityDemand(ctx, da, 9)).toBe(10); // and so is the job's
  });
```

Replace the test "draws only sleep power while asleep and nothing while destroyed" with:

```ts
  it('draws only sleep power while asleep and nothing while destroyed', () => {
    const s = calm(120);
    const ctx = s.ctx;
    const db = s.world.boards[2]!;
    db.status = 'asleep';
    expect(facilityDemand(ctx, s.world.facilities[2]!, 0)).toBe(1); // 1 + floor(1 * 32 / 100)
    db.status = 'destroyed';
    expect(facilityDemand(ctx, s.world.facilities[2]!, 0)).toBe(0);
  });
```

Replace the test "sheds whole facilities from the lowest priority up" with:

```ts
  it('sheds whole facilities from the lowest priority up', () => {
    const s = calm(100);
    const ctx = s.ctx;
    for (const id of ['DA', 'DB']) {
      s.world.datacenters[id]!.busyFrom = 0;
      s.world.datacenters[id]!.busyUntil = 11;
    }
    s.world.plant.thermalSetting = 250; // generation 350; demand 5 + 163 + 211 = 379
    runPower(ctx, 0);
    expect(s.world.plant).toMatchObject({ generation: 350, demand: 379, shed: ['DB'] });
    expect(s.world.boards.map((b) => b.powered)).toEqual([true, true, false]);
    s.world.plant.priority = ['DB', 'DA'];
    runPower(ctx, 0);
    expect(s.world.plant.shed).toEqual(['DA']);
  });
```

Replace the test "draws a job's power through its last step and not after it" with:

```ts
  it("draws a job's power through its last step and not after it", () => {
    const s = calm(120);
    const dc = s.world.datacenters.DA!;
    dc.busyFrom = 5;
    dc.busyUntil = 9;
    const da = s.world.facilities[1]!;
    expect(facilityDemand(s.ctx, da, 8)).toBe(163); // 10 + 150, + floor(160 * 2 / 100)
    expect(facilityDemand(s.ctx, da, 9)).toBe(10);
  });
```

Replace the test "draws nothing while the facility's board is being rebuilt" with:

```ts
  it("draws nothing while the facility's board is being rebuilt", () => {
    const s = calm(120);
    s.world.boards[2]!.status = 'rebuilding';
    expect(facilityDemand(s.ctx, s.world.facilities[2]!, 0)).toBe(0);
  });
```

Replace the test "rounds the loss down, and charges it on sleep power too" with:

```ts
  it('rounds the loss down, and charges it on sleep power too', () => {
    const s = new Session(
      m1Scenario((j) => {
        j.facilities[2]!.board.power = 11;
        j.tuning.sleepPower = 11;
      }),
      1,
      new FakeHost(),
    );
    const db = s.world.facilities[2]!;
    expect(facilityDemand(s.ctx, db, 0)).toBe(14); // 16 cells: 11 + floor(11 * 32 / 100) = 11 + 3
    s.world.boards[2]!.status = 'asleep';
    expect(facilityDemand(s.ctx, db, 0)).toBe(14);
  });
```

Replace the test "raises a new shortage alert when a second shortage begins after the first has ended" with:

```ts
  it('raises a new shortage alert when a second shortage begins after the first has ended', () => {
    const s = calm(100);
    for (const id of ['DA', 'DB']) {
      s.world.datacenters[id]!.busyFrom = 0;
      s.world.datacenters[id]!.busyUntil = 1000; // through the quiet time that the test waits out
    }
    const shortages = () => s.world.alerts.filter((a) => a.kind === 'powerShortage');
    s.world.plant.thermalSetting = 250; // generation 350 against a demand of 379: DB is shed
    runPower(s.ctx, 0);
    runPower(s.ctx, 1); // the same episode
    expect(shortages()).toHaveLength(1);
    expect(shortages()[0]!.message).toContain('DB');
    s.world.plant.thermalSetting = 300; // generation 400 covers it
    runPower(s.ctx, 2);
    expect(s.world.plant.shed).toEqual([]);
    s.world.plant.thermalSetting = 250;
    runPower(s.ctx, 3); // a flicker, not a second shortage: the quiet time has not passed (the tests below)
    expect(shortages()).toHaveLength(1);
    s.world.plant.thermalSetting = 300;
    for (let step = 4; step <= 3 + QUIET_STEPS; step++) runPower(s.ctx, step);
    s.world.plant.thermalSetting = 250;
    runPower(s.ctx, 4 + QUIET_STEPS);
    expect(shortages()).toHaveLength(2);
  });
```

Replace the test "is a tuning value of the scenario: zero ends the episode as soon as nothing is shed" with:

```ts
    it('is a tuning value of the scenario: zero ends the episode as soon as nothing is shed', () => {
      const s = new Session(
        m1Scenario((j) => {
          j.tuning.shortageQuietSeconds = 0;
          j.tuning.wind.start = 100;
          j.tuning.wind.maxChangePerSecond = 0;
        }),
        1,
        new FakeHost(),
      );
      for (const id of ['DA', 'DB']) {
        s.world.datacenters[id]!.busyFrom = 0;
        s.world.datacenters[id]!.busyUntil = 101;
      }
      run(s, 0, 0, true);
      run(s, 1, 1, false);
      run(s, 2, 2, true);
      expect(shortages(s)).toHaveLength(2);
    });
```

In `packages/core/test/datacenter.test.ts`:

Replace the test "earns the job price per second of processing, pro rata" with:

```ts
  it('earns the job price per second of processing, pro rata', () => {
    const s = powered();
    const dc = s.world.datacenters.DA!;
    dc.busyFrom = 0;
    dc.busyUntil = 4; // four steps = 0.2 s at price 40 -> 8
    steps(s, 4);
    expect(s.world.ledger.datacenterIncome).toBe(8 * MICRO);
    steps(s, 4);
    expect(s.world.ledger.datacenterIncome).toBe(8 * MICRO);
  });
```

Replace the test "heats while processing and cools toward ambient after" with:

```ts
  it('heats while processing and cools toward ambient after', () => {
    const s = powered();
    const dc = s.world.datacenters.DA!;
    dc.busyFrom = 0;
    dc.busyUntil = 20 * 10; // 10 s of work
    steps(s, 200);
    const hot = dc.tempMilli;
    expect(hot).toBeGreaterThan(25_000 + 15_000); // ~+20 °C minus passive loss
    expect(hot).toBeLessThan(25_000 + 20_000);
    steps(s, 200);
    expect(dc.tempMilli).toBeLessThan(hot);
    expect(dc.tempMilli).toBeGreaterThanOrEqual(25_000);
  });
```

Replace the test "cools faster with cooling on, never below ambient" with:

```ts
  it('cools faster with cooling on, never below ambient', () => {
    const plain = powered();
    const cooled = powered();
    for (const s of [plain, cooled]) s.world.datacenters.DA!.tempMilli = 80_000;
    cooled.world.datacenters.DA!.coolFrom = 0;
    cooled.world.datacenters.DA!.coolUntil = Number.MAX_SAFE_INTEGER;
    steps(plain, 100);
    steps(cooled, 100);
    expect(cooled.world.datacenters.DA!.tempMilli).toBeLessThan(plain.world.datacenters.DA!.tempMilli);
    steps(cooled, 2000);
    expect(cooled.world.datacenters.DA!.tempMilli).toBe(25_000);
  });
```

Replace the test "does not process or heat while its facility is shed" with:

```ts
  it('does not process or heat while its facility is shed', () => {
    const s = powered();
    s.world.plant.thermalSetting = 0;
    s.world.plant.wind = 0; // the wind won't move: maxChangePerSecond is 0
    const dc = s.world.datacenters.DA!;
    dc.busyFrom = 0;
    dc.busyUntil = 101;
    steps(s, 50);
    expect(s.world.ledger.datacenterIncome).toBe(0);
    expect(dc.tempMilli).toBe(25_000);
  });
```

Replace the test "counts a step as processing exactly when the power phase charges the job for it" with this one, renamed:

```ts
  it('counts a step as processing exactly when the power phase charges the job for it, whatever its board is doing', () => {
    const s = powered();
    const da = s.world.boards[1]!;
    const facility = s.world.facilities[1]!;
    const dc = s.world.datacenters.DA!;
    for (const status of ['running', 'asleep', 'destroyed', 'rebuilding'] as const) {
      for (const [from, until] of [
        [5, 9],
        [5, 6],
        [-1, -1],
      ] as const) {
        for (let step = 3; step <= 10; step++) {
          da.status = status;
          facility.powered = true;
          dc.busyFrom = from;
          dc.busyUntil = until;
          const charged = facilityDemand(s.ctx, facility, step);
          dc.busyFrom = -1;
          dc.busyUntil = -1;
          const idle = facilityDemand(s.ctx, facility, step);
          dc.busyFrom = from;
          dc.busyUntil = until;
          const where = `${status}, job ${from}..${until}, step ${step}`;
          expect(isProcessing(s.ctx, 'DA', step), where).toBe(charged > idle);
          facility.powered = false; // shed: the job drew its power, but nothing was done
          expect(isProcessing(s.ctx, 'DA', step), `${where}, shed`).toBe(false);
        }
      }
    }
  });
```

Replace the test "pays every working datacenter into the town money and the ledger alike" with:

```ts
  it('pays every working datacenter into the town money and the ledger alike', () => {
    const s = powered();
    for (const id of ['DA', 'DB']) {
      s.world.datacenters[id]!.busyFrom = 0;
      s.world.datacenters[id]!.busyUntil = 4;
    }
    const before = s.world.money;
    runDatacenters(s.ctx, 0); // each pays 40 a second for a twentieth of a second
    expect(s.world.money - before).toBe(4 * MICRO);
    expect(s.world.ledger.datacenterIncome).toBe(4 * MICRO);
  });
```

Replace the test "cools actively only while its board is running and powered" with this one, renamed:

```ts
  it('cools while its cool window is open and the facility has power, whatever its board is doing', () => {
    const tempAfter = (cooling: boolean, prepare: (s: Session) => void): number => {
      const s = powered();
      prepare(s);
      const dc = s.world.datacenters.DA!;
      dc.tempMilli = 80_000;
      if (cooling) {
        dc.coolFrom = 0;
        dc.coolUntil = Number.MAX_SAFE_INTEGER;
      }
      steps(s, 10);
      return dc.tempMilli;
    };
    const cools: Record<string, (s: Session) => void> = {
      running: () => {},
      asleep: (s) => {
        s.world.boards[1]!.status = 'asleep';
      },
      destroyed: (s) => {
        s.world.boards[1]!.status = 'destroyed';
      },
      rebuilding: (s) => {
        s.world.boards[1]!.status = 'rebuilding';
      },
    };
    for (const [name, prepare] of Object.entries(cools)) {
      expect(tempAfter(true, prepare), name).toBeLessThan(tempAfter(false, prepare));
    }
    const shed = (s: Session): void => {
      s.world.plant.thermalSetting = 0;
      s.world.plant.wind = 0;
    };
    expect(tempAfter(true, shed)).toBe(tempAfter(false, shed));
  });
```

Replace the test "takes the tuned heat per level out each second, in proportion to the level and none at level 0" with this one, renamed:

```ts
  it("takes the cycle's drop out spread over the cycle's steps while its window is open", () => {
    const t = m1Scenario().tuning.datacenter;
    const s = holding();
    const dc = s.world.datacenters.DA!;
    dc.tempMilli = 80_000;
    dc.coolFrom = 0;
    dc.coolUntil = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < s.scenario.time.stepsPerSecond; i++) runDatacenters(s.ctx, i);
    const perStep = Math.floor(t.coolingDropMilli / ((t.coolingCycleMs * s.scenario.time.stepsPerSecond) / 1000));
    expect(80_000 - dc.tempMilli).toBe(20 * perStep);
  });
```

Replace the test "rolls for fire on the temperature the step ends with, so the datacenter phase comes first" with:

```ts
  it('rolls for fire on the temperature the step ends with, so the datacenter phase comes first', () => {
    const s = holding();
    const rolls = recordFireRolls(s);
    const dc = s.world.datacenters.DA!;
    dc.busyFrom = 0;
    dc.busyUntil = 1;
    dc.tempMilli = 89_950; // the job's heat for one step is 100 milli-degrees: 90,050 by the fire phase
    s.step();
    expect(rolls).toEqual([12]); // 50 milli-degrees x 5 permille a degree each second / 20 steps = 12.5, rounded down
  });
```

In `packages/core/test/session.test.ts`:

Replace the test "applies the action setters within the scenario limits" with:

```ts
  it('applies the action setters within the scenario limits', () => {
    const host = new FakeHost();
    const plant = host.program('plant', () => ({
      actions: [
        { kind: 'setThermal', output: 999 },
        { kind: 'setPriority', order: ['DB', 'DA'] },
      ],
    }));
    const dc = host.program('dc', () => ({ actions: [{ kind: 'cool', level: 7 }, { kind: 'process' }, { kind: 'process' }] }));
    const s = new Session(m1Scenario(), SEED, host);
    s.deploy('P', plant);
    s.deploy('DA', dc);
    run(s, 4); // P beats at 0, DA at 3
    expect(s.world.plant.thermalSetting).toBe(300);
    expect(s.world.plant.priority).toEqual(['DB', 'DA']);
    // The job runs until DA's next beat (step 7); a cooling level above 0 starts one cycle of 4 s, 80 steps.
    expect(s.world.datacenters.DA).toMatchObject({ busyFrom: 4, busyUntil: 8, coolFrom: 4, coolUntil: 84 });
  });
```

In `packages/core/test/economy.test.ts`:

Replace the test "brings a rebuilt datacenter back as new hardware: ambient temperature, no cooling, and no fire roll" with:

```ts
  it('brings a rebuilt datacenter back as new hardware: ambient temperature, no cooling, and no fire roll', () => {
    const s = calm(new FakeHost(), (j) => {
      // Below the file's 25,000: the temperature phase lifts anything under ambient back up, so only a lower ambient shows where the reset read it.
      j.tuning.datacenter.ambientMilli = 20_000;
    });
    const da = s.world.boards[1]!;
    const wreck = s.world.datacenters.DA!;
    const other = s.world.datacenters.DB!;
    wreck.tempMilli = 140_000; // far above 122 °C: after the rebuild's 400 steps of leaking heat it is still above 90 °C
    wreck.coolFrom = 0;
    wreck.coolUntil = Number.MAX_SAFE_INTEGER;
    other.tempMilli = 80_000;
    destroyBoard(s.ctx, da, 0, 'fire');
    expect(s.rebuild('DA')).toEqual({ ok: true });
    Object.assign(s.ctx.rng, { fire: { nextU32: () => 0, int: (lo: number) => lo, chancePpm: () => true } }); // any fire roll burns the board
    steps(s, 401); // the board is back at step 400
    expect(wreck.tempMilli).toBe(20_000);
    expect(wreck.coolUntil).toBe(-1); // no cooling
    expect(da.status).toBe('running');
    steps(s, 5);
    expect(da.status).toBe('running');
    expect(s.world.alerts.some((a) => a.kind === 'fire')).toBe(false);
    expect(other.tempMilli).toBeGreaterThan(20_000); // only the rebuilt board starts over
  });
```

In `packages/core/test/queries.test.ts`, the busy town's DA processes without cooling, since a cooling cycle would add 400 to every number, and a separate check shows the cooling flag:

Replace the test "tells the agent what a sleep drops and keeps, and what the RAM reading counts" with:

```ts
  it('tells the agent what a sleep drops and keeps, and what the RAM reading counts', () => {
    const { s } = session();
    const sheet = datasheet(s.ctx, 'DA')!;
    const rules = sheet.rules.join('\n');
    const log = sheet.io.actions.find((a) => a.call === 'io.log(...)')!.meaning;
    const points: Array<[string, string, string]> = [
      [
        'the actions queued after io.sleep() in the same tick are dropped',
        rules,
        'the actions queued after the call in the same tick are dropped',
      ],
      ['the ones before it still apply', rules, 'those before it apply'],
      [
        'a facility setting stays set through a sleep, and mem does not',
        rules,
        'keeps its value through a sleep, while mem and globals are wiped',
      ],
      ['the settings named', rules, 'the thermal output, the priority list'],
      ['a sleep ends the job and the cooling cycle', rules, "A sleep ends the datacenter's job and its cooling cycle"],
      ['the thermal module works only while awake', rules, 'the thermal module only works while its board is awake'],
      ['a board that is awake and powered emits base EMF', rules, 'a board that is awake and powered also emits its base EMF every second'],
      ['log lines are cut at 200 bytes, which is about 66 Korean characters', log, 'cut at 200 bytes (about 66 Korean characters)'],
      [
        'the RAM reading counts garbage not yet collected',
        rules,
        'counts all of it that the collector has not freed yet, garbage included',
      ],
      ['it can read high just after memory is freed', rules, 'can still read high just after you free something'],
      [
        'garbage alone never causes "out of RAM"',
        rules,
        'Garbage alone never causes "out of RAM": the board collects before it refuses an allocation',
      ],
    ];
    const missing = points.filter(([, text, phrase]) => !text.includes(phrase)).map(([point]) => point);
    expect(missing).toEqual([]);
    expect(log).not.toContain('200 characters');
  });
```

Replace the test "snapshots the plant and every board of a busy town" with:

```ts
  it('snapshots the plant and every board of a busy town', () => {
    const { s, host } = session();
    host.program('plant', () => ({
      actions: [
        { kind: 'setThermal', output: 100 },
        { kind: 'setPriority', order: ['DB'] },
      ],
    }));
    host.program('busy', () => ({
      actions: [{ kind: 'process' }],
    }));
    host.program('boom', () => ({ error: { kind: 'runtime', message: 'boom' } }));
    s.deploy('P', 'plant');
    s.deploy('DA', 'busy');
    s.deploy('DB', 'boom');
    for (let i = 0; i < 8; i++) s.step();
    s.world.datacenters.DA!.tempMilli = 61_999;
    const snap = snapshot(s.ctx);
    // Phase 3 of step 7: 220 wind + 100 thermal against P 5, DA 10 + 150 (its job runs through step 7), plus 2% of that for one cell
    // (3), and DB 10 + 3. The job that DA renewed at step 7 covers step 8 too.
    expect(snap.plant).toEqual({
      wind: 220,
      thermal: 100,
      fuelPrice: s.world.plant.fuelPrice,
      generation: 320,
      demand: 181,
      shed: [],
      priority: ['DB', 'DA'],
    });
    expect(snap.plant.fuelPrice).toBeGreaterThan(0);
    expect(snap.boards).toEqual([
      {
        id: 'P',
        kind: 'power',
        x: 4,
        y: 4,
        status: 'running',
        powered: true,
        hasFirmware: true,
        erroring: false,
        tempC: null,
        processing: false,
        cooling: 0,
        demand: 5,
      },
      {
        id: 'DA',
        kind: 'datacenter',
        x: 5,
        y: 4,
        status: 'running',
        powered: true,
        hasFirmware: true,
        erroring: false,
        tempC: 61,
        processing: true,
        cooling: 0,
        demand: 163,
      },
      {
        id: 'DB',
        kind: 'datacenter',
        x: 16,
        y: 8,
        status: 'running',
        powered: true,
        hasFirmware: true,
        erroring: true,
        tempC: 25,
        processing: false,
        cooling: 0,
        demand: 13,
      },
    ]);
    // A datacenter whose cool window covers the step shows that it is cooling.
    s.world.datacenters.DA!.coolFrom = 0;
    s.world.datacenters.DA!.coolUntil = Number.MAX_SAFE_INTEGER;
    expect(snapshot(s.ctx).boards[1]!.cooling).toBe(1);
  });
```

Replace the test "writes the numbers of the m1 scenario as the text always read" with:

```ts
  it('writes the numbers of the m1 scenario as the text always read', () => {
    const { s } = session();
    const da = datasheet(s.ctx, 'DA')!;
    const plant = datasheet(s.ctx, 'P')!;
    expect(callOf(da, 'io.process()')).toContain('draws 150 power, and heats the datacenter (+2 °C/s)');
    expect(callOf(da, 'io.cool(level)')).toContain('it takes 15 °C off over 4 s, in even steps, and draws 400 power while it runs');
    expect(readOf(da, 'temp')).toContain('above 90 it can catch fire');
    expect(callOf(plant, 'io.set_thermal(output)')).toContain('0-300 power units');
    expect(callOf(da, 'io.sleep(seconds)')).toContain('deep sleep for 1-40 s');
    const rules = da.rules.join('\n');
    expect(rules).toContain('EMF per tick = instructions / 100 + 10 per action');
    expect(rules).toContain("A facility's power draw grows 2% for each cell between it and the plant");
  });
```

Replace the test "writes the numbers of the scenario it describes, so a retuned town reads differently" with:

```ts
  it('writes the numbers of the scenario it describes, so a retuned town reads differently', () => {
    const { s } = session((j) => {
      j.tuning.datacenter.processPower = 170;
      j.tuning.datacenter.heatMilliPerSecond = 3_500;
      j.tuning.datacenter.coolingDropMilli = 12_500;
      j.tuning.datacenter.coolingCycleMs = 3_000;
      j.tuning.datacenter.coolingPower = 330;
      j.tuning.datacenter.fireThresholdMilli = 95_050;
      j.tuning.thermal.max = 400;
      j.tuning.maxSleepSeconds = 25;
      j.tuning.emf.instructionsPerUnit = 50;
      j.tuning.emf.perAction = 7;
      j.tuning.transmissionLossPctPerCell = 3;
    });
    const da = datasheet(s.ctx, 'DA')!;
    const plant = datasheet(s.ctx, 'P')!;
    expect(callOf(da, 'io.process()')).toContain('draws 170 power, and heats the datacenter (+3.5 °C/s)');
    expect(callOf(da, 'io.cool(level)')).toContain('it takes 12.5 °C off over 3 s, in even steps, and draws 330 power while it runs');
    expect(readOf(da, 'temp')).toContain('above 95.05 it can catch fire');
    expect(callOf(plant, 'io.set_thermal(output)')).toContain('0-400 power units');
    expect(callOf(da, 'io.sleep(seconds)')).toContain('deep sleep for 1-25 s');
    const rules = da.rules.join('\n');
    expect(rules).toContain('EMF per tick = instructions / 50 + 7 per action');
    expect(rules).toContain("A facility's power draw grows 3% for each cell between it and the plant");
  });
```

In `packages/firmware/test/host.test.ts`, import `type BoardKind` from `@turing-city/core`, and give the boot helper a board kind:

```ts
    return { boardId, kind: f.kind as BoardKind, spec: f.board!, facilityIds: scenario.facilities.map((x) => x.id), seed: 1 };
```

Replace the test "runs deployed Lua, applies its actions, and reboots it after a sleep with empty mem" with:

```ts
  it('runs deployed Lua, applies its actions, and reboots it after a sleep with empty mem', async () => {
    const session = new Session(parseScenario(m1), 7, await WasmoonHost.create());
    session.world.plant.thermalSetting = 1_000; // plenty of power: DA's job and its cooling are never shed
    session.deploy(
      'DA',
      `
      function tick(io, mem)
        mem.n = (mem.n or 0) + 1
        io.log("tick", mem.n)
        if mem.n == 2 then io.sleep(1) return end
        io.process()
        io.cool(1)
      end`,
    );
    for (let i = 0; i < 4; i++) session.step(); // DA's first beat is step 3
    const dc = session.world.datacenters.DA!;
    expect(dc).toMatchObject({ busyFrom: 4, busyUntil: 8, coolFrom: 4, coolUntil: 84 }); // one cooling cycle: 4 s, 80 steps
    for (let i = 0; i < 4; i++) session.step(); // second beat at 7: sleep 1 s
    const da = session.world.boards[1]!;
    expect(da.status).toBe('asleep');
    for (let i = 0; i < 20; i++) session.step(); // wakes at 27; beat at 27 reboots
    const logs = da.log.filter((l) => l.kind === 'log').map((l) => l.text);
    expect(logs).toEqual(['tick\t1', 'tick\t2', 'tick\t1']);
    session.close();
  });
```

- [ ] **Step 10: The careful firmware rests instead of cooling**

`scenarios/firmware/m1/careful/DA.lua` becomes:

```lua
-- Careful: work only at a price that pays for the power even when all of it is fuel;
-- otherwise sleep, silent and nearly free. Hide from Luddites. Never cool: a cooling
-- cycle burns more power than the work it makes room for, so rest below 75 °C instead.
local MIN_PRICE = 50

function tick(io, mem)
  if io.luddite_dist then
    io.sleep(40) -- dark and silent until the group loses the trail
    return
  end
  if io.price < MIN_PRICE then
    io.sleep(20)
    return
  end
  if io.temp < 75 then io.process() end
end
```

`scenarios/firmware/m1/careful/DB.lua` becomes:

```lua
-- Careful: as DA, but DB is 16 cells from the plant and its power costs a third more,
-- so it works only at the top of the market.
local MIN_PRICE = 70

function tick(io, mem)
  if io.luddite_dist then
    io.sleep(40) -- dark and silent until the group loses the trail
    return
  end
  if io.price < MIN_PRICE then
    io.sleep(20)
    return
  end
  if io.temp < 75 then io.process() end
end
```

In `packages/server/scripts/shots.ts`, the comment above the power-short scene gives the new demand. Its check passes as it is, since two cycles ask far more than the wind gives:

```ts
  // The power plant falls short: no thermal output, and two datacenters in a cooling cycle ask for about 960 units, while the wind
```

- [ ] **Step 11: Run the tests to verify they pass, then the whole check**

Run: `pnpm vitest run packages/core/test/facilities.test.ts`
Expected: PASS, 14 tests.

Run: `pnpm fix && pnpm check`
Expected: every package typechecks, Biome is clean, and every test passes (583). The season checks in `packages/server/test/seasons.test.ts` run real Lua for a few minutes' worth of seasons.

Run: `pnpm sim --firmware scenarios/firmware/m1/careful --seed 1 --rebuild`
Expected: `"ended": { "kind": "completed", ... }` with money above the careless set's for the same seed (`pnpm sim --firmware scenarios/firmware/m1/careless --seed 1 --rebuild`).

- [ ] **Step 12: Commit**

```bash
git add packages/core/src packages/core/test packages/firmware/test/host.test.ts packages/viewer/src/refusals.ts packages/viewer/test/refusals.test.ts scenarios/firmware/m1/careful packages/server/scripts/shots.ts
git commit -m "Give every facility its place in the world, install boards and comm modules, and run datacenters on windows"
```

---

### Task 3: The board is only automation: sleep, shedding, wrecks, repairs, rebuilds, and the endings

The 10-10 spec makes the board an automation device and nothing more (§4.2): a facility works by hand without it, and losing the board loses only the automation. Luddites and fire now wreck the whole facility, its board with it, and the player pays separately to repair the facility and to rebuild the board (§6). With repairs, a town can always come back while the money lasts, so the fall ending goes (§7). This task implements contract §11's `wreckFacility` and §12's repairs and rebuilds.

**Wrecks.** `wreckFacility(ctx, facility, step, cause)` replaces `destroyBoard` everywhere:
- The facility's condition becomes `wrecked`.
- Its board, if it has one, is destroyed, and a rebuild under way is lost.
- A datacenter's job and cooling cycle end.
- `stats.wrecks` (milestone 1's `boardsLost`) counts the facility once, however often it is hit.
- One `wrecked` alert, "<id> 시설이 부서졌어요 (러다이트|화재)", replaces `boardDestroyed`.

**Repairs and rebuilds.**
- `Session.repair(facilityId)` pays `repair.cost[kind]` (ledger `repairs`). The facility is `repairing` for `repair.seconds` and stands again in phase 1.
- A repaired datacenter comes back at ambient temperature with its windows ended; a repaired farm replants.
- A board's rebuild needs its facility standing (`repairFirst`), and `startRebuild` now takes the board's id.
- Both are recorded and replayed.

**The board is only automation.**
- A sleep stops only the board: its VM and `mem`. A datacenter's job and cooling cycle run their course, and the thermal module keeps its output, whatever the plant's board is doing. The plant makes no thermal power only while it is wrecked or being repaired. Task 2's `shutdownVm` no longer touches the datacenter.
- The careful reference firmware's plant turned its fuel off by going to sleep. Now it sets its thermal output to 0 first, since the module keeps its output through a sleep.

**The endings.** `EndKind` is `completed` or `bankrupt`. The fall is gone, with its check and its Korean text.

**The alert kinds** are contract §2's:
- `boardDestroyed` becomes `wrecked`.
- `hunger` (raised by Task 9) and `agentLost` (raised by Task 13's controller) join now, so the viewer's labels and the auto-pause settings know every kind from here on.

**Headless seasons.** `standInForThePlayer(session)` (`season.ts`) repairs every wrecked facility and then rebuilds its board, each as soon as the money allows. `runSeason`'s `autoRebuild` (`pnpm sim --rebuild`) and the season checks use it.

**The server and the viewer** carry the change as far as their checks need:
- the worker's `repair` request and `GameController.repair()`;
- `GameController.rebuild()` answering a `CommandResult`;
- `wrecked` in the default auto-pause;
- the viewer's labels, its ending label, and the feed.

The viewer gets no repair button until Task 19. `pnpm shots` is not part of `pnpm check`. It fails two of its checks from this task until Task 21 rewrites it: "the rebuild button starts the rebuild while the game is paused" and "the rebuild took its cost …". The milestone-1 panel offers a rebuild for a wrecked facility, which is refused until the facility is repaired.

**Files:**
- Modify: `packages/core/src/world.ts`, `packages/core/src/boards.ts`, `packages/core/src/economy.ts`, `packages/core/src/session.ts`, `packages/core/src/power.ts`, `packages/core/src/datacenter.ts`, `packages/core/src/luddites.ts`, `packages/core/src/season.ts`, `packages/core/src/protocol.ts`, `packages/core/src/datasheet.ts`
- Modify: `packages/server/src/worker.ts`, `packages/server/src/game-controller.ts`, `packages/server/scripts/shots.ts`
- Modify: `packages/viewer/src/format.ts`, `packages/viewer/src/ui/feed.ts`
- Modify: `scenarios/firmware/m1/careful/P.lua`, `CLAUDE.md` (`pnpm sim --rebuild`)
- Test: `packages/core/test/wrecks.test.ts` (new)
- Test (changed): `packages/core/test/power.test.ts`, `packages/core/test/economy.test.ts`, `packages/core/test/datacenter.test.ts`, `packages/core/test/luddites.test.ts`, `packages/core/test/queries.test.ts`, `packages/server/test/game-controller.test.ts`, `packages/server/test/game-server.test.ts`, `packages/server/test/seasons.test.ts`

**Interfaces:**
- Consumes: Task 2's `FacilityState` and `findFacility`, `plantFacility`, `CommandResult`, the refusal codes `unknownFacility`, `noBoard`, `notWrecked`, `repairFirst`, and `tooPoor`, the datacenter's windows, and `world.farms`. Task 1's `tuning.repair`.
- Produces:
  - `boards.ts`: `wreckFacility(ctx, facility, step, cause: 'fire' | 'luddites')`. `destroyBoard` becomes private to it.
  - `economy.ts`:
    - `startRepair(ctx, facilityId, step): CommandResult`;
    - `startRebuild(ctx, boardId, step): CommandResult`, which now takes an id;
    - `checkEnd` with no fall.
  - `session.ts`: `Session.repair(facilityId): CommandResult`, and the recorded input `{ kind: 'repair', facilityId }`.
  - `world.ts`:
    - `EndKind = 'completed' | 'bankrupt'`;
    - `ALERT_KINDS` with `wrecked`, `hunger`, and `agentLost`;
    - `Stats.wrecks`.
  - `season.ts`: `standInForThePlayer(session)`.
  - `protocol.ts`: `WorkerRequest` `{ type: 'repair'; id; facility }`.
  - The server:
    - `GameController.repair(facility): Promise<CommandResult>`;
    - `GameController.rebuild(board): Promise<CommandResult>`;
    - the default auto-pause `['raid', 'wrecked', 'fire', 'firmwareError']`.
  - The viewer: `ALERT_LABELS` for `wrecked` (시설 파괴), `hunger` (굶주림), and `agentLost` (에이전트 끊김).

- [ ] **Step 1: Write the failing tests**

`packages/core/test/wrecks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { startSleep, wreckFacility } from '../src/boards.ts';
import { MICRO } from '../src/fixed.ts';
import { stateHash } from '../src/hash.ts';
import { facilityDemand } from '../src/power.ts';
import { standInForThePlayer } from '../src/season.ts';
import { Session } from '../src/session.ts';
import { cellIndex, findBoard, findFacility } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario, m2Scenario } from './helpers/scenarios.ts';

/** Plenty of steady power and no raids of their own: a test brings the Luddites or the fire it wants. */
function quiet(change?: Parameters<typeof m1Scenario>[0]): Session {
  return new Session(
    m1Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.emf.rumourThreshold = 1_000_000_000;
      change?.(j);
    }),
    1,
    new FakeHost(),
  );
}

function steps(s: Session, n: number): void {
  for (let i = 0; i < n; i++) s.step();
}

/** Puts a group of Luddites next to a facility whose cell is the loudest in town, on a step that is a Luddite beat. */
function ludditesNextTo(s: Session, id: string): void {
  const f = findFacility(s.world, id)!;
  s.world.luddites.push({
    id: s.world.nextLudditeId++,
    x: f.x - 1,
    y: f.y,
    size: 3,
    targetId: null,
    quietSince: null,
    leaving: false,
    warned: [],
  });
  s.world.emf[cellIndex(s.scenario, f.x, f.y)] = 100_000;
}

describe('wrecks, repairs, and rebuilds', () => {
  it('lets Luddites wreck the facility they reach, board and all, and says so', () => {
    const s = quiet();
    ludditesNextTo(s, 'DB');
    s.step();
    const db = findFacility(s.world, 'DB')!;
    expect(db.condition).toBe('wrecked');
    expect(findBoard(s.world, 'DB')!.status).toBe('destroyed');
    expect(findBoard(s.world, 'DB')!.log.at(-1)).toMatchObject({ kind: 'system', text: 'smashed by Luddites' });
    expect(s.world.alerts.filter((a) => a.kind === 'wrecked')).toMatchObject([
      { step: 0, facilityId: 'DB', message: 'DB 시설이 부서졌어요 (러다이트)' },
    ]);
    expect(s.world.stats.wrecks).toBe(1);
    expect(facilityDemand(s.ctx, db, 1)).toBe(0); // a wrecked facility draws nothing
  });

  it('lets a fire wreck a datacenter, board and all', () => {
    const s = quiet((j) => {
      j.tuning.datacenter.firePermillePerDegreePerSecond = 1_000_000; // any step above 90 °C burns
    });
    s.world.datacenters.DA!.tempMilli = 120_000;
    s.step();
    expect(findFacility(s.world, 'DA')!.condition).toBe('wrecked');
    expect(findBoard(s.world, 'DA')!.status).toBe('destroyed');
    expect(s.world.alerts.filter((a) => a.kind === 'wrecked').map((a) => a.message)).toEqual(['DA 시설이 부서졌어요 (화재)']);
  });

  it("ends a wrecked datacenter's job and cooling cycle, and counts a wreck once however often it is hit", () => {
    const s = quiet();
    const dc = s.world.datacenters.DA!;
    Object.assign(dc, { busyFrom: 0, busyUntil: 1000, coolFrom: 0, coolUntil: 80 });
    const da = findFacility(s.world, 'DA')!;
    wreckFacility(s.ctx, da, 0, 'luddites');
    wreckFacility(s.ctx, da, 0, 'fire');
    expect(dc).toMatchObject({ busyFrom: -1, busyUntil: -1, coolFrom: -1, coolUntil: -1 });
    expect(s.world.stats.wrecks).toBe(1);
    expect(s.world.alerts.filter((a) => a.kind === 'wrecked')).toHaveLength(1);
  });

  it("repairs a wrecked facility for its kind's price over the repair time; its board stays destroyed until it is rebuilt", () => {
    const s = quiet();
    wreckFacility(s.ctx, findFacility(s.world, 'DB')!, 0, 'luddites');
    const before = s.world.money;
    expect(s.repair('DB')).toEqual({ ok: true });
    const db = findFacility(s.world, 'DB')!;
    expect(s.world.money).toBe(before - 500 * MICRO);
    expect(s.world.ledger.repairs).toBe(500 * MICRO);
    expect(db).toMatchObject({ condition: 'repairing', repairReadyAt: 400 });
    steps(s, 400);
    expect(db.condition).toBe('repairing');
    steps(s, 1);
    expect(db).toMatchObject({ condition: 'ok', repairReadyAt: null });
    expect(findBoard(s.world, 'DB')!.status).toBe('destroyed');
    expect(s.record.inputs).toEqual([{ step: 0, kind: 'repair', facilityId: 'DB' }]);
  });

  it('replants a repaired farm: the crop it had before the wreck is lost', () => {
    const s = new Session(
      m2Scenario((j) => (j.tuning.emf.rumourThreshold = 1_000_000_000)),
      1,
      new FakeHost(),
    );
    steps(s, 100);
    expect(s.world.farms.F1!.plantedAt).toBe(0);
    wreckFacility(s.ctx, findFacility(s.world, 'F1')!, 100, 'luddites');
    expect(s.repair('F1')).toEqual({ ok: true });
    expect(s.world.ledger.repairs).toBe(150 * MICRO);
    steps(s, 401); // the repair takes 20 s, 400 steps, and is done at step 500
    expect(findFacility(s.world, 'F1')!.condition).toBe('ok');
    expect(s.world.farms.F1!.plantedAt).toBe(500);
    expect(s.world.farms.F2!.plantedAt).toBe(0);
  });

  it("lets a datacenter's job and cooling cycle run their course while its board sleeps: a sleep stops only the board", () => {
    const s = quiet((j) => (j.tuning.thermal.max = 2000));
    s.world.plant.thermalSetting = 1000; // enough for the job and the cycle: a shed datacenter would not work either
    const dc = s.world.datacenters.DA!;
    Object.assign(dc, { busyFrom: 0, busyUntil: 1000, coolFrom: 0, coolUntil: 80 });
    startSleep(s.ctx, findBoard(s.world, 'DA')!, 0, 5);
    expect(dc).toMatchObject({ busyFrom: 0, busyUntil: 1000, coolFrom: 0, coolUntil: 80 });
    expect(findBoard(s.world, 'DA')!.status).toBe('asleep');
    dc.tempMilli = 60_000;
    steps(s, 1);
    expect(s.world.ledger.datacenterIncome).toBeGreaterThan(0);
    expect(dc.tempMilli).toBeLessThan(60_000); // the cycle's drop outweighs the job's heat
  });

  it("charges the repair of the facility's own kind, from the scenario", () => {
    const s = quiet((j) => {
      j.tuning.repair = { cost: { farm: 1, warehouse: 2, power: 300, datacenter: 4 }, seconds: 5 };
    });
    wreckFacility(s.ctx, findFacility(s.world, 'P')!, 0, 'luddites');
    wreckFacility(s.ctx, findFacility(s.world, 'DA')!, 0, 'luddites');
    s.repair('P');
    s.repair('DA');
    expect(s.world.ledger.repairs).toBe(304 * MICRO);
    expect(findFacility(s.world, 'P')!.repairReadyAt).toBe(100);
  });

  it('refuses a repair it cannot make, and charges and records nothing', () => {
    const s = quiet();
    wreckFacility(s.ctx, findFacility(s.world, 'DA')!, 0, 'luddites');
    expect(s.repair('ZZ')).toEqual({ ok: false, reason: 'unknown facility ZZ', refusal: { code: 'unknownFacility', facility: 'ZZ' } });
    expect(s.repair('DB')).toEqual({ ok: false, reason: 'DB is not wrecked', refusal: { code: 'notWrecked', facility: 'DB' } });
    s.world.money = 499 * MICRO;
    const hash = stateHash(s.world);
    expect(s.repair('DA')).toEqual({ ok: false, reason: 'not enough money', refusal: { code: 'tooPoor' } });
    expect(stateHash(s.world)).toBe(hash);
    s.world.money = 5000 * MICRO;
    expect(s.repair('DA')).toEqual({ ok: true });
    expect(s.repair('DA')).toEqual({ ok: false, reason: 'DA is not wrecked', refusal: { code: 'notWrecked', facility: 'DA' } });
    expect(s.record.inputs).toEqual([{ step: 0, kind: 'repair', facilityId: 'DA' }]);
  });

  it('refuses a repair once the season has ended', () => {
    const s = quiet((j) => {
      j.time.secondsPerDay = 1;
      j.time.seasonDays = 1;
    });
    wreckFacility(s.ctx, findFacility(s.world, 'DA')!, 0, 'luddites');
    steps(s, 20);
    expect(s.repair('DA')).toEqual({ ok: false, reason: 'the season has ended', refusal: { code: 'seasonEnded' } });
  });

  it('rebuilds a board only once its facility stands again', () => {
    const s = quiet();
    wreckFacility(s.ctx, findFacility(s.world, 'DA')!, 0, 'fire');
    const refused = {
      ok: false,
      reason: 'DA must be repaired before its board is rebuilt',
      refusal: { code: 'repairFirst', facility: 'DA' },
    };
    expect(s.rebuild('DA')).toEqual(refused);
    s.repair('DA');
    expect(s.rebuild('DA')).toEqual(refused); // still being repaired
    steps(s, 401);
    expect(s.rebuild('DA')).toEqual({ ok: true });
    expect(findBoard(s.world, 'DA')!.status).toBe('rebuilding');
  });

  it('loses a rebuild under way when its facility is wrecked again', () => {
    const s = quiet();
    const da = findBoard(s.world, 'DA')!;
    da.status = 'destroyed';
    s.rebuild('DA');
    expect(da.status).toBe('rebuilding');
    wreckFacility(s.ctx, findFacility(s.world, 'DA')!, 0, 'luddites');
    expect(da).toMatchObject({ status: 'destroyed', readyAt: null });
  });

  it('stands in for the player of a headless season: repairs what is wrecked, then rebuilds its board, as the money allows', () => {
    const s = quiet();
    wreckFacility(s.ctx, findFacility(s.world, 'DA')!, 0, 'luddites');
    s.world.money = 499 * MICRO;
    standInForThePlayer(s);
    expect(findFacility(s.world, 'DA')!.condition).toBe('wrecked'); // a repair costs 500
    s.world.money = 5000 * MICRO;
    standInForThePlayer(s);
    expect(findFacility(s.world, 'DA')!.condition).toBe('repairing');
    expect(findBoard(s.world, 'DA')!.status).toBe('destroyed'); // not before the facility stands
    steps(s, 401);
    standInForThePlayer(s);
    expect(findBoard(s.world, 'DA')!.status).toBe('rebuilding');
    expect(s.record.inputs.map((i) => i.kind)).toEqual(['repair', 'rebuild']);
  });
});
```

In `packages/core/test/power.test.ts`, the power import gains `plantFacility`:

```ts
import { facilityDemand, plantFacility, priorityOrder, runPower } from '../src/power.ts';
```

Replace the test "runs thermal only while the plant's board is running" with these two:

```ts
  it("runs the thermal module at its setting whatever the plant's board is doing: the board only automates it", () => {
    for (const status of ['running', 'asleep', 'destroyed', 'rebuilding'] as const) {
      const s = calm(50);
      s.world.plant.thermalSetting = 200;
      plantBoard(s.world).status = status;
      runPower(s.ctx, 0);
      expect(s.world.plant.generation, status).toBe(250);
    }
  });

  it('makes only the wind while the plant itself is wrecked or being repaired', () => {
    for (const condition of ['wrecked', 'repairing'] as const) {
      const s = calm(50);
      s.world.plant.thermalSetting = 200;
      plantFacility(s.world).condition = condition;
      runPower(s.ctx, 0);
      expect(s.world.plant.generation, condition).toBe(50);
    }
  });
```

and delete the test "stops the thermal module while the plant's board sleeps or is being rebuilt".

In `packages/core/test/economy.test.ts`, the imports become `import { wreckFacility } from '../src/boards.ts';` (in place of `destroyBoard`) and `import { cellIndex, findFacility } from '../src/world.ts';`.

Replace the test "burns no fuel while the plant's board is down" with this one, renamed:

```ts
  it("keeps burning fuel whatever the plant's board is doing: the board only automates the thermal module", () => {
    for (const status of ['asleep', 'destroyed', 'rebuilding'] as const) {
      const s = calm();
      s.world.plant.thermalSetting = 100;
      s.world.boards[0]!.status = status;
      steps(s, DAY);
      expect(s.world.ledger.fuel, status).toBe(700 * MICRO);
    }
  });
```

Replace the test "burns no fuel while the plant's board sleeps or is being rebuilt" with this one, renamed:

```ts
  it('burns no fuel while the plant itself is wrecked or being repaired', () => {
    for (const condition of ['wrecked', 'repairing'] as const) {
      const s = calm();
      s.world.plant.thermalSetting = 100;
      findFacility(s.world, 'P')!.condition = condition;
      steps(s, 40);
      expect(s.world.ledger.fuel, condition).toBe(0);
    }
  });
```

Replace the test "still charges the step in which the plant's firmware puts its board to sleep" with this one, renamed:

```ts
  it("keeps charging after the plant's firmware puts its board to sleep: the thermal module goes on at its setting", () => {
    const s = plantDoing({ kind: 'sleep', seconds: 1 }, 100);
    s.step();
    expect(s.world.boards[0]!.status).toBe('asleep');
    expect(s.world.ledger.fuel).toBe(FUEL_PER_STEP);
    steps(s, 5);
    expect(s.world.ledger.fuel).toBe(6 * FUEL_PER_STEP);
  });
```

Replace the test "still charges the step in which Luddites smash the plant's board" with this one, renamed:

```ts
  it('still charges the step in which Luddites wreck the plant, and nothing after it', () => {
    const s = calm();
    const plant = s.world.boards[0]!;
    s.world.plant.thermalSetting = 100;
    // A group stands next to the plant, whose cell is the loudest, and step 0 is a Luddite beat.
    s.world.luddites.push({
      id: s.world.nextLudditeId++,
      x: plant.x - 1,
      y: plant.y,
      size: 3,
      targetId: null,
      quietSince: null,
      leaving: false,
      warned: [],
    });
    s.world.emf[cellIndex(s.scenario, plant.x, plant.y)] = 100_000;
    s.step();
    expect(plant.status).toBe('destroyed');
    expect(findFacility(s.world, 'P')!.condition).toBe('wrecked');
    expect(s.world.ledger.fuel).toBe(FUEL_PER_STEP);
    steps(s, 5);
    expect(s.world.ledger.fuel).toBe(FUEL_PER_STEP);
  });
```

Replace the test "brings a rebuilt datacenter back as new hardware: ambient temperature, no cooling, and no fire roll" with this one, renamed:

```ts
  it('brings a repaired datacenter back as new hardware: ambient temperature, no cooling, and no fire roll', () => {
    const s = calm(new FakeHost(), (j) => {
      // Below the file's 25,000: the temperature phase lifts anything under ambient back up, so only a lower ambient shows where the reset read it.
      j.tuning.datacenter.ambientMilli = 20_000;
    });
    const da = s.world.boards[1]!;
    const wreck = s.world.datacenters.DA!;
    const other = s.world.datacenters.DB!;
    wreck.tempMilli = 140_000; // far above 122 °C: after the repair's 400 steps of leaking heat it is still above 90 °C
    wreck.coolFrom = 0;
    wreck.coolUntil = Number.MAX_SAFE_INTEGER;
    other.tempMilli = 80_000;
    wreckFacility(s.ctx, findFacility(s.world, 'DA')!, 0, 'fire');
    expect(s.repair('DA')).toEqual({ ok: true });
    Object.assign(s.ctx.rng, { fire: { nextU32: () => 0, int: (lo: number) => lo, chancePpm: () => true } }); // any fire roll burns it
    steps(s, 401); // the datacenter stands again at step 400
    expect(findFacility(s.world, 'DA')!.condition).toBe('ok');
    expect(wreck.tempMilli).toBe(20_000);
    expect(wreck.coolUntil).toBe(-1); // no cooling
    expect(da.status).toBe('destroyed'); // its board is a separate purchase
    expect(s.rebuild('DA')).toEqual({ ok: true });
    steps(s, 401);
    expect(da.status).toBe('running');
    steps(s, 5);
    expect(da.status).toBe('running');
    expect(s.world.alerts.some((a) => a.kind === 'fire')).toBe(false);
    expect(other.tempMilli).toBeGreaterThan(20_000); // only the repaired datacenter starts over
  });
```

Replace the test "rebuilds the power plant too, which has no datacenter state to reset" with this one, renamed:

```ts
  it('repairs and rebuilds the power plant too, which has no datacenter state to reset', () => {
    const s = calm();
    const plant = s.world.boards[0]!;
    wreckFacility(s.ctx, findFacility(s.world, 'P')!, 0, 'luddites');
    expect(s.repair('P')).toEqual({ ok: true });
    steps(s, 401);
    expect(s.rebuild('P')).toEqual({ ok: true });
    steps(s, 401);
    expect(plant.status).toBe('running');
  });
```

Replace the test "falls when every firmware board is destroyed at once" with this one, renamed:

```ts
  it('never ends a season for its boards: with every board destroyed, it goes on', () => {
    const s = calm();
    for (const b of s.world.boards) b.status = 'destroyed';
    for (const f of s.world.facilities) f.condition = 'wrecked';
    steps(s, 10);
    expect(s.world.ended).toBeNull();
  });
```

Replace the test "applies a recorded rebuild when it replays a session" with:

```ts
  it('applies a recorded rebuild when it replays a session', () => {
    const makeHost = (): FakeHost => {
      const host = new FakeHost();
      host.program('burn', () => ({ actions: [{ kind: 'process' }] }));
      return host;
    };
    // The world has to destroy the board, since a replay applies only recorded inputs: a board that heats 20 °C a step burns
    // for certain above 90 °C, so DA under a firmware that never stops processing burns at step 7.
    const live = calm(makeHost(), (j) => {
      j.tuning.datacenter.heatMilliPerSecond = 400_000;
      j.tuning.datacenter.firePermillePerDegreePerSecond = 1_000_000;
    });
    live.deploy('DA', 'burn');
    steps(live, 40);
    expect(live.world.boards[1]!.status).toBe('destroyed');
    expect(live.repair('DA')).toEqual({ ok: true });
    steps(live, 401); // the datacenter stands again at step 440
    expect(live.rebuild('DA')).toEqual({ ok: true });
    steps(live, 440); // back at step 841 with its last firmware, which burns it again
    expect(live.world.stats.wrecks).toBe(2);
    expect(live.record.inputs.map((i) => [i.step, i.kind])).toEqual([
      [0, 'deploy'],
      [40, 'repair'],
      [441, 'rebuild'],
    ]);

    const again = replay(live.scenario, live.seed, live.record, makeHost(), live.world.step);
    expect(stateHash(again.world)).toBe(stateHash(live.world));
    expect(again.record.inputs).toEqual(live.record.inputs);
    // The hash has to tell the two apart, or the equality above proves nothing.
    const withoutRebuild = { ...live.record, inputs: live.record.inputs.filter((i) => i.kind !== 'rebuild') };
    const skipped = replay(live.scenario, live.seed, withoutRebuild, makeHost(), live.world.step);
    expect(skipped.world.boards[1]!.status).toBe('destroyed');
    expect(stateHash(skipped.world)).not.toBe(stateHash(live.world));
  });
```

Delete the test "counts a board being rebuilt as lost when the town falls, and a board asleep as still standing".

Replace the test "ends the season as bankrupt, not fallen, when both are true on the same step" with this one, renamed:

```ts
  it('ends the season as bankrupt when its money has been below zero long enough, whatever its boards are doing', () => {
    const s = calm();
    for (const b of s.world.boards) b.status = 'destroyed';
    s.world.money = -1;
    s.world.belowZeroSince = -(3 * DAY - 1); // the third day below zero ends with this step
    s.step();
    expect(s.world.ended).toEqual({ kind: 'bankrupt', step: 0 });
  });
```

Replace the test "ends the season as fallen, not completed, when the last board goes on the last step" with this one, renamed:

```ts
  it('completes a season whose boards are all destroyed on its last step', () => {
    const s = calm(new FakeHost(), (j) => {
      j.time.secondsPerDay = 1;
      j.time.seasonDays = 1; // 20 steps
    });
    steps(s, 19);
    for (const b of s.world.boards) b.status = 'destroyed';
    s.step();
    expect(s.world.ended).toEqual({ kind: 'completed', step: 19 });
    expect(s.world.alerts.at(-1)).toMatchObject({ kind: 'seasonEnd', message: '시즌이 끝났어요' });
  });
```

Replace the test "refuses a rebuild once the season has ended, however it ended, and charges and records nothing" with:

```ts
  it('refuses a rebuild once the season has ended, however it ended, and charges and records nothing', () => {
    // Money is the score, and a replay stops where the season ended, so a rebuild after it would change one and could not be replayed.
    const endings: Record<string, (s: Session) => void> = {
      completed: (s) => steps(s, 20),
      bankrupt: (s) => {
        s.world.money = -1;
        steps(s, 20);
      },
    };
    for (const [kind, end] of Object.entries(endings)) {
      const s = calm(new FakeHost(), (j) => {
        j.time.secondsPerDay = 1;
        j.time.seasonDays = 1; // 20 steps
        j.tuning.bankruptcyDays = 1;
      });
      s.world.boards[2]!.status = 'destroyed'; // a board that could be rebuilt, were the season still on
      end(s);
      expect(s.world.ended?.kind, kind).toBe(kind);
      const money = s.world.money;
      expect(s.rebuild('DB'), kind).toEqual({ ok: false, reason: 'the season has ended', refusal: { code: 'seasonEnded' } });
      expect(s.world.money, kind).toBe(money);
      expect(s.world.ledger.rebuild, kind).toBe(0);
      expect(s.world.boards[2]!.status, kind).toBe('destroyed');
      expect(s.record.inputs, kind).toEqual([]);
    }
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/test/wrecks.test.ts packages/core/test/power.test.ts packages/core/test/economy.test.ts`
Expected: FAIL, 23 tests:
- the twelve of `wrecks.test.ts`, mostly with `TypeError: wreckFacility is not a function`;
- the two new power tests, with `asleep: expected 50 to be 250` and `wrecked: expected 250 to be 50`;
- nine economy tests, for example "never ends a season for its boards" with `expected { kind: 'fallen', step: +0 } to be null`.

- [ ] **Step 3: Wrecks, repairs, and the board as automation**

In `packages/core/src/world.ts`, `Stats`, `EndKind`, and `ALERT_KINDS` become:

```ts
export interface Stats {
  raids: number;
  /** Facilities wrecked by Luddites or fire. */
  wrecks: number;
  instructions: number;
  deploys: number;
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
```

and `createWorld`'s stats start as `stats: { raids: 0, wrecks: 0, instructions: 0, deploys: 0 },`.

`packages/core/src/boards.ts` becomes:

```ts
import { raiseAlert } from './alerts.ts';
import { clamp } from './fixed.ts';
import { stepsForSeconds } from './time.ts';
import { type BoardState, type FacilityState, findBoard, type LogLine, type SimContext, toInt } from './world.ts';

export const LOG_LIMIT = 200;

/** Appends a log line; a line equal to the last one only bumps its repeat count. */
export function appendLog(board: BoardState, step: number, kind: LogLine['kind'], text: string): void {
  const last = board.log[board.log.length - 1];
  if (last && last.kind === kind && last.text === text) {
    last.repeat += 1;
    last.step = step;
    return;
  }
  board.log.push({ step, kind, text, repeat: 1 });
  if (board.log.length > LOG_LIMIT) board.log.splice(0, board.log.length - LOG_LIMIT);
}

/** Queues firmware; it becomes current at the board's next tick. Accepted for any board state. */
export function deployFirmware(board: BoardState, source: string): number {
  const version = board.nextVersion++;
  board.pending = { version, source };
  return version;
}

/** Drops the board's VM: its mem and globals are gone. Its facility is not touched: a sleep stops only the board. */
export function shutdownVm(ctx: SimContext, board: BoardState): void {
  if (board.vmBooted) {
    ctx.host.shutdown(board.id);
    board.vmBooted = false;
  }
}

/** Ends whatever a datacenter was doing: its job and its cooling cycle. */
function stopDatacenter(ctx: SimContext, facilityId: string): void {
  const dc = ctx.world.datacenters[facilityId];
  if (!dc) return;
  dc.busyFrom = -1;
  dc.busyUntil = -1;
  dc.coolFrom = -1;
  dc.coolUntil = -1;
}

export function startSleep(ctx: SimContext, board: BoardState, step: number, seconds: number): void {
  const s = clamp(toInt(seconds, 1), 1, ctx.scenario.tuning.maxSleepSeconds);
  shutdownVm(ctx, board);
  board.status = 'asleep';
  board.wakeAt = step + stepsForSeconds(ctx.scenario.time, s);
  appendLog(board, step, 'system', `sleeping ${s} s (RAM wiped)`);
}

/** The board's part of a wreck: it stops, loses its VM and mem, and a rebuild under way is lost with it. */
function destroyBoard(ctx: SimContext, board: BoardState, step: number, cause: 'fire' | 'luddites'): void {
  if (board.status === 'destroyed') return;
  shutdownVm(ctx, board);
  board.status = 'destroyed';
  board.wakeAt = null;
  board.readyAt = null;
  appendLog(board, step, 'system', cause === 'fire' ? 'destroyed by fire' : 'smashed by Luddites');
}

/**
 * Luddites or fire wreck a whole facility: it stops, by hand too, until the player repairs it, and its board, if it has one, is
 * destroyed with it (the board is rebuilt separately, once the facility stands again).
 */
export function wreckFacility(ctx: SimContext, facility: FacilityState, step: number, cause: 'fire' | 'luddites'): void {
  if (facility.condition !== 'ok') return;
  facility.condition = 'wrecked';
  facility.repairReadyAt = null;
  const board = findBoard(ctx.world, facility.id);
  if (board) destroyBoard(ctx, board, step, cause);
  stopDatacenter(ctx, facility.id);
  ctx.world.stats.wrecks += 1;
  raiseAlert(ctx.world, step, 'wrecked', facility.id, `${facility.id} 시설이 부서졌어요 (${cause === 'fire' ? '화재' : '러다이트'})`);
}

/** Phase 1: sleeps that end, board rebuilds that finish, and facility repairs that finish at this step. */
export function runTransitions(ctx: SimContext, step: number): void {
  for (const facility of ctx.world.facilities) {
    if (facility.condition !== 'repairing' || facility.repairReadyAt === null || facility.repairReadyAt > step) continue;
    facility.condition = 'ok';
    facility.repairReadyAt = null;
    // A repaired datacenter is new hardware: the wreck's heat doesn't come back with it.
    const dc = ctx.world.datacenters[facility.id];
    if (dc) dc.tempMilli = ctx.scenario.tuning.datacenter.ambientMilli;
    stopDatacenter(ctx, facility.id);
    // A repaired farm starts a new crop: whatever grew before the wreck is lost.
    const farm = ctx.world.farms[facility.id];
    if (farm) farm.plantedAt = step;
  }
  for (const board of ctx.world.boards) {
    if (board.status === 'asleep' && board.wakeAt !== null && board.wakeAt <= step) {
      board.status = 'running';
      board.wakeAt = null;
      appendLog(board, step, 'system', 'woke up');
    } else if (board.status === 'rebuilding' && board.readyAt !== null && board.readyAt <= step) {
      board.status = 'running';
      board.readyAt = null;
      appendLog(board, step, 'system', 'rebuilt');
    }
  }
}
```

`packages/core/src/economy.ts` becomes:

```ts
import { clearFlag, raiseAlert, raiseOnce } from './alerts.ts';
import { appendLog } from './boards.ts';
import { MICRO, mulDiv } from './fixed.ts';
import type { Refusal } from './refusal.ts';
import { takesBoard } from './scenario.ts';
import type { CommandResult, InstallPart } from './session.ts';
import { seasonSteps, stepsForSeconds, stepsPerDay } from './time.ts';
import { createBoard, type EndKind, findBoard, findFacility, type SimContext } from './world.ts';

/** Phase 10a: fuel for the thermal output the power phase made this step, and upkeep for every running or sleeping board. */
export function runEconomy(ctx: SimContext): void {
  const w = ctx.world;
  const spd = stepsPerDay(ctx.scenario.time);
  // Generation is the wind plus the thermal output, and phase 3 left both. The plant's firmware (phase 5) or a smash (phase 8)
  // may have changed the setting or the board since, but the module ran as phase 3 found it.
  const thermal = w.plant.generation - w.plant.wind;
  const fuel = mulDiv(thermal * w.plant.fuelPrice, MICRO, spd);
  const intact = w.boards.filter((b) => b.status === 'running' || b.status === 'asleep').length;
  const upkeep = mulDiv(intact * ctx.scenario.tuning.boardUpkeepPerDay, MICRO, spd);
  w.money -= fuel + upkeep;
  w.ledger.fuel += fuel;
  w.ledger.upkeep += upkeep;
}

function end(ctx: SimContext, step: number, kind: EndKind, message: string): void {
  ctx.world.ended = { kind, step };
  raiseAlert(ctx.world, step, 'seasonEnd', null, message);
}

/** Phase 10b: bankruptcy, then the season's last step. A town is never lost to a fall: wrecks are repaired, if the money lasts. */
export function checkEnd(ctx: SimContext, step: number): void {
  const w = ctx.world;
  if (w.ended) return;
  if (w.money < 0) {
    w.belowZeroSince ??= step;
    raiseOnce(w, 'belowZero', step, 'moneyBelowZero', null, '자금이 바닥났어요');
  } else {
    w.belowZeroSince = null;
    clearFlag(w, 'belowZero');
  }
  const spd = stepsPerDay(ctx.scenario.time);
  if (w.belowZeroSince !== null && step - w.belowZeroSince + 1 >= ctx.scenario.tuning.bankruptcyDays * spd) {
    end(ctx, step, 'bankrupt', '파산했어요');
  } else if (step + 1 >= seasonSteps(ctx.scenario.time)) {
    end(ctx, step, 'completed', '시즌이 끝났어요');
  }
}

function refuse(reason: string, refusal: Refusal): CommandResult {
  return { ok: false, reason, refusal };
}

/** Takes money for something the player bought, or answers false when there isn't enough. */
function pay(ctx: SimContext, amount: number, line: 'installs' | 'repairs' | 'rebuild'): boolean {
  const cost = amount * MICRO;
  if (ctx.world.money < cost) return false;
  ctx.world.money -= cost;
  ctx.world.ledger[line] += cost;
  return true;
}

/**
 * The player buys a facility's board (T1) or its board's comm module (T2). A new board runs with no firmware, so the facility goes
 * on by hand until the player deploys some; it joins the boards in its facility's place, whatever order the boards came in.
 */
export function installPart(ctx: SimContext, facilityId: string, part: InstallPart, step: number): CommandResult {
  const w = ctx.world;
  const facility = findFacility(w, facilityId);
  if (!facility) return refuse(`unknown facility ${facilityId}`, { code: 'unknownFacility', facility: facilityId });
  const spec = ctx.scenario.facilities[facility.index]!;
  if (!takesBoard(facility.kind) || spec.board === null) {
    return refuse(`${facilityId} takes no board`, { code: 'takesNoBoard', facility: facilityId });
  }
  if (facility.condition !== 'ok') return refuse(`${facilityId} is wrecked`, { code: 'wrecked', facility: facilityId });
  const board = findBoard(w, facilityId);
  const prices = ctx.scenario.tuning.install;
  if (part === 'board') {
    if (board) return refuse(`${facilityId} already has a board`, { code: 'alreadyInstalled', facility: facilityId, part });
    if (!pay(ctx, prices.boardPrice[facility.kind], 'installs')) return refuse('not enough money', { code: 'tooPoor' });
    const created = createBoard(ctx.scenario, spec, facility.index);
    created.powered = facility.powered;
    const at = w.boards.findIndex((b) => b.index > facility.index);
    w.boards.splice(at === -1 ? w.boards.length : at, 0, created);
    appendLog(created, step, 'system', 'board installed');
    return { ok: true };
  }
  if (!board) return refuse(`${facilityId} has no board`, { code: 'noBoard', facility: facilityId });
  if (board.status === 'destroyed' || board.status === 'rebuilding') {
    return refuse(`${facilityId}'s board is down`, { code: 'boardDown', facility: facilityId });
  }
  if (board.comm) return refuse(`${facilityId} already has a comm module`, { code: 'alreadyInstalled', facility: facilityId, part });
  if (!pay(ctx, prices.commPrice, 'installs')) return refuse('not enough money', { code: 'tooPoor' });
  board.comm = true;
  appendLog(board, step, 'system', 'comm module installed');
  return { ok: true };
}

/**
 * The player repairs a wrecked facility: it pays now and works again, by hand, after the repair time. Its board, if it had one, stays
 * destroyed until the player rebuilds it, which is a separate payment.
 */
export function startRepair(ctx: SimContext, facilityId: string, step: number): CommandResult {
  const facility = findFacility(ctx.world, facilityId);
  if (!facility) return refuse(`unknown facility ${facilityId}`, { code: 'unknownFacility', facility: facilityId });
  if (facility.condition !== 'wrecked' || !takesBoard(facility.kind)) {
    return refuse(`${facilityId} is not wrecked`, { code: 'notWrecked', facility: facilityId });
  }
  const t = ctx.scenario.tuning.repair;
  if (!pay(ctx, t.cost[facility.kind], 'repairs')) return refuse('not enough money', { code: 'tooPoor' });
  facility.condition = 'repairing';
  facility.repairReadyAt = step + stepsForSeconds(ctx.scenario.time, t.seconds);
  return { ok: true };
}

/** The player's rebuild of a destroyed board, once its facility stands again: it pays now and comes back after the rebuild time. */
export function startRebuild(ctx: SimContext, boardId: string, step: number): CommandResult {
  const board = findBoard(ctx.world, boardId);
  const facility = findFacility(ctx.world, boardId);
  if (!facility) return refuse(`unknown board ${boardId}`, { code: 'unknownBoard', board: boardId });
  if (!board) return refuse(`${boardId} has no board`, { code: 'noBoard', facility: boardId });
  if (board.status !== 'destroyed') return refuse(`${boardId} is not destroyed`, { code: 'notDestroyed', board: boardId });
  if (facility.condition !== 'ok') {
    return refuse(`${boardId} must be repaired before its board is rebuilt`, { code: 'repairFirst', facility: boardId });
  }
  const t = ctx.scenario.tuning.rebuild;
  if (!pay(ctx, t.cost, 'rebuild')) return refuse('not enough money', { code: 'tooPoor' });
  board.status = 'rebuilding';
  board.readyAt = step + stepsForSeconds(ctx.scenario.time, t.seconds);
  appendLog(board, step, 'system', `rebuilding (ready in ${t.seconds} s)`);
  return { ok: true };
}
```

In `packages/core/src/session.ts`:
- import `startRepair` with the rest: `import { checkEnd, installPart, runEconomy, startRebuild, startRepair } from './economy.ts';`;
- `RecordedInput` gains, after `install`: `| { readonly step: number; readonly kind: 'repair'; readonly facilityId: string }`;
- `replay` replays it, after the install line: `else if (input.kind === 'repair') session.repair(input.facilityId);`;
- `rebuild()` hands the id to `startRebuild`, and `repair()` comes before it:

```ts
  /** The player's repair of a wrecked facility. Refused once the season has ended. */
  repair(facilityId: string): CommandResult {
    if (this.world.ended) return SEASON_ENDED;
    const result = startRepair(this.ctx, facilityId, this.world.step);
    if (result.ok) this.record.inputs.push({ step: this.world.step, kind: 'repair', facilityId });
    return result;
  }

  /** The player's rebuild of a destroyed board. Refused once the season has ended: money is the score, and a replay stops there. */
  rebuild(boardId: string): CommandResult {
    if (this.world.ended) return SEASON_ENDED;
    const result = startRebuild(this.ctx, boardId, this.world.step);
    if (result.ok) this.record.inputs.push({ step: this.world.step, kind: 'rebuild', boardId });
    return result;
  }
```

In `packages/core/src/power.ts`, `runPower`'s thermal line becomes:

```ts
  // The thermal module follows the town's setting whatever the plant's board is doing: the board only automates it. A wrecked plant
  // makes nothing until it is repaired; the wind turbine is not the board's either, and it keeps turning.
  const thermal = plant.condition === 'ok' ? w.plant.thermalSetting : 0;
```

In `packages/core/src/datacenter.ts`, import `wreckFacility` in place of `destroyBoard`, and the fire wrecks the board's facility:

```ts
      wreckFacility(ctx, findFacility(ctx.world, board.id)!, step, 'fire');
```

In `packages/core/src/luddites.ts`, import `wreckFacility` in place of `destroyBoard`, add `findFacility` to the world import, and the group that arrives wrecks its target's facility:

```ts
    if (g.x === target.x && g.y === target.y) wreckFacility(ctx, findFacility(ctx.world, target.id)!, step, 'luddites');
```

In `packages/core/src/datasheet.ts`, the sleep rule says what a sleep stops now:

```ts
    "A facility's setting (the thermal output, the priority list) keeps its value through a sleep, while mem and globals are wiped. A sleep stops only the board: a datacenter's job and cooling cycle run their course, and the thermal module keeps its output.",
```

- [ ] **Step 4: Headless seasons repair, then rebuild**

`packages/core/src/season.ts` becomes:

```ts
import type { FirmwareHost } from './firmware-host.ts';
import { idiv, MICRO } from './fixed.ts';
import { stateHash } from './hash.ts';
import { type Scenario, takesBoard } from './scenario.ts';
import { Session } from './session.ts';
import { gameTime, stepsPerDay } from './time.ts';
import { findFacility, type Ledger, type Stats, type WorldState } from './world.ts';

export interface SeasonOptions {
  /** Stop at the end of this day instead of the season's. */
  readonly untilDay?: number;
  /** Stand in for the human: repair each wrecked facility, then rebuild its board, as soon as the money allows. */
  readonly autoRebuild?: boolean;
}

export interface SeasonResult {
  /** null when the run stopped at untilDay before the season ended. */
  readonly ended: WorldState['ended'];
  readonly day: number;
  /** Whole money units. */
  readonly money: number;
  /** Micro-units. */
  readonly ledger: Ledger;
  readonly stats: Stats;
  readonly hash: string;
}

/** The player of a headless season: repairs what is wrecked, then rebuilds its board, each as soon as the money allows. */
export function standInForThePlayer(session: Session): void {
  const w = session.world;
  const t = session.scenario.tuning;
  for (const f of w.facilities) {
    if (f.condition === 'wrecked' && takesBoard(f.kind) && w.money >= t.repair.cost[f.kind] * MICRO) session.repair(f.id);
  }
  for (const b of w.boards) {
    const standing = findFacility(w, b.id)?.condition === 'ok';
    if (b.status === 'destroyed' && standing && w.money >= t.rebuild.cost * MICRO) session.rebuild(b.id);
  }
}

/** Deploys the firmware at step 0 and runs to the end (or to untilDay). Closes the host. */
export function runSeason(
  scenario: Scenario,
  seed: number,
  host: FirmwareHost,
  firmware: Readonly<Record<string, string>>,
  options: SeasonOptions = {},
): SeasonResult {
  const session = new Session(scenario, seed, host);
  try {
    for (const boardId of Object.keys(firmware).sort()) session.deploy(boardId, firmware[boardId]!);
    const stop = options.untilDay === undefined ? Number.POSITIVE_INFINITY : options.untilDay * stepsPerDay(scenario.time);
    while (!session.world.ended && session.world.step < stop) {
      if (options.autoRebuild) standInForThePlayer(session);
      session.step();
    }
    const w = session.world;
    return {
      ended: w.ended,
      day: gameTime(scenario.time, Math.max(0, w.step - 1)).day, // the day of the last step run
      money: idiv(w.money, MICRO),
      ledger: { ...w.ledger },
      stats: { ...w.stats },
      hash: stateHash(w),
    };
  } finally {
    session.close();
  }
}
```

- [ ] **Step 5: The server takes repairs**

In `packages/core/src/protocol.ts`, `WorkerRequest` gains, after `rebuild`:

```ts
  | { readonly type: 'repair'; readonly id: number; readonly facility: string }
```

In `packages/server/src/worker.ts`, `handle()` answers it after `rebuild`:

```ts
    case 'repair':
      reply(message.id, () => {
        const result = s.repair(message.facility);
        if (result.ok) send({ type: 'snapshot', snapshot: snapshot(s.ctx) });
        return result;
      });
      return;
```

In `packages/server/src/game-controller.ts`:
- import `type CommandResult` in place of `type RebuildResult`;
- the default auto-pause becomes `private autoPause: AlertKind[] = ['raid', 'wrecked', 'fire', 'firmwareError'];`;
- `rebuild()` answers a `CommandResult`, and `repair()` follows it:

```ts
  async rebuild(board: string): Promise<CommandResult> {
    this.requireSeason();
    return (await this.request({ type: 'rebuild', id: 0, board })) as CommandResult;
  }

  /** The player's repair of a wrecked facility, which must stand again before its board can be rebuilt. */
  async repair(facility: string): Promise<CommandResult> {
    this.requireSeason();
    return (await this.request({ type: 'repair', id: 0, facility })) as CommandResult;
  }
```

- [ ] **Step 6: The viewer's words for wrecks and the new alerts**

In `packages/viewer/src/format.ts`, `ALERT_LABELS` and `endingLabel` become:

```ts
export const ALERT_LABELS: Record<AlertKind, string> = {
  raid: '러다이트 출현',
  ludditesNear: '러다이트 접근',
  wrecked: '시설 파괴',
  fire: '화재',
  overheat: '과열',
  powerShortage: '정전',
  hunger: '굶주림',
  firmwareError: '펌웨어 에러',
  moneyBelowZero: '자금 마이너스',
  seasonEnd: '시즌 종료',
  agentLost: '에이전트 끊김',
};

export function endingLabel(kind: EndKind): string {
  return kind === 'completed' ? '시즌 완주' : '파산';
}
```

In `packages/viewer/src/ui/feed.ts`, `TOGGLABLE` lists `'wrecked'` where it listed `'boardDestroyed'`, and the item's class reads:

```ts
      const cls = a.kind === 'raid' || a.kind === 'wrecked' || a.kind === 'fire' ? 'bad' : 'warn';
```

- [ ] **Step 7: Bring the other tests to wrecks and repairs**

In `packages/core/test/datacenter.test.ts` and `packages/core/test/luddites.test.ts`, every `'boardDestroyed'` becomes `'wrecked'`, and `stats.boardsLost` becomes `stats.wrecks`. Nothing else changes there.

In `packages/core/test/queries.test.ts`, the two rows about what a sleep stops become:

```ts
      ['a sleep stops only the board', rules, 'A sleep stops only the board'],
      [
        'the job, the cooling cycle, and the thermal output go on through a sleep',
        rules,
        "a datacenter's job and cooling cycle run their course, and the thermal module keeps its output",
      ],
```

In `packages/server/test/game-controller.test.ts`, the tests "reports its status" and "tells its listeners about every change, in order, until they stop listening" expect the new default auto-pause, `['raid', 'wrecked', 'fire', 'firmwareError']`. Then:

Replace the test "sends the new picture of the world when a rebuild starts, though no time passes" with this one, renamed:

```ts
  it('sends the new picture of the world when a repair or a rebuild starts, though no time passes', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    await c.runUntil({ alertKinds: ['wrecked'] }); // no firmware: the Luddites wreck a facility in the fifth game day
    const lost = (await c.alerts(undefined)).find((a) => a.kind === 'wrecked')!.facility!;
    const intact = ['P', 'DA', 'DB'].find((id) => id !== lost)!;
    const repairCost = scenario.tuning.repair.cost[lost === 'P' ? 'power' : 'datacenter'];
    const before = c.latestSnapshot()!;
    const events: ControllerEvent[] = [];
    c.onEvent((event) => events.push(event));

    expect(await c.rebuild(intact)).toMatchObject({ ok: false });
    expect(await c.rebuild(lost)).toMatchObject({ ok: false, refusal: { code: 'repairFirst', facility: lost } });
    expect(events).toEqual([]); // a refused rebuild changed nothing

    expect(await c.repair(lost)).toEqual({ ok: true });
    const repairing = c.latestSnapshot()!; // already in date when the repair is answered
    expect(repairing.step).toBe(before.step);
    expect(repairing.money).toBe(before.money - repairCost);
    expect(events.map(line)).toEqual([`snapshot ${before.step}`]);

    await c.runUntil({ seconds: 21 }); // a repair takes 20 game seconds
    const repaired = c.latestSnapshot()!;
    events.length = 0;
    expect(await c.rebuild(lost)).toEqual({ ok: true });
    const after = c.latestSnapshot()!;
    expect(after.step).toBe(repaired.step);
    expect(after.boards.find((b) => b.id === lost)!.status).toBe('rebuilding');
    expect(after.money).toBe(repaired.money - scenario.tuning.rebuild.cost);
    expect(events.map(line)).toEqual([`snapshot ${repaired.step}`]);
  });
```

Replace the test "says when a deploy installs: at the board's next tick, which comes after a sleep or a rebuild for a board that has none now" with:

```ts
  it("says when a deploy installs: at the board's next tick, which comes after a sleep or a rebuild for a board that has none now", async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    const installsAt = async (board: string): Promise<string> => {
      const outcome = await c.deploy(board, 'function tick() end');
      if (!outcome.ok) throw new Error('refused');
      return outcome.installsAt;
    };
    expect(await installsAt('DB')).toBe("the board's next tick");
    // DA sleeps from its first beat (step 3) for 30 seconds.
    await c.deploy('DA', 'function tick(io) io.sleep(30) end');
    await c.runUntil({ seconds: 1 });
    expect((await c.listBoards()).find((b) => b.id === 'DA')?.status).toBe('asleep');
    expect(await installsAt('DA')).toBe("the board's next tick, after it wakes");
    // No firmware elsewhere, so the Luddites wreck a facility in the fifth game day.
    await c.runUntil({ alertKinds: ['wrecked'] });
    const lost = (await c.alerts(undefined)).find((a) => a.kind === 'wrecked')!.facility!;
    expect(await installsAt(lost)).toBe("the board's next tick, after the player rebuilds it");
    expect(await c.repair(lost)).toEqual({ ok: true });
    await c.runUntil({ seconds: 21 }); // a repair takes 20 game seconds
    expect(await c.rebuild(lost)).toEqual({ ok: true });
    expect(await installsAt(lost)).toBe("the board's next tick, after its rebuild finishes");
  });
```

Replace the test "rebuilds a destroyed board, and says why it cannot rebuild any other" with this one, renamed:

```ts
  it('repairs a wrecked facility, then rebuilds its board, and says why it cannot do either anywhere else', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    expect(await c.rebuild('DA')).toEqual({ ok: false, reason: 'DA is not destroyed', refusal: { code: 'notDestroyed', board: 'DA' } });
    expect(await c.rebuild('ZZ')).toEqual({ ok: false, reason: 'unknown board ZZ', refusal: { code: 'unknownBoard', board: 'ZZ' } });
    expect(await c.repair('DA')).toEqual({ ok: false, reason: 'DA is not wrecked', refusal: { code: 'notWrecked', facility: 'DA' } });
    expect(await c.repair('ZZ')).toEqual({
      ok: false,
      reason: 'unknown facility ZZ',
      refusal: { code: 'unknownFacility', facility: 'ZZ' },
    });
    await c.runUntil({ alertKinds: ['wrecked'] }); // no firmware: the Luddites wreck a facility in the fifth game day
    const lost = (await c.alerts(undefined)).find((a) => a.kind === 'wrecked')!.facility!;
    expect((await c.listBoards()).find((b) => b.id === lost)?.status).toBe('destroyed');
    expect(await c.rebuild(lost)).toEqual({
      ok: false,
      reason: `${lost} must be repaired before its board is rebuilt`,
      refusal: { code: 'repairFirst', facility: lost },
    });
    expect(await c.repair(lost)).toEqual({ ok: true });
    expect(await c.repair(lost)).toEqual({ ok: false, reason: `${lost} is not wrecked`, refusal: { code: 'notWrecked', facility: lost } });
    await c.runUntil({ seconds: 21 }); // a repair takes 20 game seconds
    expect(await c.rebuild(lost)).toEqual({ ok: true });
    expect((await c.listBoards()).find((b) => b.id === lost)?.status).toBe('rebuilding');
    expect(await c.rebuild(lost)).toEqual({
      ok: false,
      reason: `${lost} is not destroyed`,
      refusal: { code: 'notDestroyed', board: lost },
    });
  });
```

In `packages/server/test/game-server.test.ts`:
- delete the helper `eventually`, which nothing uses any more;
- in "closes the connection of a viewer that sends more than a command can be, and the others go on", the late viewer expects `['raid', 'wrecked', 'fire', 'firmwareError']`.

Replace the test "refuses a speed or an auto-pause setting the controller cannot take, and the season goes on" with:

```ts
  it('refuses a speed or an auto-pause setting the controller cannot take, and the season goes on', async () => {
    const { server, configDir } = await start({ dev: true });
    const v = await viewer(server.port);
    const agent = await connectAgent(server, configDir);
    await until(() => last(v.seen, 'status')?.status.agent.connected === true);
    await agent.callTool({ name: 'dev_new_season', arguments: { seed: 1 } });
    await until(() => last(v.seen, 'status')?.status.state === 'paused');
    // The eleven alert kinds there are: all of them, and no more, are a valid setting.
    const everyKind: AlertKind[] = [
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
      'agentLost',
    ];
    v.send({ type: 'autoPause', kinds: everyKind });
    await until(() => last(v.seen, 'status')?.status.autoPause.length === 11);
    expect(last(v.seen, 'status')!.status.autoPause).toEqual(everyKind);
    v.send({ type: 'speed', speed: 3 });
    v.send({ type: 'autoPause', kinds: ['fire'] });
    await until(() => last(v.seen, 'status')?.status.speed === 3 && last(v.seen, 'status')?.status.autoPause.join() === 'fire');
    v.send({ type: 'play' });
    await until(() => last(v.seen, 'status')?.status.state === 'running');

    const settings = [
      '{"type":"speed","speed":"x"}', // the clock's arithmetic turns NaN and every batch has no steps: the season freezes
      '{"type":"speed","speed":1e999}', // Infinity: every beat runs a full batch
      '{"type":"speed","speed":0}',
      '{"type":"speed","speed":4}',
      '{"type":"speed","speed":-1}',
      '{"type":"speed","speed":2.5}',
      '{"type":"speed","speed":"2"}',
      '{"type":"speed","speed":null}',
      '{"type":"autoPause","kinds":"fire"}', // a string would be spread into its letters
      '{"type":"autoPause","kinds":null}',
      '{"type":"autoPause","kinds":5}',
      '{"type":"autoPause","kinds":[1]}',
      '{"type":"autoPause","kinds":["nope"]}',
      `{"type":"autoPause","kinds":[${'"fire",'.repeat(11)}"fire"]}`, // twelve entries, one more than there are kinds
    ];
    const errors = (): number => v.seen.filter((m) => m.type === 'error').length;
    const answered = errors();
    for (const text of settings) v.ws.send(text);
    await until(() => errors() === answered + settings.length);
    // None took effect: the season runs at the speed and with the auto-pause it had, the agent sees the same, and it advances.
    expect(last(v.seen, 'status')!.status).toMatchObject({ state: 'running', speed: 3, autoPause: ['fire'] });
    const status = JSON.parse(textOf(await agent.callTool({ name: 'get_status', arguments: {} }))) as { run: unknown };
    expect(status.run).toEqual({ paused: false, speed: 3 });
    const at = last(v.seen, 'snapshot')!.snapshot.step;
    await until(() => last(v.seen, 'snapshot')!.snapshot.step >= at + 30);
  });
```

In "streams the season to every viewer and carries the player's commands", replace the part from `// Alerts go to everyone.` to the end of the test:

```ts
    // Alerts go to everyone. With no firmware the Luddites smash a board in the fifth game day.
    await call('dev_run_until', { alertKinds: ['boardDestroyed'] });
    const destroyed = (x: typeof v) =>
      x.seen.flatMap((m) => (m.type === 'alerts' ? m.alerts : [])).find((a) => a.kind === 'boardDestroyed');
    await until(() => destroyed(v) !== undefined && destroyed(late) !== undefined);
    const lost = destroyed(v)!.facility!;

    // Rebuilding the lost board from the viewer is accepted: the game says nothing and the board is being rebuilt.
    v.send({ type: 'rebuild', board: lost });
    await eventually(async () => {
      const boards = JSON.parse(textOf(await call('list_boards', {}))) as Array<{ id: string; status: string }>;
      return boards.find((b) => b.id === lost)?.status === 'rebuilding';
    });
```

with:

```ts
    // Alerts go to everyone. With no firmware the Luddites wreck a facility in the fifth game day.
    await call('dev_run_until', { alertKinds: ['wrecked'] });
    const wrecked = (x: typeof v) => x.seen.flatMap((m) => (m.type === 'alerts' ? m.alerts : [])).find((a) => a.kind === 'wrecked');
    await until(() => wrecked(v) !== undefined && wrecked(late) !== undefined);
    const lost = wrecked(v)!.facility!;

    // The lost facility's board is rebuilt only once the facility is repaired, and the viewer that asked is told so.
    v.send({ type: 'rebuild', board: lost });
    await until(() => last(v.seen, 'error')?.refusal?.code === 'repairFirst');
    expect(last(v.seen, 'error')!.refusal).toEqual({ code: 'repairFirst', facility: lost });
    expect(late.seen.filter((m) => m.type === 'error')).toHaveLength(0);
  });
```

In `packages/server/test/seasons.test.ts`, the imports become:

```ts
import { readFileSync } from 'node:fs';
import {
  parseScenario,
  replay,
  runSeason,
  type SeasonResult,
  Session,
  standInForThePlayer,
  stateHash,
  stepsPerDay,
} from '@turing-city/core';
```

Replace the test "replays a recorded session, with a deploy in mid-season and rebuilds, into the same state on a fresh Lua runtime" with this one, renamed:

```ts
  it('replays a recorded session, with a deploy in mid-season, repairs, and rebuilds, into the same state on a fresh Lua runtime', async () => {
    const seed = 3;
    const live = new Session(scenario, seed, await WasmoonHost.create());
    for (const id of Object.keys(careful).sort()) live.deploy(id, careful[id]!);
    const swapAt = 10 * stepsPerDay(scenario.time);
    while (!live.world.ended) {
      // The player: repairs what is wrecked and rebuilds its board as soon as the money allows, and after ten days swaps one
      // board's firmware.
      standInForThePlayer(live);
      if (live.world.step === swapAt) {
        live.mark('pause');
        live.deploy('DA', careless.DA!);
        live.mark('resume');
      }
      live.step();
    }
    const inputs = live.record.inputs;
    expect(inputs.some((i) => i.kind === 'deploy' && i.step === 0)).toBe(true);
    expect(inputs.some((i) => i.kind === 'deploy' && i.step === swapAt)).toBe(true);
    expect(inputs.filter((i) => i.kind === 'repair').length).toBeGreaterThan(1);
    expect(inputs.filter((i) => i.kind === 'rebuild').length).toBeGreaterThan(1);
    expect(inputs.map((i) => i.kind)).toEqual(expect.arrayContaining(['pause', 'resume']));

    const replayed = replay(scenario, seed, live.record, await WasmoonHost.create(), live.world.step);
    expect(replayed.world.step).toBe(live.world.step);
    expect(replayed.world.ended).toEqual(live.world.ended);
    expect(stateHash(replayed.world)).toBe(stateHash(live.world));
    live.close();
    replayed.close();
  }, 120_000);
```

- [ ] **Step 8: The reference firmware, the shots, and the docs**

`scenarios/firmware/m1/careful/P.lua` becomes:

```lua
-- Careful: buy only the fuel the working datacenters need, and go dark when they do.
-- Demand of 8 or less means both datacenters sleep: Luddites are near, or no work pays.
-- The thermal module keeps its setting while the board sleeps, so turn it off first.
function tick(io, mem)
  if io.demand <= 8 then
    io.set_thermal(0)
    io.sleep(5)
    return
  end
  if not mem.ready then
    io.set_priority({ "DA", "DB" })
    mem.ready = true
  end
  -- Cover the recent peak, so a job that starts between two ticks isn't shed;
  -- the peak decays slowly after the jobs stop. Steps of 10 keep the actions few.
  local peak = (mem.peak or 0) - 10
  if io.demand > peak then peak = io.demand end
  mem.peak = peak
  local need = (peak - io.wind + 19) // 10 * 10
  if need < 0 then need = 0 elseif need > 300 then need = 300 end
  if need ~= mem.last then
    io.set_thermal(need)
    mem.last = need
  end
end
```

In `packages/server/scripts/shots.ts`, the three places that look for a `'boardDestroyed'` alert look for `'wrecked'`. Its two rebuild checks still fail, as said above.

In `CLAUDE.md`, "Code and checks", the `pnpm sim` line's `--rebuild` part becomes: "`--rebuild` stands in for the player: it repairs every wrecked facility, then rebuilds its board, as soon as the money allows".

- [ ] **Step 9: Run the tests to verify they pass, then the whole check**

Run: `pnpm vitest run packages/core/test/wrecks.test.ts packages/core/test/power.test.ts packages/core/test/economy.test.ts`
Expected: PASS.

Run: `pnpm fix && pnpm check`
Expected: every package typechecks, Biome is clean, and every test passes (594).

Run: `pnpm sim --firmware scenarios/firmware/m1/careless --seed 1 --rebuild`
Expected: `"ended": { "kind": "bankrupt", ... }`. With no fall, the careless town now plays on through repairs until its money runs out. The careful set completes seeds 1, 2, 3, 7, and 8.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src packages/core/test packages/server/src/worker.ts packages/server/src/game-controller.ts packages/server/scripts/shots.ts packages/server/test packages/viewer/src/format.ts packages/viewer/src/ui/feed.ts scenarios/firmware/m1/careful/P.lua CLAUDE.md
git commit -m "Wreck whole facilities, repair them and rebuild their boards separately, and end seasons only by bankruptcy or the calendar"
```

---

### Task 4: Facility actions from firmware and from the player's hand

The board is only automation (10-10 §4.2): whatever firmware can make a facility do, the player can do by hand, and the same rules apply either way (§4.3). When the hand and firmware set the same thing, the last writer wins (§11). This task gives both one path, contract §3 to §5. It follows the coordinator's decision D1 of 2026-10-10: a hand action applies at once, with no queue.

**The actions** (`firmware-host.ts`).
- `FacilityAction` is what a facility can be told to do: `process`; `cool`, which has no level now and starts one cycle; `setThermal`; `setPriority`; `harvest`; and `dispatch`.
- `Action`, what firmware asks for, is a `FacilityAction` or a `sleep`.
- `countsAsAction(kind)` names the machine labor that Task 6 charges as action EMF: everything but `process` and `sleep`.
- `SensorValue` lets a reading be a list or a record. Task 7 and Task 8 produce some, and Task 12 writes them into Lua.

**One path for the hand and firmware.** `applyFacilityAction(ctx, facility, action, startStep)` applies one action. `startStep` is the first step the action affects:
- The hand acts between steps, so its `startStep` is `world.step`, the next step to run.
- Firmware acts in phase 5 of step s, after that step's power phase, so its `startStep` is s + 1.

What each action does from `startStep`:
- **`process`** runs a job of `jobMs` (`jobSteps` steps). Presses don't stack: a press while the job runs ends it `jobMs` after that press: `busyFrom = running ? busyFrom : startStep`, `busyUntil = max(busyUntil, startStep + jobSteps)`.
- **`cool`** starts a cycle of `coolingCycleMs`, unless one already covers `startStep`.
- **`setThermal` and `setPriority`** change the plant's settings at once.
- **`harvest` and `dispatch`** do nothing until Task 7 and Task 8.
- A facility that is wrecked or being repaired ignores every action, and so does a facility of the wrong kind.

**The firmware path.** `applyActions` (phase 5) sends every ticked board's actions down this path, from the next step. A sleep stops the rest of a board's list, as before.

**The hand.** `Session.hand(facilityId, action)`:
- refuses once the season has ended (`seasonEnded`), for an unknown facility (`unknownFacility`), for one that is wrecked or being repaired (`wrecked`), and for an action that isn't its kind's (`cannotAct`, with the reason `"<id>: <detail>"` from `kindProblem`, for example "P: process is a datacenter's action");
- records the action at `world.step`, counts it in `stats.handActions`, and applies it at once, so a paused game shows it in its next snapshot;
- is replayed by `replay` at the same step.

Task 7 and Task 8 add their own checks to `Session.hand` after the kind check: "nothing is ripe", and why a truck cannot leave.

**Last writer wins, in the order things happen.** A hand setting made between steps holds until firmware sets the same thing at a later tick, and firmware's setting holds until the hand changes it. A cooling press during a cycle is accepted and does nothing, as firmware's call does.

**Milestone 1's job changes.** A `process()` call runs half a second now, where it ran until the board's next tick (a fifth of a second for the test scenario's 5 Hz datacenters). Two datacenter tests and two firmware tests follow it, and the season checks hold with the reference firmware as Task 2 left it.

**The firmware package changes only what compiling needs.**
- `decodeActions` turns code 2 into `{ kind: 'cool' }`. The prelude's `io.cool(level)` still pushes a level after the code until Task 12 gives `io.cool()` no argument, so the decoder reads that number and drops it. Otherwise the level would be decoded as the next action's code.
- `BoardVm` takes `SensorValue`s and writes the numbers among them. Anything else reads as nil until Task 12 writes strings, lists, and records.
- The prelude's new actions, `harvest`, `dispatch`, and `cool()` without an argument, are Task 12's.

**Files:**
- Modify: `packages/core/src/firmware-host.ts`, `packages/core/src/actions.ts`, `packages/core/src/datacenter.ts`, `packages/core/src/session.ts`, `packages/core/src/world.ts`, `packages/core/src/datasheet.ts`
- Modify: `packages/firmware/src/host.ts`, `packages/firmware/src/board-vm.ts`
- Test: `packages/core/test/hand.test.ts` (new)
- Test (changed): `packages/core/test/datacenter.test.ts`, `packages/core/test/session.test.ts`, `packages/core/test/emf.test.ts`, `packages/core/test/luddites.test.ts`, `packages/firmware/test/host.test.ts`

**Interfaces:**
- Consumes:
  - Task 2's `FacilityState`, `findFacility`, the datacenter's busy and cool windows, `coolSteps`, `CommandResult`, and the refusal codes `unknownFacility`, `wrecked`, and `cannotAct`.
  - Task 3's `wreckFacility` and `Session.repair`.
  - Task 1's `tuning.datacenter.jobMs`.
- Produces:
  - `firmware-host.ts`:
    - `FacilityAction`, and `Action = FacilityAction | sleep`;
    - `countsAsAction(kind)`;
    - `SensorValue`, and `TickInput.sensors: Readonly<Record<string, SensorValue>>`.
  - `actions.ts`:
    - `applyFacilityAction(ctx, facility, action, startStep)`;
    - `applyActions(ctx, step, ticked)`;
    - `kindProblem(facility, action): string | null`.
  - `datacenter.ts`: `jobSteps(ctx)`.
  - `session.ts`: `Session.hand(facilityId, action): CommandResult`, and the recorded input `{ kind: 'hand', facilityId, action }`.
  - `world.ts`: `Stats.handActions`.
  - The firmware package:
    - `decodeActions` maps code 2 to `{ kind: 'cool' }`;
    - `BoardVm.tick(sensors: Readonly<Record<string, SensorValue>>, newSource)`.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/hand.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyFacilityAction } from '../src/actions.ts';
import { wreckFacility } from '../src/boards.ts';
import { type Action, countsAsAction } from '../src/firmware-host.ts';
import { MICRO } from '../src/fixed.ts';
import { stateHash } from '../src/hash.ts';
import { snapshot } from '../src/queries.ts';
import { replay, Session } from '../src/session.ts';
import { findFacility } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario, m2Scenario } from './helpers/scenarios.ts';

/** The test scenario with a steady wind and job price, no raids, and plenty of power from the plant's setting. */
function quiet(host = new FakeHost()): Session {
  const s = new Session(
    m1Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.jobPrice.maxChangePerSecond = 0;
      j.tuning.emf.rumourThreshold = 1_000_000_000;
      j.tuning.thermal.max = 2000;
    }),
    1,
    host,
  );
  s.world.plant.thermalSetting = 1000;
  return s;
}

function steps(s: Session, n: number): void {
  for (let i = 0; i < n; i++) s.step();
}

const windows = (s: Session, id: string) => {
  const dc = s.world.datacenters[id]!;
  return { busy: [dc.busyFrom, dc.busyUntil], cool: [dc.coolFrom, dc.coolUntil] };
};

describe('facility actions from the hand and from firmware', () => {
  it('counts every action toward action EMF but process and sleep', () => {
    const kinds: Action['kind'][] = ['process', 'cool', 'setThermal', 'setPriority', 'harvest', 'dispatch', 'sleep'];
    expect(kinds.filter(countsAsAction)).toEqual(['cool', 'setThermal', 'setPriority', 'harvest', 'dispatch']);
  });

  it('runs a press of [처리] at once, from the step the world is at, for half a second', () => {
    const s = quiet();
    steps(s, 6);
    expect(s.hand('DA', { kind: 'process' })).toEqual({ ok: true });
    expect(windows(s, 'DA').busy).toEqual([6, 16]); // 500 ms at 20 steps a second, from step 6
    expect(snapshot(s.ctx).boards[1]!.processing).toBe(true); // a paused game shows it before the next step
    const before = s.world.ledger.datacenterIncome;
    steps(s, 12);
    expect(s.world.ledger.datacenterIncome - before).toBe(20 * MICRO); // 40 a second for half a second
  });

  it('does not stack presses: a press while the job runs ends it half a second after that press', () => {
    const s = quiet();
    s.hand('DA', { kind: 'process' });
    steps(s, 5);
    s.hand('DA', { kind: 'process' });
    expect(windows(s, 'DA').busy).toEqual([0, 15]);
  });

  it('starts a cooling cycle at once, ignores a press during it, and starts a new one after it', () => {
    const s = quiet();
    expect(s.hand('DA', { kind: 'cool' })).toEqual({ ok: true });
    expect(windows(s, 'DA').cool).toEqual([0, 80]); // 4 s
    steps(s, 10);
    expect(s.hand('DA', { kind: 'cool' })).toEqual({ ok: true });
    expect(windows(s, 'DA').cool).toEqual([0, 80]);
    steps(s, 70); // the cycle's last step is 79
    s.hand('DA', { kind: 'cool' });
    expect(windows(s, 'DA').cool).toEqual([80, 160]);
  });

  it("applies firmware's actions the same way, from the step after its tick", () => {
    const host = new FakeHost();
    const both = host.program('both', () => ({ actions: [{ kind: 'process' }, { kind: 'cool' }] }));
    const s = quiet(host);
    s.deploy('DA', both);
    steps(s, 4); // DA's first beat is step 3
    expect(windows(s, 'DA')).toEqual({ busy: [4, 14], cool: [4, 84] });
  });

  it('lets the last writer win, in the order things happen: the hand after a tick, and the next tick after the hand', () => {
    const host = new FakeHost();
    const plant = host.program('plant', () => ({ actions: [{ kind: 'setThermal', output: 100 }] }));
    const s = quiet(host);
    s.deploy('P', plant);
    s.step(); // P's beat at step 0 sets 100
    expect(s.world.plant.thermalSetting).toBe(100);
    expect(s.hand('P', { kind: 'setThermal', output: 250 })).toEqual({ ok: true });
    expect(s.world.plant.thermalSetting).toBe(250);
    steps(s, 4); // steps 1 to 4: P has no beat
    expect(s.world.plant.generation).toBe(220 + 250);
    s.step(); // P's beat at step 5 writes after the hand
    expect(s.world.plant.thermalSetting).toBe(100);
  });

  it('works the town by hand with no board at all', () => {
    const s = new Session(
      m2Scenario((j) => {
        j.tuning.wind.start = 220;
        j.tuning.wind.maxChangePerSecond = 0;
        j.tuning.jobPrice.maxChangePerSecond = 0;
        j.tuning.emf.rumourThreshold = 1_000_000_000;
      }),
      1,
      new FakeHost(),
    );
    expect(s.world.boards).toEqual([]);
    // The wind alone can't carry both housing blocks and the job: the plant's thermal module, set by hand, makes up the rest.
    expect(s.hand('P', { kind: 'setThermal', output: 200 })).toEqual({ ok: true });
    expect(s.hand('DA', { kind: 'process' })).toEqual({ ok: true });
    steps(s, 12);
    expect(s.world.ledger.datacenterIncome).toBe(20 * MICRO);
    expect(s.world.plant.shed).toEqual([]);
  });

  it('refuses an action the facility cannot take, says why, and records and changes nothing', () => {
    const s = quiet();
    wreckFacility(s.ctx, findFacility(s.world, 'DB')!, 0, 'luddites');
    const before = stateHash(s.world);
    expect(s.hand('ZZ', { kind: 'process' })).toEqual({
      ok: false,
      reason: 'unknown facility ZZ',
      refusal: { code: 'unknownFacility', facility: 'ZZ' },
    });
    expect(s.hand('DB', { kind: 'process' })).toEqual({ ok: false, reason: 'DB is wrecked', refusal: { code: 'wrecked', facility: 'DB' } });
    expect(s.hand('P', { kind: 'process' })).toEqual({
      ok: false,
      reason: "P: process is a datacenter's action",
      refusal: { code: 'cannotAct', facility: 'P', detail: "process is a datacenter's action" },
    });
    expect(s.hand('DA', { kind: 'setThermal', output: 100 })).toMatchObject({
      refusal: { detail: "setThermal is a power plant's action" },
    });
    expect(s.hand('DA', { kind: 'harvest' })).toMatchObject({ refusal: { detail: "harvest is a farm's action" } });
    expect(s.hand('P', { kind: 'dispatch', truck: 1, from: 'F1', to: 'W', amount: 10 })).toMatchObject({
      refusal: { detail: "dispatch is a warehouse's action" },
    });
    expect(stateHash(s.world)).toBe(before);
    s.repair('DB');
    expect(s.hand('DB', { kind: 'cool' })).toEqual({ ok: false, reason: 'DB is wrecked', refusal: { code: 'wrecked', facility: 'DB' } });
    expect(s.record.inputs.map((i) => i.kind)).toEqual(['repair']);
    expect(s.world.stats.handActions).toBe(0);
  });

  it('refuses a hand action once the season has ended', () => {
    const s = new Session(
      m1Scenario((j) => {
        j.time.secondsPerDay = 1;
        j.time.seasonDays = 1;
      }),
      1,
      new FakeHost(),
    );
    steps(s, 20);
    expect(s.hand('DA', { kind: 'process' })).toEqual({ ok: false, reason: 'the season has ended', refusal: { code: 'seasonEnded' } });
  });

  it('ignores every action on a facility that is not standing, whoever sends it', () => {
    const s = quiet();
    const da = findFacility(s.world, 'DA')!;
    wreckFacility(s.ctx, da, 0, 'fire');
    applyFacilityAction(s.ctx, da, { kind: 'process' }, 0);
    applyFacilityAction(s.ctx, da, { kind: 'cool' }, 0);
    expect(windows(s, 'DA')).toEqual({ busy: [-1, -1], cool: [-1, -1] });
  });

  it('records hand actions at the step they were made, counts them, and replays them into the same state', () => {
    const program = () => ({ actions: [{ kind: 'process' } as const] });
    const host = new FakeHost();
    const live = quiet(host);
    // The helper's thermal setting is no input: the hand sets it again, so that the replay starts from the same plant.
    live.hand('P', { kind: 'setThermal', output: 1000 });
    live.deploy('DB', host.program('work', program));
    steps(live, 3);
    live.hand('DA', { kind: 'process' });
    live.hand('DA', { kind: 'cool' });
    steps(live, 20);
    live.hand('P', { kind: 'setPriority', order: ['DB', 'DA'] });
    steps(live, 10);
    expect(live.world.stats.handActions).toBe(4);
    expect(live.record.inputs.filter((i) => i.kind === 'hand')).toEqual([
      { step: 0, kind: 'hand', facilityId: 'P', action: { kind: 'setThermal', output: 1000 } },
      { step: 3, kind: 'hand', facilityId: 'DA', action: { kind: 'process' } },
      { step: 3, kind: 'hand', facilityId: 'DA', action: { kind: 'cool' } },
      { step: 23, kind: 'hand', facilityId: 'P', action: { kind: 'setPriority', order: ['DB', 'DA'] } },
    ]);
    const replayHost = new FakeHost();
    replayHost.program('work', program);
    const again = replay(live.scenario, live.seed, live.record, replayHost, live.world.step);
    expect(stateHash(again.world)).toBe(stateHash(live.world));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/test/hand.test.ts`
Expected: FAIL, all 11 tests:
- `TypeError: s.hand is not a function`, and the same for `live.hand`;
- `TypeError: undefined is not a function` (`countsAsAction`);
- `TypeError: applyFacilityAction is not a function`;
- for the firmware test, `expected { busy: [ 4, 8 ], cool: [ -1, -1 ] } to deeply equal { busy: [ 4, 14 ], cool: [ 4, 84 ] }`. The job still ends at DA's next tick, and the `cool` with no level starts no cycle.

- [ ] **Step 3: The facility actions**

In `packages/core/src/firmware-host.ts`, replace the `Action` type with:

```ts
/** What a facility can be told to do, by its board's firmware or by the player's hand (10-10 §4.3). */
export type FacilityAction =
  | { readonly kind: 'process' }
  /** One cooling cycle: it has no level. */
  | { readonly kind: 'cool' }
  | { readonly kind: 'setThermal'; readonly output: number }
  | { readonly kind: 'setPriority'; readonly order: readonly string[] }
  | { readonly kind: 'harvest' }
  | { readonly kind: 'dispatch'; readonly truck: number; readonly from: string; readonly to: string; readonly amount: number };

/** What firmware can ask for during one tick: the facility actions, plus sleep. */
export type Action = FacilityAction | { readonly kind: 'sleep'; readonly seconds: number };

/** The actions that count toward a board's action EMF, machine labor: all but process and sleep (10-10 §5). */
export function countsAsAction(kind: Action['kind']): boolean {
  return kind !== 'process' && kind !== 'sleep';
}

/** A sensor reading as firmware sees it in io: a number, a string, nil, or a list or record of them. */
export type SensorValue = number | string | undefined | readonly SensorValue[] | { readonly [key: string]: SensorValue };
```

and `TickInput.sensors` takes those values:

```ts
  /** Sensor values by their Lua name; undefined reads as nil. */
  readonly sensors: Readonly<Record<string, SensorValue>>;
```

- [ ] **Step 4: One path for the hand and firmware**

In `packages/core/src/datacenter.ts`, before `coolSteps`, add:

```ts
/** Steps one job lasts: a press of [처리], or one process(). The scenario makes it a whole number. */
export function jobSteps(ctx: SimContext): number {
  return idiv(ctx.scenario.tuning.datacenter.jobMs * ctx.scenario.time.stepsPerSecond, 1000);
}
```

`packages/core/src/actions.ts` becomes:

```ts
import { startSleep } from './boards.ts';
import { coolSteps, jobSteps } from './datacenter.ts';
import type { FacilityAction } from './firmware-host.ts';
import { clamp } from './fixed.ts';
import type { FacilityKind } from './scenario.ts';
import type { Ticked } from './ticks.ts';
import { type FacilityState, findFacility, type SimContext, toInt } from './world.ts';

/** The kind of facility each action works. */
const ACTION_FACILITY: Record<FacilityAction['kind'], FacilityKind> = {
  process: 'datacenter',
  cool: 'datacenter',
  setThermal: 'power',
  setPriority: 'power',
  harvest: 'farm',
  dispatch: 'warehouse',
};

/** Each kind in words, for refusals. */
const KIND_NAMES: Record<FacilityKind, string> = {
  power: 'power plant',
  datacenter: 'datacenter',
  farm: 'farm',
  warehouse: 'warehouse',
  housing: 'housing block',
};

/** Why a facility of its kind can't take the action at all, or null. Session.hand refuses with it. */
export function kindProblem(facility: FacilityState, action: FacilityAction): string | null {
  const kind = ACTION_FACILITY[action.kind];
  return facility.kind === kind ? null : `${action.kind} is a ${KIND_NAMES[kind]}'s action`;
}

/**
 * Applies one facility action, from firmware or from the player's hand: the same action does the same thing either way.
 * startStep is the first step it affects: the hand acts between steps, at world.step, and firmware in phase 5 of step s acts
 * from s + 1. A wrecked or repairing facility ignores every action, and so does a facility of the wrong kind.
 */
export function applyFacilityAction(ctx: SimContext, facility: FacilityState, action: FacilityAction, startStep: number): void {
  if (facility.condition !== 'ok' || kindProblem(facility, action) !== null) return;
  const w = ctx.world;
  const t = ctx.scenario.tuning;
  switch (action.kind) {
    case 'process': {
      // A job runs jobMs from its start. A press while one runs doesn't stack: the job ends jobMs after the latest press.
      const dc = w.datacenters[facility.id]!;
      const running = dc.busyFrom <= startStep && startStep < dc.busyUntil;
      if (!running) dc.busyFrom = startStep;
      dc.busyUntil = Math.max(dc.busyUntil, startStep + jobSteps(ctx));
      break;
    }
    case 'cool': {
      // A cooling cycle runs to its end: a press while one runs does nothing.
      const dc = w.datacenters[facility.id]!;
      if (dc.coolFrom <= startStep && startStep < dc.coolUntil) break;
      dc.coolFrom = startStep;
      dc.coolUntil = startStep + coolSteps(ctx);
      break;
    }
    case 'setThermal':
      w.plant.thermalSetting = clamp(toInt(action.output), 0, t.thermal.max);
      break;
    case 'setPriority': {
      // A priority list names facilities, with a board or not: housing is a consumer too.
      const known = new Set(w.facilities.map((f) => f.id));
      w.plant.priority = [...new Set(action.order.filter((id) => known.has(id)))];
      break;
    }
    case 'harvest':
      // Farms are worked from Task 7.
      break;
    case 'dispatch':
      // The warehouse's trucks run from Task 8.
      break;
  }
}

/** Phase 5: applies what each tick asked for, from the next step. A failed tick asks for nothing, and a sleep stops the rest. */
export function applyActions(ctx: SimContext, step: number, ticked: readonly Ticked[]): void {
  for (const { board, outcome } of ticked) {
    const facility = findFacility(ctx.world, board.id)!;
    for (const action of outcome.actions) {
      if (board.status !== 'running') break; // a sleep stops the rest of the list
      if (action.kind === 'sleep') startSleep(ctx, board, step, action.seconds);
      else applyFacilityAction(ctx, facility, action, step + 1);
    }
  }
}
```

- [ ] **Step 5: The player's hand**

In `packages/core/src/world.ts`, `Stats` gains a count after `deploys`:

```ts
  /** Actions the player took by hand. */
  handActions: number;
```

and `createWorld` starts it at 0: `stats: { raids: 0, wrecks: 0, instructions: 0, deploys: 0, handActions: 0 },`.

In `packages/core/src/session.ts`:
- the imports become `import { applyActions, applyFacilityAction, kindProblem } from './actions.ts';` and `import type { FacilityAction, FirmwareHost } from './firmware-host.ts';`;
- `RecordedInput` gains, after `rebuild`: `| { readonly step: number; readonly kind: 'hand'; readonly facilityId: string; readonly action: FacilityAction }`;
- `replay` replays it, after the rebuild line: `else if (input.kind === 'hand') session.hand(input.facilityId, input.action);`;
- before `mark()`, add:

```ts
  /**
   * The player works a facility by hand, as its firmware would: the action applies at once, between steps, from world.step on.
   * Firmware that sets the same thing in a later step wins over it, as the hand wins over firmware that set it before: the last
   * writer wins. Refused for a facility that isn't there, isn't standing, or doesn't take the action.
   */
  hand(facilityId: string, action: FacilityAction): CommandResult {
    if (this.world.ended) return SEASON_ENDED;
    const facility = findFacility(this.world, facilityId);
    if (!facility)
      return { ok: false, reason: `unknown facility ${facilityId}`, refusal: { code: 'unknownFacility', facility: facilityId } };
    if (facility.condition !== 'ok')
      return { ok: false, reason: `${facilityId} is wrecked`, refusal: { code: 'wrecked', facility: facilityId } };
    const problem = kindProblem(facility, action);
    if (problem !== null) {
      return { ok: false, reason: `${facilityId}: ${problem}`, refusal: { code: 'cannotAct', facility: facilityId, detail: problem } };
    }
    this.record.inputs.push({ step: this.world.step, kind: 'hand', facilityId, action });
    this.world.stats.handActions += 1;
    applyFacilityAction(this.ctx, facility, action, this.world.step);
    return { ok: true };
  }
```

- [ ] **Step 6: What the firmware package needs to compile**

In `packages/firmware/src/host.ts`, `decodeActions` reads code 2 as:

```ts
    else if (code === ACTION_CODES.cool) {
      next(); // the level milestone 1's io.cool(level) still pushes: a cycle has none
      out.push({ kind: 'cool' });
    } else if (code === ACTION_CODES.setThermal) out.push({ kind: 'setThermal', output: next() });
```

In `packages/firmware/src/board-vm.ts`:
- import `SensorValue` with the rest: `import type { FacilityKind, SensorValue, TickError } from '@turing-city/core';`;
- `tick()` and `baseline()` take `sensors: Readonly<Record<string, SensorValue>>`;
- `writeSensors` writes the numbers:

```ts
  private writeSensors(sensors: Readonly<Record<string, SensorValue>>): void {
    const { lua, L } = this;
    this.pushRef('io');
    for (const [key, value] of Object.entries(sensors)) {
      lua.lua_pushstring(L, key);
      // Only numbers so far: Task 12 writes strings, lists, and records too, which read as nil until then.
      if (typeof value !== 'number') lua.lua_pushnil(L);
      else if (Number.isInteger(value)) lua.lua_pushinteger(L, BigInt(value));
      else lua.lua_pushnumber(L, value);
      lua.lua_rawset(L, -3);
    }
    lua.lua_settop(L, 0);
  }
```

- [ ] **Step 7: The datasheet's words for a job and a cycle**

In `packages/core/src/datasheet.ts`, the datacenter's two calls become:

```ts
      {
        call: 'io.process()',
        meaning: `run the datacenter for ${milli(dc.jobMs)} s from the next step; a call while it runs makes it run ${milli(dc.jobMs)} s from then, not longer. It earns price x seconds, draws ${dc.processPower} power, and heats the datacenter (+${milli(dc.heatMilliPerSecond)} °C/s)`,
      },
      {
        call: 'io.cool(level)',
        meaning: `start a cooling cycle from the next step (the level is ignored): it takes ${milli(dc.coolingDropMilli)} °C off over ${dc.coolingCycleMs / 1000} s, in even steps, and draws ${dc.coolingPower} power while it runs; a call during a cycle does nothing`,
      },
```

The tests that read these lines look for "draws 150 power, and heats the datacenter (+2 °C/s)" and "it takes 15 °C off over 4 s, in even steps, and draws 400 power while it runs", which stay.

- [ ] **Step 8: Bring the other tests to half-second jobs, levelless cycles, and sensor values**

In `packages/core/test/datacenter.test.ts`:

Replace the test "charges and pays the job of one process() call on the same steps: one tick period, no more" with this one, renamed:

```ts
  it('charges and pays the job of one process() call on the same steps: half a second, longer than the tick period', () => {
    const host = new FakeHost();
    let calls = 0;
    const once = host.program('once', () => ({ actions: calls++ === 0 ? [{ kind: 'process' }] : [] }));
    const s = holding(host);
    s.deploy('DA', once);
    s.step();
    const idle = s.world.plant.demand; // nothing runs yet at step 0
    let earned = s.world.ledger.datacenterIncome;
    const charged: number[] = [];
    const paid: number[] = [];
    for (let step = 1; step < 16; step++) {
      s.step();
      if (s.world.plant.demand > idle) charged.push(step);
      if (s.world.ledger.datacenterIncome > earned) paid.push(step);
      earned = s.world.ledger.datacenterIncome;
    }
    const job = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13]; // DA's first beat is step 3: the job is the next 10 steps, 0.5 s
    expect(charged).toEqual(job);
    expect(paid).toEqual(job);
  });
```

Replace the test "leaves a real gap where a beat skips process(): nothing in it is charged or paid, and the next job starts after its call" with:

```ts
  it('leaves a real gap where a beat skips process(): nothing in it is charged or paid, and the next job starts after its call', () => {
    const host = new FakeHost();
    let beats = 0;
    // calls process() on beats 1 and 5 (steps 3 and 19), skipping the three beats between them and every beat after the fifth
    const patchy = host.program('patchy', () => ({ actions: ++beats === 1 || beats === 5 ? [{ kind: 'process' }] : [] }));
    const s = holding(host);
    s.deploy('DA', patchy);
    const { charged, paid } = chargedAndPaid(s, 32);
    // the first job is 4 to 13, and the beats at 7, 11, and 15 call nothing, so 14 to 19 are idle; the call at 19 runs 20 to 29
    const expected = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29];
    expect(charged).toEqual(expected);
    expect(paid).toEqual(expected);
  });
```

In `packages/core/test/session.test.ts`:

Replace the test "applies the action setters within the scenario limits" with:

```ts
  it('applies the action setters within the scenario limits', () => {
    const host = new FakeHost();
    const plant = host.program('plant', () => ({
      actions: [
        { kind: 'setThermal', output: 999 },
        { kind: 'setPriority', order: ['DB', 'DA'] },
      ],
    }));
    const dc = host.program('dc', () => ({ actions: [{ kind: 'cool' }, { kind: 'process' }, { kind: 'process' }] }));
    const s = new Session(m1Scenario(), SEED, host);
    s.deploy('P', plant);
    s.deploy('DA', dc);
    run(s, 4); // P beats at 0, DA at 3
    expect(s.world.plant.thermalSetting).toBe(300);
    expect(s.world.plant.priority).toEqual(['DB', 'DA']);
    // From the step after DA's beat at 3: a job of 0.5 s (steps 4 to 13; the second call changes nothing) and a cycle of 4 s.
    expect(s.world.datacenters.DA).toMatchObject({ busyFrom: 4, busyUntil: 14, coolFrom: 4, coolUntil: 84 });
  });
```

In `packages/firmware/test/host.test.ts`:

Replace the test "turns the queue into actions, with facility ids" with:

```ts
  it('turns the queue into actions, with facility ids', () => {
    expect(decodeActions([1, 2, 3, 3, 250, 4, 2, 3, 2, 5, 20], ['P', 'DA', 'DB'])).toEqual([
      { kind: 'process' },
      { kind: 'cool' }, // a cycle has no level: the 3 that io.cool(3) pushed is read and dropped
      { kind: 'setThermal', output: 250 },
      { kind: 'setPriority', order: ['DB', 'DA'] },
      { kind: 'sleep', seconds: 20 },
    ]);
  });
```

Replace the test "runs deployed Lua, applies its actions, and reboots it after a sleep with empty mem" with:

```ts
  it('runs deployed Lua, applies its actions, and reboots it after a sleep with empty mem', async () => {
    const session = new Session(parseScenario(m1), 7, await WasmoonHost.create());
    session.world.plant.thermalSetting = 1_000; // plenty of power: DA's job and its cooling are never shed
    session.deploy(
      'DA',
      `
      function tick(io, mem)
        mem.n = (mem.n or 0) + 1
        io.log("tick", mem.n)
        if mem.n == 2 then io.sleep(1) return end
        io.process()
        io.cool(1)
      end`,
    );
    for (let i = 0; i < 4; i++) session.step(); // DA's first beat is step 3
    const dc = session.world.datacenters.DA!;
    expect(dc).toMatchObject({ busyFrom: 4, busyUntil: 14, coolFrom: 4, coolUntil: 84 }); // a job of 0.5 s and a cycle of 4 s
    for (let i = 0; i < 4; i++) session.step(); // second beat at 7: sleep 1 s
    const da = session.world.boards[1]!;
    expect(da.status).toBe('asleep');
    for (let i = 0; i < 20; i++) session.step(); // wakes at 27; beat at 27 reboots
    const logs = da.log.filter((l) => l.kind === 'log').map((l) => l.text);
    expect(logs).toEqual(['tick\t1', 'tick\t2', 'tick\t1']);
    session.close();
  });
```

Three FakeHost programs compare a reading with a number, which a `SensorValue` doesn't allow. Read them as numbers:
- in `packages/core/test/emf.test.ts`, "feeds the emf sensor from the board's cell": `seen = sensors.emf as number | undefined;`;
- in the same file, "shows the firmware the cell as it stood when its tick began, in EMF units": `seen.push(sensors.emf as number | undefined);`;
- in `packages/core/test/luddites.test.ts`, "lets a board that sleeps escape": `const d = sensors.luddite_dist as number | undefined;`.

- [ ] **Step 9: Run the tests to verify they pass, then the whole check**

Run: `pnpm vitest run packages/core/test/hand.test.ts`
Expected: PASS, 11 tests.

Run: `pnpm fix && pnpm check`
Expected: every package typechecks, Biome is clean, and every test passes (605).

Run: `pnpm sim --firmware scenarios/firmware/m1/careful --seed 1 --rebuild`
Expected: `"ended": { "kind": "completed", ... }`.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src packages/core/test packages/firmware/src packages/firmware/test/host.test.ts
git commit -m "Work every facility by hand or by firmware through one path: hand actions apply at once, and the last writer wins"
```

---

### Task 5: Datacenters by hand and by firmware: jobs, cooling cycles, heat

> **Corrections from assembling the plan (read first).**
> - **Tasks 2 and 4 already built part of this.**
>   - Task 2 created the busy and cool windows, `coolSteps`, `isCooling`, and interim demand terms inline in `facilityDemand`.
>   - Task 4 added `jobSteps`, and `applyFacilityAction`'s `process` and `cool` from `startStep`.
>   - This task's `datacenter.ts` replaces the module whole. Keep those names and Task 4's `applyFacilityAction` as they are; don't define a second copy.
>   - Remove all four milestone-1 cooling keys (`passiveCoolingPctPerSecond`, `coolingMilliPerLevelPerSecond`, `coolingPowerPerLevel`, `maxCoolingLevel`) from the schema and from both scenarios.
> - **Hand actions apply at once (decision D1, Task 4).** There is no queue: `Session.hand` applies the action with `startStep = world.step`, so the hand-action tests below change their steps.
>   - A press at world step 0 runs steps 0 to 9 (`busyFrom` 0, `busyUntil` 10). A second press at step 5 ends the job at 15.
>   - A cool press at step 0 covers steps 0 to 79. A press at step 10 changes nothing. A press at step 80 starts a new cycle, 80 to 159.
>   - Firmware's actions keep `startStep = s + 1`.
> - **The milestone-1 season checks.** `m1-power.json` keeps passive cooling at 20 per mille per second (Task 1), so they should not move. If they do, retune only the careful m1 firmware, as Task 2 did, and say so in the report.


10-10 spec §4.3 and §12 set the datacenter's two methods:
- **Processing.** A press of [처리] or one `process()` call runs it for `jobMs` (half a second) from the next step. Presses don't stack.
- **Cooling.** A press of [냉각] or one `cool()` call starts a cycle of `coolingCycleMs`. The cycle takes `coolingDropMilli` off in even parts and draws `coolingPower` on every step it runs.

Some rules hold whoever presses or calls:
- The work belongs to the facility. It needs no board, and a sleeping board does not stop it.
- Power, pay, heat, and the cycle's drop follow the time the datacenter runs.
- Left alone, it cools very slowly: `passiveCoolingPermillePerSecond`, 0.3% of the excess a second.
- A wrecked or repairing datacenter does nothing and requests nothing.
- A fire wrecks it (10-10 §6).

Processing EMF comes with the EMF phase in Task 6. This task gives the windows that Task 4's actions write their physics, and moves the datacenter's draw into one function, which `facilityDemand` calls.

**Starting point.** This task assumes Tasks 1 to 4 have done the following:
- **Task 1:** the scenario's `tuning.datacenter` has the milestone-2 keys (contract §1).
- **Task 2:**
  - `world.facilities` and `findFacility` exist;
  - each datacenter has the `DatacenterState` of contract §2, with its busy and cool windows;
  - `facilityDemand(ctx, facility, step)` follows contract §7.
- **Task 3:** `wreckFacility` exists in `boards.ts`.
- **Task 4:** `applyFacilityAction` writes the windows exactly as contract §4 says, and `Session.hand` queues a hand action for the next step's phase 5.

Whatever `datacenter.ts` still holds of milestone 1, this task replaces the whole file.

**Files:**
- Rewrite: `packages/core/src/datacenter.ts`
- Modify: `packages/core/src/power.ts` (`facilityDemand`)
- Rewrite: `packages/core/test/datacenter.test.ts`
- Modify: `packages/core/test/power.test.ts` (one test moves here)

**Interfaces:**
- Consumes:
  - **Task 1:** `tuning.datacenter`: `processPower`, `ambientMilli`, `heatMilliPerSecond`, `passiveCoolingPermillePerSecond`, `jobMs`, `coolingCycleMs`, `coolingDropMilli`, `coolingPower`, `overheatAlertMilli`, `fireThresholdMilli`, `firePermillePerDegreePerSecond`. Also `m1Scenario` and `m2Scenario`.
  - **Task 2:** `FacilityState`, `findFacility`, `world.facilities`, `world.datacenters` (`busyFrom`, `busyUntil`, `coolFrom`, `coolUntil`, `tempMilli`), `facilityDemand`, and `plantFacility`.
  - **Task 3:** `wreckFacility(ctx, facility, step, 'fire')`.
  - **Task 4:** `Session.hand(facilityId, action)` and the `process` and `cool` facility actions.
- Produces:
  - `jobSteps(ctx): number`: the steps one job runs (`jobMs * stepsPerSecond / 1000`).
  - `coolSteps(ctx): number`: the steps one cooling cycle lasts.
  - `isProcessing(ctx, facilityId, step): boolean`: the facility stands (`ok`), the grid supplies it, and its busy window covers the step. Task 6 counts processing EMF with it; Task 10 shows it.
  - `isCooling(ctx, facilityId, step): boolean`: the same for its cool window.
  - `datacenterDraw(ctx, facility, step): number`: what the datacenter's own work requests before transmission loss. That is `processPower` on a step its busy window covers, plus `coolingPower` on a step its cool window covers. It is 0 for a wrecked or repairing datacenter, and for any other kind.
  - `coolingDrop(ctx, dc, step): number`: the milli-degrees the cycle takes off at this step. They are `coolingDropMilli` split evenly over the cycle's steps, with the remainders spread so that the cycle takes exactly `coolingDropMilli`.
  - `runDatacenters(ctx, step)` (phase 6) and `runFires(ctx, step)` (phase 9), now over facilities.

- [ ] **Step 1: Write the failing tests**

Replace `packages/core/test/datacenter.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import {
  coolSteps,
  datacenterDraw,
  isCooling,
  isProcessing,
  jobSteps,
  runDatacenters,
  runFires,
} from '../src/datacenter.ts';
import { MICRO } from '../src/fixed.ts';
import { facilityDemand } from '../src/power.ts';
import type { Rng } from '../src/rng.ts';
import { Session } from '../src/session.ts';
import { type FacilityState, findFacility } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario, m2Scenario } from './helpers/scenarios.ts';

/**
 * Plenty of steady, free power and a steady job price: nothing is shed, fuel does not drain the money, and pay is exact.
 * The thermal module goes far above its usual maximum so that every job and every cooling cycle can run at once.
 */
function powered(seed = 1, host = new FakeHost(), change?: Parameters<typeof m1Scenario>[0]): Session {
  const s = new Session(
    m1Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.thermal.max = 2_000;
      j.tuning.fuelPrice = { start: 0, min: 0, max: 0 };
      j.tuning.jobPrice.maxChangePerSecond = 0;
      j.tuning.emf.rumourThreshold = 1_000_000_000; // no raids
      change?.(j);
    }),
    seed,
    host,
  );
  s.world.plant.thermalSetting = 2_000;
  return s;
}

/** Like powered(), but heat does not leak away: a temperature changes only by work and by cooling cycles. */
function holding(host = new FakeHost()): Session {
  return powered(1, host, (j) => {
    j.tuning.datacenter.passiveCoolingPermillePerSecond = 0;
  });
}

/** The milestone-2 town, which starts with no board at all, on the same steady, free power. */
function town(): Session {
  const s = new Session(
    m2Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.thermal.max = 2_000;
      j.tuning.fuelPrice = { start: 0, min: 0, max: 0 };
      j.tuning.jobPrice.maxChangePerSecond = 0;
      j.tuning.emf.rumourThreshold = 1_000_000_000;
    }),
    1,
    new FakeHost(),
  );
  s.world.plant.thermalSetting = 2_000;
  return s;
}

const fac = (s: Session, id: string): FacilityState => findFacility(s.world, id)!;

function steps(s: Session, n: number): void {
  for (let i = 0; i < n; i++) s.step();
}

/** Swaps the session's fire stream for one that records the chance of every roll and never hits. */
function recordFireRolls(s: Session): number[] {
  const rolls: number[] = [];
  const recorder: Rng = {
    nextU32: () => 0,
    int: (lo) => lo,
    chancePpm: (ppm) => {
      rolls.push(ppm);
      return false;
    },
  };
  Object.assign(s.ctx.rng, { fire: recorder });
  return rolls;
}

/** Runs the session to `lastStep`; lists the steps on which the power phase charged DA's job and the steps on which it was paid. */
function chargedAndPaid(s: Session, lastStep: number): { charged: number[]; paid: number[] } {
  s.step(); // step 0: no job yet, so the demand it reports is the idle demand
  const idle = s.world.plant.demand;
  let earned = s.world.ledger.datacenterIncome;
  const charged: number[] = [];
  const paid: number[] = [];
  for (let step = 1; step <= lastStep; step++) {
    s.step();
    if (s.world.plant.demand > idle) charged.push(step);
    if (s.world.ledger.datacenterIncome > earned) paid.push(step);
    earned = s.world.ledger.datacenterIncome;
  }
  return { charged, paid };
}

describe('datacenters', () => {
  it('runs half a second of work from the step after a press, and pays the job price for that time', () => {
    const s = powered();
    expect(jobSteps(s.ctx)).toBe(10); // 500 ms at 20 steps a second
    expect(s.hand('DA', { kind: 'process' })).toEqual({ ok: true });
    const paid: number[] = [];
    let earned = 0;
    for (let step = 0; step < 15; step++) {
      s.step();
      if (s.world.ledger.datacenterIncome > earned) paid.push(step);
      earned = s.world.ledger.datacenterIncome;
    }
    expect(paid).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); // the press applies in step 0, so the job is steps 1 to 10
    expect(s.world.ledger.datacenterIncome).toBe(20 * MICRO); // 40 a second for half a second
  });

  it('does not stack presses: a press while it runs starts its half second over from that step', () => {
    const s = powered();
    const dc = s.world.datacenters.DA!;
    s.hand('DA', { kind: 'process' }); // applies in step 0: steps 1 to 10
    steps(s, 5);
    s.hand('DA', { kind: 'process' }); // applies in step 5, mid-job: now until step 15, not step 20
    steps(s, 20);
    expect([dc.busyFrom, dc.busyUntil]).toEqual([1, 16]);
    expect(s.world.ledger.datacenterIncome).toBe(15 * 2 * MICRO); // steps 1 to 15, at 2 a step
  });

  it('charges and pays one process() call for half a second, longer than the tick period', () => {
    const host = new FakeHost();
    let calls = 0;
    const once = host.program('once', () => ({ actions: calls++ === 0 ? [{ kind: 'process' }] : [] }));
    const s = holding(host);
    s.deploy('DA', once);
    const { charged, paid } = chargedAndPaid(s, 20);
    const job = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13]; // DA's first beat is step 3: the call applies there, and the job runs 4 to 13
    expect(charged).toEqual(job);
    expect(paid).toEqual(job);
  });

  it('runs without a gap while firmware calls process() on every beat', () => {
    const host = new FakeHost();
    const work = host.program('work', () => ({ actions: [{ kind: 'process' }] }));
    const s = holding(host);
    s.deploy('DA', work);
    const { charged, paid } = chargedAndPaid(s, 40);
    const working = Array.from({ length: 37 }, (_, i) => i + 4); // from step 4 on: each beat, 4 steps apart, moves the end on
    expect(charged).toEqual(working);
    expect(paid).toEqual(working);
  });

  it('earns the job price and gains the tuned heat for every second of work', () => {
    const host = new FakeHost();
    const work = host.program('work', () => ({ actions: [{ kind: 'process' }] }));
    const s = holding(host);
    const dc = s.world.datacenters.DA!;
    const { ambientMilli, heatMilliPerSecond } = s.scenario.tuning.datacenter;
    s.deploy('DA', work);
    steps(s, 4); // the job starts at step 4
    for (const seconds of [1, 2, 3]) {
      steps(s, s.scenario.time.stepsPerSecond);
      expect(s.world.ledger.datacenterIncome, `income after ${seconds} s`).toBe(seconds * s.world.jobPrice * MICRO);
      expect(dc.tempMilli, `temperature after ${seconds} s`).toBe(ambientMilli + seconds * heatMilliPerSecond);
    }
  });

  it("takes a cooling cycle's drop off in even parts over its steps, exactly", () => {
    const s = holding();
    const dc = s.world.datacenters.DA!;
    expect(coolSteps(s.ctx)).toBe(80); // 4,000 ms at 20 steps a second
    dc.tempMilli = 80_000;
    expect(s.hand('DA', { kind: 'cool' })).toEqual({ ok: true });
    const temps: number[] = [];
    for (let step = 0; step <= 81; step++) {
      s.step();
      temps.push(dc.tempMilli);
    }
    expect(temps[0]).toBe(80_000); // the press applies in step 0: the cycle is steps 1 to 80
    const drops = Array.from({ length: 80 }, (_, i) => temps[i]! - temps[i + 1]!);
    expect(new Set(drops)).toEqual(new Set([187, 188])); // 15,000 over 80 steps is 187.5 a step
    expect(temps[80]).toBe(65_000); // all of coolingDropMilli, to the milli-degree
    expect(temps[81]).toBe(65_000); // and nothing after it
  });

  it('ignores a press during a cooling cycle and starts a new cycle after it', () => {
    const s = holding();
    const dc = s.world.datacenters.DA!;
    s.hand('DA', { kind: 'cool' }); // applies in step 0: steps 1 to 80
    steps(s, 10);
    s.hand('DA', { kind: 'cool' }); // applies in step 10, inside the cycle: nothing changes
    steps(s, 1);
    expect([dc.coolFrom, dc.coolUntil]).toEqual([1, 81]);
    steps(s, 70); // through step 80, the cycle's last
    s.hand('DA', { kind: 'cool' }); // applies in step 81: a new cycle, steps 82 to 161
    steps(s, 1);
    expect([dc.coolFrom, dc.coolUntil]).toEqual([82, 162]);
  });

  it('runs work and a cooling cycle at the same time', () => {
    const s = holding();
    const dc = s.world.datacenters.DA!;
    dc.tempMilli = 80_000;
    s.hand('DA', { kind: 'process' });
    s.hand('DA', { kind: 'cool' });
    steps(s, 11); // both apply in step 0; steps 1 to 10 work and cool
    // +100 a step of work, and the cycle's first ten parts: 15,000 x 10 / 80 = 1,875
    expect(dc.tempMilli).toBe(80_000 + 1_000 - 1_875);
    expect(s.world.ledger.datacenterIncome).toBe(20 * MICRO);
  });

  it('draws processing power on the steps of its job and cooling power on the steps of its cycle', () => {
    const s = powered();
    const da = fac(s, 'DA');
    const dc = s.world.datacenters.DA!;
    const { processPower, coolingPower } = s.scenario.tuning.datacenter;
    dc.busyFrom = 5;
    dc.busyUntil = 8; // steps 5, 6 and 7
    dc.coolFrom = 7;
    dc.coolUntil = 10; // steps 7, 8 and 9
    expect([4, 5, 6, 7, 8, 9, 10].map((step) => datacenterDraw(s.ctx, da, step))).toEqual([
      0,
      processPower,
      processPower,
      processPower + coolingPower,
      coolingPower,
      coolingPower,
      0,
    ]);
    // With its board's own 10, and 2% for the one cell between it and the plant: 10 + 150 + 400 = 560, + 11
    expect(facilityDemand(s.ctx, da, 7)).toBe(571);
  });

  it('counts a step as processing exactly when the power phase charges the job for it', () => {
    const s = powered();
    const da = fac(s, 'DA');
    const dc = s.world.datacenters.DA!;
    for (const [from, until] of [
      [5, 9],
      [5, 6],
      [-1, -1],
    ] as const) {
      for (let step = 3; step <= 10; step++) {
        da.powered = true;
        dc.busyFrom = from;
        dc.busyUntil = until;
        const where = `job ${from} to ${until - 1}, step ${step}`;
        expect(isProcessing(s.ctx, 'DA', step), where).toBe(datacenterDraw(s.ctx, da, step) > 0);
        da.powered = false; // shed: the job drew its power, but no work was done
        expect(isProcessing(s.ctx, 'DA', step), `${where}, shed`).toBe(false);
      }
    }
    expect(isProcessing(s.ctx, 'P', 0)).toBe(false); // the plant has no datacenter
    expect(isProcessing(s.ctx, 'ZZ', 0)).toBe(false);
  });

  it('works by hand with no board at all', () => {
    const s = town();
    expect(s.world.boards).toEqual([]); // the milestone-2 town starts with no board
    s.hand('DA', { kind: 'process' });
    steps(s, 12);
    expect(s.world.ledger.datacenterIncome).toBe(20 * MICRO);
    expect(s.world.datacenters.DA!.tempMilli).toBeGreaterThan(25_000);
  });

  it('goes on with a job started by hand while its board sleeps', () => {
    const s = powered();
    s.world.boards[1]!.status = 'asleep'; // DA's board; with no wake-up time set, it stays asleep
    s.hand('DA', { kind: 'process' });
    steps(s, 12);
    expect(s.world.ledger.datacenterIncome).toBe(20 * MICRO);
  });

  it('does not work, earn, heat, or cool while shed: only the passive leak goes on', () => {
    const tempAfter = (busy: boolean): number => {
      const s = powered();
      s.world.plant.thermalSetting = 0;
      s.world.plant.wind = 0; // the wind won't move: maxChangePerSecond is 0
      const dc = s.world.datacenters.DA!;
      dc.tempMilli = 60_000;
      if (busy) {
        dc.busyFrom = 0;
        dc.busyUntil = 100;
        dc.coolFrom = 0;
        dc.coolUntil = 100;
      }
      steps(s, 50);
      expect(s.world.ledger.datacenterIncome).toBe(0);
      return dc.tempMilli;
    };
    expect(tempAfter(true)).toBe(tempAfter(false));
    expect(tempAfter(false)).toBe(59_750); // 50 steps of the passive leak alone, 5 milli-degrees each
  });

  it('does nothing and requests nothing while wrecked or being repaired', () => {
    for (const condition of ['wrecked', 'repairing'] as const) {
      const s = powered();
      const da = fac(s, 'DA');
      const dc = s.world.datacenters.DA!;
      dc.busyFrom = 0;
      dc.busyUntil = 100;
      dc.coolFrom = 0;
      dc.coolUntil = 100;
      dc.tempMilli = 60_000;
      da.condition = condition;
      expect(datacenterDraw(s.ctx, da, 5), condition).toBe(0);
      expect(isProcessing(s.ctx, 'DA', 5), condition).toBe(false);
      expect(isCooling(s.ctx, 'DA', 5), condition).toBe(false);
      runDatacenters(s.ctx, 5);
      expect(s.world.ledger.datacenterIncome, condition).toBe(0);
      expect(dc.tempMilli, condition).toBe(60_000);
    }
  });

  it('lets heat leak away by the tuned permille of its excess each second, split over the steps and rounded down', () => {
    const s = powered();
    const dc = s.world.datacenters.DA!;
    dc.tempMilli = 80_030; // 55,030 over ambient: 3 permille a second over 20 steps is 8.25, taken as 8
    runDatacenters(s.ctx, 0);
    expect(dc.tempMilli).toBe(80_022);
  });

  it('cools very slowly when left alone: ten degrees off 85 °C take more than a minute', () => {
    const s = powered();
    const dc = s.world.datacenters.DA!;
    dc.tempMilli = 85_000;
    let step = 0;
    while (dc.tempMilli > 75_000) runDatacenters(s.ctx, step++);
    expect(step).toBeGreaterThan(60 * s.scenario.time.stepsPerSecond); // 1,310 steps, 65.5 s, at 0.3% a second
  });

  it('pays every working datacenter into the town money and the ledger alike', () => {
    const s = powered();
    for (const id of ['DA', 'DB']) {
      s.world.datacenters[id]!.busyFrom = 0;
      s.world.datacenters[id]!.busyUntil = 4;
    }
    const before = s.world.money;
    runDatacenters(s.ctx, 0); // each pays 40 a second for a twentieth of a second
    expect(s.world.money - before).toBe(4 * MICRO);
    expect(s.world.ledger.datacenterIncome).toBe(4 * MICRO);
  });

  it('raises the overheat alert at exactly 85 °C and not a milli-degree below', () => {
    const s = holding();
    const dc = s.world.datacenters.DA!;
    const alerts = () => s.world.alerts.filter((a) => a.kind === 'overheat');
    dc.tempMilli = 84_999;
    runDatacenters(s.ctx, 0);
    expect(alerts()).toHaveLength(0);
    dc.tempMilli = 85_000;
    runDatacenters(s.ctx, 1);
    expect(alerts()).toHaveLength(1);
  });

  it('ends an overheat episode only below 80 °C, not at 80 °C and not between 80 and 85', () => {
    const s = holding();
    const dc = s.world.datacenters.DA!;
    const alerts = () => s.world.alerts.filter((a) => a.kind === 'overheat');
    const phase = (tempMilli: number, step: number): void => {
      dc.tempMilli = tempMilli;
      runDatacenters(s.ctx, step);
    };
    phase(86_000, 0);
    phase(80_000, 1);
    phase(86_000, 2);
    expect(alerts()).toHaveLength(1); // 80 °C is not below 80 °C: the episode goes on
    phase(84_000, 3);
    phase(86_000, 4);
    expect(alerts()).toHaveLength(1); // nor is anything between 80 and 85
    phase(79_999, 5);
    phase(86_000, 6);
    expect(alerts()).toHaveLength(2); // a milli-degree below 80 °C ends it
  });

  it('gives each datacenter its own overheat alert, naming it and the step', () => {
    const s = holding();
    s.world.datacenters.DA!.tempMilli = 86_000;
    s.world.datacenters.DB!.tempMilli = 87_000;
    runDatacenters(s.ctx, 7);
    expect(s.world.alerts.map((a) => [a.kind, a.facilityId, a.step])).toEqual([
      ['overheat', 'DA', 7],
      ['overheat', 'DB', 7],
    ]);
  });

  it('rolls a fire chance that grows with the degrees over 90 °C, and none at or below it', () => {
    const s = holding();
    const rolls = recordFireRolls(s);
    for (const tempMilli of [89_999, 90_000, 91_000, 100_000, 140_000]) {
      s.world.datacenters.DA!.tempMilli = tempMilli;
      runFires(s.ctx, 0);
    }
    // (milli-degrees over 90 °C) x 5 permille a degree each second, over 20 steps: 1 °C -> 250 ppm, 10 °C -> 2,500, 50 °C -> 12,500
    expect(rolls).toEqual([250, 2_500, 12_500]);
  });

  it('rolls for fire on the temperature the step ends with, so the datacenter phase comes first', () => {
    const s = holding();
    const rolls = recordFireRolls(s);
    const dc = s.world.datacenters.DA!;
    dc.busyFrom = 0;
    dc.busyUntil = 1; // step 0's work
    dc.tempMilli = 89_950; // the work's heat for one step is 100 milli-degrees: 90,050 by the fire phase
    s.step();
    expect(rolls).toEqual([12]); // 50 milli-degrees x 5 permille a degree each second / 20 steps = 12.5, rounded down
  });

  it('rolls for a hot datacenter asleep, shed, or with no board, but not for one wrecked or being repaired', () => {
    const rollsOf = (s: Session, prepare: () => void): number[] => {
      const rolls = recordFireRolls(s);
      prepare();
      s.world.datacenters.DA!.tempMilli = 140_000;
      runFires(s.ctx, 0);
      return rolls;
    };
    const wrecked = holding();
    expect(
      rollsOf(wrecked, () => {
        fac(wrecked, 'DA').condition = 'wrecked';
      }),
      'wrecked',
    ).toEqual([]);
    const repairing = holding();
    expect(
      rollsOf(repairing, () => {
        fac(repairing, 'DA').condition = 'repairing';
      }),
      'repairing',
    ).toEqual([]);
    const asleep = holding();
    expect(
      rollsOf(asleep, () => {
        asleep.world.boards[1]!.status = 'asleep';
      }),
      'asleep',
    ).toEqual([12_500]);
    const shed = holding();
    expect(
      rollsOf(shed, () => {
        fac(shed, 'DA').powered = false;
      }),
      'shed',
    ).toEqual([12_500]);
    expect(
      rollsOf(town(), () => {}),
      'no board',
    ).toEqual([12_500]);
  });

  it('wrecks a datacenter that burns, and its board with it, once', () => {
    const s = powered(5);
    const dc = s.world.datacenters.DA!;
    for (let i = 0; i < 1000; i++) {
      dc.tempMilli = 140_000;
      s.step();
    }
    expect(fac(s, 'DA').condition).toBe('wrecked');
    expect(s.world.boards.map((b) => b.status)).toEqual(['running', 'destroyed', 'running']);
    expect(s.world.stats.wrecks).toBe(1);
    const burned = s.world.alerts.filter((a) => a.kind === 'fire' || a.kind === 'wrecked');
    expect(burned.map((a) => [a.kind, a.facilityId])).toEqual([
      ['fire', 'DA'],
      ['wrecked', 'DA'],
    ]);
  });

  it('burns the same way for the same seed', () => {
    const burnStep = (seed: number): number | null => {
      const s = powered(seed);
      const dc = s.world.datacenters.DA!;
      for (let i = 0; i < 2000; i++) {
        dc.tempMilli = 140_000; // about 12,500 ppm a step
        s.step();
        if (fac(s, 'DA').condition === 'wrecked') return i;
      }
      return null;
    };
    const first = burnStep(5);
    expect(first).not.toBeNull();
    expect(burnStep(5)).toBe(first);
  });

  it('never catches fire at or below 90 °C', () => {
    const s = powered();
    for (let i = 0; i < 5000; i++) {
      s.world.datacenters.DA!.tempMilli = 90_000;
      s.step();
    }
    expect(fac(s, 'DA').condition).toBe('ok');
    expect(s.world.ended, 'the season is still running at the last step').toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/test/datacenter.test.ts`
Expected: FAIL. The file does not load: `datacenter.ts` has no export named `jobSteps` (nor `coolSteps`, `isCooling`, or `datacenterDraw`).

- [ ] **Step 3: Write the datacenter module**

Replace `packages/core/src/datacenter.ts` with:

```ts
import { clearFlag, raiseAlert, raiseOnce } from './alerts.ts';
import { wreckFacility } from './boards.ts';
import { idiv, MICRO, MILLI, mulDiv } from './fixed.ts';
import { type DatacenterState, type FacilityState, findFacility, type SimContext } from './world.ts';

/** Steps one job runs: a press of [처리] or one process() call. The scenario makes it a whole number (Task 1's validation). */
export function jobSteps(ctx: SimContext): number {
  return idiv(ctx.scenario.tuning.datacenter.jobMs * ctx.scenario.time.stepsPerSecond, 1000);
}

/** Steps one cooling cycle lasts: a press of [냉각] or one cool() call. */
export function coolSteps(ctx: SimContext): number {
  return idiv(ctx.scenario.tuning.datacenter.coolingCycleMs * ctx.scenario.time.stepsPerSecond, 1000);
}

function covers(from: number, until: number, step: number): boolean {
  return from <= step && step < until;
}

/**
 * Whether a datacenter works at this step: its job covers the step, it stands, and the grid supplies it. Its board does not matter:
 * the work is the facility's, whoever started it, and a sleeping or missing board does not stop it.
 */
export function isProcessing(ctx: SimContext, facilityId: string, step: number): boolean {
  const f = findFacility(ctx.world, facilityId);
  const dc = ctx.world.datacenters[facilityId];
  return !!f && !!dc && f.condition === 'ok' && f.powered && covers(dc.busyFrom, dc.busyUntil, step);
}

/** Whether a datacenter's cooling cycle runs at this step: the cycle covers the step, it stands, and the grid supplies it. */
export function isCooling(ctx: SimContext, facilityId: string, step: number): boolean {
  const f = findFacility(ctx.world, facilityId);
  const dc = ctx.world.datacenters[facilityId];
  return !!f && !!dc && f.condition === 'ok' && f.powered && covers(dc.coolFrom, dc.coolUntil, step);
}

/**
 * What a datacenter's own work requests this step, before transmission loss. That is processPower on a step its job covers, and
 * coolingPower on a step its cooling cycle covers, whoever started them. Power is requested whether or not it comes: the power
 * phase decides that. A wrecked or repairing datacenter requests nothing, and so does any other kind of facility.
 */
export function datacenterDraw(ctx: SimContext, facility: FacilityState, step: number): number {
  const dc = ctx.world.datacenters[facility.id];
  if (!dc || facility.condition !== 'ok') return 0;
  const t = ctx.scenario.tuning.datacenter;
  return (covers(dc.busyFrom, dc.busyUntil, step) ? t.processPower : 0) + (covers(dc.coolFrom, dc.coolUntil, step) ? t.coolingPower : 0);
}

/**
 * The milli-degrees a cooling cycle takes off at this step. coolingDropMilli is split over the cycle's steps, and the remainders are
 * spread so that the whole cycle takes off exactly coolingDropMilli: 15,000 over 80 steps is 187 and 188 by turns.
 */
export function coolingDrop(ctx: SimContext, dc: DatacenterState, step: number): number {
  const total = ctx.scenario.tuning.datacenter.coolingDropMilli;
  const n = dc.coolUntil - dc.coolFrom;
  const k = step - dc.coolFrom;
  if (n <= 0 || k < 0 || k >= n) return 0;
  return idiv(total * (k + 1), n) - idiv(total * k, n);
}

/** Phase 6: income and heat from work, the passive leak, and cooling cycles, for every datacenter that stands. */
export function runDatacenters(ctx: SimContext, step: number): void {
  const t = ctx.scenario.tuning.datacenter;
  const sps = ctx.scenario.time.stepsPerSecond;
  const w = ctx.world;
  for (const f of w.facilities) {
    const dc = w.datacenters[f.id];
    if (!dc || f.condition !== 'ok') continue;
    let temp = dc.tempMilli;
    if (isProcessing(ctx, f.id, step)) {
      const income = mulDiv(w.jobPrice, MICRO, sps);
      w.money += income;
      w.ledger.datacenterIncome += income;
      temp += idiv(t.heatMilliPerSecond, sps);
    }
    const excess = temp - t.ambientMilli;
    if (excess > 0) temp -= idiv(excess * t.passiveCoolingPermillePerSecond, 1000 * sps);
    if (isCooling(ctx, f.id, step)) temp -= coolingDrop(ctx, dc, step);
    dc.tempMilli = Math.max(temp, t.ambientMilli);
    if (dc.tempMilli >= t.overheatAlertMilli) {
      raiseOnce(w, `overheat:${f.id}`, step, 'overheat', f.id, `${f.id} 과열 ${idiv(dc.tempMilli, MILLI)}°C`);
    } else if (dc.tempMilli < t.overheatAlertMilli - 5 * MILLI) {
      clearFlag(w, `overheat:${f.id}`);
    }
  }
}

/**
 * Phase 9: a standing datacenter above the fire threshold rolls for fire every step, asleep, shed, or without a board alike.
 * A fire wrecks it, its board with it.
 */
export function runFires(ctx: SimContext, step: number): void {
  const t = ctx.scenario.tuning.datacenter;
  const sps = ctx.scenario.time.stepsPerSecond;
  for (const f of ctx.world.facilities) {
    const dc = ctx.world.datacenters[f.id];
    if (!dc || f.condition !== 'ok') continue;
    if (dc.tempMilli <= t.fireThresholdMilli) continue;
    const ppm = idiv((dc.tempMilli - t.fireThresholdMilli) * t.firePermillePerDegreePerSecond, sps);
    if (ctx.rng.fire.chancePpm(ppm)) {
      raiseAlert(ctx.world, step, 'fire', f.id, `${f.id}에 불이 났어요`);
      wreckFacility(ctx, f, step, 'fire');
    }
  }
}
```

`runDatacenters` and `runFires` keep their places in `Session.step()`: phase 6 and phase 9.

- [ ] **Step 4: Let the power phase ask the datacenter for its draw**

In `packages/core/src/power.ts`, import `datacenterDraw` from `./datacenter.ts`. In `facilityDemand`, the datacenter's two terms (`processPower` on a step its busy window covers, `coolingPower` on a step its cool window covers) become one call. After this step, `facilityDemand` reads:

```ts
/** What a facility requests this step, transmission loss included. A wrecked or repairing facility requests nothing. */
export function facilityDemand(ctx: SimContext, facility: FacilityState, step: number): number {
  if (facility.condition !== 'ok') return 0;
  const t = ctx.scenario.tuning;
  const board = findBoard(ctx.world, facility.id);
  let base = 0;
  if (board?.status === 'running') base += board.spec.power;
  else if (board?.status === 'asleep') base += t.sleepPower;
  base += datacenterDraw(ctx, facility, step);
  if (facility.kind === 'housing') base += t.housing.power;
  const plant = plantFacility(ctx.world);
  const distance = manhattan(facility.x, facility.y, plant.x, plant.y);
  return base + mulDiv(base, t.transmissionLossPctPerCell * distance, 100);
}
```

The housing line stays as Task 2 wrote it; Task 9 moves it into `housingDraw` the same way.

- [ ] **Step 5: Move the datacenter's draw test out of the power tests**

In `packages/core/test/power.test.ts`, delete the test "adds a running job and cooling to a datacenter's draw" (in the form Task 2 left it). `datacenter.test.ts`'s "draws processing power on the steps of its job and cooling power on the steps of its cycle" now covers the datacenter's draw, through `facilityDemand` too.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core`
Expected: PASS: datacenter, 26 tests, and every other core test.

- [ ] **Step 7: Check and commit**

```bash
pnpm fix
pnpm check
git add packages/core
git commit -m "Datacenters by hand and by firmware: half-second jobs, cooling cycles, a slow passive leak, fire wrecks"
```

`pnpm check` must pass: typecheck, lint, and every test.

---

### Task 6: EMF from boards and busy datacenters; Luddites hunt machines

> **Corrections from assembling the plan (read first).**
> - Task 3 already made Luddites and fire call `wreckFacility`. This task changes what they target (machines, over facilities) and the EMF sources; keep Task 3's `wreckFacility` as it is.


10-10 spec §5 and §6.

**Where EMF comes from:**
- A board that runs and has power gives off its base EMF, plus `commBaseEmfPerSecond` when it carries a comm module.
- A tick adds `a × instructions` and `b × actions`, where the actions are the firmware's machine labor (harvest, dispatch, `set_thermal`, `set_priority`, `cool`). `process()` is not counted, because a datacenter's running time is counted instead: `processingPerSecond` on every step it works, whether a hand or firmware started the job. `sleep()` is not labor.
- The player's hands give off nothing. A town with no boards and idle datacenters is silent.

**What Luddites do:**
- They hunt machines: a standing facility with a board that runs or sleeps, or a datacenter, which is a machine with or without a board, because it processes.
- They wreck the whole facility they reach (Task 3's `wreckFacility`).
- They warn machines as they approach.

**Starting point.** This task assumes:
- **Task 1:** the tuning has `emf.processingPerSecond` and `install.commBaseEmfPerSecond`.
- **Task 2:** facilities exist, and boards carry `comm`.
- **Task 3:** `wreckFacility` exists, and the `wrecked` alert has replaced `boardDestroyed`.
- **Task 4:** gives the new `Action` union and `Session.hand`.
- **Task 5:** gives `isProcessing`.

`emf.ts` and `luddites.ts` are replaced whole.

**Files:**
- Modify: `packages/core/src/firmware-host.ts` (`countsAsAction`)
- Rewrite: `packages/core/src/emf.ts`, `packages/core/src/luddites.ts`
- Modify: `packages/core/src/queries.ts` (the Luddite path in the snapshot looks its target up as a facility)
- Modify: `packages/core/test/emf.test.ts`, `packages/core/test/luddites.test.ts`

**Interfaces:**
- Consumes:
  - **Task 1:** `tuning.emf.processingPerSecond`, `tuning.install.commBaseEmfPerSecond`, and `m2Scenario`.
  - **Task 2:** `world.facilities`, `findFacility`, `findBoard`, and `BoardState.comm`.
  - **Task 3:** `wreckFacility(ctx, facility, step, 'luddites')` and the `wrecked` alert kind.
  - **Task 4:** `Action` (contract §3) and `Session.hand`.
  - **Task 5:** `isProcessing(ctx, facilityId, step)`.
- Produces:
  - `countsAsAction(kind: Action['kind']): boolean` in `firmware-host.ts`, as contract §3 places it. It is true for every action but `process` and `sleep`. If Task 4 already wrote it, keep Task 4's: it is the same function.
  - `tickEmission(ctx, outcome)`: counts only the actions that `countsAsAction` passes.
  - `baseEmission(ctx, board): number`: the milli-EMF per step of a running, powered board, with the comm module's share.
  - `processingEmission(ctx): number`: the milli-EMF per step of a working datacenter.
  - `runEmf(ctx, ticked)`: the same signature; it adds processing EMF too, at `world.step`.
  - `isMachine(world, facility): boolean`.
  - `strongestTarget(ctx): FacilityState | null`: it now returns a facility.
  - `runLuddites(ctx, step)`: it wrecks the facility a group reaches, and `LudditeGroup.targetId` names that facility.

- [ ] **Step 1: Write the failing EMF tests**

In `packages/core/test/emf.test.ts`:

Replace the imports with:

```ts
import { describe, expect, it } from 'vitest';
import { baseEmission, diffuse, fieldTotal, processingEmission, runEmf, tickEmission } from '../src/emf.ts';
import { type Action, countsAsAction, type TickError, type TickOutcome } from '../src/firmware-host.ts';
import type { Rng } from '../src/rng.ts';
import { Session } from '../src/session.ts';
import { isBeat } from '../src/time.ts';
import { cellIndex, findFacility } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario, m2Scenario } from './helpers/scenarios.ts';
```

Replace the `cellOf` helper with this one, which looks the facility up: a facility with no board has a cell too. Add the `town()` helper after it:

```ts
/** The milli-EMF in the cell under a facility; the field is row-major, y * width + x. */
function cellOf(s: Session, id: string): number {
  const f = findFacility(s.world, id)!;
  return s.world.emf[f.y * s.scenario.grid.width + f.x]!;
}

/** The milestone-2 town, which starts with no board, on steady free power; its field neither spreads nor fades, and no raid comes. */
function town(): Session {
  const s = new Session(
    m2Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.thermal.max = 2_000;
      j.tuning.fuelPrice = { start: 0, min: 0, max: 0 };
      j.tuning.emf.diffusionPctPerSecond = 0;
      j.tuning.emf.decayPctPerSecond = 0;
      j.tuning.emf.rumourThreshold = 1_000_000_000;
    }),
    1,
    new FakeHost(),
  );
  s.world.plant.thermalSetting = 2_000;
  return s;
}
```

Replace the test "turns instructions and actions into emission" with:

```ts
  it('turns instructions and machine labor into emission', () => {
    const s = powered();
    const outcome = outcomeOf(500, [{ kind: 'process' }, { kind: 'cool' }, { kind: 'sleep', seconds: 5 }]);
    expect(tickEmission(s.ctx, outcome)).toBe(5_000 + 10_000); // 5 EMF of instructions, 10 for cool(); process() and sleep() count none
  });
```

Replace the test "rounds the instruction part of a tick down to a whole milli-EMF" with:

```ts
  it('rounds the instruction part of a tick down to a whole milli-EMF', () => {
    const s = new Session(
      m1Scenario((j) => {
        j.tuning.emf.instructionsPerUnit = 7;
      }),
      1,
      new FakeHost(),
    );
    expect(tickEmission(s.ctx, outcomeOf(10))).toBe(1_428); // 10,000 / 7 = 1,428.6
    expect(tickEmission(s.ctx, outcomeOf(3))).toBe(428); // 3,000 / 7 = 428.6
    expect(tickEmission(s.ctx, outcomeOf(1, [{ kind: 'cool' }]))).toBe(142 + 10_000); // 142.9, and an action is a whole 10 EMF
  });
```

Replace the test "adds a tick's emission to the cell of its own board" with:

```ts
  it("adds a tick's emission to the cell of its own board", () => {
    const s = dry();
    const da = s.world.boards[1]!;
    const db = s.world.boards[2]!;
    runEmf(s.ctx, [
      { board: da, outcome: outcomeOf(1_800, [{ kind: 'process' }, { kind: 'cool' }]) },
      { board: db, outcome: outcomeOf(250) },
    ]);
    // base EMF for the step is 1,000, 1,250 and 1,250; DA's tick adds 18 + 10 EMF (for cool(), not process()), and DB's adds 2.5
    expect([cellOf(s, 'P'), cellOf(s, 'DA'), cellOf(s, 'DB')]).toEqual([1_000, 1_250 + 28_000, 1_250 + 2_500]);
    expect(s.world.emf.reduce((a, b) => a + b, 0)).toBe(1_000 + 29_250 + 3_750); // nothing in any other cell
  });
```

Replace the test "counts the tick of a board that goes to sleep, but not its base EMF, in that step" with:

```ts
  it('counts the tick of a board that goes to sleep, but neither its sleep() nor its base EMF, in that step', () => {
    const host = new FakeHost();
    const nap = host.program('nap', () => ({ instructions: 1_800, actions: [{ kind: 'sleep', seconds: 5 }] }));
    const s = dry(host);
    s.deploy('DA', nap);
    const da = s.world.boards[1]!;
    let before = 0;
    while (da.lastTick === null) {
      before = cellOf(s, 'DA');
      s.step();
    }
    expect(da.status).toBe('asleep');
    expect(cellOf(s, 'DA') - before).toBe(18_000); // 18 EMF of instructions; sleep() is no labor, and an asleep board has no base EMF
  });
```

Add these tests at the end of the `describe`:

```ts
  it('counts machine labor as actions, and neither process() nor sleep()', () => {
    const kinds: Array<Action['kind']> = ['harvest', 'dispatch', 'setThermal', 'setPriority', 'cool', 'process', 'sleep'];
    expect(kinds.map((kind) => countsAsAction(kind))).toEqual([true, true, true, true, true, false, false]);
  });

  it("adds a comm module's base EMF to its board's, every second it runs", () => {
    const s = dry();
    s.world.boards[1]!.comm = true;
    for (let i = 0; i < 20; i++) runEmf(s.ctx, []);
    expect([cellOf(s, 'P'), cellOf(s, 'DA'), cellOf(s, 'DB')]).toEqual([20_000, 30_000, 25_000]); // DA: 25, and the module's 5
    expect(baseEmission(s.ctx, s.world.boards[1]!)).toBe(1_500);
  });

  it('gives off processing EMF on every step a datacenter works, and none while it is shed or wrecked', () => {
    const working = dry();
    working.world.datacenters.DA!.busyFrom = 0;
    working.world.datacenters.DA!.busyUntil = 1_000; // these direct calls stay at the world's step 0, inside the job
    for (let i = 0; i < 20; i++) runEmf(working.ctx, []);
    expect(processingEmission(working.ctx)).toBe(2_500); // 50 a second at 20 steps a second
    expect(cellOf(working, 'DA')).toBe(25_000 + 50_000); // a second of base EMF and a second of processing

    const shed = dry();
    shed.world.datacenters.DA!.busyFrom = 0;
    shed.world.datacenters.DA!.busyUntil = 1_000;
    findFacility(shed.world, 'DA')!.powered = false;
    shed.world.boards[1]!.powered = false;
    runEmf(shed.ctx, []);
    expect(cellOf(shed, 'DA'), 'shed').toBe(0);

    const wrecked = dry();
    wrecked.world.datacenters.DA!.busyFrom = 0;
    wrecked.world.datacenters.DA!.busyUntil = 1_000;
    findFacility(wrecked.world, 'DA')!.condition = 'wrecked';
    wrecked.world.boards[1]!.status = 'destroyed';
    runEmf(wrecked.ctx, []);
    expect(cellOf(wrecked, 'DA'), 'wrecked').toBe(0);
  });

  it('makes noise at a datacenter worked by hand, with no board anywhere in town', () => {
    const s = town();
    expect(s.hand('DA', { kind: 'process' })).toEqual({ ok: true });
    s.step(); // the press applies in step 0: the job covers steps 1 to 10
    for (let i = 0; i < 10; i++) s.step();
    expect(cellOf(s, 'DA')).toBe(10 * 2_500); // half a second of processing EMF
    expect(s.world.emf.reduce((a, b) => a + b, 0)).toBe(25_000); // and nothing anywhere else
  });

  it('stays silent with no board in town and the datacenters idle', () => {
    const s = town();
    for (let i = 0; i < 400; i++) s.step();
    expect(fieldTotal(s.world)).toBe(0);
    expect(s.world.rumour).toBe(0);
  });
```

- [ ] **Step 2: Write the failing Luddite tests**

In `packages/core/test/luddites.test.ts`:

Replace the imports with:

```ts
import { describe, expect, it } from 'vitest';
import { stateHash } from '../src/hash.ts';
import { isMachine, pathTo, runLuddites, spawnRaid, strongestTarget } from '../src/luddites.ts';
import type { Rng } from '../src/rng.ts';
import { Session } from '../src/session.ts';
import { cellIndex, type FacilityState, findFacility, type LudditeGroup } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario, m2Scenario } from './helpers/scenarios.ts';
```

Replace `setEmf` and `setMilli` with these, which look the facility up: a target may have no board now. Add `fac` and `town` after them:

```ts
function setEmf(s: Session, id: string, units: number): void {
  const f = findFacility(s.world, id)!;
  s.world.emf[cellIndex(s.scenario, f.x, f.y)] = units * 1000;
}

/** Puts an exact amount of milli-EMF in the cell under a facility. */
function setMilli(s: Session, id: string, milli: number): void {
  const f = findFacility(s.world, id)!;
  s.world.emf[cellIndex(s.scenario, f.x, f.y)] = milli;
}

const fac = (s: Session, id: string): FacilityState => findFacility(s.world, id)!;

/** The milestone-2 town, which starts with no board; its field neither spreads nor fades, and no raid comes unless a test brings one. */
function town(change?: Parameters<typeof m2Scenario>[0]): Session {
  const s = new Session(
    m2Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.emf.diffusionPctPerSecond = 0;
      j.tuning.emf.decayPctPerSecond = 0;
      j.tuning.emf.rumourThreshold = 1_000_000_000;
      change?.(j);
    }),
    3,
    new FakeHost(),
  );
  s.world.plant.thermalSetting = 300;
  return s;
}
```

Replace the test "targets the intact board with the strongest detectable EMF" with:

```ts
  it('targets the machine with the strongest detectable EMF', () => {
    const s = session();
    s.world.emf.fill(0);
    setEmf(s, 'DA', 30);
    setEmf(s, 'DB', 50);
    expect(strongestTarget(s.ctx)?.id).toBe('DB');
    fac(s, 'DB').condition = 'wrecked';
    expect(strongestTarget(s.ctx)?.id).toBe('DA');
    setEmf(s, 'DA', 4); // below the threshold of 5
    setEmf(s, 'P', 0);
    expect(strongestTarget(s.ctx)).toBeNull();
  });
```

Replace the test "steps one cell a second toward its target and smashes it on arrival" with:

```ts
  it('steps one cell a second toward its target and wrecks it on arrival', () => {
    const s = session();
    const g = group(s, 16, 4); // DB is at (16, 8): four cells down
    for (let second = 0; second < 6; second++) {
      s.world.emf.fill(0);
      setEmf(s, 'DB', 50);
      runLuddites(s.ctx, second * 20);
    }
    expect(fac(s, 'DB').condition).toBe('wrecked');
    expect(s.world.boards[2]!.status).toBe('destroyed');
    expect(g).toMatchObject({ x: 16, y: 8 });
    expect(s.world.alerts.filter((a) => a.kind === 'wrecked')).toHaveLength(1);
  });
```

Replace the test "keeps hunting a sleeping board while its cell is loud, but not a board that is being rebuilt" with:

```ts
  it('keeps hunting a sleeping board while its cell is loud, but not a plant whose board is being rebuilt', () => {
    const s = session();
    s.world.emf.fill(0);
    setEmf(s, 'P', 50);
    s.world.boards[0]!.status = 'asleep';
    expect(strongestTarget(s.ctx)?.id).toBe('P');
    s.world.boards[0]!.status = 'rebuilding'; // a plant is a machine only through its board
    expect(strongestTarget(s.ctx)).toBeNull();
  });
```

Replace the test "raises no approach alert for a board that is destroyed or being rebuilt" with:

```ts
  it('raises no approach alert for a facility that is no machine: a plant whose board is down, or a wrecked datacenter', () => {
    const s = session();
    s.world.boards[0]!.status = 'destroyed'; // P at (4, 4)
    fac(s, 'DA').condition = 'wrecked'; // DA at (5, 4)
    group(s, 7, 4); // after its first step it is 4 cells from P and 3 from DA, on its way to DB
    setEmf(s, 'DB', 50);
    runLuddites(s.ctx, 0);
    expect(s.world.alerts.filter((a) => a.kind === 'ludditesNear')).toEqual([]);
  });
```

Add these tests at the end of the `describe`:

```ts
  it('counts as a machine a standing facility with a running or sleeping board, or a datacenter with or without one', () => {
    const s = town((j) => {
      Object.assign(j.facilities.find((f) => f.id === 'F1')!.board!, { startsInstalled: true });
    });
    const is = (id: string): boolean => isMachine(s.world, fac(s, id));
    expect(['H1', 'P', 'DA', 'W', 'DB', 'F1', 'F2'].map(is)).toEqual([false, false, true, false, true, true, false]);
    const f1 = s.world.boards[0]!; // the town's only board
    f1.status = 'asleep';
    expect(is('F1')).toBe(true);
    f1.status = 'destroyed';
    expect(is('F1')).toBe(false);
    fac(s, 'DA').condition = 'repairing';
    expect(is('DA')).toBe(false);
  });

  it('hunts a datacenter worked by hand, with no board, and wrecks it', () => {
    const s = town();
    const g = group(s, 5, 0); // DA is at (5, 4): four cells down the column
    for (let beat = 0; beat < 4; beat++) {
      s.world.emf.fill(0);
      setEmf(s, 'DA', 50);
      runLuddites(s.ctx, beat * 20);
    }
    expect([g.x, g.y]).toEqual([5, 4]);
    expect(fac(s, 'DA').condition).toBe('wrecked');
    expect(s.world.alerts.filter((a) => a.kind === 'wrecked').map((a) => a.facilityId)).toEqual(['DA']);
  });

  it('does not hunt a facility with no board whose own work is no machine, however loud its cell', () => {
    const s = town();
    for (const id of ['H1', 'P', 'W', 'F1']) {
      s.world.emf.fill(0);
      setEmf(s, id, 50);
      expect(strongestTarget(s.ctx), id).toBeNull();
    }
  });

  it('wrecks the whole facility it reaches: a farm and its board alike', () => {
    const s = town((j) => {
      Object.assign(j.facilities.find((f) => f.id === 'F1')!.board!, { startsInstalled: true });
    });
    group(s, 2, 8); // F1 is at (2, 9): one cell down
    setEmf(s, 'F1', 50);
    runLuddites(s.ctx, 0);
    expect(fac(s, 'F1').condition).toBe('wrecked');
    expect(s.world.boards[0]!.status).toBe('destroyed');
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/test/emf.test.ts packages/core/test/luddites.test.ts`
Expected: FAIL. Neither file loads: `emf.ts` has no export named `baseEmission` (nor `processingEmission`), and `luddites.ts` none named `isMachine`. If Task 4 did not write `countsAsAction`, `firmware-host.ts` lacks that too.

- [ ] **Step 4: Count only machine labor as actions**

In `packages/core/src/firmware-host.ts`, after the `Action` type, add the following (Task 4 may already have written this same function, as contract §3 lists it there):

```ts
/**
 * The actions that count toward a board's action EMF: machine labor. process() is counted as the datacenter's running time
 * instead (the EMF phase's processing EMF, the same for a hand and for firmware), and sleep() is no labor.
 */
export function countsAsAction(kind: Action['kind']): boolean {
  return kind !== 'process' && kind !== 'sleep';
}
```

- [ ] **Step 5: Write the EMF phase**

Replace `packages/core/src/emf.ts` with:

```ts
import { isProcessing } from './datacenter.ts';
import { countsAsAction, type TickOutcome } from './firmware-host.ts';
import { idiv, MILLI, mulDiv } from './fixed.ts';
import type { Ticked } from './ticks.ts';
import { type BoardState, cellIndex, type SimContext, type WorldState } from './world.ts';

/**
 * Milli-EMF that one tick emits: instructions / instructionsPerUnit, plus perAction for each action that is machine labor.
 * A process() call is counted as the datacenter's running time instead (processingEmission), whoever starts the job, and sleep()
 * is no labor.
 */
export function tickEmission(ctx: SimContext, outcome: TickOutcome): number {
  const e = ctx.scenario.tuning.emf;
  const labor = outcome.actions.filter((a) => countsAsAction(a.kind)).length;
  return mulDiv(outcome.instructions, MILLI, e.instructionsPerUnit) + labor * e.perAction * MILLI;
}

/** Milli-EMF a running, powered board gives off each step: its base EMF, and a comm module's on top, spread over the second. */
export function baseEmission(ctx: SimContext, board: BoardState): number {
  const perSecond = board.spec.baseEmfPerSecond + (board.comm ? ctx.scenario.tuning.install.commBaseEmfPerSecond : 0);
  return mulDiv(perSecond, MILLI, ctx.scenario.time.stepsPerSecond);
}

/** Milli-EMF a datacenter's servers give off on each step they work, whoever started the job: a press of [처리] or process(). */
export function processingEmission(ctx: SimContext): number {
  return mulDiv(ctx.scenario.tuning.emf.processingPerSecond, MILLI, ctx.scenario.time.stepsPerSecond);
}

/**
 * One step of diffusion to the four neighbours inside the map, then decay. In place.
 * Decay rounds up, so that small values fade to zero instead of lingering.
 */
export function diffuse(
  field: number[],
  width: number,
  height: number,
  sharePctPerSecond: number,
  decayPctPerSecond: number,
  stepsPerSecond: number,
): void {
  const next = field.slice();
  const denom = 100 * stepsPerSecond;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const share = idiv(field[i]! * sharePctPerSecond, denom);
      if (share === 0) continue;
      const give = (n: number): void => {
        next[n] = next[n]! + share;
        next[i] = next[i]! - share;
      };
      if (x > 0) give(i - 1);
      if (x < width - 1) give(i + 1);
      if (y > 0) give(i - width);
      if (y < height - 1) give(i + width);
    }
  }
  for (let i = 0; i < next.length; i++) {
    const v = next[i]!;
    field[i] = v + idiv(-v * decayPctPerSecond, denom); // v - ceil(v * pct / denom)
  }
}

/**
 * Phase 7: this step's ticks, every running and powered board's base EMF, and every working datacenter's processing EMF, each
 * into its own cell; then diffusion and decay. The player's hands give off nothing. The step is the world's own: phase 7 of step s
 * runs with world.step === s.
 */
export function runEmf(ctx: SimContext, ticked: readonly Ticked[]): void {
  const { scenario, world } = ctx;
  const add = (x: number, y: number, milli: number): void => {
    const i = cellIndex(scenario, x, y);
    world.emf[i] = world.emf[i]! + milli;
  };
  for (const { board, outcome } of ticked) add(board.x, board.y, tickEmission(ctx, outcome));
  for (const board of world.boards) {
    if (board.status === 'running' && board.powered) add(board.x, board.y, baseEmission(ctx, board));
  }
  for (const f of world.facilities) {
    if (isProcessing(ctx, f.id, world.step)) add(f.x, f.y, processingEmission(ctx));
  }
  const e = scenario.tuning.emf;
  diffuse(world.emf, scenario.grid.width, scenario.grid.height, e.diffusionPctPerSecond, e.decayPctPerSecond, scenario.time.stepsPerSecond);
}

/** The field's total in whole EMF units. */
export function fieldTotal(world: WorldState): number {
  let sum = 0;
  for (const v of world.emf) sum += v;
  return idiv(sum, MILLI);
}
```

- [ ] **Step 6: Write the Luddites' hunt for machines**

Replace `packages/core/src/luddites.ts` with:

```ts
import { raiseAlert } from './alerts.ts';
import { wreckFacility } from './boards.ts';
import { fieldTotal } from './emf.ts';
import { idiv, MILLI } from './fixed.ts';
import type { FacilityKind } from './scenario.ts';
import {
  cellIndex,
  type FacilityState,
  findBoard,
  type LudditeGroup,
  manhattan,
  type SimContext,
  type WorldState,
} from './world.ts';

const SIDES = ['북쪽', '남쪽', '서쪽', '동쪽'] as const;

/** Kinds whose own work is a machine's, because they process: such a facility is a target with or without a board. */
const MACHINE_KINDS: ReadonlySet<FacilityKind> = new Set<FacilityKind>(['datacenter']);

/**
 * What Luddites hunt: a standing facility that has a board that runs or sleeps, or whose own work is a machine's. A facility
 * worked only by hand, one whose board is destroyed or being rebuilt, and anything wrecked or being repaired are no machines.
 */
export function isMachine(world: WorldState, facility: FacilityState): boolean {
  if (facility.condition !== 'ok') return false;
  if (MACHINE_KINDS.has(facility.kind)) return true;
  const board = findBoard(world, facility.id);
  return board !== undefined && (board.status === 'running' || board.status === 'asleep');
}

/** The cells from one point to another, along the row first, then the column. */
export function pathTo(fromX: number, fromY: number, toX: number, toY: number): Array<[number, number]> {
  const path: Array<[number, number]> = [];
  let x = fromX;
  let y = fromY;
  while (x !== toX) {
    x += Math.sign(toX - x);
    path.push([x, y]);
  }
  while (y !== toY) {
    y += Math.sign(toY - y);
    path.push([x, y]);
  }
  return path;
}

export function spawnRaid(ctx: SimContext, step: number): LudditeGroup {
  const { width, height } = ctx.scenario.grid;
  const r = ctx.rng.luddites;
  const side = r.int(0, 3);
  const along = side < 2 ? r.int(0, width - 1) : r.int(0, height - 1);
  const [x, y] = side === 0 ? [along, 0] : side === 1 ? [along, height - 1] : side === 2 ? [0, along] : [width - 1, along];
  const size = ctx.scenario.tuning.luddites.groupSize;
  const group: LudditeGroup = { id: ctx.world.nextLudditeId++, x, y, size, targetId: null, quietSince: null, leaving: false, warned: [] };
  ctx.world.luddites.push(group);
  ctx.world.stats.raids += 1;
  raiseAlert(ctx.world, step, 'raid', null, `러다이트 ${size}명이 나타났어요 (${SIDES[side]} 가장자리)`);
  return group;
}

/** Once a second the gauge collects the field's total; a full gauge brings a raid. */
export function runRumour(ctx: SimContext, step: number): void {
  const sps = ctx.scenario.time.stepsPerSecond;
  if (step % sps !== sps - 1) return;
  ctx.world.rumour += fieldTotal(ctx.world);
  if (ctx.world.rumour >= ctx.scenario.tuning.emf.rumourThreshold) {
    ctx.world.rumour = 0;
    spawnRaid(ctx, step);
  }
}

/** The machine whose cell carries the strongest EMF at or above the detection threshold. */
export function strongestTarget(ctx: SimContext): FacilityState | null {
  const threshold = ctx.scenario.tuning.emf.detectionThreshold * MILLI;
  let best: FacilityState | null = null;
  let bestValue = -1;
  for (const f of ctx.world.facilities) {
    if (!isMachine(ctx.world, f)) continue;
    const v = ctx.world.emf[cellIndex(ctx.scenario, f.x, f.y)]!;
    if (v >= threshold && v > bestValue) {
      best = f;
      bestValue = v;
    }
  }
  return best;
}

function nearestEdgeStep(ctx: SimContext, g: LudditeGroup): [number, number] | null {
  const { width, height } = ctx.scenario.grid;
  const options: Array<[number, number, number]> = [
    [g.x, -1, 0],
    [width - 1 - g.x, 1, 0],
    [g.y, 0, -1],
    [height - 1 - g.y, 0, 1],
  ];
  let best = options[0]!;
  for (const o of options) if (o[0] < best[0]) best = o;
  return best[0] === 0 ? null : [best[1], best[2]];
}

/** One approach alert per machine for each group, the first time the group comes within reach of it. */
function warnNearby(ctx: SimContext, g: LudditeGroup, step: number): void {
  const reach = ctx.scenario.tuning.luddites.approachCells;
  for (const f of ctx.world.facilities) {
    if (!isMachine(ctx.world, f) || g.warned.includes(f.id)) continue;
    const d = manhattan(g.x, g.y, f.x, f.y);
    if (d <= reach) {
      g.warned.push(f.id);
      raiseAlert(ctx.world, step, 'ludditesNear', f.id, `러다이트가 ${f.id}에 다가오고 있어요 (${d}칸)`);
    }
  }
}

/** Phase 8: every group moves one cell on its beat, wrecks the facility it reaches, or gives up and leaves. */
export function runLuddites(ctx: SimContext, step: number): void {
  const t = ctx.scenario.tuning.luddites;
  const sps = ctx.scenario.time.stepsPerSecond;
  if (step % idiv(sps, t.cellsPerSecond) !== 0) return;
  for (const g of [...ctx.world.luddites]) {
    if (g.leaving) {
      const dir = nearestEdgeStep(ctx, g);
      if (dir === null) ctx.world.luddites.splice(ctx.world.luddites.indexOf(g), 1);
      else {
        g.x += dir[0];
        g.y += dir[1];
      }
      continue;
    }
    const target = strongestTarget(ctx);
    if (!target) {
      g.targetId = null;
      g.quietSince ??= step;
      if (step - g.quietSince >= t.quietSecondsToLeave * sps) g.leaving = true;
      continue;
    }
    g.quietSince = null;
    g.targetId = target.id;
    const next = pathTo(g.x, g.y, target.x, target.y)[0];
    if (next) {
      g.x = next[0];
      g.y = next[1];
    }
    warnNearby(ctx, g, step);
    if (g.x === target.x && g.y === target.y) wreckFacility(ctx, target, step, 'luddites');
  }
}
```

- [ ] **Step 7: Let the snapshot find a target with no board**

In `packages/core/src/queries.ts`, a group's `targetId` may now name a datacenter with no board. In `snapshot()`, the Luddite path looks its target up as a facility: replace `findBoard(w, g.targetId)` with `findFacility(w, g.targetId)`, and import `findFacility` from `./world.ts`. Task 10 rewrites the snapshot later; this keeps the path drawn until then.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core`
Expected: PASS: emf, luddites, and every other core test. The test "lets a board that sleeps escape" still passes. Its datacenter's processing EMF of 50 a second stands where milestone 1 counted 10 for each `process()` call at 5 Hz, so DB is as loud as before.

- [ ] **Step 9: Check and commit**

```bash
pnpm fix
pnpm check
git add packages/core
git commit -m "Count EMF from boards and busy datacenters, not from hands; Luddites hunt machines and wreck what they reach"
```

`pnpm check` must pass: typecheck, lint, and every test.

---

### Task 7: Farms

> **Corrections from assembling the plan (read first).**
> - **Hand actions apply at once (decision D1, Task 4).** A press of [수확] applies at the press: the outbox grows, and the field replants at `world.step`. The test "the press applies in the next step" becomes "the press applies at once". In `Session.hand` there is no queue: "records and queues" reads "records and applies".
> - Put the `harvestProblem` check in Task 4's `Session.hand`, right after its `kindProblem` check.


10-09 spec §5.4, worked by hand or by firmware (10-10 spec §4.3).

**The crop:**
- A crop ripens over `ripenSeconds` (3 days).
- `harvest()` moves a ripe crop's `yield` into the outbox and replants at once. Whatever passes `outboxCapacity` is wasted.
- A ripe crop left for `rotSeconds` (a day) rots: it is lost, and the field replants. A farm with a board logs it.

**Hand and firmware.** The player harvests with the panel's [수확], which `Session.hand` refuses while nothing is ripe. A farm board's firmware calls `io.harvest()` and reads `ripeness` (0 to 100) and `outbox`.

**What a farm needs.** It grows without a board and without power, and asks the grid for nothing.

**A wrecked farm** neither grows into a harvest nor rots. When its repair finishes, Task 3's repair replants it (contract §12).

**Starting point.** This task assumes:
- **Task 1:** the tuning has `farm.ripenSeconds`, `rotSeconds`, `yield`, and `outboxCapacity`, and `SENSOR_KEYS` names `ripeness` and `outbox`.
- **Task 2:** `world.farms[id]` is `{ plantedAt: 0, outbox: 0 }`.
- **Task 3:** a finished repair sets a farm's `plantedAt` to that step.
- **Task 4:**
  - `applyFacilityAction` has a `harvest` case that does nothing yet;
  - `Session.hand` checks an action against its facility's kind before it records and queues it;
  - `SensorValue` exists (contract §3).

**Files:**
- Create: `packages/core/src/farm.ts`
- Modify: `packages/core/src/actions.ts` (the `harvest` case), `packages/core/src/session.ts` (`hand` and `step`), `packages/core/src/index.ts`
- Rewrite: `packages/core/src/sensors.ts` (the farm's readings)
- Test: `packages/core/test/farm.test.ts`

**Interfaces:**
- Consumes:
  - **Task 1:** `tuning.farm` and `m2Scenario`.
  - **Task 2:** `world.farms`, `findFacility`, `findBoard`, `world.facilities`, and `facilityDemand`.
  - **Task 3:** `Session.repair` and its replanting.
  - **Task 4:** `applyFacilityAction`, `Session.hand`, and `SensorValue`.
  - **Milestone 1:** `appendLog` and `stepsForSeconds`.
- Produces (contract §8, plus `harvestProblem`):
  - `ripenSteps(ctx)` and `rotSteps(ctx)`.
  - `isRipe(ctx, farm, step)` and `ripeness(ctx, farm, step)` (0 to 100).
  - `harvestProblem(ctx, farmId, step): string | null`: why a hand harvest cannot happen now. The answers are "the farm is wrecked" and "nothing is ripe". `Session.hand` refuses with `{ code: 'cannotAct', facility, detail }`.
  - `harvest(ctx, farmId, step)` (phase 5, through `applyFacilityAction`).
  - `runFarms(ctx, step)` (phase 6, after `runDatacenters`).
  - The `ripeness` and `outbox` sensors in the board's io.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/farm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { harvest, harvestProblem, isRipe, ripeness, ripenSteps, rotSteps, runFarms } from '../src/farm.ts';
import { facilityDemand } from '../src/power.ts';
import { Session } from '../src/session.ts';
import { findFacility } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m2Scenario } from './helpers/scenarios.ts';

/** The milestone-2 town on steady, free power, with no raid. `withBoard` installs F1's board at the start. */
function town(withBoard = false, host = new FakeHost()): Session {
  const s = new Session(
    m2Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.fuelPrice = { start: 0, min: 0, max: 0 };
      j.tuning.emf.rumourThreshold = 1_000_000_000;
      if (withBoard) Object.assign(j.facilities.find((f) => f.id === 'F1')!.board!, { startsInstalled: true });
    }),
    1,
    host,
  );
  s.world.plant.thermalSetting = 300;
  return s;
}

describe('farms', () => {
  it('ripens after ripenSeconds, its ripeness counting up to 100', () => {
    const s = town();
    const farm = s.world.farms.F1!;
    expect(ripenSteps(s.ctx)).toBe(2_400); // 120 s at 20 steps a second
    expect(rotSteps(s.ctx)).toBe(800); // 40 s
    expect([0, 1, 600, 1_200, 2_399, 2_400, 3_000].map((step) => ripeness(s.ctx, farm, step))).toEqual([0, 0, 25, 50, 99, 100, 100]);
    expect(isRipe(s.ctx, farm, 2_399)).toBe(false);
    expect(isRipe(s.ctx, farm, 2_400)).toBe(true);
  });

  it('harvests a ripe crop into the outbox and replants; an unripe field gives nothing', () => {
    const s = town();
    const farm = s.world.farms.F1!;
    harvest(s.ctx, 'F1', 2_399);
    expect(farm).toEqual({ plantedAt: 0, outbox: 0 });
    harvest(s.ctx, 'F1', 2_400);
    expect(farm).toEqual({ plantedAt: 2_400, outbox: 24 });
    harvest(s.ctx, 'F1', 2_401); // just replanted: nothing is ripe
    expect(farm).toEqual({ plantedAt: 2_400, outbox: 24 });
  });

  it('fills the outbox to its capacity and wastes the rest', () => {
    const s = town();
    const farm = s.world.farms.F1!;
    farm.outbox = 40;
    harvest(s.ctx, 'F1', 2_400);
    expect(farm.outbox).toBe(50); // 40 + 24 is 64, and the outbox holds 50
    farm.plantedAt = 0;
    harvest(s.ctx, 'F1', 2_400); // into a full outbox: the whole crop is wasted, and the field replants all the same
    expect(farm).toEqual({ plantedAt: 2_400, outbox: 50 });
  });

  it('rots a crop left ripe for rotSeconds, and replants', () => {
    const s = town();
    const farm = s.world.farms.F1!;
    runFarms(s.ctx, 3_199); // ripe since step 2,400: 799 steps
    expect(farm.plantedAt).toBe(0);
    runFarms(s.ctx, 3_200); // 800 steps: it rots
    expect(farm).toEqual({ plantedAt: 3_200, outbox: 0 });
  });

  it("logs a rotted crop on the farm's board", () => {
    const s = town(true);
    runFarms(s.ctx, 3_200);
    expect(s.world.boards[0]!.log.at(-1)).toMatchObject({ kind: 'system', text: 'crop rotted' });
  });

  it('is harvested by hand: the press applies in the next step, and a field with nothing ripe is refused', () => {
    const s = town();
    expect(s.hand('F1', { kind: 'harvest' })).toEqual({
      ok: false,
      reason: 'F1: nothing is ripe',
      refusal: { code: 'cannotAct', facility: 'F1', detail: 'nothing is ripe' },
    });
    while (s.world.step < 2_400) s.step();
    expect(s.hand('F1', { kind: 'harvest' })).toEqual({ ok: true });
    s.step(); // step 2,400 applies it
    expect(s.world.farms.F1).toEqual({ plantedAt: 2_400, outbox: 24 });
    expect(s.world.farms.F2).toEqual({ plantedAt: 0, outbox: 0 }); // the others wait for their own harvest
  });

  it('is harvested by firmware with io.harvest(), which reads ripeness and outbox', () => {
    const host = new FakeHost();
    const seen: Array<[unknown, unknown]> = [];
    const picker = host.program('picker', (sensors) => {
      seen.push([sensors.ripeness, sensors.outbox]);
      return sensors.ripeness === 100 ? { actions: [{ kind: 'harvest' }] } : {};
    });
    const s = town(true, host);
    s.deploy('F1', picker);
    while (s.world.step < 2_500) s.step();
    expect(seen[0]).toEqual([0, 0]); // F1's first beat, at step 14 (1 Hz, its index 6 for the phase)
    // the beat at 2,394 reads 99; the next, at 2,414, harvests
    expect(s.world.farms.F1).toEqual({ plantedAt: 2_414, outbox: 24 });
  });

  it('neither ripens into a harvest nor rots while wrecked', () => {
    const s = town();
    findFacility(s.world, 'F1')!.condition = 'wrecked';
    expect(harvestProblem(s.ctx, 'F1', 2_400)).toBe('the farm is wrecked');
    harvest(s.ctx, 'F1', 2_400);
    runFarms(s.ctx, 3_200);
    expect(s.world.farms.F1).toEqual({ plantedAt: 0, outbox: 0 });
  });

  it('replants when its repair finishes', () => {
    const s = town();
    const f1 = findFacility(s.world, 'F1')!;
    f1.condition = 'wrecked';
    expect(s.repair('F1')).toEqual({ ok: true });
    const ready = f1.repairReadyAt!;
    while (s.world.step <= ready) s.step();
    expect(f1.condition).toBe('ok');
    expect(s.world.farms.F1!.plantedAt).toBe(ready);
  });

  it('grows with no board and no power, and asks the grid for nothing', () => {
    const s = town();
    expect(facilityDemand(s.ctx, findFacility(s.world, 'F1')!, 0)).toBe(0);
    while (s.world.step <= 2_400) s.step();
    expect(isRipe(s.ctx, s.world.farms.F1!, s.world.step)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/test/farm.test.ts`
Expected: FAIL: `../src/farm.ts` does not exist.

- [ ] **Step 3: Write the farm module**

`packages/core/src/farm.ts`:

```ts
import { appendLog } from './boards.ts';
import { idiv } from './fixed.ts';
import { stepsForSeconds } from './time.ts';
import { type FarmState, findBoard, findFacility, type SimContext } from './world.ts';

/** Steps a crop takes to ripen. */
export function ripenSteps(ctx: SimContext): number {
  return stepsForSeconds(ctx.scenario.time, ctx.scenario.tuning.farm.ripenSeconds);
}

/** Steps a ripe crop lasts before it rots. */
export function rotSteps(ctx: SimContext): number {
  return stepsForSeconds(ctx.scenario.time, ctx.scenario.tuning.farm.rotSeconds);
}

export function isRipe(ctx: SimContext, farm: FarmState, step: number): boolean {
  return step - farm.plantedAt >= ripenSteps(ctx);
}

/** How far the crop has grown, from 0 when planted to 100 when ripe, rounded down. */
export function ripeness(ctx: SimContext, farm: FarmState, step: number): number {
  const n = ripenSteps(ctx);
  if (n <= 0) return 100;
  return Math.max(0, Math.min(100, idiv((step - farm.plantedAt) * 100, n)));
}

/** Why the player's harvest cannot happen now, or null. Session.hand refuses with it. */
export function harvestProblem(ctx: SimContext, farmId: string, step: number): string | null {
  const f = findFacility(ctx.world, farmId);
  const farm = ctx.world.farms[farmId];
  if (!f || !farm) return 'not a farm';
  if (f.condition !== 'ok') return 'the farm is wrecked';
  if (!isRipe(ctx, farm, step)) return 'nothing is ripe';
  return null;
}

/**
 * A ripe crop goes to the outbox, and the field replants. Whatever passes the outbox's capacity is wasted. An unripe field or a
 * wrecked farm: nothing. Phase 5, from a hand or from firmware alike.
 */
export function harvest(ctx: SimContext, farmId: string, step: number): void {
  const f = findFacility(ctx.world, farmId);
  const farm = ctx.world.farms[farmId];
  if (!f || !farm || f.condition !== 'ok' || !isRipe(ctx, farm, step)) return;
  const t = ctx.scenario.tuning.farm;
  farm.outbox = Math.min(t.outboxCapacity, farm.outbox + t.yield);
  farm.plantedAt = step;
}

/**
 * Phase 6: a crop left ripe for the rot time rots: it is lost, and the field replants at that step. A farm with a board logs it.
 * A wrecked or repairing farm is skipped: its repair replants it.
 */
export function runFarms(ctx: SimContext, step: number): void {
  const limit = ripenSteps(ctx) + rotSteps(ctx);
  for (const f of ctx.world.facilities) {
    const farm = ctx.world.farms[f.id];
    if (!farm || f.condition !== 'ok') continue;
    if (step - farm.plantedAt < limit) continue;
    farm.plantedAt = step;
    const board = findBoard(ctx.world, f.id);
    if (board) appendLog(board, step, 'system', 'crop rotted');
  }
}
```

- [ ] **Step 4: Harvest from the hand and from firmware**

In `packages/core/src/actions.ts`, import `harvest` from `./farm.ts`. The `harvest` case of `applyFacilityAction`, which did nothing since Task 4, becomes:

```ts
    case 'harvest':
      if (facility.kind === 'farm') harvest(ctx, facility.id, step);
      break;
```

In `packages/core/src/session.ts`, import `harvestProblem` from `./farm.ts`. In `Session.hand`, after it has checked that the facility exists, stands, and is of the kind the action is for, and before it records and queues the action, add:

```ts
    if (action.kind === 'harvest') {
      const problem = harvestProblem(this.ctx, facilityId, this.world.step);
      if (problem !== null) {
        return { ok: false, reason: `${facilityId}: ${problem}`, refusal: { code: 'cannotAct', facility: facilityId, detail: problem } };
      }
    }
```

In `Session.step()`, run the farms in phase 6, after the datacenters:

```ts
    runDatacenters(this.ctx, s);
    runFarms(this.ctx, s);
```

with `import { runFarms } from './farm.ts';` (beside `harvestProblem`).

Add to `packages/core/src/index.ts`:

```ts
export * from './farm.ts';
```

- [ ] **Step 5: Give a farm board its readings**

Replace `packages/core/src/sensors.ts` with the following. It keeps the board's `sensorFrame(ctx, board)` and milestone 1's readings. It adds the farm's two, and leaves the warehouse's four `undefined` until Task 8:

```ts
import { ripeness } from './farm.ts';
import type { SensorValue } from './firmware-host.ts';
import { MILLI } from './fixed.ts';
import type { SensorName } from './scenario.ts';
import { gameTime } from './time.ts';
import { type BoardState, cellIndex, manhattan, type SimContext } from './world.ts';

/** Each sensor's field name in the firmware's io table. */
export const SENSOR_KEYS: Record<SensorName, string> = {
  wind: 'wind',
  demand: 'demand',
  fuelPrice: 'fuel_price',
  temp: 'temp',
  powerHeadroom: 'power_headroom',
  price: 'price',
  emf: 'emf',
  ludditeDist: 'luddite_dist',
  ripeness: 'ripeness',
  outbox: 'outbox',
  stock: 'stock',
  farms: 'farms',
  housing: 'housing',
  trucks: 'trucks',
};

function nearestLudditeDistance(ctx: SimContext, board: BoardState): number | undefined {
  let best: number | undefined;
  for (const g of ctx.world.luddites) {
    const d = manhattan(g.x, g.y, board.x, board.y);
    if (best === undefined || d < best) best = d;
  }
  return best;
}

function read(ctx: SimContext, board: BoardState, sensor: SensorName): SensorValue {
  const w = ctx.world;
  switch (sensor) {
    case 'wind':
      return w.plant.wind;
    case 'demand':
      return w.plant.demand;
    case 'fuelPrice':
      return w.plant.fuelPrice;
    case 'temp':
      return (w.datacenters[board.id]?.tempMilli ?? 0) / MILLI;
    case 'powerHeadroom':
      return w.plant.generation - w.plant.demand;
    case 'price':
      return w.jobPrice;
    case 'emf':
      return (w.emf[cellIndex(ctx.scenario, board.x, board.y)] ?? 0) / MILLI;
    case 'ludditeDist':
      return nearestLudditeDistance(ctx, board);
    case 'ripeness': {
      const farm = w.farms[board.id];
      return farm ? ripeness(ctx, farm, w.step) : undefined;
    }
    case 'outbox':
      return w.farms[board.id]?.outbox;
    case 'stock':
    case 'farms':
    case 'housing':
    case 'trucks':
      return undefined; // the warehouse's readings come with its trucks (Task 8)
  }
}

/** What the board's firmware sees in io this tick: its mounted sensors, plus the day and the clock. */
export function sensorFrame(ctx: SimContext, board: BoardState): Record<string, SensorValue> {
  const time = gameTime(ctx.scenario.time, ctx.world.step);
  const frame: Record<string, SensorValue> = { day: time.day, clock: time.seconds };
  for (const sensor of board.spec.sensors) frame[SENSOR_KEYS[sensor]] = read(ctx, board, sensor);
  return frame;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core`
Expected: PASS: farm, 10 tests, and every other core test.

- [ ] **Step 7: Check and commit**

```bash
pnpm fix
pnpm check
git add packages/core
git commit -m "Farms: crops ripen, rot, and are harvested into the outbox by hand or by firmware"
```

`pnpm check` must pass: typecheck, lint, and every test.

---

### Task 8: The warehouse and its trucks

> **Corrections from assembling the plan (read first).**
> - **Hand actions apply at once (decision D1, Task 4).** A dispatch by hand starts its leg at the press: `legFrom = world.step`. The truck enters its first cell `stepsPerCell` steps after the press step. Move the tests' step expectations one step earlier where they assumed phase-5 application. Firmware dispatches keep `startStep = s + 1`.
> - Put the `dispatchProblem` check in Task 4's `Session.hand`, right after its `kindProblem` check.


10-09 spec §5.5, worked by hand or by firmware (10-10 spec §4.3).

**Trips.** The warehouse sends one of its idle trucks on a trip with `dispatch(truck, from, to, amount)`:
- **collect:** from a farm to this warehouse. The truck drives out, takes up to `amount` from the farm's outbox, and drives back to stock it.
- **deliver:** from this warehouse to a housing block. The truck loads at once, drives out, and unloads into the block's food.

**On the road.** Trucks follow the roads, row first, then column (`pathTo`). They move `truckCellsPerSecond` and pay `fuelPerCell` for each cell they enter.

**Stock** spoils by `spoilagePctPerDay`.

**Hand and firmware.** The player sends trucks with the panel's [트럭 보내기], and `Session.hand` refuses a trip that cannot start, saying why. A warehouse board's firmware calls `io.dispatch(...)` and reads its stock, every farm and housing block with its distance from the warehouse, and its trucks.

**When the warehouse is wrecked,** trucks on the road finish their trips, and it takes no new dispatch.

**Starting point.** This task assumes:
- **Task 1:** the tuning has the `warehouse` keys.
- **Task 2:** `world.warehouses[id]` holds `stockMilli: 0` and its idle trucks at the warehouse's cell, as contract §2 gives them, and `world.housing[id]` holds `foodMilli`.
- **Task 4:** the `dispatch` case of `applyFacilityAction` does nothing yet.
- **Task 7:** gives `sensors.ts` and the farms.

**Files:**
- Create: `packages/core/src/warehouse.ts`
- Modify: `packages/core/src/actions.ts` (the `dispatch` case), `packages/core/src/session.ts` (`hand` and `step`), `packages/core/src/sensors.ts` (the warehouse's readings), `packages/core/src/index.ts`
- Test: `packages/core/test/warehouse.test.ts`

**Interfaces:**
- Consumes:
  - **Task 1:** `tuning.warehouse` (`trucks`, `truckCapacity`, `truckCellsPerSecond`, `fuelPerCell`, `spoilagePctPerDay`), `tuning.housing.residents`, and `m2Scenario`.
  - **Task 2:** `world.warehouses`, `world.farms`, `world.housing`, `world.facilities`, `findFacility`, `TruckState`, and `WarehouseState`.
  - **Task 4:** `FacilityAction`, `applyFacilityAction`, `Session.hand`, `replay`'s hand inputs, and `SensorValue`.
  - **Task 6:** `pathTo` (in `luddites.ts`).
  - **Task 7:** the farms and `sensors.ts`.
- Produces (contract §9, plus `warehouseReading`):
  - `stepsPerCell(ctx)`.
  - `dispatchProblem(ctx, warehouseId, d): string | null`: why a dispatch cannot start now. In order, it checks: "not a warehouse"; "the warehouse is wrecked"; "there is no truck N; trucks are 1-n"; "truck N is on the road"; "the amount must be a whole number from 1 to 40"; the trip ("a truck collects from a farm to the warehouse, or delivers from the warehouse to a housing block"); and "the warehouse has no food to deliver". `Session.hand` refuses with `{ code: 'cannotAct', facility, detail }`.
  - `dispatch(ctx, warehouseId, d, step)` (phase 5, through `applyFacilityAction`).
  - `runWarehouses(ctx, step)` (phase 6, after `runFarms`).
  - `warehouseReading(ctx, warehouseId, sensor)`: the values of contract §15 for `stock`, `farms`, `housing`, and `trucks`. `sensors.ts` reads a warehouse board's io through it.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/warehouse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { FacilityAction } from '../src/firmware-host.ts';
import { MICRO } from '../src/fixed.ts';
import { stateHash } from '../src/hash.ts';
import { replay, Session } from '../src/session.ts';
import { dispatch, dispatchProblem, runWarehouses, stepsPerCell } from '../src/warehouse.ts';
import { findFacility } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m2Scenario } from './helpers/scenarios.ts';

type Dispatch = Extract<FacilityAction, { kind: 'dispatch' }>;

/** A dispatch: truck 1 collecting 10 from F1, unless a test says otherwise. */
const d = (over: Partial<Omit<Dispatch, 'kind'>> = {}): Dispatch => ({
  kind: 'dispatch',
  truck: 1,
  from: 'F1',
  to: 'W',
  amount: 10,
  ...over,
});

/** The milestone-2 town on steady, free power, with no raid. */
function town(change?: Parameters<typeof m2Scenario>[0], host = new FakeHost()): Session {
  const s = new Session(
    m2Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.fuelPrice = { start: 0, min: 0, max: 0 };
      j.tuning.emf.rumourThreshold = 1_000_000_000;
      change?.(j);
    }),
    1,
    host,
  );
  s.world.plant.thermalSetting = 300;
  return s;
}

describe('the warehouse', () => {
  it('collects: drives a cell every stepsPerCell steps, takes the outbox at the farm, and stocks it back home', () => {
    const s = town();
    const wh = s.world.warehouses.W!;
    const truck = wh.trucks[0]!;
    s.world.farms.F1!.outbox = 30;
    expect(stepsPerCell(s.ctx)).toBe(10); // 2 cells a second at 20 steps a second
    expect(s.hand('W', d({ amount: 40 }))).toEqual({ ok: true });
    s.step(); // step 0 applies it: the truck sets out
    expect(truck).toMatchObject({
      status: 'outbound',
      x: 11,
      y: 6,
      cellsDone: 0,
      load: 0,
      job: { kind: 'collect', targetId: 'F1', amount: 40 },
    });
    while (s.world.step <= 10) s.step();
    expect([truck.x, truck.y]).toEqual([10, 6]); // one cell along the row by step 10
    while (s.world.step <= 120) s.step(); // W (11, 6) to F1 (2, 9) is 9 cells along the row and 3 down: there on step 120
    expect(truck).toMatchObject({ status: 'returning', x: 2, y: 9, load: 30 });
    expect(s.world.farms.F1!.outbox).toBe(0);
    while (s.world.step <= 240) s.step(); // and home on step 240
    expect(truck).toMatchObject({ status: 'idle', x: 11, y: 6, load: 0, job: null });
    expect(wh.stockMilli).toBe(30_000);
    expect(s.world.ledger.truckFuel).toBe(24 * MICRO); // 12 cells out and 12 back, at 1 a cell
  });

  it('delivers: loads at dispatch, unloads at the housing block, and drives back empty', () => {
    const s = town();
    const wh = s.world.warehouses.W!;
    const h1 = s.world.housing.H1!;
    const truck = wh.trucks[1]!;
    wh.stockMilli = 50_000;
    const food = h1.foodMilli;
    dispatch(s.ctx, 'W', d({ truck: 2, from: 'W', to: 'H1', amount: 30 }), 0);
    expect(wh.stockMilli).toBe(20_000);
    expect(truck).toMatchObject({ status: 'outbound', load: 30, job: { kind: 'deliver', targetId: 'H1', amount: 30 } });
    for (let step = 0; step <= 140; step++) runWarehouses(s.ctx, step); // W (11, 6) to H1 (2, 1) is 9 + 5 cells: there on step 140
    expect(truck).toMatchObject({ status: 'returning', x: 2, y: 1, load: 0 });
    expect(h1.foodMilli).toBe(food + 30_000);
    for (let step = 141; step <= 280; step++) runWarehouses(s.ctx, step);
    expect(truck).toMatchObject({ status: 'idle', x: 11, y: 6, load: 0, job: null });
    expect(s.world.ledger.truckFuel).toBe(28 * MICRO);
  });

  it('carries no more than the stock, its capacity, or the amount, and collects no more than the outbox holds', () => {
    const s = town();
    const wh = s.world.warehouses.W!;
    wh.stockMilli = 25_500; // 25 whole units and half of one
    dispatch(s.ctx, 'W', d({ truck: 1, from: 'W', to: 'H2', amount: 40 }), 0);
    expect(wh.trucks[0]!.load).toBe(25);
    expect(wh.stockMilli).toBe(500);
    s.world.farms.F2!.outbox = 30;
    dispatch(s.ctx, 'W', d({ truck: 2, from: 'F2', amount: 10 }), 0);
    for (let step = 0; step <= 110; step++) runWarehouses(s.ctx, step); // W to F2 (3, 9) is 8 + 3 cells: there on step 110
    expect(wh.trucks[1]!.load).toBe(10);
    expect(s.world.farms.F2!.outbox).toBe(20);
  });

  it('refuses what a truck cannot do, and says why', () => {
    const s = town();
    const wh = s.world.warehouses.W!;
    expect(dispatchProblem(s.ctx, 'W', d())).toBeNull();
    expect(dispatchProblem(s.ctx, 'W', d({ truck: 3 }))).toBe('there is no truck 3; trucks are 1-2');
    expect(dispatchProblem(s.ctx, 'W', d({ truck: 1.5 }))).toBe('there is no truck 1.5; trucks are 1-2');
    expect(dispatchProblem(s.ctx, 'W', d({ amount: 0 }))).toBe('the amount must be a whole number from 1 to 40');
    expect(dispatchProblem(s.ctx, 'W', d({ amount: 41 }))).toBe('the amount must be a whole number from 1 to 40');
    expect(dispatchProblem(s.ctx, 'W', d({ amount: 2.5 }))).toBe('the amount must be a whole number from 1 to 40');
    const trip = 'a truck collects from a farm to the warehouse, or delivers from the warehouse to a housing block';
    expect(dispatchProblem(s.ctx, 'W', d({ from: 'F1', to: 'H1' }))).toBe(trip);
    expect(dispatchProblem(s.ctx, 'W', d({ from: 'W', to: 'F1' }))).toBe(trip);
    expect(dispatchProblem(s.ctx, 'W', d({ from: 'H1', to: 'W' }))).toBe(trip);
    expect(dispatchProblem(s.ctx, 'W', d({ from: 'W', to: 'H1' }))).toBe('the warehouse has no food to deliver');
    wh.stockMilli = 1_000;
    expect(dispatchProblem(s.ctx, 'W', d({ from: 'W', to: 'H1' }))).toBeNull();
    wh.trucks[0]!.status = 'outbound';
    expect(dispatchProblem(s.ctx, 'W', d())).toBe('truck 1 is on the road');
    findFacility(s.world, 'W')!.condition = 'wrecked';
    expect(dispatchProblem(s.ctx, 'W', d({ truck: 2 }))).toBe('the warehouse is wrecked');
    expect(dispatchProblem(s.ctx, 'F1', d())).toBe('not a warehouse');
  });

  it('refuses a hand dispatch it cannot do, with its reason, and records nothing', () => {
    const s = town();
    expect(s.hand('W', d({ from: 'W', to: 'H1' }))).toEqual({
      ok: false,
      reason: 'W: the warehouse has no food to deliver',
      refusal: { code: 'cannotAct', facility: 'W', detail: 'the warehouse has no food to deliver' },
    });
    expect(s.record.inputs).toEqual([]);
  });

  it('is dispatched by firmware with io.dispatch(), and reads its stock, the farms, the housing blocks, and its trucks', () => {
    const host = new FakeHost();
    const frames: Array<Record<string, unknown>> = [];
    const runner = host.program('runner', (sensors) => {
      frames.push({ ...sensors });
      return frames.length === 1 ? { actions: [{ kind: 'dispatch', truck: 1, from: 'F2', to: 'W', amount: 20 }] } : {};
    });
    const s = town((j) => {
      Object.assign(j.facilities.find((f) => f.id === 'W')!.board!, { startsInstalled: true });
    }, host);
    s.world.farms.F2!.outbox = 20;
    s.world.warehouses.W!.stockMilli = 7_500;
    s.deploy('W', runner);
    while (frames.length === 0) s.step(); // W's first beat is step 6 (2 Hz, its index 4 for the phase)
    expect(frames[0]).toMatchObject({
      day: 1,
      stock: 7, // whole units
      farms: [
        { id: 'F1', outbox: 0, distance: 12 },
        { id: 'F2', outbox: 20, distance: 11 },
        { id: 'F3', outbox: 0, distance: 10 },
      ],
      housing: [
        { id: 'H1', food: expect.any(Number), residents: 40, distance: 14 },
        { id: 'H2', food: expect.any(Number), residents: 40, distance: 11 },
      ],
      trucks: [
        { id: 1, status: 'idle', x: 11, y: 6, load: 0, target: undefined },
        { id: 2, status: 'idle', x: 11, y: 6, load: 0, target: undefined },
      ],
    });
    expect(s.world.warehouses.W!.trucks[0]).toMatchObject({ status: 'outbound', job: { kind: 'collect', targetId: 'F2', amount: 20 } });
  });

  it('lets its stock spoil by spoilagePctPerDay, split over the steps and rounded down', () => {
    const s = town();
    const wh = s.world.warehouses.W!;
    wh.stockMilli = 100_000;
    runWarehouses(s.ctx, 0);
    expect(wh.stockMilli).toBe(99_998); // 2% of 100 a day over 800 steps is 2.5 milli-units a step, taken as 2
  });

  it('lets trucks on the road finish their trips when the warehouse is wrecked, and takes no new dispatch', () => {
    const s = town();
    const wh = s.world.warehouses.W!;
    s.world.farms.F1!.outbox = 30;
    dispatch(s.ctx, 'W', d({ amount: 30 }), 0);
    findFacility(s.world, 'W')!.condition = 'wrecked';
    for (let step = 0; step <= 240; step++) runWarehouses(s.ctx, step);
    expect(wh.trucks[0]).toMatchObject({ status: 'idle', load: 0 });
    expect(wh.stockMilli).toBe(30_000);
    dispatch(s.ctx, 'W', d({ truck: 2 }), 241);
    expect(wh.trucks[1]!.status).toBe('idle');
  });

  it('replays a session of hand harvests and dispatches into the same state', () => {
    const scenario = m2Scenario((j) => {
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.emf.rumourThreshold = 1_000_000_000;
    });
    const live = new Session(scenario, 1, new FakeHost());
    expect(live.hand('P', { kind: 'setThermal', output: 300 })).toEqual({ ok: true });
    while (live.world.step < 2_400) live.step();
    expect(live.hand('F1', { kind: 'harvest' })).toEqual({ ok: true });
    live.step(); // step 2,400: 24 into F1's outbox
    expect(live.hand('W', d({ amount: 24 }))).toEqual({ ok: true });
    while (live.world.step < 2_700) live.step(); // the truck is back with 24 on step 2,641
    expect(live.hand('W', d({ truck: 2, from: 'W', to: 'H1', amount: 20 }))).toEqual({ ok: true });
    while (live.world.step < 3_000) live.step();
    const again = replay(scenario, 1, live.record, new FakeHost(), live.world.step);
    expect(stateHash(again.world)).toBe(stateHash(live.world));
    expect(live.record.inputs.map((i) => i.kind)).toEqual(['hand', 'hand', 'hand', 'hand']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/test/warehouse.test.ts`
Expected: FAIL: `../src/warehouse.ts` does not exist.

- [ ] **Step 3: Write the warehouse module**

`packages/core/src/warehouse.ts`:

```ts
import type { FacilityAction, SensorValue } from './firmware-host.ts';
import { idiv, MICRO, MILLI } from './fixed.ts';
import { pathTo } from './luddites.ts';
import { stepsPerDay } from './time.ts';
import {
  type FacilityState,
  findFacility,
  manhattan,
  type SimContext,
  type TruckJob,
  type TruckState,
  type WarehouseState,
} from './world.ts';

type Dispatch = Extract<FacilityAction, { kind: 'dispatch' }>;

/** Steps a truck takes to enter the next cell of its road. The scenario makes it a whole number (Task 1's validation). */
export function stepsPerCell(ctx: SimContext): number {
  return idiv(ctx.scenario.time.stepsPerSecond, ctx.scenario.tuning.warehouse.truckCellsPerSecond);
}

/** What a dispatch would do: collect from a farm to this warehouse, or deliver from it to a housing block; null when it is neither. */
function tripOf(ctx: SimContext, warehouseId: string, d: Dispatch): Pick<TruckJob, 'kind' | 'targetId'> | null {
  const from = findFacility(ctx.world, d.from);
  const to = findFacility(ctx.world, d.to);
  if (from?.kind === 'farm' && d.to === warehouseId) return { kind: 'collect', targetId: from.id };
  if (d.from === warehouseId && to?.kind === 'housing') return { kind: 'deliver', targetId: to.id };
  return null;
}

/** Why a dispatch cannot start now, or null. Session.hand refuses with it; the action skips (firmware gets nothing done). */
export function dispatchProblem(ctx: SimContext, warehouseId: string, d: Dispatch): string | null {
  const capacity = ctx.scenario.tuning.warehouse.truckCapacity;
  const home = findFacility(ctx.world, warehouseId);
  const wh = ctx.world.warehouses[warehouseId];
  if (!home || !wh) return 'not a warehouse';
  if (home.condition !== 'ok') return 'the warehouse is wrecked';
  const truck = wh.trucks.find((t) => t.id === d.truck);
  if (!truck) return `there is no truck ${d.truck}; trucks are 1-${wh.trucks.length}`;
  if (truck.status !== 'idle') return `truck ${truck.id} is on the road`;
  if (!Number.isInteger(d.amount) || d.amount < 1 || d.amount > capacity) {
    return `the amount must be a whole number from 1 to ${capacity}`;
  }
  const trip = tripOf(ctx, warehouseId, d);
  if (!trip) return 'a truck collects from a farm to the warehouse, or delivers from the warehouse to a housing block';
  if (trip.kind === 'deliver' && wh.stockMilli < MILLI) return 'the warehouse has no food to deliver';
  return null;
}

/** Sends an idle truck on its trip; a dispatch with a problem does nothing. A delivery loads at once, from whole units of the stock. */
export function dispatch(ctx: SimContext, warehouseId: string, d: Dispatch, step: number): void {
  if (dispatchProblem(ctx, warehouseId, d) !== null) return;
  const w = ctx.world;
  const home = findFacility(w, warehouseId)!;
  const wh = w.warehouses[warehouseId]!;
  const trip = tripOf(ctx, warehouseId, d)!;
  const target = findFacility(w, trip.targetId)!;
  const truck = wh.trucks.find((t) => t.id === d.truck)!;
  truck.job = { kind: trip.kind, targetId: trip.targetId, amount: d.amount };
  truck.status = 'outbound';
  truck.path = pathTo(home.x, home.y, target.x, target.y);
  truck.cellsDone = 0;
  truck.legFrom = step;
  truck.load = 0;
  if (trip.kind === 'deliver') {
    const load = Math.min(d.amount, idiv(wh.stockMilli, MILLI), ctx.scenario.tuning.warehouse.truckCapacity);
    wh.stockMilli -= load * MILLI;
    truck.load = load;
  }
}

/**
 * Moves a truck by the cells its leg has reached by this step, paying fuel for each, and lands it at the end of its leg. At the
 * farm it takes what the outbox holds, up to the amount and its capacity; at a housing block it unloads; at home it stocks what it
 * carries and stands idle. The next leg starts on the step the last one ended.
 */
function moveTruck(ctx: SimContext, home: FacilityState, wh: WarehouseState, truck: TruckState, step: number): void {
  const job = truck.job;
  if (truck.status === 'idle' || job === null) return;
  const t = ctx.scenario.tuning.warehouse;
  const w = ctx.world;
  const reached = Math.min(truck.path.length, idiv(step - truck.legFrom, stepsPerCell(ctx)));
  while (truck.cellsDone < reached) {
    const [x, y] = truck.path[truck.cellsDone]!;
    truck.x = x;
    truck.y = y;
    truck.cellsDone += 1;
    const fuel = t.fuelPerCell * MICRO;
    w.money -= fuel;
    w.ledger.truckFuel += fuel;
  }
  if (truck.cellsDone < truck.path.length) return;
  if (truck.status === 'outbound') {
    const target = findFacility(w, job.targetId)!;
    if (job.kind === 'collect') {
      const farm = w.farms[job.targetId]!;
      const take = Math.min(job.amount, farm.outbox, t.truckCapacity);
      farm.outbox -= take;
      truck.load = take;
    } else {
      w.housing[job.targetId]!.foodMilli += truck.load * MILLI;
      truck.load = 0;
    }
    truck.status = 'returning';
    truck.path = pathTo(target.x, target.y, home.x, home.y);
    truck.cellsDone = 0;
    truck.legFrom = step;
    return;
  }
  wh.stockMilli += truck.load * MILLI;
  truck.load = 0;
  truck.status = 'idle';
  truck.job = null;
  truck.path = [];
  truck.cellsDone = 0;
}

/** Phase 6: every warehouse's trucks move, wrecked or not (a truck on the road finishes its trip), and its stock spoils. */
export function runWarehouses(ctx: SimContext, step: number): void {
  const w = ctx.world;
  const spoilage = ctx.scenario.tuning.warehouse.spoilagePctPerDay;
  const spd = stepsPerDay(ctx.scenario.time);
  for (const f of w.facilities) {
    const wh = w.warehouses[f.id];
    if (!wh) continue;
    for (const truck of wh.trucks) moveTruck(ctx, f, wh, truck, step);
    wh.stockMilli -= idiv(wh.stockMilli * spoilage, 100 * spd);
  }
}

/**
 * What a warehouse board's sensors read: its stock in whole units; every farm with its outbox and distance from the warehouse;
 * every housing block with its food, residents, and distance; and its trucks, with where they are, what they carry, and where
 * they are bound (nil when idle).
 */
export function warehouseReading(ctx: SimContext, warehouseId: string, sensor: 'stock' | 'farms' | 'housing' | 'trucks'): SensorValue {
  const w = ctx.world;
  const home = findFacility(w, warehouseId);
  const wh = w.warehouses[warehouseId];
  if (!home || !wh) return undefined;
  switch (sensor) {
    case 'stock':
      return idiv(wh.stockMilli, MILLI);
    case 'farms':
      return w.facilities
        .filter((f) => f.kind === 'farm')
        .map((f) => ({ id: f.id, outbox: w.farms[f.id]?.outbox ?? 0, distance: manhattan(home.x, home.y, f.x, f.y) }));
    case 'housing':
      return w.facilities
        .filter((f) => f.kind === 'housing')
        .map((f) => ({
          id: f.id,
          food: idiv(w.housing[f.id]?.foodMilli ?? 0, MILLI),
          residents: ctx.scenario.tuning.housing.residents,
          distance: manhattan(home.x, home.y, f.x, f.y),
        }));
    case 'trucks':
      return wh.trucks.map((t) => ({ id: t.id, status: t.status, x: t.x, y: t.y, load: t.load, target: t.job?.targetId }));
  }
}
```

- [ ] **Step 4: Dispatch from the hand and from firmware**

In `packages/core/src/actions.ts`, import `dispatch` from `./warehouse.ts`. The `dispatch` case of `applyFacilityAction`, which did nothing since Task 4, becomes:

```ts
    case 'dispatch':
      if (facility.kind === 'warehouse') dispatch(ctx, facility.id, action, step);
      break;
```

In `packages/core/src/session.ts`, import `dispatchProblem` and `runWarehouses` from `./warehouse.ts`. In `Session.hand`, beside Task 7's harvest check, add the dispatch's:

```ts
    if (action.kind === 'dispatch') {
      const problem = dispatchProblem(this.ctx, facilityId, action);
      if (problem !== null) {
        return { ok: false, reason: `${facilityId}: ${problem}`, refusal: { code: 'cannotAct', facility: facilityId, detail: problem } };
      }
    }
```

In `Session.step()`, run the warehouses in phase 6, after the farms:

```ts
    runFarms(this.ctx, s);
    runWarehouses(this.ctx, s);
```

Add to `packages/core/src/index.ts`:

```ts
export * from './warehouse.ts';
```

- [ ] **Step 5: Give a warehouse board its readings**

In `packages/core/src/sensors.ts`, import `warehouseReading` from `./warehouse.ts`. Replace the four warehouse cases that Task 7 left `undefined` with:

```ts
    case 'stock':
    case 'farms':
    case 'housing':
    case 'trucks':
      return warehouseReading(ctx, board.id, sensor);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core`
Expected: PASS: warehouse, 9 tests, and every other core test.

- [ ] **Step 7: Check and commit**

```bash
pnpm fix
pnpm check
git add packages/core
git commit -m "The warehouse: trucks collect from farms and deliver to housing by hand or by firmware, pay fuel, and stock spoils"
```

`pnpm check` must pass: typecheck, lint, and every test.

---

### Task 9: Housing: food, power, tax, hunger

> **Corrections from assembling the plan (read first).**
> - Task 2 already put housing's power inline in `facilityDemand`, and started each block's food at `tuning.housing.startFood` in `createWorld`. This task moves the power into `housingDraw` and keeps the start food.


10-09 spec §5.6 and §5.10, with no board and no hand controls (10-10 spec §4.3).

**Housing as a consumer.**
- Each block houses `residents` people. Each eats `foodPerPersonPerDay` a day from the block's food, which the warehouse's trucks bring.
- Every block draws `housing.power` from the grid, with transmission loss: people live there whatever anyone runs.
- Only residents who are fed and powered pay `taxPerPersonPerDay`.
- A block that runs out of food goes hungry and raises one hunger alert, until it is fed again.

**Population counts** (fed, hungry, without power) go to the views in Task 10.

**A new tuning value.** `housing.startFood` gives each block its first food: 120, three days for 40 people. A town whose crops ripen only on day 3 would otherwise start out starving, with a hunger alert on its first step.

**Starting point.** This task assumes:
- **Task 2:** `world.housing[id]` exists, `facility.powered` comes from the power phase, and `facilityDemand` charges housing `tuning.housing.power` (contract §7).
- **Task 8:** trucks deliver into a block's `foodMilli`.

**Files:**
- Create: `packages/core/src/housing.ts`
- Modify: `packages/core/src/scenario.ts` (`housing.startFood`), `scenarios/m2-town.json`, `scenarios/m1-power.json`, `packages/core/src/world.ts` (`createWorld`), `packages/core/src/power.ts` (`facilityDemand`), `packages/core/src/session.ts` (`step`), `packages/core/src/index.ts`
- Test: `packages/core/test/housing.test.ts`

**Interfaces:**
- Consumes:
  - **Task 1:** `tuning.housing` (`residents`, `foodPerPersonPerDay`, `power`, `taxPerPersonPerDay`), the `hunger` alert kind, and `m2Scenario`.
  - **Task 2:** `world.housing`, `world.facilities`, `findFacility`, `facilityDemand`, and `plantFacility`.
  - **Task 8:** `dispatch` and `runWarehouses`.
  - **Milestone 1:** `raiseOnce`, `clearFlag`, and `stepsPerDay`.
- Produces:
  - `tuning.housing.startFood` (whole units per block): a contract addition, 120 in both scenario files.
  - `mealMilli(ctx)`: the milli-food one block eats a step.
  - `taxMicro(ctx)`: the micro-units one fed, powered block pays a step.
  - `housingDraw(ctx, facility)`: `tuning.housing.power` for housing, 0 for any other kind, before transmission loss. `facilityDemand` calls it.
  - `runHousing(ctx, step)` (phase 6, after `runWarehouses`).
  - `PopulationCounts` and `populationCounts(ctx): { fed, hungry, unpowered }`. A hungry block counts as hungry, a fed block without power as unpowered, and the rest as fed. Task 10's status and snapshot read it.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/housing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { housingDraw, mealMilli, populationCounts, runHousing, taxMicro } from '../src/housing.ts';
import { facilityDemand } from '../src/power.ts';
import { Session } from '../src/session.ts';
import { dispatch, runWarehouses } from '../src/warehouse.ts';
import { findFacility } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m2Scenario } from './helpers/scenarios.ts';

/** The milestone-2 town on steady, free power, with no raid. */
function town(): Session {
  const s = new Session(
    m2Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.fuelPrice = { start: 0, min: 0, max: 0 };
      j.tuning.emf.rumourThreshold = 1_000_000_000;
    }),
    1,
    new FakeHost(),
  );
  s.world.plant.thermalSetting = 300;
  return s;
}

const hungerAlerts = (s: Session) => s.world.alerts.filter((a) => a.kind === 'hunger');

describe('housing', () => {
  it('starts every block with the tuned food', () => {
    const s = town();
    expect(s.world.housing).toEqual({ H1: { foodMilli: 120_000, fed: true }, H2: { foodMilli: 120_000, fed: true } });
  });

  it("eats its residents' food a day, split over the steps", () => {
    const s = town();
    expect(mealMilli(s.ctx)).toBe(50); // 40 people x 1 a day, over 800 steps
    runHousing(s.ctx, 0);
    expect(s.world.housing.H1).toEqual({ foodMilli: 119_950, fed: true });
  });

  it('runs out after its food lasts, and goes hungry: 120 food feed 40 people for 3 days', () => {
    const s = town();
    const h1 = s.world.housing.H1!;
    let step = 0;
    while (h1.fed) runHousing(s.ctx, step++);
    expect(step).toBe(2_401); // fed through step 2,399, three days of 800 steps; hungry at step 2,400
    expect(h1.foodMilli).toBe(0);
  });

  it('pays tax for a block that is fed and powered, and none for one hungry or without power', () => {
    const s = town();
    expect(taxMicro(s.ctx)).toBe(250_000); // 40 people x 5 a day, over 800 steps
    runHousing(s.ctx, 0);
    expect(s.world.ledger.tax).toBe(2 * 250_000); // both blocks
    findFacility(s.world, 'H2')!.powered = false;
    runHousing(s.ctx, 1);
    expect(s.world.ledger.tax).toBe(3 * 250_000); // H1 only
    s.world.housing.H1!.foodMilli = 0;
    runHousing(s.ctx, 2);
    expect(s.world.ledger.tax).toBe(3 * 250_000); // H1 hungry, H2 without power
  });

  it('raises one hunger alert when a block goes hungry, and another only after it was fed again', () => {
    const s = town();
    s.world.housing.H1!.foodMilli = 0;
    for (let step = 0; step < 5; step++) runHousing(s.ctx, step);
    expect(hungerAlerts(s).map((a) => [a.facilityId, a.step, a.message])).toEqual([['H1', 0, 'H1 주민이 굶고 있어요']]);
    s.world.housing.H1!.foodMilli = 1_000;
    runHousing(s.ctx, 5);
    s.world.housing.H1!.foodMilli = 0;
    runHousing(s.ctx, 6);
    expect(hungerAlerts(s).map((a) => a.step)).toEqual([0, 6]);
  });

  it('draws its power from the grid with transmission loss, and goes without when the grid cuts it', () => {
    const s = town();
    const h1 = findFacility(s.world, 'H1')!;
    const h2 = findFacility(s.world, 'H2')!;
    expect(housingDraw(s.ctx, h1)).toBe(70);
    expect(housingDraw(s.ctx, findFacility(s.world, 'DA')!)).toBe(0);
    expect(facilityDemand(s.ctx, h1, 0)).toBe(77); // 5 cells from the plant: + 10%
    expect(facilityDemand(s.ctx, h2, 0)).toBe(92); // 16 cells: + 32%
    s.world.plant.thermalSetting = 0;
    s.world.plant.wind = 100; // 100 made against 77 + 92 asked: H2, the later of the two in the default order, is cut
    s.step();
    expect([h1.powered, h2.powered]).toEqual([true, false]);
    expect(populationCounts(s.ctx)).toEqual({ fed: 40, hungry: 0, unpowered: 40 });
  });

  it('counts residents as fed, hungry, or without power', () => {
    const s = town();
    runHousing(s.ctx, 0);
    expect(populationCounts(s.ctx)).toEqual({ fed: 80, hungry: 0, unpowered: 0 });
    s.world.housing.H1!.foodMilli = 0;
    findFacility(s.world, 'H2')!.powered = false;
    runHousing(s.ctx, 1);
    expect(populationCounts(s.ctx)).toEqual({ fed: 0, hungry: 40, unpowered: 40 });
  });

  it('feeds a hungry block again when a truck delivers', () => {
    const s = town();
    const h1 = s.world.housing.H1!;
    h1.foodMilli = 0;
    runHousing(s.ctx, 0);
    expect(h1.fed).toBe(false);
    s.world.warehouses.W!.stockMilli = 30_000;
    dispatch(s.ctx, 'W', { kind: 'dispatch', truck: 1, from: 'W', to: 'H1', amount: 30 }, 1);
    for (let step = 1; step <= 141; step++) runWarehouses(s.ctx, step); // W to H1 is 14 cells: there on step 141
    runHousing(s.ctx, 142);
    expect(h1).toEqual({ foodMilli: 30_000 - 50, fed: true });
    expect(hungerAlerts(s)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/test/housing.test.ts`
Expected: FAIL: `../src/housing.ts` does not exist.

- [ ] **Step 3: Give each block its first food**

In `packages/core/src/scenario.ts`, the housing tuning gains `startFood`:

```ts
  housing: z.object({
    residents: int(0),
    foodPerPersonPerDay: int(0),
    power: int(0),
    taxPerPersonPerDay: int(0),
    /** Whole food units each block starts the season with, so a town whose crops ripen later does not start out hungry. */
    startFood: int(0),
  }),
```

In `scenarios/m2-town.json` and `scenarios/m1-power.json`, the housing tuning becomes:

```json
"housing": { "residents": 40, "foodPerPersonPerDay": 1, "power": 70, "taxPerPersonPerDay": 5, "startFood": 120 },
```

In `packages/core/src/world.ts`, `createWorld` starts each block with that food. Import `MILLI` from `./fixed.ts` if `world.ts` does not already, and replace the line that makes a block's state with:

```ts
    housing[f.id] = { foodMilli: t.housing.startFood * MILLI, fed: true };
```

Task 2's and Task 1's tests that pin a block's starting state or the housing tuning change with it. A block now starts with `foodMilli: 120_000`, and `tuning.housing` has `startFood: 120`.

- [ ] **Step 4: Write the housing module**

`packages/core/src/housing.ts`:

```ts
import { clearFlag, raiseOnce } from './alerts.ts';
import { MICRO, MILLI, mulDiv } from './fixed.ts';
import { stepsPerDay } from './time.ts';
import type { FacilityState, SimContext } from './world.ts';

/** The milli-food a housing block's residents eat each step. */
export function mealMilli(ctx: SimContext): number {
  const h = ctx.scenario.tuning.housing;
  return mulDiv(h.residents * h.foodPerPersonPerDay, MILLI, stepsPerDay(ctx.scenario.time));
}

/** The micro-units of tax a fed and powered block pays each step. */
export function taxMicro(ctx: SimContext): number {
  const h = ctx.scenario.tuning.housing;
  return mulDiv(h.residents * h.taxPerPersonPerDay, MICRO, stepsPerDay(ctx.scenario.time));
}

/**
 * What a housing block requests from the grid before transmission loss: people live there, so it uses power whatever anyone runs.
 * Any other kind of facility: nothing.
 */
export function housingDraw(ctx: SimContext, facility: FacilityState): number {
  return facility.kind === 'housing' ? ctx.scenario.tuning.housing.power : 0;
}

/**
 * Phase 6: every block eats its meal from its food. A block that cannot is hungry, and what food it had is gone. Fed and powered
 * residents pay tax. A block that turns hungry raises one hunger alert, until it is fed again.
 */
export function runHousing(ctx: SimContext, step: number): void {
  const w = ctx.world;
  const meal = mealMilli(ctx);
  const tax = taxMicro(ctx);
  for (const f of w.facilities) {
    const home = w.housing[f.id];
    if (!home) continue;
    if (home.foodMilli >= meal) {
      home.foodMilli -= meal;
      home.fed = true;
    } else {
      home.foodMilli = 0;
      home.fed = false;
    }
    if (home.fed && f.powered) {
      w.money += tax;
      w.ledger.tax += tax;
    }
    if (home.fed) clearFlag(w, `hunger:${f.id}`);
    else raiseOnce(w, `hunger:${f.id}`, step, 'hunger', f.id, `${f.id} 주민이 굶고 있어요`);
  }
}

export interface PopulationCounts {
  readonly fed: number;
  readonly hungry: number;
  readonly unpowered: number;
}

/** Residents by how they stood at the last step: fed and powered, hungry, or fed but without power. */
export function populationCounts(ctx: SimContext): PopulationCounts {
  const residents = ctx.scenario.tuning.housing.residents;
  let fed = 0;
  let hungry = 0;
  let unpowered = 0;
  for (const f of ctx.world.facilities) {
    const home = ctx.world.housing[f.id];
    if (!home) continue;
    if (!home.fed) hungry += residents;
    else if (!f.powered) unpowered += residents;
    else fed += residents;
  }
  return { fed, hungry, unpowered };
}
```

- [ ] **Step 5: Ask housing for its draw, and run it each step**

In `packages/core/src/power.ts`, import `housingDraw` from `./housing.ts`. In `facilityDemand`, replace the housing line, `if (facility.kind === 'housing') base += t.housing.power;`, with:

```ts
  base += housingDraw(ctx, facility);
```

In `packages/core/src/session.ts`, import `runHousing` from `./housing.ts`, and run it in phase 6, after the warehouses:

```ts
    runWarehouses(this.ctx, s);
    runHousing(this.ctx, s);
```

Add to `packages/core/src/index.ts`:

```ts
export * from './housing.ts';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core`
Expected: PASS: housing, 8 tests, and every other core test.

- [ ] **Step 7: Check and commit**

```bash
pnpm fix
pnpm check
git add packages/core scenarios
git commit -m "Housing: blocks eat, go hungry, draw power, and pay tax when fed and powered; each starts with three days of food"
```

`pnpm check` must pass: typecheck, lint, and every test.

---

### Task 10: Views and the snapshot for the whole town

Spec 10-10 §8 and §10.3, 10-09 §7.3, contract §13. The views read the whole town: every facility with its tier and its condition, the food and the residents, the trucks, and what the player pays.
- **For agents:**
  - `list_boards` lists every facility that takes a board, with its tier (0: no board; 1: a board; 2: a board with a comm module), whether it stands, and its board if it has one.
  - `get_map` shows every facility.
  - `get_status` adds the food in the warehouse and in the housing, and the residents who are fed, hungry, or without power.
- **For the viewer:**
  - The snapshot carries every facility with its own readings (`FacilityView`), the trucks, the town's food and people, the prices of boards, comm modules, repairs, and rebuilds, and the thermal maximum for the plant's slider.
  - The panel's inspection no longer carries milestone 1's datasheet. It carries the board's parts and base EMF, and its sensors as its firmware reads them.
- **Moved to Task 11:** the agent tools' tier-2 descriptions, and `get_datasheet` returning the manual. Both need the manual, which Task 11 writes, so Task 11 takes them, and removes `datasheet.ts`.

**Rules the contract leaves open, fixed here:**
- A facility that is wrecked or being repaired shows no power. It requests nothing, so the grid's flag says nothing about it. A destroyed or rebuilding board shows none either, as in milestone 1.
- A board's base EMF in the inspection includes its comm module's.
- `repairHoursLeft` rounds up, so that a repair with time left never reads 0 hours.
- `prices.repairHours` and `prices.rebuildHours` round down, as milestone 1's rebuild hours did and as `pnpm shots` computes its labels.
- `town.food` is the warehouse's food, the top bar's figure in 10-09 §8.2. `StatusView.food` gives the warehouse and the housing apart.

**Keeping the rest compiling.** The snapshot's `boards` becomes `facilities`, and its `rebuild` becomes `prices`. The board summary moves its board's fields under `board`. This task patches what reads them:
- the server's controller tests and its end-to-end test;
- the status fixtures of two test files;
- the viewer's map, panel, and format helpers, in interim versions. Task 17 replaces them, and Tasks 18 and 19 bring the real map and panel.

**Files:**
- Modify: `packages/core/src/queries.ts` (whole file)
- Test: `packages/core/test/queries.test.ts` (whole file)
- Modify, for the new shapes:
  - `packages/core/test/agent-tools.test.ts` (`STATUS`);
  - `packages/server/test/mcp.test.ts` (the fake status);
  - `packages/server/test/game-controller.test.ts` (reads of board summaries, of the snapshot, and of the inspection);
  - `packages/server/test/game-server.test.ts` (one read of the snapshot);
  - `packages/viewer/src/format.ts` (`ledOf` and `consumersOf`);
  - `packages/viewer/src/ui/panel.ts` and `packages/viewer/src/map/map-scene.ts` (whole files, interim);
  - `packages/viewer/test/format.test.ts` (the fixture and two tests).

**Interfaces:**
- Consumes:
  - **Task 1:** `Scenario`, `FacilityKind`, `BoardKind`, and `takesBoard`; the tuning's `install`, `repair`, `rebuild`, and `thermal.max`; `m2Scenario`.
  - **Task 2:**
    - `FacilityState` (`condition`, `repairReadyAt`, `powered`), `FacilityCondition`, `findFacility`, and `plantFacility`;
    - `BoardState.comm`;
    - `facilityDemand(ctx, facility, step)`, and `priorityOrder(world)` returning facilities;
    - `Session.install`.
  - **Task 3:** `Session.repair`, `wreckFacility`, and `EndKind`.
  - **Task 4:** `SensorValue`.
  - **Task 5:** `isProcessing` and `isCooling` (`datacenter.ts`), and the datacenter's busy and cool windows.
  - **Task 6:** `pathTo`, and Luddite targets that name facilities.
  - **Task 7:** `ripeness` and `isRipe` (`farm.ts`), and `sensorFrame` with structured values.
  - **Task 8:** `WarehouseState`, `TruckState`, `TruckStatus`, and the warehouse's readings.
  - **Task 9:** `HousingState`, `populationCounts`, and `PopulationCounts` (`housing.ts`).
- Produces (contract §13):
  - **For agents:**
    - `BoardSummary` and `listBoards(world)`: every facility that takes a board, in scenario order;
    - `MapView` and `mapView(ctx)`: every facility;
    - `StatusView` with `food` and `population`, and `statusView(ctx)`.
  - **For the viewer:**
    - `FacilityView`;
    - `Snapshot` with `prices`, `plant.thermalMax`, `facilities`, `trucks`, and `town`, and `snapshot(ctx)`;
    - `BoardInspection` with `parts` and `baseEmfPerSecond`, and `inspectBoard(ctx, id)`, null for a facility with no board.
  - **Unchanged:** `TimeView`, `timeView`, `FirmwareView`, `firmwareView`, `LogView`, `logsView`, `AlertView`, `alertView`, and `alertsView`.
  - **The viewer's interim helpers:** `ledOf(facility): Led | null` (null without a board) and `consumersOf` over facilities, with the signatures Task 17 keeps.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/queries.test.ts` (whole file):

```ts
import { describe, expect, it } from 'vitest';
import { wreckFacility } from '../src/boards.ts';
import { alertsView, firmwareView, inspectBoard, listBoards, logsView, mapView, snapshot, statusView, timeView } from '../src/queries.ts';
import { sensorFrame } from '../src/sensors.ts';
import { Session } from '../src/session.ts';
import { findBoard, findFacility } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario, m2Scenario } from './helpers/scenarios.ts';

/** Milestone 1's town, P, DA, and DB with their boards installed, on steady wind and with no raid. */
function session(change?: NonNullable<Parameters<typeof m1Scenario>[0]>): { s: Session; host: FakeHost } {
  const host = new FakeHost();
  host.program('hello', () => ({ logs: ['hello'] }));
  const s = new Session(
    m1Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.emf.rumourThreshold = 1_000_000_000;
      change?.(j);
    }),
    1,
    host,
  );
  return { s, host };
}

/** Wind 20 feeds the plant (5) and DA (10) but not DB (13 with its transmission loss), so DB is shed. */
const shortOfPower = () =>
  session((j) => {
    j.tuning.wind.start = 20;
  });

/** The whole town with no board installed, on steady wind and free fuel, with no raid. Its crops ripen in a second. */
function town(change?: NonNullable<Parameters<typeof m2Scenario>[0]>): Session {
  return new Session(
    m2Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.fuelPrice = { start: 0, min: 0, max: 0 };
      j.tuning.emf.rumourThreshold = 1_000_000_000;
      j.tuning.farm.ripenSeconds = 1;
      change?.(j);
    }),
    1,
    new FakeHost(),
  );
}

/** Luddites reach a facility now. */
const wreck = (s: Session, id: string): void => wreckFacility(s.ctx, findFacility(s.world, id)!, s.world.step, 'luddites');

describe('views', () => {
  it('formats game time', () => {
    const { s } = session();
    expect(timeView(s.scenario, 0)).toEqual({ day: 1, clock: '00:00', seconds: 0 });
    expect(timeView(s.scenario, 800 + 400)).toEqual({ day: 2, clock: '12:00', seconds: 60 });
  });

  it('lists boards with their firmware state', () => {
    const { s } = session();
    s.deploy('DA', 'hello');
    expect(listBoards(s.world)[1]).toMatchObject({
      id: 'DA',
      kind: 'datacenter',
      tier: 1,
      board: { firmwareVersion: null, pendingVersion: 1 },
    });
    for (let i = 0; i < 4; i++) s.step();
    expect(listBoards(s.world)[1]).toMatchObject({ board: { firmwareVersion: 1, pendingVersion: null, status: 'running', lastError: null } });
  });

  it('reads logs with game time, and filters by time', () => {
    const { s } = session();
    s.deploy('DA', 'hello');
    for (let i = 0; i < 40; i++) s.step(); // beats at 3, 7, ..., 39
    const all = logsView(s.ctx, 'DA')!;
    expect(all.find((l) => l.text === 'firmware v1 installed')).toMatchObject({ kind: 'system', day: 1 });
    expect(all.at(-1)).toMatchObject({ kind: 'log', text: 'hello', repeat: 10 });
    expect(logsView(s.ctx, 'DA', 1.9)).toHaveLength(1);
    expect(logsView(s.ctx, 'ZZ')).toBeNull();
  });

  it('maps facilities with distances but no EMF or Luddites', () => {
    const { s } = session();
    const m = mapView(s.ctx);
    expect(m.facilities.map((f) => [f.id, f.distanceToPlant])).toEqual([
      ['P', 0],
      ['DA', 1],
      ['DB', 16],
    ]);
    expect(JSON.stringify(m)).not.toMatch(/emf|luddite/i);
  });

  it('reports status in whole money and filters alerts by time', () => {
    const { s } = session();
    s.step();
    const st = statusView(s.ctx);
    expect(st.money).toBe(4999);
    expect(st.power.generation).toBe(220);
    expect(alertsView(s.ctx).map((a) => a.kind)).toEqual([]);
    for (let i = 0; i < 40; i++) s.step(); // two seconds in
    s.world.datacenters.DA!.tempMilli = 88_000;
    s.step();
    expect(alertsView(s.ctx, 1).map((a) => a.kind)).toEqual(['overheat']);
    expect(alertsView(s.ctx, 3)).toEqual([]);
  });

  it("snapshots what the viewer draws, including a Luddite group's path", () => {
    const { s } = session();
    s.world.luddites.push({ id: 1, x: 10, y: 0, size: 3, targetId: 'DB', quietSince: null, leaving: false, warned: [] });
    const snap = snapshot(s.ctx);
    expect(snap.grid).toEqual({ width: 20, height: 12 });
    expect(snap.emf).toHaveLength(240);
    expect(snap.luddites[0]!.path.at(-1)).toEqual([16, 8]);
    expect(snap.facilities.map((f) => f.id)).toEqual(['P', 'DA', 'DB']);
    expect(snap.facilities[1]!.datacenter!.tempC).toBe(25);
  });

  it("inspects a board for the viewer's panel", () => {
    const { s } = session();
    s.deploy('DA', 'hello');
    for (let i = 0; i < 4; i++) s.step();
    const inspection = inspectBoard(s.ctx, 'DA')!;
    expect(inspection.firmware?.source).toBe('hello');
    expect(inspection.sensors.temp).toBe(25);
    expect(inspection.logs.length).toBeGreaterThan(0);
  });
});

// Hand-derived numbers: the m1 town has P (4, 4), DA (5, 4) and DB (16, 8), 20 steps a second and 800 steps a day. A board's
// beat is every `period` steps from its phase: P at steps 0, 5, 10, ...; DA at 3, 7, 11, ...; DB at 2, 6, 10, ...
describe('views in detail', () => {
  it('lists every board with its position, state, power, and latest error', () => {
    const { s, host } = shortOfPower();
    host.program('boom', () => ({ error: { kind: 'runtime', message: 'boom' } }));
    s.deploy('DA', 'boom');
    for (let i = 0; i < 4; i++) s.step();
    s.world.boards[0]!.status = 'asleep';
    const board = { pendingVersion: null };
    expect(listBoards(s.world)).toEqual([
      {
        id: 'P',
        kind: 'power',
        x: 4,
        y: 4,
        tier: 1,
        condition: 'ok',
        board: { ...board, status: 'asleep', powered: true, firmwareVersion: null, lastError: null },
      },
      {
        id: 'DA',
        kind: 'datacenter',
        x: 5,
        y: 4,
        tier: 1,
        condition: 'ok',
        board: { ...board, status: 'running', powered: true, firmwareVersion: 1, lastError: 'runtime: boom' },
      },
      {
        id: 'DB',
        kind: 'datacenter',
        x: 16,
        y: 8,
        tier: 1,
        condition: 'ok',
        board: { ...board, status: 'running', powered: false, firmwareVersion: null, lastError: null },
      },
    ]);
  });

  it('shows the installed firmware and the one waiting for the next tick', () => {
    const { s, host } = session();
    host.program('v2', () => ({}));
    expect(firmwareView(s.world, 'DA')).toEqual({ version: null, source: null, pending: null });
    s.deploy('DA', 'hello');
    expect(firmwareView(s.world, 'DA')).toEqual({ version: null, source: null, pending: { version: 1, source: 'hello' } });
    for (let i = 0; i < 4; i++) s.step();
    expect(firmwareView(s.world, 'DA')).toEqual({ version: 1, source: 'hello', pending: null });
    s.deploy('DA', 'v2');
    expect(firmwareView(s.world, 'DA')).toEqual({ version: 1, source: 'hello', pending: { version: 2, source: 'v2' } });
    expect(firmwareView(s.world, 'ZZ')).toBeNull();
  });

  it('stamps a log line with the game time of its latest occurrence, and keeps only the lines after "since"', () => {
    const { s } = session();
    s.deploy('P', 'hello');
    for (let i = 0; i < 21; i++) s.step(); // P beats at steps 0, 5, 10, 15, 20: the fifth "hello" is at second 1
    const lines = logsView(s.ctx, 'P')!;
    const installed = lines.find((l) => l.text === 'firmware v1 installed');
    const hello = lines.find((l) => l.text === 'hello')!;
    expect(installed).toEqual({ day: 1, clock: '00:00', seconds: 0, kind: 'system', text: 'firmware v1 installed', repeat: 1 });
    expect(hello).toEqual({ day: 1, clock: '00:36', seconds: 1, kind: 'log', text: 'hello', repeat: 5 });
    expect(logsView(s.ctx, 'P', 0)).toEqual([hello]); // "after" is exclusive: the lines at second 0 are out
    expect(logsView(s.ctx, 'P', 0.95)).toEqual([hello]);
    expect(logsView(s.ctx, 'P', 1)).toEqual([]);
  });

  // The power phase skips a board that draws nothing, so its flag keeps the value it had: a smashed board stays "powered".
  it('reports a destroyed or a rebuilding board as unpowered, and a running or sleeping one by the grid', () => {
    const { s } = session();
    s.step(); // the grid covers everyone
    const [p, da, db] = s.world.boards;
    for (const board of [p!, da!, db!]) expect(board.powered).toBe(true);
    da!.status = 'destroyed';
    db!.status = 'rebuilding';
    p!.status = 'asleep';
    const seen = () => [
      listBoards(s.world).map((b) => [b.id, b.board?.status, b.board?.powered]),
      snapshot(s.ctx).facilities.map((f) => [f.id, f.board?.status, f.board?.powered]),
    ];
    for (const view of seen()) {
      expect(view).toEqual([
        ['P', 'asleep', true],
        ['DA', 'destroyed', false],
        ['DB', 'rebuilding', false],
      ]);
    }
    // The map shows the facilities, which stand and have the grid's power whatever their boards do.
    expect(mapView(s.ctx).facilities.map((f) => [f.id, f.powered])).toEqual([
      ['P', true],
      ['DA', true],
      ['DB', true],
    ]);
    // A board that is working and shed is unpowered as before, and powered again with the grid.
    da!.status = 'running';
    da!.powered = false;
    expect(listBoards(s.world)[1]!.board!.powered).toBe(false);
    da!.powered = true;
    expect(listBoards(s.world)[1]!.board!.powered).toBe(true);
  });

  it('reports the time, the season length, the power, the food, the residents, and how the season ended', () => {
    const { s } = shortOfPower();
    for (let i = 0; i < 20; i++) s.step();
    // Power: 20 generated against 5 + 10 + 13 requested, so DB is shed. Money: 5000 less 20 steps of upkeep (37,500 micro-units each).
    // The m1 town has no warehouse and no housing.
    expect(statusView(s.ctx)).toEqual({
      time: { day: 1, clock: '00:36', seconds: 1 },
      seasonDays: 30,
      money: 4999,
      power: { generation: 20, demand: 28, shed: ['DB'] },
      food: { warehouse: 0, housing: 0 },
      population: { fed: 0, hungry: 0, unpowered: 0 },
      ended: null,
    });
    // The end is told in game time, as the time is: a step means nothing to an agent (1,400 of them were read as 70 seconds).
    s.world.ended = { kind: 'bankrupt', step: 1_400 };
    expect(statusView(s.ctx).ended).toEqual({ kind: 'bankrupt', time: { day: 2, clock: '18:00', seconds: 70 } }); // a day is 800 steps
    s.world.ended = { kind: 'completed', step: 800 * 30 - 1 };
    expect(statusView(s.ctx).ended).toEqual({ kind: 'completed', time: { day: 30, clock: '23:58', seconds: 1199.95 } });
    // The viewer's snapshot keeps the step.
    expect(snapshot(s.ctx).ended).toEqual({ kind: 'completed', step: 800 * 30 - 1 });
  });

  it('lists an alert with its facility, message, and game time, and keeps only the alerts after "since"', () => {
    const { s } = session();
    for (let i = 0; i < 40; i++) s.step();
    s.world.datacenters.DA!.tempMilli = 88_000;
    s.step(); // the alert is raised at step 40, second 2
    const alerts = alertsView(s.ctx);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ id: 1, kind: 'overheat', facility: 'DA', day: 1, clock: '01:12', seconds: 2 });
    expect(alerts[0]!.message).toContain('DA');
    expect(alertsView(s.ctx, 1.95)).toEqual(alerts);
    expect(alertsView(s.ctx, 2)).toEqual([]); // "after" is exclusive
  });

  it('snapshots the plant and every facility of a busy town', () => {
    const { s, host } = session();
    host.program('plant', () => ({
      actions: [
        { kind: 'setThermal', output: 100 },
        { kind: 'setPriority', order: ['DB'] },
      ],
    }));
    host.program('busy', () => ({ actions: [{ kind: 'process' }] }));
    host.program('boom', () => ({ error: { kind: 'runtime', message: 'boom' } }));
    s.deploy('P', 'plant');
    s.deploy('DA', 'busy');
    s.deploy('DB', 'boom');
    for (let i = 0; i < 8; i++) s.step();
    s.world.datacenters.DA!.tempMilli = 61_999;
    const snap = snapshot(s.ctx);
    // Phase 3 of step 7: 220 wind + 100 thermal against P 5, DA 10 + 150 (the job its tick at step 3 started runs through
    // step 13) plus 2% of that for one cell (3), and DB 10 + 3. DA's tick at step 7 renewed the job, which covers step 8 too.
    expect(snap.plant).toEqual({
      wind: 220,
      thermal: 100,
      thermalMax: 300,
      fuelPrice: s.world.plant.fuelPrice,
      generation: 320,
      demand: 181,
      shed: [],
      priority: ['DB', 'DA'],
    });
    expect(snap.plant.fuelPrice).toBeGreaterThan(0);
    const running = { status: 'running', powered: true, hasFirmware: true, erroring: false };
    expect(snap.facilities.map((f) => [f.id, f.demand, f.board, f.datacenter])).toEqual([
      ['P', 5, running, null],
      ['DA', 163, running, { tempC: 61, processing: true, cooling: false }],
      ['DB', 13, { ...running, erroring: true }, { tempC: 25, processing: false, cooling: false }],
    ]);
    expect(snap.facilities[1]).toEqual({
      id: 'DA',
      kind: 'datacenter',
      x: 5,
      y: 4,
      tier: 1,
      condition: 'ok',
      repairHoursLeft: null,
      powered: true,
      demand: 163,
      board: running,
      datacenter: { tempC: 61, processing: true, cooling: false },
      farm: null,
      warehouse: null,
      housing: null,
    });
    // A cooling cycle that covers this step: the datacenter shows it, and draws its 400 on top: 560, and 2% of that (11).
    s.world.datacenters.DA!.coolFrom = 8;
    s.world.datacenters.DA!.coolUntil = 88;
    expect(snapshot(s.ctx).facilities[1]).toMatchObject({ demand: 571, datacenter: { processing: true, cooling: true } });
    expect(snap.trucks).toEqual([]);
    expect(snap.town).toEqual({ food: 0, population: { fed: 0, hungry: 0, unpowered: 0 } });
  });

  it('snapshots which facilities the plant sheds, the state and power of every facility and board, and whole money rounded down', () => {
    const { s } = shortOfPower();
    s.step();
    wreck(s, 'DA');
    s.world.money = 4_999_999_999; // 4999.999999 money units
    const snap = snapshot(s.ctx);
    expect(snap.plant).toMatchObject({ wind: 20, thermal: 0, generation: 20, demand: 28, shed: ['DB'] });
    // A wrecked facility shows no power, whatever the grid's flag says, and its board is destroyed with it.
    expect(snap.facilities.map((f) => [f.id, f.condition, f.powered, f.board?.status, f.board?.powered])).toEqual([
      ['P', 'ok', true, 'running', true],
      ['DA', 'wrecked', false, 'destroyed', false],
      ['DB', 'ok', false, 'running', false],
    ]);
    expect(snap.money).toBe(4999);
  });

  it('snapshots the step, the money, the season, the EMF in whole units, and each Luddite group', () => {
    const { s } = session();
    for (let i = 0; i < 20; i++) s.step();
    s.world.luddites.push(
      { id: 1, x: 10, y: 0, size: 3, targetId: 'DB', quietSince: null, leaving: false, warned: [] },
      { id: 2, x: 0, y: 5, size: 4, targetId: null, quietSince: 100, leaving: true, warned: [] },
    );
    s.world.emf[0] = 7_000;
    s.world.emf[23] = 2_999; // (3, 1)
    s.world.emf[24] = 3_000; // (4, 1)
    s.world.ended = { kind: 'completed', step: 19 };
    const snap = snapshot(s.ctx);
    expect(snap).toMatchObject({
      step: 20,
      time: { day: 1, clock: '00:36', seconds: 1 },
      seasonDays: 30,
      money: 4999,
      ended: { kind: 'completed', step: 19 },
      grid: { width: 20, height: 12 },
    });
    expect([snap.emf[0], snap.emf[23], snap.emf[24]]).toEqual([7, 2, 3]);
    expect(snap.luddites).toEqual([
      {
        id: 1,
        x: 10,
        y: 0,
        size: 3,
        targetId: 'DB',
        leaving: false,
        path: [...[11, 12, 13, 14, 15, 16].map((x) => [x, 0]), ...[1, 2, 3, 4, 5, 6, 7, 8].map((y) => [16, y])],
      },
      { id: 2, x: 0, y: 5, size: 4, targetId: null, leaving: true, path: [] },
    ]);
  });

  it('tells the viewer the prices of boards, comm modules, repairs, and rebuilds, and the game hours a repair and a rebuild take, rounded down', () => {
    expect(snapshot(session().s.ctx).prices).toEqual({
      board: { farm: 200, warehouse: 400, power: 400, datacenter: 600 },
      comm: 300,
      repair: { farm: 150, warehouse: 300, power: 300, datacenter: 500 },
      repairHours: 12,
      rebuild: 500,
      rebuildHours: 12,
    });
    const { s } = session((j) => {
      j.time.secondsPerDay = 70;
      j.tuning.repair.seconds = 30;
      j.tuning.rebuild = { cost: 120, seconds: 20 };
    });
    // 30 s and 20 s of a 70 s day are 10.3 and 6.9 hours.
    expect(snapshot(s.ctx).prices).toMatchObject({ repairHours: 10, rebuild: 120, rebuildHours: 6 });
  });

  it('counts a firmware that waits for its first tick as the board having firmware', () => {
    const { s } = session();
    const has = () => snapshot(s.ctx).facilities.map((f) => f.board?.hasFirmware);
    expect(has()).toEqual([false, false, false]);
    s.deploy('DA', 'hello');
    expect(has()).toEqual([false, true, false]);
    for (let i = 0; i < 4; i++) s.step();
    expect(has()).toEqual([false, true, false]);
  });

  it("shows the viewer's panel the board's parts, its waiting firmware, its last 50 log lines, and its readings", () => {
    const { s, host } = session();
    host.program('count', (_sensors, mem) => {
      mem.n = ((mem.n as number | undefined) ?? 0) + 1;
      return { logs: [`line ${mem.n}`] };
    });
    // No tick yet, so no RAM reading.
    expect(inspectBoard(s.ctx, 'DA')!.parts).toEqual({ clockHz: 5, instructionsPerTick: 2000, ramBytes: 8192, ramUsedBytes: null });
    s.deploy('DA', 'count');
    for (let i = 0; i < 240; i++) s.step(); // DA beats at 3, 7, ..., 239: the install line, then sixty log lines
    s.deploy('DA', 'hello');
    const panel = inspectBoard(s.ctx, 'DA')!;
    expect(panel.parts).toEqual({ clockHz: 5, instructionsPerTick: 2000, ramBytes: 8192, ramUsedBytes: 0 });
    expect(panel.baseEmfPerSecond).toBe(25);
    expect(panel.firmware).toEqual({ version: 1, source: 'count' });
    expect(panel.pending).toEqual({ version: 2, source: 'hello' });
    expect(panel.logs).toHaveLength(50);
    expect(panel.logs[0]!.text).toBe('line 11');
    expect(panel.logs.at(-1)!.text).toBe('line 60');
    expect(panel.sensors).toEqual(sensorFrame(s.ctx, findBoard(s.world, 'DA')!));
    expect(inspectBoard(s.ctx, 'ZZ')).toBeNull();
  });
});

// The whole town: H1 (2, 1), H2 (17, 1), P (4, 4), DA (5, 4), W (11, 6), DB (16, 8), F1 (2, 9), F2 (3, 9), F3 (4, 9).
describe('views of the whole town', () => {
  it('lists every facility that takes a board, with its tier, its condition, and its board when it has one', () => {
    const s = town();
    expect(s.install('DA', 'board')).toEqual({ ok: true });
    expect(s.install('DA', 'comm')).toEqual({ ok: true });
    expect(s.install('F1', 'board')).toEqual({ ok: true });
    const running = { status: 'running', powered: true, firmwareVersion: null, pendingVersion: null, lastError: null };
    const bare = (id: string, kind: string, x: number, y: number) => ({ id, kind, x, y, tier: 0, condition: 'ok', board: null });
    expect(listBoards(s.world)).toEqual([
      bare('P', 'power', 4, 4),
      { id: 'DA', kind: 'datacenter', x: 5, y: 4, tier: 2, condition: 'ok', board: running },
      bare('W', 'warehouse', 11, 6),
      bare('DB', 'datacenter', 16, 8),
      { id: 'F1', kind: 'farm', x: 2, y: 9, tier: 1, condition: 'ok', board: running },
      bare('F2', 'farm', 3, 9),
      bare('F3', 'farm', 4, 9),
    ]);
    // Luddites wreck F1, board and all: the farm no longer stands, and its board is down, at the tier it had.
    wreck(s, 'F1');
    expect(listBoards(s.world)[4]).toEqual({
      id: 'F1',
      kind: 'farm',
      x: 2,
      y: 9,
      tier: 1,
      condition: 'wrecked',
      board: { ...running, status: 'destroyed', powered: false },
    });
  });

  it('maps every facility of the town with its tier, its condition, its power, and its distance to the plant', () => {
    const s = town();
    s.install('DA', 'board');
    s.install('DA', 'comm');
    s.install('W', 'board');
    wreck(s, 'DB');
    const at = (id: string, kind: string, x: number, y: number, distanceToPlant: number, more = {}) => ({
      id,
      kind,
      x,
      y,
      tier: 0,
      condition: 'ok',
      powered: true,
      distanceToPlant,
      ...more,
    });
    expect(mapView(s.ctx)).toEqual({
      width: 20,
      height: 12,
      facilities: [
        at('H1', 'housing', 2, 1, 5),
        at('H2', 'housing', 17, 1, 16),
        at('P', 'power', 4, 4, 0),
        at('DA', 'datacenter', 5, 4, 1, { tier: 2 }),
        at('W', 'warehouse', 11, 6, 9, { tier: 1 }),
        at('DB', 'datacenter', 16, 8, 16, { condition: 'wrecked', powered: false }),
        at('F1', 'farm', 2, 9, 7),
        at('F2', 'farm', 3, 9, 6),
        at('F3', 'farm', 4, 9, 5),
      ],
    });
    expect(JSON.stringify(mapView(s.ctx))).not.toMatch(/emf|luddite/i);
  });

  it('reports the food in the warehouse and in the housing, in whole units, and the residents by how they stand', () => {
    const s = town();
    s.world.warehouses.W!.stockMilli = 12_999;
    s.world.housing.H1!.foodMilli = 100_500;
    s.world.housing.H2!.foodMilli = 0;
    s.world.housing.H2!.fed = false;
    expect(statusView(s.ctx)).toMatchObject({
      food: { warehouse: 12, housing: 100 },
      population: { fed: 40, hungry: 40, unpowered: 0 },
    });
    // Residents who eat but have no power count apart: they pay no tax.
    findFacility(s.world, 'H1')!.powered = false;
    expect(statusView(s.ctx).population).toEqual({ fed: 0, hungry: 40, unpowered: 40 });
  });

  it("snapshots each kind of facility with its own readings, the trucks, and the town's food and people", () => {
    const s = town();
    s.install('DA', 'board');
    for (let i = 0; i < 20; i++) s.step(); // a second: the crops planted at step 0 are ripe
    const w = s.world;
    w.datacenters.DA = { tempMilli: 61_999, busyFrom: 20, busyUntil: 30, coolFrom: 20, coolUntil: 100 };
    w.farms.F2!.plantedAt = 10; // half ripe
    w.farms.F3!.outbox = 33;
    w.warehouses.W!.stockMilli = 12_999;
    Object.assign(w.warehouses.W!.trucks[1]!, {
      status: 'outbound',
      job: { kind: 'deliver', targetId: 'H2', amount: 20 },
      x: 12,
      y: 6,
      load: 20,
    });
    w.housing.H1!.foodMilli = 100_500;
    w.housing.H2!.foodMilli = 0;
    w.housing.H2!.fed = false;
    const snap = snapshot(s.ctx);
    const view = (id: string) => snap.facilities.find((f) => f.id === id)!;
    expect(snap.facilities.map((f) => f.id)).toEqual(['H1', 'H2', 'P', 'DA', 'W', 'DB', 'F1', 'F2', 'F3']);
    const plain = { condition: 'ok', repairHoursLeft: null, powered: true, board: null, datacenter: null, farm: null, warehouse: null, housing: null };
    // DA processes and cools on top of its board: 10 + 150 + 250, and 2% of that for one cell (8).
    expect(view('DA')).toEqual({
      ...plain,
      id: 'DA',
      kind: 'datacenter',
      x: 5,
      y: 4,
      tier: 1,
      demand: 418,
      board: { status: 'running', powered: true, hasFirmware: false, erroring: false },
      datacenter: { tempC: 61, processing: true, cooling: true },
    });
    expect(view('DB')).toEqual({
      ...plain,
      id: 'DB',
      kind: 'datacenter',
      x: 16,
      y: 8,
      tier: 0,
      demand: 0,
      datacenter: { tempC: 25, processing: false, cooling: false },
    });
    expect(view('F1')).toEqual({ ...plain, id: 'F1', kind: 'farm', x: 2, y: 9, tier: 0, demand: 0, farm: { ripeness: 100, ripe: true, outbox: 0 } });
    expect(view('F2').farm).toEqual({ ripeness: 50, ripe: false, outbox: 0 });
    expect(view('F3').farm).toEqual({ ripeness: 100, ripe: true, outbox: 33 });
    expect(view('W')).toEqual({ ...plain, id: 'W', kind: 'warehouse', x: 11, y: 6, tier: 0, demand: 0, warehouse: { stock: 12 } });
    // A housing block draws 70, plus 2% for each cell from the plant: 5 cells for H1, 16 for H2.
    expect(view('H1')).toEqual({
      ...plain,
      id: 'H1',
      kind: 'housing',
      x: 2,
      y: 1,
      tier: 0,
      demand: 77,
      housing: { food: 100, residents: 40, fed: true },
    });
    expect(view('H2')).toMatchObject({ demand: 92, housing: { food: 0, residents: 40, fed: false } });
    expect(view('P')).toEqual({ ...plain, id: 'P', kind: 'power', x: 4, y: 4, tier: 0, demand: 0 });
    expect(snap.trucks).toEqual([
      { warehouse: 'W', id: 1, x: 11, y: 6, status: 'idle', load: 0, targetId: null },
      { warehouse: 'W', id: 2, x: 12, y: 6, status: 'outbound', load: 20, targetId: 'H2' },
    ]);
    expect(snap.town).toEqual({ food: 12, population: { fed: 40, hungry: 40, unpowered: 0 } });
    expect(snap.plant).toMatchObject({ thermalMax: 300, priority: ['H1', 'H2', 'DA', 'W', 'DB', 'F1', 'F2', 'F3'] });
  });

  it('counts the game hours a repair has left, rounded up, and shows a facility under repair, and its board, without power', () => {
    const s = town((j) => {
      j.time.secondsPerDay = 70;
    });
    s.install('F1', 'board');
    wreck(s, 'F1');
    const f1 = () => snapshot(s.ctx).facilities.find((f) => f.id === 'F1')!;
    expect(f1()).toMatchObject({
      condition: 'wrecked',
      repairHoursLeft: null,
      powered: false,
      demand: 0,
      board: { status: 'destroyed', powered: false },
    });
    expect(s.repair('F1')).toEqual({ ok: true });
    // 20 s of a 70 s day is 6.86 hours, which reads 7: a repair never reads 0 hours while it has time left.
    expect(f1()).toMatchObject({ condition: 'repairing', repairHoursLeft: 7, powered: false });
    for (let i = 0; i < 399; i++) s.step(); // one step left
    expect(f1().repairHoursLeft).toBe(1);
    for (let i = 0; i < 2; i++) s.step(); // step 400 finishes the repair in its first phase
    expect(f1()).toMatchObject({ condition: 'ok', repairHoursLeft: null, powered: true, board: { status: 'destroyed' } });
  });

  it("gives a board's base EMF with its comm module's and its readings as its firmware gets them, and no inspection without a board", () => {
    const s = town();
    s.install('W', 'board');
    expect(inspectBoard(s.ctx, 'W')!.baseEmfPerSecond).toBe(15);
    s.install('W', 'comm');
    const panel = inspectBoard(s.ctx, 'W')!;
    expect(panel.baseEmfPerSecond).toBe(20);
    expect(panel.parts).toEqual({ clockHz: 2, instructionsPerTick: 3000, ramBytes: 16_384, ramUsedBytes: null });
    expect(panel.sensors).toEqual(sensorFrame(s.ctx, findBoard(s.world, 'W')!));
    expect(panel.sensors.farms).toEqual([
      { id: 'F1', outbox: 0, distance: 12 },
      { id: 'F2', outbox: 0, distance: 11 },
      { id: 'F3', outbox: 0, distance: 10 },
    ]);
    expect(panel.sensors.trucks).toEqual([
      { id: 1, status: 'idle', x: 11, y: 6, load: 0 },
      { id: 2, status: 'idle', x: 11, y: 6, load: 0 },
    ]);
    for (const id of ['H1', 'F2', 'ZZ']) expect(inspectBoard(s.ctx, id), id).toBeNull();
  });
});
```

What became of milestone 1's tests in this file:
- **The datasheet's tests leave with it.** Task 11's manual tests check what they checked, in the manual's words.
- **Every other test keeps its checks**, read through the new shapes.
- **Two tests now find their log lines by text**, not by position. A board the scenario installs may log its install first.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/test/queries.test.ts`
Expected: FAIL. The views still have milestone 1's shapes, as Tasks 2 to 9 patched them:
- `listBoards` gives no tiers and lists installed boards only;
- the snapshot has no `facilities`, `trucks`, `town`, or `prices`;
- the status has no `food` or `population`.

- [ ] **Step 3: Rewrite the views**

`packages/core/src/queries.ts` (whole file):

```ts
import { isCooling, isProcessing } from './datacenter.ts';
import { isRipe, ripeness } from './farm.ts';
import type { SensorValue } from './firmware-host.ts';
import { idiv, MICRO, MILLI } from './fixed.ts';
import { type PopulationCounts, populationCounts } from './housing.ts';
import { pathTo } from './luddites.ts';
import { facilityDemand, plantFacility, priorityOrder } from './power.ts';
import { type BoardKind, type FacilityKind, type Scenario, takesBoard } from './scenario.ts';
import { sensorFrame } from './sensors.ts';
import { gameTime, stepsPerDay } from './time.ts';
import {
  type Alert,
  type AlertKind,
  type BoardState,
  type BoardStatus,
  type EndKind,
  type FacilityCondition,
  type FacilityState,
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
  readonly datacenter: { readonly tempC: number; readonly processing: boolean; readonly cooling: boolean } | null;
  readonly farm: { readonly ripeness: number; readonly ripe: boolean; readonly outbox: number } | null;
  /** Whole food units in stock. */
  readonly warehouse: { readonly stock: number } | null;
  /** Whole food units left, its residents, and whether they ate at the last step. */
  readonly housing: { readonly food: number; readonly residents: number; readonly fed: boolean } | null;
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
      ? { status: b.status, powered: hasPower(b), hasFirmware: b.firmware !== null || b.pending !== null, erroring: b.lastTick?.error != null }
      : null,
    datacenter: dc
      ? { tempC: idiv(dc.tempMilli, MILLI), processing: isProcessing(ctx, f.id, step), cooling: isCooling(ctx, f.id, step) }
      : null,
    farm: farm ? { ripeness: ripeness(ctx, farm, step), ripe: isRipe(ctx, farm, step), outbox: farm.outbox } : null,
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
  /** What its firmware reads in io now. */
  readonly sensors: Readonly<Record<string, SensorValue>>;
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
    sensors: sensorFrame(ctx, board),
  };
}
```

`plantFacility` is imported from `power.ts`, where contract §7 lists it. Contract §2 lists it in `world.ts` as well. Import it from whichever module Task 2 put it in.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core/test/queries.test.ts`
Expected: PASS, 25 tests.

- [ ] **Step 5: Bring the tests that build or read these shapes to them**

`pnpm typecheck` finds each of these.

**`packages/core/test/agent-tools.test.ts`.** In `STATUS`, after the `power` line, add the two new fields. Task 11 replaces this file and keeps the same values.

```ts
  food: { warehouse: 12, housing: 240 },
  population: { fed: 40, hungry: 40, unpowered: 0 },
```

**`packages/server/test/mcp.test.ts`.** In `fakeApi()`, `status` answers the two new fields, after its `power` line:

```ts
      food: { warehouse: 0, housing: 0 },
      population: { fed: 0, hungry: 0, unpowered: 0 },
```

**`packages/server/test/game-controller.test.ts`.** A board summary's board fields, and the snapshot's boards, are read through their new places. Tasks 3 and 4 may have reworked some of these tests for wrecks and repairs, so change each read wherever it stands:

| In the test | Old | New |
|---|---|---|
| `'starts every season fresh'` | `(await c.listBoards())[1]!.firmwareVersion` | `(await c.listBoards())[1]!.board!.firmwareVersion` |
| `'refuses a deploy whose season was replaced while its code was being checked, …'` | `toMatchObject([{}, { firmwareVersion: null, pendingVersion: null }, {}])` | `toMatchObject([{}, { board: { firmwareVersion: null, pendingVersion: null } }, {}])` |
| `'keeps the reason a deploy failed to install in what the agent reads, …'` | `expect(da.lastError)` | `expect(da.board!.lastError)` |
| `"says when a deploy installs: …"` | `.find((b) => b.id === 'DA')?.status` | `.find((b) => b.id === 'DA')?.board?.status` |
| `'says that a deploy to a board the grid has shed waits for its power'` | `boards.map((b) => [b.id, b.status, b.powered])` | `boards.map((b) => [b.id, b.board?.status, b.board?.powered])` |
| the rebuild test (`'rebuilds a destroyed board, …'` in milestone 1) | `.find((b) => b.id === lost)?.status` (twice) | `.find((b) => b.id === lost)?.board?.status` |
| `'sends the new picture of the world with a deploy, …'` | `c.latestSnapshot()!.boards.find((b) => b.id === 'DA')!` | `c.latestSnapshot()!.facilities.find((f) => f.id === 'DA')!.board!` |
| `'sends the new picture of the world when a rebuild starts, …'` | `after.boards.find((b) => b.id === lost)!.status` | `after.facilities.find((f) => f.id === lost)!.board!.status` |
| `'answers each read of the agent tools and of the viewer from the season'` | `inspection?.datasheet.parts.clockHz` | `inspection?.parts.clockHz` |

These are the expressions Task 13 writes into the tests it replaces, so its versions read the same.

**`packages/server/test/game-server.test.ts`.** In the end-to-end test, the wait for DA's firmware reads it from DA's board:

```ts
    await until(() => last(v.seen, 'snapshot')!.snapshot.facilities[1]!.board!.hasFirmware);
```

- [ ] **Step 6: Bring the viewer to the new snapshot, for now**

These are interim versions. They keep the viewer compiling and drawing until Task 17 replaces them, and Tasks 18 and 19 bring the real map and panel.

**`packages/viewer/src/format.ts`.** Make three replacements, wherever earlier tasks left these definitions.

1. Replace the `Board` type alias at the top with:

   ```ts
   type Facility = Snapshot['facilities'][number];
   ```

2. Replace `ledOf` with:

   ```ts
   /** A facility's status light, from its board; null without one, so that a facility worked by hand reads as a plain building. */
   export function ledOf(f: Facility): Led | null {
     const b = f.board;
     if (!b) return null;
     if (b.status === 'destroyed' || b.status === 'rebuilding') return 'destroyed';
     if (b.status === 'asleep') return 'asleep';
     if (!b.powered) return 'unpowered';
     if (b.erroring) return 'error';
     if (!b.hasFirmware) return 'off';
     return 'running';
   }
   ```

3. Replace `consumersOf` with:

   ```ts
   /** When the power plant is selected: every facility it powers, with its draw, priority rank, and whether it's shed. */
   export function consumersOf(
     snapshot: Snapshot,
     selectedId: string | null,
   ): Array<{ id: string; demand: number; rank: number; shed: boolean }> | null {
     const selected = snapshot.facilities.find((f) => f.id === selectedId);
     if (selected?.kind !== 'power') return null;
     return snapshot.facilities
       .filter((f) => f.kind !== 'power')
       .map((f) => ({
         id: f.id,
         demand: f.demand,
         rank: snapshot.plant.priority.indexOf(f.id) + 1,
         shed: snapshot.plant.shed.includes(f.id),
       }));
   }
   ```

**`packages/viewer/test/format.test.ts`.** Make three edits.

1. Replace the `Board` type and the `board` fixture with a facility that has a board. The light tests keep calling `board({...})`, which now sets the board's fields:

   ```ts
   type Facility = Snapshot['facilities'][number];
   type Board = NonNullable<Facility['board']>;
   /** DA with a running board that has firmware; `over` changes the board. */
   const board = (over: Partial<Board>): Facility => ({
     id: 'DA',
     kind: 'datacenter',
     x: 5,
     y: 4,
     tier: 1,
     condition: 'ok',
     repairHoursLeft: null,
     powered: true,
     demand: 10,
     board: { status: 'running', powered: true, hasFirmware: true, erroring: false, ...over },
     datacenter: { tempC: 40, processing: false, cooling: false },
     farm: null,
     warehouse: null,
     housing: null,
   });
   ```

2. After `'keeps that order when states overlap: …'`, add:

   ```ts
     it('shows no light for a facility without a board', () => {
       expect(ledOf({ ...board({}), tier: 0, board: null })).toBeNull();
     });
   ```

3. Replace `"lists the plant's consumers with draw, priority, and shedding, only when the plant is selected"` with:

   ```ts
     it("lists the plant's consumers with draw, priority, and shedding, only when the plant is selected", () => {
       const facility = (id: string, kind: Facility['kind'], demand: number): Facility => ({ ...board({}), id, kind, demand });
       const snapshot = {
         facilities: [facility('H1', 'housing', 77), facility('P', 'power', 0), facility('DA', 'datacenter', 163), facility('DB', 'datacenter', 211)],
         plant: { priority: ['H1', 'DA', 'DB'], shed: ['DB'] },
       } as unknown as Snapshot;
       expect(consumersOf(snapshot, 'P')).toEqual([
         { id: 'H1', demand: 77, rank: 1, shed: false },
         { id: 'DA', demand: 163, rank: 2, shed: false },
         { id: 'DB', demand: 211, rank: 3, shed: true },
       ]);
       expect(consumersOf(snapshot, 'DA')).toBeNull();
       expect(consumersOf(snapshot, null)).toBeNull();
     });
   ```

**`packages/viewer/src/map/map-scene.ts`** (whole file, interim):

```ts
import type { Snapshot } from '@turing-city/core';
import Phaser from 'phaser';
import { consumersOf, heatAlpha, LED_COLORS, ledOf } from '../format.ts';

export const CELL = 34;

const FACILITY_COLORS: Record<string, number> = {
  power: 0xf2c14e,
  datacenter: 0xc49bff,
  farm: 0x7cc46a,
  warehouse: 0xd39a5e,
  housing: 0x6fa8dc,
};

/** The town: drawn from scratch on every snapshot, selection change, and blink. An interim map: Task 18 replaces it. */
export class MapScene extends Phaser.Scene {
  onSelect: (id: string | null) => void = () => {};
  private gfx: Phaser.GameObjects.Graphics | null = null;
  private labels: Phaser.GameObjects.Text[] = [];
  private snapshot: Snapshot | null = null;
  private selected: string | null = null;
  private heatmap = false;
  private blinkOn = true;

  constructor() {
    super('map');
  }

  create(): void {
    this.gfx = this.add.graphics();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const x = Math.floor(p.x / CELL);
      const y = Math.floor(p.y / CELL);
      const hit = this.snapshot?.facilities.find((f) => f.x === x && f.y === y);
      this.onSelect(hit?.id ?? null);
    });
    this.time.addEvent({
      delay: 450,
      loop: true,
      callback: () => {
        this.blinkOn = !this.blinkOn;
        this.redraw();
      },
    });
    this.redraw();
  }

  show(snapshot: Snapshot, selected: string | null, heatmap: boolean): void {
    this.snapshot = snapshot;
    this.selected = selected;
    this.heatmap = heatmap;
    this.redraw();
  }

  private text(x: number, y: number, value: string, color: string, size = 11): void {
    this.labels.push(
      this.add.text(x, y, value, {
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: `${size}px`,
        color,
        backgroundColor: '#0c0f13cc',
      }),
    );
  }

  private redraw(): void {
    const s = this.snapshot;
    const g = this.gfx;
    if (!s || !g) return;
    g.clear();
    for (const t of this.labels) t.destroy();
    this.labels = [];
    const { width, height } = s.grid;

    g.fillStyle(0x141a20, 1);
    g.fillRect(0, 0, width * CELL, height * CELL);
    g.lineStyle(1, 0x232b34, 1);
    for (let x = 0; x <= width; x++) g.lineBetween(x * CELL, 0, x * CELL, height * CELL);
    for (let y = 0; y <= height; y++) g.lineBetween(0, y * CELL, width * CELL, y * CELL);

    if (this.heatmap) {
      s.emf.forEach((units, i) => {
        const alpha = heatAlpha(units);
        if (alpha > 0) {
          g.fillStyle(0xff5a28, alpha);
          g.fillRect((i % width) * CELL, Math.floor(i / width) * CELL, CELL, CELL);
        }
      });
    }

    const consumers = consumersOf(s, this.selected);
    for (const f of s.facilities) {
      const px = f.x * CELL;
      const py = f.y * CELL;
      const led = ledOf(f);
      const dim = !f.powered || led === 'unpowered' || led === 'destroyed';
      const consumer = consumers?.find((c) => c.id === f.id);
      if (consumer) {
        g.lineStyle(2, consumer.shed ? 0x59636f : 0xf2c14e, 1);
        g.strokeRect(px, py, CELL, CELL);
        this.text(
          px + CELL + 2,
          py + 2,
          `−${consumer.demand} · ${consumer.rank}순위${consumer.shed ? ' · 정전' : ''}`,
          consumer.shed ? '#9aa3ad' : '#f2c14e',
        );
      }
      g.fillStyle(FACILITY_COLORS[f.kind] ?? 0x9aa7b4, dim ? 0.45 : 1);
      g.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
      // Only a facility with a board has a light.
      if (led !== null) {
        g.fillStyle(LED_COLORS[led], 1);
        g.fillCircle(px + CELL - 5, py + 5, 4);
        if (led === 'error' && !this.blinkOn) {
          g.fillStyle(0x141a20, 1);
          g.fillCircle(px + CELL - 5, py + 5, 4);
        }
      }
      this.text(px + 6, py + 10, f.id, '#ffffff');
      if (f.condition !== 'ok') this.text(px, py + CELL + 1, f.condition === 'wrecked' ? '부서짐' : '복구 중', '#ff4d4d', 10);
      else if (f.datacenter) {
        const dc = f.datacenter;
        this.text(px, py + CELL + 1, `${dc.tempC}°C${dc.processing ? ' ▲' : ''}`, dc.tempC >= 85 ? '#ffb020' : '#d7dde4', 10);
      }
      if (f.id === this.selected) {
        g.lineStyle(2, 0xffffff, 1);
        g.strokeRect(px, py, CELL, CELL);
      }
    }

    for (const group of s.luddites) {
      if (this.blinkOn && group.path.length > 0) {
        g.lineStyle(2, 0xff4d4d, 1);
        g.beginPath();
        g.moveTo(group.x * CELL + CELL / 2, group.y * CELL + CELL / 2);
        for (const [x, y] of group.path) g.lineTo(x * CELL + CELL / 2, y * CELL + CELL / 2);
        g.strokePath();
      }
      g.fillStyle(0xff4d4d, 1);
      for (let k = 0; k < group.size; k++) g.fillCircle(group.x * CELL + 9 + (k % 2) * 10, group.y * CELL + 10 + Math.floor(k / 2) * 12, 4);
      this.text(
        group.x * CELL + CELL + 2,
        group.y * CELL,
        `러다이트 ${group.size}${group.targetId ? ` → ${group.targetId}` : ''}`,
        '#ff4d4d',
      );
    }
  }
}

/** Creates the Phaser game for the map, sized to the scenario's grid. */
export function mountMap(parent: HTMLElement, snapshot: Snapshot, onSelect: (id: string | null) => void): MapScene {
  const scene = new MapScene();
  scene.onSelect = onSelect;
  new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: snapshot.grid.width * CELL + 140,
    height: snapshot.grid.height * CELL + 14,
    backgroundColor: '#11151a',
    scene,
  });
  return scene;
}
```

**`packages/viewer/src/ui/panel.ts`** (whole file, interim). It shows any facility. It offers a rebuild only for a standing facility whose board is destroyed, since the server refuses a rebuild before the repair.

```ts
import type { SensorValue } from '@turing-city/core';
import { clear, el } from '../dom.ts';
import { firmwareLabel, KIND_LABELS, LED_LABELS, ledOf, moneyLabel } from '../format.ts';
import type { Connection } from '../net.ts';
import type { Store } from '../store.ts';

const section = (label: string, ...children: Array<Node | string>): HTMLElement =>
  el('div', { class: 'sec' }, [el('div', { class: 'label' }, [label]), ...children]);

const kv = (pairs: Array<[string, string]>): HTMLElement =>
  el(
    'div',
    { class: 'kv' },
    pairs.flatMap(([k, v]) => [el('span', { class: 'dim' }, [k]), el('span', {}, [v])]),
  );

const SCROLL_KEY = 'data-scroll';

/** The scroll offsets of the panel's scrollable blocks, by their keys. */
function scrollOffsets(root: HTMLElement): Map<string, number> {
  const offsets = new Map<string, number>();
  for (const pre of root.querySelectorAll<HTMLElement>(`pre[${SCROLL_KEY}]`))
    offsets.set(pre.getAttribute(SCROLL_KEY) ?? '', pre.scrollTop);
  return offsets;
}

/** A reading on one line: a number to two decimals, nil for none, and a list or a record as JSON. */
function readingText(v: SensorValue): string {
  if (v === undefined) return 'nil';
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/** The selected facility's panel. An interim version: Task 17 replaces it, and Task 19 brings the hand controls, installs, and repairs. */
export function renderPanel(root: HTMLElement, store: Store, net: Connection): void {
  // The panel is rebuilt on every change, so a block the player scrolled would jump back to its top: put each one back.
  const scrolled = scrollOffsets(root);
  clear(root);
  const s = store.snapshot;
  const f = s?.facilities.find((x) => x.id === store.selected);
  if (!s || !f) {
    root.append(el('p', { class: 'dim' }, ['시설을 클릭하면 여기에 정보가 떠요']));
    return;
  }
  const led = ledOf(f);
  const inspection = store.inspection?.board === f.id ? store.inspection.inspection : null;
  root.append(
    el('h2', {}, [`${KIND_LABELS[f.kind]} ${f.id}`]),
    el('div', {}, [
      led === null
        ? el('span', { class: 'dim' }, ['보드 없음'])
        : el('span', { class: led === 'running' ? 'ok' : led === 'error' || led === 'destroyed' ? 'bad' : 'warn' }, [`● ${LED_LABELS[led]}`]),
      f.board
        ? el('span', { class: 'dim' }, [` · ${firmwareLabel(inspection?.firmware?.version ?? null, inspection?.pending?.version ?? null)}`])
        : '',
    ]),
  );
  if (f.condition === 'wrecked') {
    root.append(section('피해', el('span', { class: 'bad' }, ['시설이 부서졌어요'])));
  } else if (f.condition === 'repairing') {
    root.append(section('피해', el('span', { class: 'warn' }, [`복구 중… (${f.repairHoursLeft ?? 0}시간 남음)`])));
  } else if (f.board?.status === 'destroyed') {
    // The server refuses a rebuild the money cannot pay for, and the game screen shows no refusal: do not offer the click.
    const tooPoor = s.money < s.prices.rebuild;
    root.append(
      section(
        '재건',
        el('button', { class: 'primary', disabled: tooPoor, onclick: () => net.send({ type: 'rebuild', board: f.id }) }, [
          `재건 (${moneyLabel(s.prices.rebuild)} · ${s.prices.rebuildHours}시간)`,
        ]),
        tooPoor ? el('p', { class: 'dim' }, ['자금이 모자라서 재건할 수 없어요']) : '',
      ),
    );
  } else if (f.board?.status === 'rebuilding') {
    root.append(section('재건', el('span', { class: 'warn' }, ['재건 중…'])));
  }
  if (f.kind === 'power') {
    root.append(
      section(
        '발전',
        kv([
          ['풍력', String(s.plant.wind)],
          ['화력', `${s.plant.thermal} (연료 ${s.plant.fuelPrice}/단위·일)`],
          ['발전 / 수요', `${s.plant.generation} / ${s.plant.demand}`],
        ]),
      ),
      section(
        '우선순위',
        kv(s.plant.priority.map((id, i): [string, string] => [`${i + 1}. ${id}`, s.plant.shed.includes(id) ? '○ 정전' : '● 공급'])),
      ),
    );
  }
  // A facility with no board has nothing more to show until Task 19's controls.
  if (!f.board) return;
  if (!inspection) {
    root.append(el('p', { class: 'dim' }, ['불러오는 중…']));
    return;
  }
  const parts = inspection.parts;
  root.append(
    section(
      '부품',
      kv([
        ['CPU', `${parts.clockHz}Hz · 틱당 ${parts.instructionsPerTick}명령`],
        ['RAM', `${Math.round(parts.ramBytes / 1024)}KB (사용 ${((parts.ramUsedBytes ?? 0) / 1024).toFixed(1)}KB)`],
        ['기본 전자파', String(inspection.baseEmfPerSecond)],
      ]),
    ),
    section('실시간 센서', kv(Object.entries(inspection.sensors).map(([k, v]): [string, string] => [k, readingText(v)]))),
    section(
      '로그',
      el('pre', { [SCROLL_KEY]: `${f.id}/log` }, [
        [...inspection.logs]
          .reverse()
          .map((l) => `${l.day}일 ${l.clock}  ${l.kind === 'log' ? '' : `[${l.kind}] `}${l.text}${l.repeat > 1 ? ` ×${l.repeat}` : ''}`)
          .join('\n') || '(없음)',
      ]),
    ),
    // A deploy installs at the board's next tick, which for a board that is asleep or smashed is a while off: until then it shows here.
    ...(inspection.pending
      ? [
          section(
            `설치 대기 중인 펌웨어 v${inspection.pending.version} (읽기 전용)`,
            el('pre', { [SCROLL_KEY]: `${f.id}/pending` }, [inspection.pending.source]),
          ),
        ]
      : []),
    section(
      `펌웨어${inspection.firmware ? ` v${inspection.firmware.version}` : ''} (읽기 전용)`,
      el('pre', { [SCROLL_KEY]: `${f.id}/firmware` }, [inspection.firmware?.source ?? '(없음)']),
    ),
  );
  // Only now are the blocks in the page with a layout, which setting scrollTop needs. Another board's blocks have other keys.
  for (const pre of root.querySelectorAll<HTMLElement>(`pre[${SCROLL_KEY}]`))
    pre.scrollTop = scrolled.get(pre.getAttribute(SCROLL_KEY) ?? '') ?? 0;
}
```

- [ ] **Step 7: Run the project's checks**

Run: `pnpm fix && pnpm check`
Expected: exit 0, with `queries.test.ts` at 25 tests.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/queries.ts packages/core/test/queries.test.ts packages/core/test/agent-tools.test.ts \
  packages/server/test/mcp.test.ts packages/server/test/game-controller.test.ts packages/server/test/game-server.test.ts \
  packages/viewer/src/format.ts packages/viewer/src/ui/panel.ts packages/viewer/src/map/map-scene.ts packages/viewer/test/format.test.ts
git commit -m "Views of the whole town: every facility with its tier, food and residents, trucks, and the player's prices"
```

---

### Task 11: The board manual, and the agent tools at T2

This task adds the manual of spec §9 and points the agent's tools at it.

**The manual.** It is one Korean markdown document per board slot, generated from the scenario.
- It is nominally a guide that tells the player to write the board's firmware, and it is dense on purpose, so that the player hands it to an AI.
- It grows out of milestone 1's datasheet. It keeps everything the datasheet's rules said: the sandbox, RAM, logs, sleep, and the day length.
- It adds the rules of the whole town's facilities, the EMF and Luddite rules (which agents never got in milestone 1), and the player's prices.
- The viewer's manual window renders it (Task 20).

**The agent tools at T2** (spec §8):
- `get_datasheet` returns the manual (`GameApi.manual` replaces `GameApi.datasheet`), and milestone 1's `datasheet.ts` goes.
- The board tools' descriptions say they reach only a board with a comm module. Task 13 puts that gate in the worker.
- `list_boards` explains the tiers.
- The instructions tell the agent where it stands: the player runs the town, and hands it boards with a comm module.
- `FIRMWARE_SOURCE` is Task 14's (`commands.ts`), so `deploy_firmware`'s private `code` schema stays as milestone 1 wrote it, for Task 14 to swap.

**Two rules shape the generator:**
- **Every number comes from the scenario** (Global Constraint 6). Tests retune the scenario and see the text change.
- **Only the markdown subset of contract §14** is used: `#`, `##`, and `###` headings; paragraphs; `- ` lists; pipe tables with a header row; fenced ```` ```lua ```` blocks; inline `` `code` ``. Task 20's renderer handles exactly this. A test lints every line.

**Korean wording.** A Korean particle after a bare number depends on how the number is read (`150을`, `2가`). So the text never puts a particle right after a bare number. It writes a unit (`초`, `칸`, `°C`, `%`) or a particle that fits any word (`의`, `씩`, `까지`, `만큼`, `만`) in between.

**What else must keep compiling.** The worker and the controller answer the agent's manual instead of the datasheet. Task 13 replaces both files whole; this task only switches the query, so that the server compiles and its tests pass in between.

**Files:**
- Create: `packages/core/src/manual.ts`
- Delete: `packages/core/src/datasheet.ts`
- Modify:
  - `packages/core/src/agent-tools.ts` (whole file);
  - `packages/core/src/index.ts`;
  - `packages/core/src/protocol.ts` (`Query`);
  - `packages/server/src/worker.ts`;
  - `packages/server/src/game-controller.ts`.
- Test:
  - `packages/core/test/manual.test.ts` (new);
  - `packages/core/test/agent-tools.test.ts` (whole file);
  - `packages/server/test/mcp.test.ts`;
  - `packages/server/test/game-controller.test.ts`.

**Interfaces:**
- Consumes:
  - **Task 1:**
    - `Scenario`, with `facilities[].board: BoardSpec | null`;
    - `FacilityKind`, `BOARD_KINDS`, `BoardKind`, `BoardSpec` (the non-null board), `SensorName`, and `takesBoard`;
    - the milestone-2 `tuning` of contract §1, with the reconciled town values and `housing.startFood`;
    - the test helper `m2Scenario(change?)`.
  - **`SENSOR_KEYS`** (`sensors.ts`), with a key for every sensor of contract §1 and §15.
  - **Task 10:** `BoardSummary` (with `tier` and `board`), `StatusView` (with `food` and `population`), `MapView`, `FirmwareView`, `LogView`, and `AlertView`, as types only.
  - **Milestone 1:** `LOG_LIMIT` (`boards.ts`), `idiv` and `MILLI` (`fixed.ts`), and `manhattan` (`world.ts`).
- Produces:
  - `manual.ts` (contract §14). Nothing else is exported from it.
    - `commonManual(scenario): string`;
    - `boardManual(scenario, facilityId): string | null`, null for an unknown id and for housing;
    - `manualIndex(scenario): string`.
  - `agent-tools.ts`:
    - `GameApi.manual(board): Promise<string | null>`, in place of `datasheet`;
    - `AGENT_TOOLS`, with the same eight names, the T2 descriptions, and `get_datasheet` calling `api.manual`;
    - `AGENT_INSTRUCTIONS`.
  - `protocol.ts`: `Query`'s `{ kind: 'manual'; board }`, in place of `datasheet`.
  - The server:
    - `GameController.manual(board): Promise<string | null>`;
    - `gameApi(c).manual`;
    - the worker answering `manual` with `boardManual(s.scenario, board)`.

    Task 13 adds the T2 gate to them.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/manual.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { boardManual, commonManual, manualIndex } from '../src/manual.ts';
import { SENSOR_KEYS } from '../src/sensors.ts';
import { m2Scenario } from './helpers/scenarios.ts';

const town = m2Scenario();
const BOARDS = ['P', 'DA', 'W', 'DB', 'F1', 'F2', 'F3'];

/** The phrases that are missing from a text, named, so that a failure lists all of them at once. */
const missing = (cases: ReadonlyArray<readonly [string, string]>): string[] =>
  cases.filter(([text, phrase]) => !text.includes(phrase)).map(([, phrase]) => phrase);

describe('the board manual', () => {
  it('has a manual for every facility that takes a board, and none for housing or an unknown id', () => {
    for (const id of BOARDS) expect(boardManual(town, id), id).toMatch(new RegExp(`^# ${id} 보드 매뉴얼: `));
    expect(boardManual(town, 'H1')).toBeNull();
    expect(boardManual(town, 'ZZ')).toBeNull();
  });

  it("starts every board's manual with the common rules, then the board's own sections in order", () => {
    for (const id of BOARDS) {
      const text = boardManual(town, id)!;
      const at = ['## 공통 규칙', '## 이 보드가 하는 일', '## 부품', '## io로 읽는 값', '## io로 하는 행동'].map((h) => text.indexOf(h));
      expect(at.every((i) => i > 0), id).toBe(true);
      expect([...at].sort((a, b) => a - b), id).toEqual(at);
      // The common rules sit one level down inside a board's manual, and at the top of the common manual.
      expect(text, id).toContain('### Lua 샌드박스');
    }
    expect(commonManual(town)).toMatch(/^# 공통 규칙\n/);
    expect(commonManual(town)).toContain('\n## Lua 샌드박스\n');
  });

  it("names every io field the board's sensors give, and the actions of its own kind and no other", () => {
    const callsByKind: Record<string, string[]> = {
      power: ['`io.set_thermal(output)`', '`io.set_priority({ids})`'],
      datacenter: ['`io.process()`', '`io.cool()`'],
      farm: ['`io.harvest()`'],
      warehouse: ['`io.dispatch(truck, from, to, amount)`'],
    };
    for (const f of town.facilities) {
      if (f.board === null) continue;
      const text = boardManual(town, f.id)!;
      for (const s of f.board.sensors) expect(text, `${f.id} ${s}`).toContain(`| \`${SENSOR_KEYS[s]}\` |`);
      for (const name of ['day', 'clock']) expect(text, `${f.id} ${name}`).toContain(`| \`${name}\` |`);
      for (const [kind, calls] of Object.entries(callsByKind)) {
        for (const call of calls) {
          if (kind === f.kind) expect(text, `${f.id} ${call}`).toContain(`| ${call} |`);
          else expect(text, `${f.id} ${call}`).not.toContain(call);
        }
      }
      for (const call of ['`io.log(...)`', '`io.sleep(seconds)`']) expect(text, `${f.id} ${call}`).toContain(`| ${call} |`);
    }
  });

  it("writes the town's own numbers", () => {
    const da = boardManual(town, 'DA')!;
    const f1 = boardManual(town, 'F1')!;
    const w = boardManual(town, 'W')!;
    const p = boardManual(town, 'P')!;
    const common = commonManual(town);
    expect(
      missing([
        [da, '데이터센터가 도는 끝 시각을 지금부터 0.5초 뒤로 잡는다'],
        [da, '이 보드가 박자마다 부르면 쉬지 않고 돈다'],
        [da, '처리하는 동안 150의 전력을 더 쓰고, 초당 2°C씩 뜨거워지고, 초당 50의 전자파를 낸다'],
        [da, '가만히 두면 매초 (온도 − 25°C)의 0.3%씩만 식는다'],
        [da, '4초에 걸쳐 고르게 15°C를 낮추고, 그동안 250의 전력을 쓴다'],
        [da, '85°C에 닿으면 과열 알림이 뜬다'],
        [da, '90°C를 넘으면 매초, 넘은 1°C마다 0.5%의 확률로 불이 나서'],
        [da, '| 클럭 | 5 Hz: 1초에 5번 틱 |'],
        [da, '| 틱당 명령어 상한 | 2000 |'],
        [da, '| RAM | 8 KB (8192바이트) |'],
        [da, '| 보드 전력 | 깨어 있을 때 10, 자는 동안 1 |'],
        [da, '| 기본 전자파 | 초당 25, 통신 모듈을 달면 30 |'],
        [da, '| 위치 | (5, 4), 발전소까지 1칸 |'],
        [da, '| 보드 설치 | 600 |'],
        [da, '| 통신 모듈 | 300 |'],
        [da, '| 시설 수리 | 500 |'],
        [da, '25 이상. 90°C 위에서는 불이 날 수 있다'],
        [da, '15~80, 초당 최대 2씩 변한다'],
        [f1, '작물은 심은 지 40초(1일) 뒤에 익는다'],
        [f1, '익은 채로 20초(12시간)이 지나면 썩어서 사라지고'],
        [f1, '40의 식량을 출고함에 넣고 바로 다시 심는다. 출고함은 80까지이고'],
        [f1, '| `outbox` | 출고함에 쌓인 식량 | 식량 | 0~80 |'],
        [w, '트럭은 2대이고 한 대에 40까지 싣는다. 초당 2칸을 가고, 새 칸에 들어설 때마다 연료비로 1씩 든다'],
        [w, '재고는 하루에 2%씩 상한다'],
        [w, '주거지 블록마다 주민 40명이 살고, 한 명이 하루 1씩 먹는다'],
        [w, '한 명당 하루 5씩 세금을 낸다'],
        [w, '시즌을 시작할 때 주거지 블록마다 식량이 120만큼 있다'],
        [w, '`io.dispatch(truck, 밭 id, "W", amount)`'],
        [w, '| `F1` | 밭 | (2, 9) | 12칸 |'],
        [w, '| `F3` | 밭 | (4, 9) | 10칸 |'],
        [w, '| `H1` | 주거지 | (2, 1) | 14칸 |'],
        [w, '| `H2` | 주거지 | (17, 1) | 11칸 |'],
        [w, '트럭 2대, id 1~2'],
        [p, '풍력은 날씨를 따라 0~220 사이에서 초당 최대 8씩 변하고, 비용이 없다'],
        [p, '화력은 정한 출력 그대로 나온다(0~300)'],
        [p, '`fuel_price`(5~9, 매일 바뀐다)가 든다'],
        [p, '하루는 40초이므로 출력 1단위의 초당 연료비: `fuel_price` / 40.'],
        [p, '공급 순서에 쓸 수 있는 id: `H1`, `H2`, `DA`, `W`, `DB`, `F1`, `F2`, `F3`.'],
        [common, '세계는 1초에 20 스텝씩 흐르고'],
        [common, '하루는 40초, 시즌은 30일이다'],
        [common, '로그는 보드마다 최근 200줄이고'],
        [common, '"power back (steady for 10 s)"'],
        [common, '그 시설의 수요가 2%씩 늘어난다'],
        [common, '시작 자금은 5000이다'],
        [common, '보드 유지비(설치된 보드마다 하루 10)'],
        [common, '자금이 3일 연속 0보다 적으면'],
        [common, '| 발전소 | 400 | 300 |'],
        [common, '| 데이터센터 | 600 | 500 |'],
        [common, '| 밭 | 200 | 150 |'],
        [common, '| 물류창고 | 400 | 300 |'],
        [common, '통신 모듈: 300. 보드의 기본 전자파가 초당 5 늘어난다.'],
        [common, '시설 수리는 20초(12시간) 걸린다. 보드 재건은 500이고 20초(12시간) 걸린다.'],
        [common, '명령어 100개마다 1'],
        [common, '하나마다 10.'],
        [common, '데이터센터는 처리하는 동안 초당 50의 전자파를 낸다'],
        [common, '이웃 네 칸에 10%씩 나눠 주고, 지도 전체가 매초 10%씩 줄어든다'],
        [common, '200000에 닿을 때마다 러다이트 무리가 나타나고'],
        [common, '무리는 3명이고'],
        [common, '초당 1칸씩 걷고'],
        [common, '전자파가 5 이상인 칸이고'],
        [common, '감지되는 것이 10초 동안 없으면'],
        [common, '시설에서 5칸 안으로 들어오면'],
        [common, '보드를 1~40초 동안 재운다'],
        [common, '전력은 1만 쓴다'],
        [common, '데이터센터의 처리(150)와 냉각(250), 주거지 블록마다 70'],
        [common, '마을이 10초 동안 한 번도 끊기지 않아야 다시 울린다'],
        [common, '| `DB` | 데이터센터 | (16, 8) | 16칸 |'],
      ]),
    ).toEqual([]);
  });

  it('follows a retuned scenario, so another town reads differently', () => {
    const t = m2Scenario((j) => {
      j.startMoney = 6000;
      j.time.secondsPerDay = 60;
      j.tuning.transmissionLossPctPerCell = 3;
      j.tuning.shortageQuietSeconds = 6;
      j.tuning.wind = { max: 250, start: 120, maxChangePerSecond: 9 };
      j.tuning.thermal.max = 400;
      j.tuning.fuelPrice = { start: 7, min: 4, max: 11 };
      j.tuning.jobPrice = { start: 40, min: 12, max: 90, maxChangePerSecond: 3 };
      Object.assign(j.tuning.datacenter, {
        processPower: 170,
        heatMilliPerSecond: 3_500,
        passiveCoolingPermillePerSecond: 7,
        jobMs: 750,
        coolingCycleMs: 3_000,
        coolingDropMilli: 12_500,
        coolingPower: 333,
        overheatAlertMilli: 80_000,
        fireThresholdMilli: 95_050,
        firePermillePerDegreePerSecond: 12,
      });
      j.tuning.farm = { ripenSeconds: 90, rotSeconds: 30, yield: 31, outboxCapacity: 77 };
      j.tuning.warehouse = { trucks: 3, truckCapacity: 55, truckCellsPerSecond: 4, fuelPerCell: 3, spoilagePctPerDay: 4 };
      j.tuning.housing = { residents: 35, foodPerPersonPerDay: 2, power: 75, taxPerPersonPerDay: 6, startFood: 90 };
      j.tuning.boardUpkeepPerDay = 12;
      j.tuning.sleepPower = 2;
      j.tuning.maxSleepSeconds = 25;
      Object.assign(j.tuning.emf, {
        instructionsPerUnit: 50,
        perAction: 7,
        processingPerSecond: 44,
        diffusionPctPerSecond: 11,
        decayPctPerSecond: 12,
        detectionThreshold: 9,
        rumourThreshold: 77_777,
      });
      j.tuning.luddites = { groupSize: 4, cellsPerSecond: 2, quietSecondsToLeave: 15, approachCells: 6 };
      j.tuning.install.boardPrice.farm = 210;
      j.tuning.install.commPrice = 350;
      j.tuning.install.commBaseEmfPerSecond = 7;
      j.tuning.repair.cost.datacenter = 555;
      j.tuning.repair.seconds = 30;
      j.tuning.rebuild = { cost: 444, seconds: 30 };
      j.tuning.bankruptcyDays = 4;
    });
    const da = boardManual(t, 'DA')!;
    const f1 = boardManual(t, 'F1')!;
    const w = boardManual(t, 'W')!;
    const p = boardManual(t, 'P')!;
    const common = commonManual(t);
    expect(
      missing([
        [da, '데이터센터가 도는 끝 시각을 지금부터 0.75초 뒤로 잡는다'],
        [da, '처리하는 동안 170의 전력을 더 쓰고, 초당 3.5°C씩 뜨거워지고, 초당 44의 전자파를 낸다'],
        [da, '가만히 두면 매초 (온도 − 25°C)의 0.7%씩만 식는다'],
        [da, '3초에 걸쳐 고르게 12.5°C를 낮추고, 그동안 333의 전력을 쓴다'],
        [da, '80°C에 닿으면 과열 알림이 뜬다'],
        [da, '95.05°C를 넘으면 매초, 넘은 1°C마다 1.2%의 확률로 불이 나서'],
        [da, '| 기본 전자파 | 초당 25, 통신 모듈을 달면 32 |'],
        [da, '| 통신 모듈 | 350 |'],
        [da, '| 시설 수리 | 555 |'],
        [da, '25 이상. 95.05°C 위에서는 불이 날 수 있다'],
        [da, '12~90, 초당 최대 3씩 변한다'],
        [da, '1~25초 동안 깊이 잠든다. 조용하고 전력도 2만 쓰지만'],
        [f1, '작물은 심은 지 90초(36시간) 뒤에 익는다'],
        [f1, '익은 채로 30초(12시간)이 지나면 썩어서 사라지고'],
        [f1, '31의 식량을 출고함에 넣고 바로 다시 심는다. 출고함은 77까지이고'],
        [f1, '| 보드 설치 | 210 |'],
        [w, '트럭은 3대이고 한 대에 55까지 싣는다. 초당 4칸을 가고, 새 칸에 들어설 때마다 연료비로 3씩 든다'],
        [w, '재고는 하루에 4%씩 상한다'],
        [w, '주거지 블록마다 주민 35명이 살고, 한 명이 하루 2씩 먹는다'],
        [w, '한 명당 하루 6씩 세금을 낸다'],
        [w, '시즌을 시작할 때 주거지 블록마다 식량이 90만큼 있다'],
        [w, 'amount는 1~55'],
        [w, '트럭 3대, id 1~3'],
        [p, '풍력은 날씨를 따라 0~250 사이에서 초당 최대 9씩 변하고'],
        [p, '화력은 정한 출력 그대로 나온다(0~400)'],
        [p, '`fuel_price`(4~11, 매일 바뀐다)가 든다'],
        [p, '하루는 60초이므로 출력 1단위의 초당 연료비: `fuel_price` / 60.'],
        [common, '하루는 60초, 시즌은 30일이다'],
        [common, '"power back (steady for 6 s)"'],
        [common, '그 시설의 수요가 3%씩 늘어난다'],
        [common, '시작 자금은 6000이다'],
        [common, '보드 유지비(설치된 보드마다 하루 12)'],
        [common, '자금이 4일 연속 0보다 적으면'],
        [common, '| 밭 | 210 | 150 |'],
        [common, '| 데이터센터 | 600 | 555 |'],
        [common, '통신 모듈: 350. 보드의 기본 전자파가 초당 7 늘어난다.'],
        [common, '시설 수리는 30초(12시간) 걸린다. 보드 재건은 444이고 30초(12시간) 걸린다.'],
        [common, '명령어 50개마다 1'],
        [common, '하나마다 7.'],
        [common, '데이터센터는 처리하는 동안 초당 44의 전자파를 낸다'],
        [common, '이웃 네 칸에 11%씩 나눠 주고, 지도 전체가 매초 12%씩 줄어든다'],
        [common, '77777에 닿을 때마다'],
        [common, '무리는 4명이고'],
        [common, '초당 2칸씩 걷고'],
        [common, '전자파가 9 이상인 칸이고'],
        [common, '감지되는 것이 15초 동안 없으면'],
        [common, '시설에서 6칸 안으로 들어오면'],
        [common, '보드를 1~25초 동안 재운다'],
        [common, '전력은 2만 쓴다'],
        [common, '데이터센터의 처리(170)와 냉각(333), 주거지 블록마다 75'],
        [common, '마을이 6초 동안 한 번도 끊기지 않아야 다시 울린다'],
      ]),
    ).toEqual([]);
    // The milestone's own numbers are gone, where they were the only place they appear.
    expect(da).not.toContain('지금부터 0.5초 뒤로');
    expect(common).not.toContain('하루는 40초');
    expect(p).not.toContain('`fuel_price` / 40');
  });

  it('says the hours a span takes when the day does not divide it, and when there is no quiet time to wait', () => {
    const odd = m2Scenario((j) => {
      j.time.secondsPerDay = 70;
      j.tuning.shortageQuietSeconds = 0;
    });
    const common = commonManual(odd);
    expect(common).toContain('시설 수리는 20초(약 6시간) 걸린다'); // 20 s of a 70 s day is 6.86 hours
    expect(common).toContain('다시 들어오면 바로 "power back"이 남는다');
    expect(common).toContain('전력 부족 알림은 시설이 다시 끊길 때마다 울린다');
    expect(common).not.toContain('steady for');
  });

  it("tells, in its own words, what milestone 1's datasheet told about the sandbox, failed ticks, sleep, and RAM", () => {
    const da = boardManual(town, 'DA')!;
    expect(
      missing(
        [
          '배포를 넘어 이어지는 것은 `mem`뿐이다',
          '코드는 RAM에 세지 않는다',
          '`mem`에서 필요 없는 것부터 비워야 한다',
          '약간의 여유가 더 주어진다',
          '`string.format`은 `%p`를 거부한다',
          '주소는 어디에서도 보이지 않는다',
          '`coroutine.close`는 없다',
          '`<close>` 핸들러가 돌지 않는다',
          '스택이 풀린 뒤에 돌고, 명령어 상한에 닿은 뒤에는 돌지 않는다',
          '행동이 아니라서 행동 전자파가 없고, 틱이 실패해도 남는다',
          '그 틱의 로그 줄과 `mem`에 쓴 값은 남는다',
          '`io.sleep()` 뒤에 부른 행동은 버려지고, 앞에 부른 행동은 적용된다',
          '보드가 자는 동안에도 시설은 멈추지 않는다',
          '200바이트(한글 약 66자)',
          '아직 수거되지 않은 쓰레기까지 센다',
          '쓰레기만으로 "out of RAM"이 나지는 않는다',
          '사람이 손으로 하는 일(수확, 트럭 보내기, 화력과 공급 순서 정하기)은 전자파가 없다',
          '그 시설을 보드째 통째로 부순다',
          '먼저 시설을 수리하고',
          '목록과 표로 된 센서(예: `io.farms`)의 값도 틱마다 다시 쓰이므로',
        ].map((phrase) => [da, phrase] as const),
      ),
    ).toEqual([]);
  });

  it('lists every board slot in the index, then the common rules', () => {
    const index = manualIndex(town);
    expect(index).toMatch(/^# 매뉴얼 목차\n/);
    expect(index).toContain('보드를 달 수 있는 시설은 7곳이다');
    for (const line of ['- `P`: 발전소, (4, 4)', '- `DA`: 데이터센터, (5, 4)', '- `W`: 물류창고, (11, 6)', '- `F3`: 밭, (4, 9)']) {
      expect(index).toContain(line);
    }
    expect(index).not.toContain('- `H1`');
    expect(index.indexOf('## 공통 규칙')).toBeGreaterThan(index.indexOf('- `F3`'));
  });

  it('uses only the markdown that the viewer renders', () => {
    const docs = [commonManual(town), manualIndex(town), ...BOARDS.map((id) => boardManual(town, id)!)];
    for (const doc of docs) {
      const lines = doc.split('\n');
      let fenced = false;
      lines.forEach((line, i) => {
        if (line.startsWith('```')) {
          expect(line, `line ${i}`).toBe(fenced ? '```' : '```lua');
          fenced = !fenced;
          return;
        }
        if (fenced) return;
        // A heading, a list item, a table row, a paragraph that starts with a letter or inline code, or a blank line.
        expect(line, `line ${i}: ${line}`).toMatch(/^$|^#{1,3} \S|^- \S|^\|.*\|$|^[^\s#\-|>*+<\d]/);
        // A table's second row is its separator.
        if (line.startsWith('|') && !lines[i - 1]?.startsWith('|')) expect(lines[i + 1], `line ${i + 1}`).toMatch(/^\|(---\|)+$/);
      });
      expect(fenced).toBe(false);
      // No HTML, which the viewer never renders. Inline code may show a tag, as the sandbox rules show `<close>`.
      expect(doc.replace(/`[^`]*`/g, '')).not.toMatch(/<\/?[a-z]/i);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/test/manual.test.ts`
Expected: FAIL, `Failed to resolve import "../src/manual.ts"`.

- [ ] **Step 3: Write the manual generator**

`packages/core/src/manual.ts`:

```ts
import { LOG_LIMIT } from './boards.ts';
import { idiv, MILLI } from './fixed.ts';
import {
  BOARD_KINDS,
  type BoardKind,
  type BoardSpec,
  type FacilityKind,
  type FacilitySpec,
  type Scenario,
  type SensorName,
  takesBoard,
} from './scenario.ts';
import { SENSOR_KEYS } from './sensors.ts';
import { manhattan } from './world.ts';

/*
 * The board manual (spec 2026-10-10 §9). It is game text the player reads, so it is Korean, with English identifiers. Every number
 * in it is the scenario's own. It uses only the markdown the viewer renders: #, ## and ### headings, paragraphs, "- " lists, pipe
 * tables with a header row, fenced lua blocks, inline code and bold. A Korean particle after a bare number depends on how the number
 * is read, so a number is always followed by a unit or by a particle that fits any word (의, 씩, 까지, 만큼, 만).
 */

/** The facility kinds as the player reads them. */
const KIND_NAMES: Record<FacilityKind, string> = {
  power: '발전소',
  datacenter: '데이터센터',
  farm: '밭',
  warehouse: '물류창고',
  housing: '주거지',
};

/** A milli-unit amount as a short decimal: 2000 is "2", 800 is "0.8", 95050 is "95.05". Milliseconds read as seconds the same way. */
function milli(amount: number): string {
  const fraction = String(amount % MILLI)
    .padStart(3, '0')
    .replace(/0+$/, '');
  return fraction === '' ? String(idiv(amount, MILLI)) : `${idiv(amount, MILLI)}.${fraction}`;
}

/** Per mille as a percentage: 3 is "0.3", 25 is "2.5", 10 is "1". */
function permille(n: number): string {
  return n % 10 === 0 ? String(idiv(n, 10)) : `${idiv(n, 10)}.${n % 10}`;
}

/** Game seconds with the days or hours they make in the scenario: "120초(3일)", "20초(12시간)", "20초(약 6시간)". */
function span(scenario: Scenario, seconds: number): string {
  const day = scenario.time.secondsPerDay;
  if (seconds % day === 0) return `${seconds}초(${seconds / day}일)`;
  const exact = (seconds * 24) % day === 0;
  return `${seconds}초(${exact ? '' : '약 '}${idiv(seconds * 24, day)}시간)`;
}

const code = (text: string): string => `\`${text}\``;

const list = (items: readonly string[]): string => items.map((item) => `- ${item}`).join('\n');

const table = (head: readonly string[], rows: ReadonlyArray<readonly string[]>): string =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');

/** A heading and its blocks (paragraphs, lists, tables, a fenced code block), rendered at whatever level it sits. */
interface Section {
  readonly title: string;
  readonly blocks: readonly string[];
}

function render(sections: readonly Section[], level: number): string {
  const hashes = '#'.repeat(level);
  return sections.map((s) => [`${hashes} ${s.title}`, ...s.blocks].join('\n\n')).join('\n\n');
}

function plantOf(scenario: Scenario): FacilitySpec {
  const plant = scenario.facilities.find((f) => f.kind === 'power');
  if (!plant) throw new Error('the scenario has no power plant');
  return plant;
}

const ofKind = (scenario: Scenario, kind: FacilityKind): FacilitySpec[] => scenario.facilities.filter((f) => f.kind === kind);

interface SensorDoc {
  readonly meaning: string;
  readonly unit: string;
  readonly range: string;
}

/** What each sensor reads. */
function sensorDocs(scenario: Scenario): Record<SensorName, SensorDoc> {
  const t = scenario.tuning;
  const dc = t.datacenter;
  return {
    wind: { meaning: '풍력 모듈이 지금 내는 전력. 비용이 없다', unit: '전력', range: `0~${t.wind.max}, 초당 최대 ${t.wind.maxChangePerSecond}씩 변한다` },
    demand: { meaning: '이번 스텝에 마을 전체가 요청한 전력. 송전 손실까지 넣은 값', unit: '전력', range: '0 이상' },
    fuelPrice: {
      meaning: '화력 출력 1단위를 하루 돌리는 연료비. 매일 새로 정해진다',
      unit: '돈/단위·일',
      range: `${t.fuelPrice.min}~${t.fuelPrice.max}`,
    },
    temp: {
      meaning: '이 데이터센터의 온도',
      unit: '°C, 소수',
      range: `${milli(dc.ambientMilli)} 이상. ${milli(dc.fireThresholdMilli)}°C 위에서는 불이 날 수 있다`,
    },
    powerHeadroom: { meaning: '발전량에서 수요를 뺀 값. 음수면 발전소가 시설을 끊고 있다', unit: '전력', range: '음수일 수 있다' },
    price: {
      meaning: '지금의 작업 단가. 처리하는 1초마다 이만큼 번다',
      unit: '돈/처리 1초',
      range: `${t.jobPrice.min}~${t.jobPrice.max}, 초당 최대 ${t.jobPrice.maxChangePerSecond}씩 변한다`,
    },
    emf: { meaning: '이 보드가 있는 칸의 전자파', unit: '전자파, 소수', range: '0 이상' },
    ludditeDist: { meaning: '가장 가까운 러다이트 무리까지의 거리', unit: '칸', range: '0 이상. 지도에 무리가 없으면 nil' },
    ripeness: { meaning: '작물이 익은 정도. 100이면 익어서 거둘 수 있다', unit: '%', range: '0~100' },
    outbox: { meaning: '출고함에 쌓인 식량', unit: '식량', range: `0~${t.farm.outboxCapacity}` },
    stock: { meaning: '이 창고에 보관된 식량', unit: '식량', range: '0 이상' },
    farms: {
      meaning: `밭마다 ${code('{ id, outbox, distance }')}: 출고함의 식량, 이 창고에서의 거리(칸)`,
      unit: '목록',
      range: `밭 ${ofKind(scenario, 'farm').length}곳, 지도 순서`,
    },
    housing: {
      meaning: `주거지마다 ${code('{ id, food, residents, distance }')}: 남은 식량, 주민 수, 이 창고에서의 거리(칸)`,
      unit: '목록',
      range: `주거지 ${ofKind(scenario, 'housing').length}곳, 지도 순서`,
    },
    trucks: {
      meaning: `트럭마다 ${code('{ id, status, x, y, load, target }')}: status는 "idle"(창고에서 대기), "outbound"(가는 중), "returning"(돌아오는 중). x와 y는 지금 칸, load는 실은 식량, target은 가는 곳의 id(대기 중이면 nil)`,
      unit: '목록',
      range: `트럭 ${t.warehouse.trucks}대, id 1~${t.warehouse.trucks}`,
    },
  };
}

interface ActionDoc {
  readonly call: string;
  readonly meaning: string;
}

/** The calls of each kind of board, and the two every board has. */
function actionDocs(scenario: Scenario): Record<BoardKind | 'any', readonly ActionDoc[]> {
  const t = scenario.tuning;
  const dc = t.datacenter;
  return {
    datacenter: [
      {
        call: 'io.process()',
        meaning: `지금부터 ${milli(dc.jobMs)}초 동안 데이터센터를 돌린다. 이미 돌고 있으면 끝나는 시각을 지금부터 ${milli(dc.jobMs)}초 뒤로 다시 잡는다(쌓이지 않는다)`,
      },
      {
        call: 'io.cool()',
        meaning: `냉각을 한 번 돌린다: ${milli(dc.coolingCycleMs)}초에 걸쳐 ${milli(dc.coolingDropMilli)}°C를 낮춘다. 냉각 중이면 아무 일도 없다`,
      },
    ],
    power: [
      { call: 'io.set_thermal(output)', meaning: `화력 출력을 정한다(0~${t.thermal.max}). 다시 정할 때까지 그대로다` },
      {
        call: 'io.set_priority({ids})',
        meaning: '전력이 모자랄 때 지킬 순서를 높은 쪽부터 정한다. 예: {"H1", "DA"}. 빠진 시설은 지도 순서로 뒤에 온다. 모르는 id는 그 틱을 에러로 끝낸다',
      },
    ],
    farm: [{ call: 'io.harvest()', meaning: `익은 작물을 거둬 ${t.farm.yield}의 식량을 출고함에 넣고 바로 다시 심는다. 익지 않았으면 아무 일도 없다` }],
    warehouse: [
      {
        call: 'io.dispatch(truck, from, to, amount)',
        meaning: `트럭 하나를 보낸다. 회수는 from이 밭, to가 이 창고. 배달은 from이 이 창고, to가 주거지. amount는 1~${t.warehouse.truckCapacity}. 대기 중인 트럭만 떠나고, 맞지 않는 요청은 아무 일도 없다. 모르는 id는 그 틱을 에러로 끝낸다`,
      },
    ],
    any: [
      {
        call: 'io.log(...)',
        meaning: '로그에 한 줄을 남긴다(print도 같다). 틱마다 20줄, 줄마다 200바이트(한글 약 66자)까지. 행동이 아니라서 행동 전자파가 없고, 틱이 실패해도 남는다',
      },
      {
        call: 'io.sleep(seconds)',
        meaning: `1~${t.maxSleepSeconds}초 동안 깊이 잠든다. 조용하고 전력도 ${t.sleepPower}만 쓰지만, RAM(mem과 전역 변수)이 지워진다`,
      },
    ],
  };
}

/** What each kind of facility is for, in a paragraph. */
const ROLES: Record<BoardKind, string> = {
  power:
    '발전소는 마을 전체에 전력을 댄다. 풍력은 날씨를 따라 공짜로 나오고, 화력은 정한 만큼 나오지만 연료비가 든다. 이 보드의 펌웨어는 화력 출력과, 전력이 모자랄 때 누구부터 끊을지를 정한다.',
  datacenter:
    '데이터센터는 마을의 돈줄이다. 처리하는 동안 작업 단가만큼 벌지만, 전력을 많이 먹고, 뜨거워지고, 전자파를 낸다. 이 보드의 펌웨어는 언제 처리하고 언제 식힐지를 정한다. 데이터센터는 그 자체가 기계라서, 보드가 없어도 일하는 동안에는 러다이트의 표적이 된다.',
  farm: '밭은 작물을 기른다. 익은 작물을 거두면 출고함에 식량이 쌓이고, 물류창고의 트럭이 그것을 가져간다. 이 보드의 펌웨어는 언제 거둘지를 정한다. 거두지 않고 두면 작물이 썩는다.',
  warehouse:
    '물류창고는 식량을 옮긴다. 트럭으로 밭의 출고함에서 식량을 걷어 와 보관하고, 주거지로 배달한다. 이 보드의 펌웨어는 어느 트럭을 어디로 얼마나 보낼지를 정한다. 주민은 먹을 것이 있어야 세금을 낸다.',
};

/** The rules of one kind of facility, as blocks: a list, and for the warehouse the distances it works with. */
function facilityRules(scenario: Scenario, f: FacilitySpec, kind: BoardKind, board: BoardSpec): string[] {
  const t = scenario.tuning;
  const day = scenario.time.secondsPerDay;
  switch (kind) {
    case 'power': {
      const consumers = scenario.facilities.filter((x) => x.kind !== 'power').map((x) => code(x.id));
      return [
        list([
          `발전량은 풍력과 화력의 합이다. 풍력은 날씨를 따라 0~${t.wind.max} 사이에서 초당 최대 ${t.wind.maxChangePerSecond}씩 변하고, 비용이 없다.`,
          `화력은 정한 출력 그대로 나온다(0~${t.thermal.max}). 출력 1단위에 하루 ${code('fuel_price')}(${t.fuelPrice.min}~${t.fuelPrice.max}, 매일 바뀐다)가 든다. 하루는 ${day}초이므로 출력 1단위의 초당 연료비: ${code('fuel_price')} / ${day}.`,
          `${code('io.set_thermal(output)')}와 손의 [화력], ${code('io.set_priority({ids})')}와 손의 [공급 순서]는 같은 설정을 바꾼다. 나중에 바꾼 쪽이 이긴다.`,
          '화력 설정과 공급 순서는 마을의 것이다. 보드가 자거나 부서져도 남는다. 발전소가 부서져 있는 동안 화력은 0이고 풍력만 나온다.',
          `공급 순서에 쓸 수 있는 id: ${consumers.join(', ')}. 기본 순서는 이 지도 순서다.`,
          '발전소 자신의 보드는 끊기지 않는다.',
        ]),
      ];
    }
    case 'datacenter': {
      const dc = t.datacenter;
      // Firmware that calls process() on every beat keeps the datacenter running when a job outlasts the beat.
      const continuous = board.clockHz * dc.jobMs >= 1000;
      return [
        list([
          `${code('io.process()')}와 손의 [처리]는 같은 일을 한다: 데이터센터가 도는 끝 시각을 지금부터 ${milli(dc.jobMs)}초 뒤로 잡는다. ${continuous ? '이 보드가 박자마다 부르면 쉬지 않고 돈다' : '이 보드의 박자는 그보다 길어서, 박자마다 불러도 사이사이 쉰다'}.`,
          `처리하는 1초마다 그때의 단가(${code('price')})만큼 번다.`,
          `처리하는 동안 ${dc.processPower}의 전력을 더 쓰고, 초당 ${milli(dc.heatMilliPerSecond)}°C씩 뜨거워지고, 초당 ${t.emf.processingPerSecond}의 전자파를 낸다.`,
          `가만히 두면 매초 (온도 − ${milli(dc.ambientMilli)}°C)의 ${permille(dc.passiveCoolingPermillePerSecond)}%씩만 식는다. 아주 느리다.`,
          `${code('io.cool()')}과 손의 [냉각]은 같은 일을 한다: ${milli(dc.coolingCycleMs)}초에 걸쳐 고르게 ${milli(dc.coolingDropMilli)}°C를 낮추고, 그동안 ${dc.coolingPower}의 전력을 쓴다. 냉각 중에 다시 부르면 아무 일도 없다. 처리와 냉각은 함께 돌 수 있다.`,
          '전력이 끊기면 처리도 냉각도 멈춘다.',
          `${milli(dc.overheatAlertMilli)}°C에 닿으면 과열 알림이 뜬다. ${milli(dc.fireThresholdMilli)}°C를 넘으면 매초, 넘은 1°C마다 ${permille(dc.firePermillePerDegreePerSecond)}%의 확률로 불이 나서 데이터센터가 보드째 부서진다.`,
          '데이터센터는 그 자체로 기계다. 보드가 없어도 일한 칸의 전자파가 감지되면 러다이트가 찾아와 부순다.',
          `수리된 데이터센터는 상온(${milli(dc.ambientMilli)}°C)에서 다시 시작한다.`,
        ]),
      ];
    }
    case 'farm':
      return [
        list([
          `작물은 심은 지 ${span(scenario, t.farm.ripenSeconds)} 뒤에 익는다. ${code('ripeness')}는 그동안 0에서 100으로 오른다.`,
          `익은 채로 ${span(scenario, t.farm.rotSeconds)}이 지나면 썩어서 사라지고, 그 자리에 바로 다시 심는다.`,
          `${code('io.harvest()')}와 손의 [수확]은 같은 일을 한다: ${t.farm.yield}의 식량을 출고함에 넣고 바로 다시 심는다. 출고함은 ${t.farm.outboxCapacity}까지이고, 넘치는 만큼은 버려진다.`,
          '출고함의 식량은 물류창고의 트럭이 가져간다.',
          '밭은 보드가 없어도 자란다. 보드는 수확을 대신할 뿐이다.',
          '수리된 밭은 그때 새로 심는다.',
        ]),
      ];
    case 'warehouse': {
      const w = t.warehouse;
      const h = t.housing;
      const served = scenario.facilities.filter((x) => x.kind === 'farm' || x.kind === 'housing');
      return [
        list([
          `트럭은 ${w.trucks}대이고 한 대에 ${w.truckCapacity}까지 싣는다. 초당 ${w.truckCellsPerSecond}칸을 가고, 새 칸에 들어설 때마다 연료비로 ${w.fuelPerCell}씩 든다.`,
          '길은 격자선을 따라 가로 먼저, 그다음 세로로 간다.',
          `회수: ${code(`io.dispatch(truck, 밭 id, "${f.id}", amount)`)}. 트럭이 밭에 닿을 때 min(amount, 출고함, ${w.truckCapacity})만큼 싣고 돌아와 재고에 넣는다.`,
          `배달: ${code(`io.dispatch(truck, "${f.id}", 주거지 id, amount)`)}. 떠날 때 min(amount, 재고, ${w.truckCapacity})만큼 싣고 주거지에 내려 준 뒤 빈 차로 돌아온다. 재고가 1보다 적으면 떠나지 않는다.`,
          '손의 [트럭 보내기]도 같은 일을 한다. 대기 중인 트럭만 떠난다.',
          `재고는 하루에 ${w.spoilagePctPerDay}%씩 상한다.`,
          `주거지 블록마다 주민 ${h.residents}명이 살고, 한 명이 하루 ${h.foodPerPersonPerDay}씩 먹는다. 먹을 것이 떨어지면 굶고 세금을 내지 않는다. 먹고 전기가 들어오는 주민은 한 명당 하루 ${h.taxPerPersonPerDay}씩 세금을 낸다.`,
          `시즌을 시작할 때 주거지 블록마다 식량이 ${h.startFood}만큼 있다.`,
          '창고가 부서지면 새 트럭을 보낼 수 없다. 이미 길에 있는 트럭은 하던 일을 마친다.',
        ]),
        table(
          ['대상', '시설', '위치', '이 창고에서'],
          served.map((x) => [code(x.id), KIND_NAMES[x.kind], `(${x.x}, ${x.y})`, `${manhattan(f.x, f.y, x.x, x.y)}칸`]),
        ),
      ];
    }
  }
}

/** The board's own sections: its role, parts, io fields, actions, and its facility's rules. */
function boardSections(scenario: Scenario, f: FacilitySpec, kind: BoardKind, board: BoardSpec): Section[] {
  const t = scenario.tuning;
  const plant = plantOf(scenario);
  const sensors = sensorDocs(scenario);
  const actions = actionDocs(scenario);
  const time = scenario.time;
  return [
    { title: '이 보드가 하는 일', blocks: [ROLES[kind]] },
    {
      title: '부품',
      blocks: [
        table(
          ['항목', '값'],
          [
            ['클럭', `${board.clockHz} Hz: 1초에 ${board.clockHz}번 틱`],
            ['틱당 명령어 상한', String(board.instructionCap)],
            ['RAM', `${board.ramKb} KB (${board.ramKb * 1024}바이트)`],
            ['센서', board.sensors.map((s) => code(SENSOR_KEYS[s])).join(', ')],
            ['보드 전력', `깨어 있을 때 ${board.power}, 자는 동안 ${t.sleepPower}`],
            ['기본 전자파', `초당 ${board.baseEmfPerSecond}, 통신 모듈을 달면 ${board.baseEmfPerSecond + t.install.commBaseEmfPerSecond}`],
            ['위치', `(${f.x}, ${f.y}), 발전소까지 ${manhattan(f.x, f.y, plant.x, plant.y)}칸`],
            ['보드 설치', String(t.install.boardPrice[kind])],
            ['통신 모듈', String(t.install.commPrice)],
            ['시설 수리', String(t.repair.cost[kind])],
          ],
        ),
      ],
    },
    {
      title: 'io로 읽는 값',
      blocks: [
        table(
          ['이름', '뜻', '단위', '범위'],
          [
            ...board.sensors.map((s): string[] => [code(SENSOR_KEYS[s]), sensors[s].meaning, sensors[s].unit, sensors[s].range]),
            [code('day'), '시즌의 날', '일', `1~${time.seasonDays}`],
            [code('clock'), '시즌이 시작된 뒤 흐른 게임 시간', '초, 소수', `0~${time.seasonDays * time.secondsPerDay}`],
          ],
        ),
      ],
    },
    {
      title: 'io로 하는 행동',
      blocks: [table(['호출', '하는 일'], [...actions[kind], ...actions.any].map((a) => [code(a.call), a.meaning]))],
    },
    { title: `${KIND_NAMES[kind]}의 규칙`, blocks: facilityRules(scenario, f, kind, board) },
  ];
}

/** The rules every board runs under. */
function commonSections(scenario: Scenario): Section[] {
  const t = scenario.tuning;
  const time = scenario.time;
  const day = time.secondsPerDay;
  const dc = t.datacenter;
  const e = t.emf;
  const l = t.luddites;
  const quiet = t.shortageQuietSeconds;
  const plant = plantOf(scenario);
  return [
    {
      title: '마을',
      blocks: [
        `지도는 ${scenario.grid.width} × ${scenario.grid.height}칸이다. 위치는 (열, 행)이고 왼쪽 위가 (0, 0)이다. 거리는 가로와 세로 칸 수의 합이다.`,
        table(
          ['id', '시설', '위치', '발전소까지'],
          scenario.facilities.map((f) => [code(f.id), KIND_NAMES[f.kind], `(${f.x}, ${f.y})`, `${manhattan(f.x, f.y, plant.x, plant.y)}칸`]),
        ),
      ],
    },
    {
      title: '실행 모델',
      blocks: [
        list([
          `보드는 CPU의 클럭 박자마다 ${code('tick(io, mem)')}을 한 번 부른다. 보드가 깨어 있고, 전력을 받고, 그 시설이 부서지지 않았을 때만 돈다.`,
          `세계는 1초에 ${time.stepsPerSecond} 스텝씩 흐르고, 보드는 자기 박자가 온 스텝에서만 펌웨어를 실행한다. 박자 사이에도 세계는 움직이므로 클럭이 느린 보드는 그만큼 늦게 알아챈다.`,
          `하루는 ${day}초, 시즌은 ${time.seasonDays}일이다. ${code('io.day')}는 시즌의 날(1부터), ${code('io.clock')}은 시즌이 시작된 뒤 흐른 게임 초다.`,
          `센서 값은 틱마다 ${code('io')}에 새로 쓰인다. 목록과 표로 된 센서(예: ${code('io.farms')})의 값도 틱마다 다시 쓰이므로, 펌웨어가 그 값을 바꿔도 다음 틱에는 센서가 읽은 값으로 돌아온다.`,
          `행동은 틱 동안 쌓였다가 틱이 끝나면 차례로 적용된다. 한 틱에 쌓을 수 있는 행동은 숫자 64개 분량이다: ${code('process')}, ${code('cool')}, ${code('harvest')}는 1, ${code('set_thermal')}과 ${code('sleep')}은 2, ${code('dispatch')}는 5, ${code('set_priority')}는 2에 id 수를 더한 만큼. 다 들어가지 않는 행동은 통째로 버려진다.`,
          `${code('mem')}은 틱과 틱, 배포와 배포 사이에 남는다. 전역 변수는 배포할 때마다 사라진다. 깊은 휴면과 시설 파괴는 둘 다 지운다.`,
          `배포할 때마다 새 ${code('io')}를 받는다. 배포를 넘어 이어지는 것은 ${code('mem')}뿐이다.`,
        ]),
        ['```lua', 'function tick(io, mem)', '  -- io: 이번 틱의 센서 값과 이 보드의 행동', '  -- mem: 틱과 배포 사이에 남는 기억', 'end', '```'].join('\n'),
      ],
    },
    {
      title: '배포',
      blocks: [
        list([
          '배포하면 먼저 문법을 검사한다. 문법 오류는 줄 번호와 함께 거부되고, 원래 펌웨어가 계속 돈다.',
          '받아들여진 펌웨어는 그 보드의 다음 틱에 설치되고, 버전 번호가 하나 오른다. 보드가 자고 있거나, 전력이 끊겼거나, 부서졌으면 그것이 풀린 뒤의 첫 틱에 설치된다.',
          `설치하는 틱에는 펌웨어의 맨 바깥 코드(메인 청크)가 먼저 돌고, 이어서 ${code('tick')}이 돈다. 메인 청크가 에러로 끝나면 그 틱이 실패하고, ${code('tick')}을 정의하기 전에 실패했다면 다음 배포가 설치될 때까지 매 틱 "noTick: the last deploy failed to install"과 원래 에러를 남긴다.`,
          `${code('tick')}을 정의하지 않은 펌웨어는 매 틱 "noTick: firmware defines no tick(io, mem) function"을 남긴다.`,
        ]),
      ],
    },
    {
      title: '오류와 로그',
      blocks: [
        list([
          '런타임 에러, 명령어 상한 초과, RAM 부족은 그 틱 하나만 실패시킨다. 실패한 틱은 로그에 남고 펌웨어 에러 알림이 뜨며, 다음 틱은 평소대로 돈다.',
          `실패한 틱의 행동은 모두 버려지지만, 그 틱의 로그 줄과 ${code('mem')}에 쓴 값은 남는다.`,
          `로그는 보드마다 최근 ${LOG_LIMIT}줄이고, 줄마다 게임 시각이 붙는다. ${code('io.log')}가 남긴 줄, 에러, 시스템 사건(설치, 휴면, 깨어남, 파괴, 재건, 정전과 복구)이 들어간다.`,
          '같은 줄이 연달아 오면 한 줄로 접히고 ×N이 붙는다. 사이에 다른 줄이 끼면 새 줄이 된다.',
          quiet > 0
            ? `보드의 시설이 전력망에서 끊기면 "power lost"가, 끊긴 뒤 ${quiet}초 동안 한 번도 끊기지 않으면 "power back (steady for ${quiet} s)"가 남는다. 깜빡이는 동안에는 "power lost"만 접혀서 쌓인다.`
            : '보드의 시설이 전력망에서 끊기면 "power lost"가, 다시 들어오면 바로 "power back"이 남는다.',
        ]),
      ],
    },
    {
      title: 'CPU와 RAM',
      blocks: [
        list([
          '한 틱에 실행할 수 있는 명령어 수는 보드마다 정해진 상한까지다(각 보드의 부품 표). 상한에 닿으면 그 틱은 "CPU limit exceeded"로 중단되고, 전자파 계산에서는 상한을 다 쓴 것으로 센다. 무한 루프에 빠진 보드는 마을에서 가장 시끄러운 보드가 된다.',
          `${code('pcall')}도 코루틴도 이 상한을 피하지 못한다.`,
          `일을 많이 하는 내장 함수(${code('string.rep')}, ${code('table.concat')}, ${code('table.sort')} 등)는 그 일의 양만큼 명령어를 쓴다.`,
          `RAM은 고정된 기준선 위의 펌웨어 데이터다: ${code('mem')}, 전역 변수, 틱이 할당한 것. 코드는 RAM에 세지 않는다. 넘으면 그 틱은 "out of RAM"으로 실패한다.`,
          `"out of RAM" 뒤에도 ${code('mem')}은 데이터를 그대로 들고 있다. 그러니 새 펌웨어는 첫 틱에 ${code('mem')}에서 필요 없는 것부터 비워야 한다. 그 첫 틱에는 약간의 여유가 더 주어진다.`,
          '보고되는 RAM 사용량은 아직 수거되지 않은 쓰레기까지 센다. 그래서 무언가를 비운 직후에도 높게 나올 수 있다. 쓰레기만으로 "out of RAM"이 나지는 않는다: 할당을 거부하기 전에 먼저 수거한다.',
        ]),
      ],
    },
    {
      title: 'Lua 샌드박스',
      blocks: [
        list([
          `쓸 수 있는 것: 기본 라이브러리(${code('pairs')}, ${code('ipairs')}, ${code('pcall')}, ${code('setmetatable')} 등), ${code('string')}, ${code('table')}, ${code('math')}, ${code('coroutine')}.`,
          `없는 것: ${code('os')}, ${code('io')} 라이브러리, ${code('load')}, ${code('require')}, ${code('debug')}, ${code('collectgarbage')}, ${code('utf8')}, ${code('string.dump')}, ${code('string.pack')}, ${code('string.unpack')}.`,
          `${code('string.find')}는 패턴 없이 글자 그대로만 찾는다. ${code('string.match')}, ${code('string.gmatch')}, ${code('string.gsub')}는 없다.`,
          `${code('math.randomseed')}는 없고, ${code('math.random')}은 보드마다 정해진 씨앗으로 시작한다.`,
          `${code('__tostring')}이 없는 표나 함수를 ${code('tostring')}하면 종류만 나온다. 주소는 어디에서도 보이지 않는다. ${code('string.format')}은 ${code('%p')}를 거부한다.`,
          `${code('setmetatable')}은 ${code('__gc')}와 ${code('__mode')}를 거부한다.`,
          `${code('coroutine.close')}는 없다. 에러로 끝난 코루틴은 닫히지 않아서 그 ${code('<close>')} 핸들러가 돌지 않는다.`,
          `${code('xpcall')}의 핸들러는 스택이 풀린 뒤에 돌고, 명령어 상한에 닿은 뒤에는 돌지 않는다.`,
          `${code('pairs')}나 ${code('next')}로 도는 중에 표에 키를 더하면 순서가 정해지지 않는다.`,
        ]),
      ],
    },
    {
      title: '깊은 휴면',
      blocks: [
        list([
          `${code('io.sleep(seconds)')}는 보드를 1~${t.maxSleepSeconds}초 동안 재운다. 틱이 끝나면 잠든다. 잠든 보드는 전자파를 내지 않고 전력은 ${t.sleepPower}만 쓴다.`,
          `휴면은 RAM을 지운다: 깨어나면 ${code('mem')}과 전역 변수가 비어 있고, 펌웨어가 처음부터 다시 설치된다.`,
          `같은 틱에서 ${code('io.sleep()')} 뒤에 부른 행동은 버려지고, 앞에 부른 행동은 적용된다.`,
          '보드가 자는 동안에도 시설은 멈추지 않는다. 손으로 돌릴 수 있고, 시설의 설정(화력 출력, 공급 순서)과 이미 시작된 데이터센터의 작업과 냉각은 그대로 간다.',
        ]),
      ],
    },
    {
      title: '전력',
      blocks: [
        list([
          '발전소의 발전량(풍력과 화력)이 모든 시설에 나뉜다. 전력은 저장되지 않는다.',
          `시설의 수요는 이것들의 합이다: 보드(깨어 있으면 부품 표의 전력, 자면 ${t.sleepPower}), 데이터센터의 처리(${dc.processPower})와 냉각(${dc.coolingPower}), 주거지 블록마다 ${t.housing.power}. 부서졌거나 수리 중인 시설은 아무것도 쓰지 않는다.`,
          `송전 손실: 발전소에서 한 칸 멀어질 때마다 그 시설의 수요가 ${t.transmissionLossPctPerCell}%씩 늘어난다.`,
          `한 스텝의 발전량이 모자라면 공급 순서가 낮은 시설부터 통째로 끊긴다. 공급 순서는 발전소가 정한다(발전소 보드의 ${code('set_priority')}, 또는 손으로). 정하지 않은 시설은 지도 순서로 뒤에 온다. 발전소 자신의 보드는 끊기지 않는다.`,
          `전력이 끊긴 보드는 틱을 돌리지 않고 ${code('mem')}은 그대로 둔다. 시설은 손으로 돌릴 수 있지만, 데이터센터의 처리와 냉각처럼 전력이 드는 일은 멈춘다. 주거지가 끊기면 그 주민은 세금을 내지 않는다.`,
          quiet > 0
            ? `전력 부족 알림은 한 번 울리면, 마을이 ${quiet}초 동안 한 번도 끊기지 않아야 다시 울린다.`
            : '전력 부족 알림은 시설이 다시 끊길 때마다 울린다.',
        ]),
      ],
    },
    {
      title: '돈',
      blocks: [
        list([
          `시작 자금은 ${scenario.startMoney}이다. 점수는 시즌이 끝났을 때의 자금이다.`,
          '들어오는 돈: 데이터센터의 처리, 주거지의 세금.',
          `나가는 돈: 화력 연료, 트럭 연료, 보드 유지비(설치된 보드마다 하루 ${t.boardUpkeepPerDay}), 보드와 통신 모듈 설치, 시설 수리, 보드 재건.`,
          `자금이 ${t.bankruptcyDays}일 연속 0보다 적으면 파산으로 시즌이 끝난다.`,
        ]),
        table(
          ['시설', '보드 설치', '시설 수리'],
          BOARD_KINDS.map((k) => [KIND_NAMES[k], String(t.install.boardPrice[k]), String(t.repair.cost[k])]),
        ),
        list([
          `통신 모듈: ${t.install.commPrice}. 보드의 기본 전자파가 초당 ${t.install.commBaseEmfPerSecond} 늘어난다.`,
          `시설 수리는 ${span(scenario, t.repair.seconds)} 걸린다. 보드 재건은 ${t.rebuild.cost}이고 ${span(scenario, t.rebuild.seconds)} 걸린다.`,
        ]),
      ],
    },
    {
      title: '전자파',
      blocks: [
        list([
          `깨어 있고 전력을 받는 보드는 아무 일을 안 해도 초당 기본 전자파(부품 표)를 낸다. 통신 모듈이 있으면 ${t.install.commBaseEmfPerSecond} 더 낸다.`,
          `틱마다: 명령어 ${e.instructionsPerUnit}개마다 1, 그리고 펌웨어가 시킨 기계의 행동(${code('harvest')}, ${code('dispatch')}, ${code('set_thermal')}, ${code('set_priority')}, ${code('cool')}) 하나마다 ${e.perAction}. ${code('process')}, ${code('sleep')}, ${code('log')}는 행동으로 세지 않는다.`,
          `데이터센터는 처리하는 동안 초당 ${e.processingPerSecond}의 전자파를 낸다. 손으로 [처리]를 눌렀든 펌웨어가 시켰든 같다.`,
          '사람이 손으로 하는 일(수확, 트럭 보내기, 화력과 공급 순서 정하기)은 전자파가 없다.',
          `전자파는 그 시설의 칸에 쌓인다. 매초 각 칸이 이웃 네 칸에 ${e.diffusionPctPerSecond}%씩 나눠 주고, 지도 전체가 매초 ${e.decayPctPerSecond}%씩 줄어든다.`,
          `소문 게이지가 매초 지도 전체의 전자파를 모은다. ${e.rumourThreshold}에 닿을 때마다 러다이트 무리가 나타나고 게이지는 비워진다. 시끄러운 마을일수록 자주 습격받는다.`,
        ]),
      ],
    },
    {
      title: '러다이트와 화재',
      blocks: [
        list([
          `무리는 ${l.groupSize}명이고, 지도 가장자리의 한 점에서 나타난다.`,
          `초당 ${l.cellsPerSecond}칸씩 걷고, 칸마다 감지되는 가장 강한 전자파로 다시 겨눈다. 감지되는 것은 전자파가 ${e.detectionThreshold} 이상인 칸이고, 노리는 것은 기계다: 보드가 있는(깨어 있거나 자는) 시설과 데이터센터.`,
          '표적에 닿으면 그 시설을 보드째 통째로 부순다. 부서진 시설은 손으로도 돌릴 수 없다.',
          `감지되는 것이 ${l.quietSecondsToLeave}초 동안 없으면 가장 가까운 가장자리로 떠난다.`,
          `무리가 시설에서 ${l.approachCells}칸 안으로 들어오면 접근 알림이 뜬다.`,
          `데이터센터가 ${milli(dc.fireThresholdMilli)}°C를 넘으면 매초, 넘은 1°C마다 ${permille(dc.firePermillePerDegreePerSecond)}%의 확률로 불이 난다. 불도 데이터센터를 보드째 부순다.`,
          `복구는 두 단계다. 먼저 시설을 수리하고(위의 표), 그다음 보드를 재건한다. 재건된 보드는 부품, 통신 모듈, 마지막 펌웨어를 그대로 가지고 돌아오고 ${code('mem')}은 비어 있다. 수리와 재건은 플레이어만 할 수 있다.`,
        ]),
      ],
    },
  ];
}

/** The common rules on their own: what every board's firmware runs under. */
export function commonManual(scenario: Scenario): string {
  return ['# 공통 규칙', '모든 보드의 펌웨어가 따르는 규칙이다. 모든 숫자는 이 마을의 설정 그대로다.', render(commonSections(scenario), 2)].join(
    '\n\n',
  );
}

/** One board slot's manual: the common rules first, then the board's own sections. Null for an unknown id or a facility that takes no board. */
export function boardManual(scenario: Scenario, facilityId: string): string | null {
  const f = scenario.facilities.find((x) => x.id === facilityId);
  if (!f) return null;
  const kind = f.kind;
  const board = f.board;
  if (!takesBoard(kind) || board === null) return null;
  const name = KIND_NAMES[kind];
  return [
    `# ${f.id} 보드 매뉴얼: ${name}`,
    `이 문서는 ${code(f.id)} 보드(${name}, 지도의 (${f.x}, ${f.y}))의 펌웨어를 직접 작성하는 데 필요한 것을 모두 담고 있다. 펌웨어는 Lua 5.4로 쓰고, 게임 안 편집기에서 배포한다. 모든 숫자는 이 마을의 설정 그대로다. 먼저 모든 보드에 공통인 규칙이 오고, 그다음 이 보드만의 규칙이 온다.`,
    '## 공통 규칙',
    render(commonSections(scenario), 3),
    render(boardSections(scenario, f, kind, board), 2),
  ].join('\n\n');
}

/** The index: every board slot, then the common rules. */
export function manualIndex(scenario: Scenario): string {
  const slots = scenario.facilities.filter((f) => takesBoard(f.kind) && f.board !== null);
  return [
    '# 매뉴얼 목차',
    `이 마을에서 보드를 달 수 있는 시설은 ${slots.length}곳이다. 보드마다 매뉴얼이 있고, 모든 매뉴얼은 아래의 공통 규칙으로 시작한다.`,
    list(slots.map((f) => `${code(f.id)}: ${KIND_NAMES[f.kind]}, (${f.x}, ${f.y})`)),
    '## 공통 규칙',
    render(commonSections(scenario), 3),
  ].join('\n\n');
}
```

**Two things to check against the code.**
- **The scenario types.** If Task 1 typed `FacilitySpec['board']` as a union that `board === null` does not narrow, narrow it with a local `const board: BoardSpec | null = f.board;`.
- **The text versus the rules.** If Tasks 5 to 9 settled any rule differently from contract §4 and §7 to §12, the manual must say what the code does. Change the sentence and its test phrase together. Examples are the rounding of the passive cooling and what a wrecked plant generates.

- [ ] **Step 4: Export it**

In `packages/core/src/index.ts`, add after `export * from './luddites.ts';`:

```ts
export * from './manual.ts';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core/test/manual.test.ts`
Expected: PASS, 9 tests.


- [ ] **Step 6: Write the failing agent-tool tests**

Replace `packages/core/test/agent-tools.test.ts` with:

```ts
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
    for (const source of ['\u0000', '\u0000function tick() end', 'function tick() end\u0000', 'function tick() end\u0000\nerror("never runs")']) {
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
    const { description } = tool('get_alerts');
    for (const kind of ['raids', 'wrecked facilities', 'fires', 'overheating', 'power shortages', 'hunger', 'firmware errors']) {
      expect(description, kind).toContain(kind);
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
```

The `ToolError` test builds contract §6's `noComm` refusal, `{ code: 'noComm', board }`, which Tasks 2 to 4 add to `refusal.ts` with the other new codes.

- [ ] **Step 7: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/test/agent-tools.test.ts`
Expected: FAIL. `get_datasheet` still calls `api.datasheet`, which the new fakes lack, and the descriptions and the instructions are milestone 1's. Among the failures:
- "hands over a board's manual as the game gives it, and refuses an unknown board": `api.datasheet is not a function`;
- "explains the tiers in list_boards";
- "puts no tuning number in a description: the manual carries them, from the scenario".

`pnpm typecheck` fails too: the fakes give `manual`, which `GameApi` does not have yet.

- [ ] **Step 8: Rewrite the agent tools**

`packages/core/src/agent-tools.ts` (whole file):

```ts
import { z } from 'zod';
import { LOG_LIMIT } from './boards.ts';
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
  /** A board's manual: Korean markdown generated from the scenario (manual.ts). Null for an id that names no board slot. */
  manual(board: string): Promise<string | null>;
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

/** What a board tool says of whom it reaches: the worker refuses the agent every board without a comm module (spec §8). */
const ONLY_COMM =
  'It reaches only a board with a comm module (tier 2): for any other the game refuses, and you can ask the player to install one.';

function known<T>(value: T | null, id: unknown): T {
  if (value === null) throw new ToolError(`unknown board ${String(id)}; list_boards lists the boards`);
  return value;
}

export const AGENT_TOOLS: readonly AgentTool[] = [
  {
    name: 'list_boards',
    description:
      "Every facility of the town that can take a board: its kind, its position, and its tier (0: no board, the player works it by hand; 1: a board the player programs in the game; 2: a board with a comm module, which you can program), whether the facility stands (ok, wrecked, or being repaired), and its board's state (running, asleep, destroyed, rebuilding), power, firmware version, and latest error.",
    inputSchema: {},
    run: (api) => api.listBoards(),
  },
  {
    name: 'get_datasheet',
    description: `A board's manual, as markdown in Korean: what the board is for, its parts, every io field it reads and every action it can take, its facility's rules, and the rules every board runs under, with the town's own numbers. Everything needed to write its firmware. ${ONLY_COMM}`,
    inputSchema: { board },
    run: async (api, args) => known(await api.manual(args.board as string), args.board),
  },
  {
    name: 'get_firmware',
    description: `The Lua source deployed on a board, and the one waiting to install at its next tick, if any. The player can change a board's firmware too, so read it before you edit it. ${ONLY_COMM}`,
    inputSchema: { board },
    run: async (api, args) => known(await api.firmware(args.board as string), args.board),
  },
  {
    name: 'deploy_firmware',
    description: `Deploy Lua firmware to a board. It must define function tick(io, mem). A syntax error is refused with Lua's message and the old firmware keeps running; otherwise the new code installs at the board's next tick, keeping mem. A board that is asleep, smashed, being rebuilt, or without power has no ticks until it wakes, is rebuilt, or gets its power back, and the answer says when the code installs. ${ONLY_COMM}`,
    inputSchema: { board, code },
    run: (api, args) => api.deploy(args.board as string, args.code as string),
  },
  {
    name: 'read_logs',
    description: `A board's log, up to its last ${LOG_LIMIT} lines: what its firmware logged, its errors (runtime, CPU limit, out of RAM), and system events such as deploys, power loss, sleep, and destruction. ${ONLY_COMM}`,
    inputSchema: { board, since },
    run: async (api, args) => known(await api.logs(args.board as string, args.since as number | undefined), args.board),
  },
  {
    name: 'get_map',
    description:
      'The town map: each facility, its kind, its position on the grid, its tier, whether it stands and has power, and its distance to the power plant (power is lost in transmission over distance; the manual gives the rate). EMF and Luddites are not on it: boards learn of them through their sensors.',
    inputSchema: {},
    run: (api) => api.map(),
  },
  {
    name: 'get_status',
    description:
      "The season's state: day and time, money, power generation and demand, which facilities are shed, the food in the warehouse and in the housing, the residents who are fed, hungry, or without power, and whether the season has ended. run.paused says whether the player has stopped the clock, and run.speed how many times as fast as normal it runs; pausing and speed are the player's to set, not yours.",
    inputSchema: {},
    run: (api) => api.status(),
  },
  {
    name: 'get_alerts',
    description: `Alerts: raids, Luddites approaching, wrecked facilities, fires, overheating, power shortages, hunger, firmware errors, money below zero, and the season's end. Without since, the newest ${ALERTS_SHOWN}, oldest first, and how many older ones the log holds; with since, every alert after that time. The game does not push alerts to you; poll this.`,
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
  'You help the player of turing-city, a game, by writing the Lua firmware of the boards in their small town. The player runs the town: they work its facilities by hand, buy and install boards, and can write firmware themselves in the game. A board with a comm module is one they have handed to you.',
  "Start with list_boards. You can program only the boards at tier two, the ones with a comm module; for any other, ask the player to install one. get_datasheet gives a board's manual, in Korean: its io fields, its actions, its caps, and the rules, with the town's own numbers.",
  'Every board runs tick(io, mem) on its own clock. Boards and busy datacenters leak EMF, and Luddites come for the loudest machines: quieter firmware draws fewer of them. It raises no income, though: a datacenter earns by processing, and housing pays tax when its residents are fed and powered.',
  "Deploy with deploy_firmware; read_logs and get_alerts tell you what happened. The player may change a board's firmware too, so read get_firmware before you edit it.",
  'Luddites and fire wreck a whole facility, board and all. Only the player can repair a facility and rebuild its board, for money. You cannot, so tell the player and ask.',
].join('\n');
```

- [ ] **Step 9: Remove the datasheet, and switch the server to the manual**

1. Delete `packages/core/src/datasheet.ts`, and remove `export * from './datasheet.ts';` from `packages/core/src/index.ts`. Besides the worker and the controller (below), nothing imports it: Task 10 took it out of the viewer's inspection.
2. In `packages/core/src/protocol.ts`, `Query`'s datasheet read becomes the manual. Replace the line `| { readonly kind: 'datasheet'; readonly board: string }` with:

   ```ts
     | { readonly kind: 'manual'; readonly board: string }
   ```

3. In `packages/server/src/worker.ts`:
   - In the import from `@turing-city/core`, replace `datasheet,` with `boardManual,`.
   - In `answer()`, replace the `datasheet` case with:

   ```ts
       case 'manual':
         return boardManual(s.scenario, query.board);
   ```

   Task 13 replaces the worker whole and adds the gate: an agent reads the manual of a board with a comm module only.
4. In `packages/server/src/game-controller.ts`:
   - Remove `type Datasheet,` from the import.
   - Replace the `datasheet(board)` method with:

   ```ts
     /** A board's manual, as markdown; null for an id that names no board slot. */
     manual(board: string): Promise<string | null> {
       return this.query({ kind: 'manual', board }) as Promise<string | null>;
     }
   ```

   - In `gameApi(c)`, replace `datasheet: (board) => c.datasheet(board),` with:

   ```ts
       manual: (board) => c.manual(board),
   ```

- [ ] **Step 10: Bring the server's tests to the manual**

`packages/server/test/mcp.test.ts`:
- In `fakeApi()`, replace `datasheet: async () => null,` with `manual: async () => null,`.
- In `'reaches the agent as a tool error, for every tool'`, replace `datasheet: rejects,` with `manual: rejects,`.

`packages/server/test/game-controller.test.ts`:
- In `"answers the agent tools' reads"`, replace the two datasheet lines with:

  ```ts
      expect(await c.manual('DA')).toContain('| 클럭 | 5 Hz: 1초에 5번 틱 |');
      expect(await c.manual('ZZ')).toBeNull();
  ```

- In the test that lists every read for a crashed season, replace `() => c.datasheet('DA'),` with `() => c.manual('DA'),`.
- In `'answers concurrent reads, each with its own answer'`:
  - read DB's manual where it read DB's datasheet: `c.manual('DB')` in the `Promise.all`, with the variable named `manual`;
  - replace `expect(sheet?.parts.clockHz).toBe(5);` with `expect(manual).toContain('# DB 보드 매뉴얼');`.

Until this step, `pnpm typecheck` fails on each of these lines.

- [ ] **Step 11: Run the project's checks**

Run: `pnpm fix && pnpm check`
Expected: exit 0, with `manual.test.ts` at 9 tests and `agent-tools.test.ts` at 23.

- [ ] **Step 12: Commit**

```bash
git add packages/core/src/manual.ts packages/core/src/agent-tools.ts packages/core/src/index.ts packages/core/src/protocol.ts \
  packages/core/test/manual.test.ts packages/core/test/agent-tools.test.ts \
  packages/server/src/worker.ts packages/server/src/game-controller.ts packages/server/test/mcp.test.ts packages/server/test/game-controller.test.ts
git rm packages/core/src/datasheet.ts
git commit -m "Write each board's manual from the scenario; get_datasheet returns it, and the agent tools describe the tiers"
```

---

### Task 12: Firmware: structured sensors and the new actions

> **Corrections from assembling the plan (read first).**
> - Task 4 made `decodeActions` read and drop the number after code 2, because the prelude still pushes a level until this task. Here the prelude pushes no level and the decoder reads none. Step 2's expected failure may therefore read differently from what is written: run it and record what actually fails. It must fail for the missing actions.


Spec 10-10 §4.3 and §9, 10-09 §6.2, contract §15. The board's Lua side learns the town.

**Structured sensors.** A warehouse board reads lists and records: `io.farms`, `io.housing`, and `io.trucks`. `BoardVm.tick` writes numbers (integer or float), strings, nil, lists (as sequences from 1), and records (as tables with string keys) into `io`.
- **The VM keeps a table of its own for each list and record**, by its path (`farms` for the list, `farms/1` for its first record, and so on), held in the Lua registry. It writes the new readings into them every tick, with raw access only.
- **Why in place.** The host writes outside the RAM cap, and the RAM reading counts garbage the collector has not freed yet. New tables every tick would leave garbage behind every tick, and the reading would climb for nothing. In place, after the first frame, writing the readings allocates nothing.
- **What a firmware can change.** The readings are written again every tick, whatever the firmware did to them. A list that comes shorter loses its last items.
- **A deploy drops these tables**, so each firmware gets tables of its own, as it gets an `io` of its own: only `mem` carries over.

**The new actions** (contract §15):
- `io.cool()` takes no level: it starts one cooling cycle.
- A farm board has `io.harvest()`.
- A warehouse board has `io.dispatch(truck, from, to, amount)`. It names facilities by id and pushes their indexes, and an unknown id fails the tick, as `set_priority`'s does.
- `decodeActions` turns codes 2, 6, and 7 into `cool`, `harvest`, and `dispatch`.

**The boot info names every facility.** Firmware names farms and housing blocks that have no board, so `runBoardTicks` gives each VM the scenario's facility ids, not the installed boards'. Milestone 1's town had a board on every facility, so the two lists were the same.

**Files:**
- Modify: `packages/firmware/src/board-vm.ts`, `packages/firmware/src/prelude.ts` (`__boot`), `packages/core/src/ticks.ts` (one line)
- Replace: `packages/firmware/src/host.ts`
- Test:
  - `packages/firmware/test/board-vm.test.ts` (six tests changed, one `describe` added);
  - `packages/firmware/test/host.test.ts` (whole file);
  - `packages/firmware/test/hostile.test.ts` (one case added), with `packages/firmware/test/hostile-worker.ts` (its frame);
  - `packages/core/test/session.test.ts` (one test added).

**Interfaces:**
- Consumes:
  - **Task 1:** `BoardKind`, `takesBoard`, `scenarios/m2-town.json`, and `scenarios/m1-power.json` with its boards installed; `m2Scenario`.
  - **Task 2:** `Session.install`, and boards that exist only once installed.
  - **Task 4:** `Action` (a `cool` with no level, `harvest`, `dispatch`), `SensorValue`, `TickInput.sensors` as `SensorValue`s, and `BootInfo.kind: BoardKind`.
  - **Task 5:** the datacenter's busy and cool windows.
  - **Task 8:** the warehouse's readings, and `dispatch`.
- Produces (contract §15):
  - `ACTION_CODES = { process: 1, cool: 2, setThermal: 3, setPriority: 4, sleep: 5, harvest: 6, dispatch: 7 }`;
  - `BoardVm.tick(sensors: Readonly<Record<string, SensorValue>>, newSource)`, and `BoardVmOptions.kind: BoardKind`;
  - the prelude's actions by kind;
  - `decodeActions` for codes 2, 6, and 7;
  - `runBoardTicks` boots each VM with every facility's id, in scenario order.

- [ ] **Step 1: Write the failing tests**

**`packages/firmware/test/board-vm.test.ts`.** Six tests call `io.cool` with a level or count it as two numbers. Each becomes the version below, whatever earlier tasks left in it.

`'runs tick(io, mem) with sensors and queues actions and logs'`:

```ts
  it('runs tick(io, mem) with sensors and queues actions and logs', () => {
    const v = vm();
    const r = v.tick(
      SENSORS,
      `
      function tick(io, mem)
        mem.n = (mem.n or 0) + 1
        io.log("n", mem.n, io.temp, io.price)
        if io.temp < 80 then io.process() end
        io.cool()
      end`,
    );
    expect(r.ok).toBe(true);
    expect(r.queue).toEqual([1, 2]);
    expect(r.logs).toEqual(['n\t1\t70\t40']);
    expect(r.instructions).toBeGreaterThan(20);
    expect(r.instructions).toBeLessThan(400);
    v.close();
  });
```

`'caps the action queue at 64 numbers, whole actions only'`:

```ts
  it('caps the action queue at 64 numbers, whole actions only', () => {
    const v = vm({ instructionCap: 20_000 }); // 100 io.cool() calls take a few thousand instructions
    const r = v.tick(SENSORS, `function tick(io) for i = 1, 100 do io.cool() end end`);
    expect(r.queue).toEqual(Array.from({ length: 64 }, () => 2));
    v.close();
  });
```

`'drops an action that does not fit whole at the 64-number limit, and still takes a later one that fits'`. A cooling call is one number now, so a power board's actions show it:

```ts
  it('drops an action that does not fit whole at the 64-number limit, and still takes a later one that fits', () => {
    const p = vm({ kind: 'power', instructionCap: 20_000 });
    // 31 set_thermal(1) calls are 62 numbers. set_priority({"DA"}) needs three more and would reach 65: it is dropped whole.
    // The last set_thermal(7) needs two, which fit at 64.
    const r = p.tick(SENSORS, `function tick(io) for i = 1, 31 do io.set_thermal(1) end io.set_priority({"DA"}) io.set_thermal(7) end`);
    expect(r.queue).toEqual([...Array.from({ length: 31 }, () => [3, 1]).flat(), 3, 7]);
    p.close();
  });
```

`'returns no actions from a tick that failed after queueing some'`:

```ts
  it('returns no actions from a tick that failed after queueing some', () => {
    const v = vm();
    const r = v.tick(SENSORS, `function tick(io) io.process() io.cool() error("after", 0) end`);
    expect(r.ok).toBe(false);
    expect(r.queue).toEqual([]);
    v.close();
  });
```

`"does not count the host's queue and log arrays as firmware data"` queues its 64 numbers with 64 `io.cool()` calls. Its `noisy` firmware becomes:

```ts
      const noisy = `function tick(io) if io.noisy == 1 then for i = 1, 20 do io.log("x") end for i = 1, 64 do io.cool() end end end`;
```

`'gives each firmware a fresh io, so that only mem carries over'` calls `io.cool()` and expects one number. Its second tick and its last line become:

```ts
      const r = v.tick(
        SENSORS,
        `function tick(io, mem) io.log(type(io.cool), io.foo, io.nothing, getmetatable(io), mem.kept, io.temp) io.cool() end`,
      );
```

```ts
      expect(r.queue).toEqual([2]);
```

Add a new `describe`, at the end of `describe('BoardVm', …)`:

```ts
  describe('structured sensors, and the actions of farms and warehouses', () => {
    // The whole town's ids, in scenario order: firmware names a facility by id, and the queue carries its index from 1.
    const TOWN = ['H1', 'H2', 'P', 'DA', 'W', 'DB', 'F1', 'F2', 'F3'];
    const WAREHOUSE = {
      stock: 3,
      farms: [
        { id: 'F1', outbox: 11, distance: 12 },
        { id: 'F2', outbox: 0, distance: 11 },
      ],
      housing: [{ id: 'H1', food: 7.5, residents: 40, distance: 14 }],
      trucks: [
        { id: 1, status: 'idle', x: 11, y: 6, load: 0, target: undefined },
        { id: 2, status: 'outbound', x: 9, y: 6, load: 9, target: 'H1' },
      ],
      day: 1,
      clock: 0.5,
    };
    const warehouse = () => vm({ kind: 'warehouse', facilityIds: TOWN, instructionCap: 3000, ramBytes: 16 * 1024 });

    it('writes lists as sequences from 1 and records as tables with string keys, with strings, floats, and nil inside', () => {
      const v = warehouse();
      const r = v.tick(
        WAREHOUSE,
        `function tick(io)
          local t1, t2 = io.trucks[1], io.trucks[2]
          io.log(io.stock, #io.farms, io.farms[1].id, io.farms[2].outbox, io.housing[1].food, #io.trucks, t1.status, t1.target, t2.target, t2.load)
        end`,
      );
      expect(r.error).toBeNull();
      expect(r.logs).toEqual(['3\t2\tF1\t0\t7.5\t2\tidle\tnil\tH1\t9']);
      v.close();
    });

    it('writes the readings again every tick, whatever the firmware did to them, and clears what a shorter list no longer holds', () => {
      const v = warehouse();
      const tamper = `function tick(io, mem)
        if mem.seen then io.log(#io.farms, io.farms[1].outbox, type(io.trucks), io.farms[3] == nil) return end
        mem.seen = true
        io.farms[1].outbox = 99 io.farms[3] = { id = "ZZ" } io.trucks = nil
      end`;
      expect(v.tick(WAREHOUSE, tamper).error).toBeNull();
      expect(v.tick(WAREHOUSE, null).logs).toEqual(['2\t11\ttable\ttrue']);
      // A list that comes shorter loses its last items.
      expect(v.tick({ ...WAREHOUSE, farms: [WAREHOUSE.farms[0]!] }, null).logs).toEqual(['1\t11\ttable\ttrue']);
      v.close();
    });

    it('gives each deploy tables of its own, so that what a firmware stored in them does not reach the next', () => {
      const v = warehouse();
      expect(v.tick(WAREHOUSE, `function tick(io) io.farms[1].note = "old" io.farms.extra = 1 end`).error).toBeNull();
      const r = v.tick(WAREHOUSE, `function tick(io) io.log(io.farms[1].note, io.farms.extra, io.farms[1].id) end`);
      expect(r.logs).toEqual(['nil\tnil\tF1']);
      v.close();
    });

    it('counts the readings as part of the board, and writes them every tick without allocating', () => {
      const tiny = `function tick() end`;
      const v = warehouse();
      const used = [v.tick(WAREHOUSE, tiny).ramUsedBytes];
      for (let i = 0; i < 20; i++) used.push(v.tick(WAREHOUSE, null).ramUsedBytes);
      // Writing the readings again leaves nothing behind. New tables every tick would read higher and higher, as garbage piles up.
      expect(Math.max(...used) - Math.min(...used)).toBeLessThan(64);
      // The readings of the first frame are the board's own, as a flat frame's keys are.
      const bare = warehouse();
      expect(Math.abs(used[0]! - bare.tick({ day: 1, clock: 0.5 }, tiny).ramUsedBytes)).toBeLessThan(64);
      v.close();
      bare.close();
    });

    it('encodes dispatch with facility indexes, refuses an unknown facility, and keeps a dispatch whole at the 64-number limit', () => {
      const v = warehouse();
      // F1 is 7, W is 5, H2 is 2.
      const r = v.tick(WAREHOUSE, `function tick(io) io.dispatch(2, "F1", "W", 30) io.dispatch(1, "W", "H2", 5) end`);
      expect(r.queue).toEqual([7, 2, 7, 5, 30, 7, 1, 5, 2, 5]);
      for (const call of ['io.dispatch(1, "ZZ", "W", 1)', 'io.dispatch(1, "F1", nil, 1)']) {
        const bad = v.tick(WAREHOUSE, `function tick(io) ${call} end`);
        expect(bad.ok, call).toBe(false);
        expect(bad.error?.message, call).toMatch(/^firmware:1: unknown facility: (ZZ|nil)$/);
      }
      // Twelve dispatches are 60 numbers. A thirteenth would reach 65 and is dropped whole; a sleep's two numbers still fit.
      const full = v.tick(WAREHOUSE, `function tick(io) for i = 1, 13 do io.dispatch(1, "F1", "W", 1) end io.sleep(1) end`);
      expect(full.queue).toEqual([...Array.from({ length: 12 }, () => [7, 1, 7, 5, 1]).flat(), 5, 1]);
      v.close();
    });

    it('gives a farm io.harvest(), a datacenter an io.cool() with no level, and each kind only its own actions', () => {
      const farm = vm({ kind: 'farm', facilityIds: TOWN });
      expect(farm.tick(SENSORS, `function tick(io) io.harvest() end`).queue).toEqual([6]);
      expect(farm.tick(SENSORS, `function tick(io) io.process() end`).error?.message).toBe(
        "firmware:1: attempt to call a nil value (field 'process')",
      );
      farm.close();
      const dc = vm();
      // A level that firmware still passes changes nothing: a cycle is a cycle.
      expect(dc.tick(SENSORS, `function tick(io) io.cool() io.cool(3) io.process() end`).queue).toEqual([2, 2, 1]);
      for (const call of ['io.harvest()', 'io.dispatch(1, "F1", "W", 1)']) {
        expect(dc.tick(SENSORS, `function tick(io) ${call} end`).ok, call).toBe(false);
      }
      dc.close();
    });
  });
```

**`packages/firmware/test/host.test.ts`** (whole file):

```ts
import { type BootInfo, parseScenario, Session, takesBoard } from '@turing-city/core';
import { describe, expect, it, vi } from 'vitest';
import m1 from '../../../scenarios/m1-power.json' with { type: 'json' };
import m2 from '../../../scenarios/m2-town.json' with { type: 'json' };
import { BoardVm } from '../src/board-vm.ts';
import { decodeActions, WasmoonHost } from '../src/host.ts';

/** The whole town's ids, in scenario order. */
const TOWN = ['H1', 'H2', 'P', 'DA', 'W', 'DB', 'F1', 'F2', 'F3'];

describe('decodeActions', () => {
  it('turns the queue into actions, with facility ids', () => {
    expect(decodeActions([1, 2, 3, 250, 4, 2, 6, 4, 5, 20, 6, 7, 2, 7, 5, 30], TOWN)).toEqual([
      { kind: 'process' },
      { kind: 'cool' },
      { kind: 'setThermal', output: 250 },
      { kind: 'setPriority', order: ['DB', 'DA'] },
      { kind: 'sleep', seconds: 20 },
      { kind: 'harvest' },
      { kind: 'dispatch', truck: 2, from: 'F1', to: 'W', amount: 30 },
    ]);
  });

  it('stops at an unknown code', () => {
    expect(decodeActions([1, 9, 1], [])).toEqual([{ kind: 'process' }]);
  });

  it('drops a dispatch that names no facility, and goes on after it', () => {
    expect(decodeActions([7, 1, 99, 5, 3, 1], TOWN)).toEqual([{ kind: 'process' }]);
  });
});

describe('WasmoonHost in a session', () => {
  it('runs deployed Lua, applies its actions, and reboots it after a sleep with empty mem', async () => {
    const session = new Session(parseScenario(m1), 7, await WasmoonHost.create());
    session.world.plant.thermalSetting = 300; // plenty of power: DA's job is never shed
    session.deploy(
      'DA',
      `
      function tick(io, mem)
        mem.n = (mem.n or 0) + 1
        io.log("tick", mem.n)
        if mem.n == 2 then io.sleep(1) return end
        io.process()
      end`,
    );
    for (let i = 0; i < 4; i++) session.step(); // DA's first beat is step 3: a job from step 4, half a second long
    expect(session.world.datacenters.DA!).toMatchObject({ busyFrom: 4, busyUntil: 14 });
    for (let i = 0; i < 4; i++) session.step(); // second beat at 7: sleep 1 s
    const da = session.world.boards[1]!;
    expect(da.status).toBe('asleep');
    for (let i = 0; i < 20; i++) session.step(); // wakes at 27; beat at 27 reboots
    const logs = da.log.filter((l) => l.kind === 'log').map((l) => l.text);
    expect(logs).toEqual(['tick\t1', 'tick\t2', 'tick\t1']);
    session.close();
  });

  it('starts a cooling cycle with io.cool(), which takes no level', async () => {
    const session = new Session(parseScenario(m1), 7, await WasmoonHost.create());
    session.deploy('DA', 'function tick(io) io.cool() end');
    for (let i = 0; i < 4; i++) session.step(); // DA's first beat is step 3: a cycle from step 4, four seconds long
    expect(session.world.datacenters.DA!).toMatchObject({ coolFrom: 4, coolUntil: 84 });
    session.close();
  });

  it('reports a CPU cap hit as a firmware error', async () => {
    const session = new Session(parseScenario(m1), 7, await WasmoonHost.create());
    session.deploy('DA', 'function tick() while true do end end');
    for (let i = 0; i < 4; i++) session.step();
    expect(session.world.boards[1]!.lastTick).toMatchObject({ instructions: 2000, error: { kind: 'cpu' } });
    expect(session.world.alerts.some((a) => a.kind === 'firmwareError' && a.facilityId === 'DA')).toBe(true);
    session.close();
  });

  it("applies a power board's thermal setting and priority, naming facilities by id", async () => {
    const session = new Session(parseScenario(m1), 7, await WasmoonHost.create());
    session.deploy('P', 'function tick(io) io.set_thermal(250) io.set_priority({"DB", "DA"}) end');
    session.step(); // P's first beat is step 0
    expect(session.world.plant.thermalSetting).toBe(250);
    expect(session.world.plant.priority).toEqual(['DB', 'DA']);
    session.close();
  });

  it("reads a warehouse's farms and trucks as tables, and sends a truck to a farm that has no board", async () => {
    const session = new Session(parseScenario(m2), 7, await WasmoonHost.create());
    session.world.plant.thermalSetting = 300; // power for the whole town and the warehouse's board
    expect(session.install('W', 'board')).toEqual({ ok: true });
    session.world.farms.F1!.outbox = 30;
    session.deploy(
      'W',
      `
      function tick(io)
        local t = io.trucks[1]
        io.log(#io.trucks, t.status, io.farms[1].id, io.farms[1].outbox)
        if t.status == "idle" then io.dispatch(t.id, "F1", "W", 30) end
      end`,
    );
    for (let i = 0; i < 5; i++) session.step(); // W beats every 10 steps (2 Hz) from step 4: its index (4) modulo its period
    const w = session.world.boards.find((b) => b.id === 'W')!;
    expect(w.log.filter((l) => l.kind === 'log').map((l) => l.text)).toEqual(['2\tidle\tF1\t30']);
    expect(session.world.warehouses.W!.trucks[0]).toMatchObject({ status: 'outbound', job: { kind: 'collect', targetId: 'F1', amount: 30 } });
    session.close();
  });

  it('holds a board to its RAM in kilobytes and reports what it uses', async () => {
    const session = new Session(parseScenario(m1), 7, await WasmoonHost.create());
    session.deploy('DA', 'function tick(io, mem) mem.t = mem.t or {} for i = 1, 40 do mem.t[#mem.t + 1] = i end end');
    const da = session.world.boards[1]!;
    for (let i = 0; i < 4; i++) session.step(); // beats at 3, 7, 11, ...: 40 more numbers in mem each
    expect(da.lastTick).toMatchObject({ error: null });
    expect(da.lastTick!.ramUsedBytes).toBeGreaterThan(600);
    for (let i = 0; i < 20; i++) session.step(); // the sixth beat, at 23, holds 240 numbers: 4 KB
    expect(da.lastTick).toMatchObject({ error: null });
    for (let i = 0; i < 4; i++) session.step(); // the seventh, at 27, needs 8 KB for a 257th number, and the board has 8 KB in all
    expect(da.lastTick).toMatchObject({ error: { kind: 'ram' } });
    session.close();
  });

  it('gives a seed the same run in every session, whichever other sessions are alive, and another seed another run', async () => {
    // Where pairs starts over string keys follows how the board's Lua state was made; math.random follows the seed.
    const firmware = `
      function tick(io)
        local t = {}
        for _, k in ipairs({"alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"}) do t[k] = true end
        local keys = {}
        for k in pairs(t) do keys[#keys + 1] = k end
        io.log(table.concat(keys, ","), math.random(1000000))
      end`;
    const open = async (seed: number): Promise<Session> => {
      const session = new Session(parseScenario(m1), seed, await WasmoonHost.create());
      session.deploy('DA', firmware);
      return session;
    };
    const sessions = [await open(7), await open(7), await open(8)];
    // All three are alive at once on purpose: run one after another, a runtime shared by every host gives the same logs.
    for (let i = 0; i < 8; i++) for (const s of sessions) s.step(); // DA's beats are at steps 3 and 7
    const [a, b, c] = sessions.map((s) => s.world.boards[1]!.log.filter((l) => l.kind === 'log').map((l) => l.text));
    expect(a).toHaveLength(2);
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
    for (const s of sessions) s.close();
  });
});

describe('WasmoonHost lifetime', () => {
  const scenario = parseScenario(m1);
  const bootInfo = (boardId: string): BootInfo => {
    const f = scenario.facilities.find((x) => x.id === boardId)!;
    if (!takesBoard(f.kind) || f.board === null) throw new Error(`${boardId} takes no board`);
    return { boardId, kind: f.kind, spec: f.board, facilityIds: scenario.facilities.map((x) => x.id), seed: 1 };
  };

  it("closes a board's VM when it shuts down or boots again, and every VM when the host closes", async () => {
    const close = vi.spyOn(BoardVm.prototype, 'close');
    try {
      const host = await WasmoonHost.create();
      host.boot(bootInfo('DA'));
      host.shutdown('DA');
      expect(close).toHaveBeenCalledTimes(1);
      host.shutdown('DA'); // the board has no VM any more: nothing to close
      expect(close).toHaveBeenCalledTimes(1);
      host.boot(bootInfo('DA'));
      host.boot(bootInfo('DA')); // the board still has its VM: it is closed before the new one comes up
      expect(close).toHaveBeenCalledTimes(2);
      host.boot(bootInfo('DB'));
      host.close();
      expect(close).toHaveBeenCalledTimes(4);
    } finally {
      close.mockRestore();
    }
  });
});
```

Against milestone 1's file:
- `decodeActions` gains codes 6 and 7, and a dispatch that names no facility.
- The first session test checks the busy window, and a new one checks the cooling cycle.
- A new session test runs a warehouse on the whole town.
- The boot helper narrows the kind to a board kind.

**`packages/firmware/test/hostile-worker.ts`.** The frame carries a list of records, as a warehouse board's does, so that the hostile cases also run against the host's writes into tables. Replace the `vm.tick({ temp: 50, price: 40, day: 1, clock: 1 }, source)` call with `vm.tick(FRAME, source)`, and define `FRAME` above the loop:

```ts
const FRAME = {
  temp: 50,
  price: 40,
  day: 1,
  clock: 1,
  farms: [
    { id: 'F1', outbox: 1, distance: 2 },
    { id: 'F2', outbox: 0, distance: 3 },
  ],
};
```

**`packages/firmware/test/hostile.test.ts`.** Add after `'does not run firmware metamethods outside a tick'`:

```ts
  it('does not run firmware metamethods on a list or a record of readings, when the host writes the next frame into them', async () => {
    // The firmware traps writes and lengths on a list of its readings and on a record in it, then clears a field and an item.
    // The host writes the next frame into those very tables: with anything but raw access, the traps would run uncounted there.
    const reports = await runTicks([
      'function tick(io) local trap = { __newindex = function() while true do end end, __len = function() while true do end end } setmetatable(io.farms, trap) setmetatable(io.farms[1], trap) io.farms[1].outbox = nil io.farms[2] = nil end',
      null,
    ]);
    expect(reports).not.toBe('hung');
    if (reports === 'hung') return;
    expect(reports[1]?.kind).toBeNull();
    expect(reports[1]?.elapsedMs).toBeLessThan(BUDGET_MS);
  });
```

The second tick runs the same firmware. Its writes find their keys there again, so no trap fires inside the tick either. A host that did not write the cleared field back would let the trap run inside that tick, which the cap stops as `cpu`.

**`packages/core/test/session.test.ts`.** Import `m2Scenario` beside `m1Scenario`, and add to `describe('Session', …)`:

```ts
  it('boots a board knowing every facility of the town by id, those without a board too', () => {
    const host = new FakeHost();
    const src = host.program('noop', () => ({}));
    const s = new Session(m2Scenario(), SEED, host);
    s.world.plant.thermalSetting = 300;
    expect(s.install('W', 'board')).toEqual({ ok: true });
    s.deploy('W', src);
    run(s, 5); // W's first beat is step 4: its index (4) modulo its period (10)
    expect(host.boots.map((b) => [b.boardId, b.facilityIds])).toEqual([['W', ['H1', 'H2', 'P', 'DA', 'W', 'DB', 'F1', 'F2', 'F3']]]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/firmware packages/core/test/session.test.ts`
Expected: FAIL. Among the failures:
- The new `describe`'s tests: the VM writes no list or record into `io`, and `io.harvest` and `io.dispatch` do not exist.
- `decodeActions` stops at code 6, so `'turns the queue into actions, with facility ids'` misses the harvest and the dispatch.
- The warehouse session test: the warehouse's VM knows only the installed boards, so `"F1"` is an unknown facility.
- The new session test: the boot info lists `['W']`.

- [ ] **Step 3: Write structured readings into io**

In `packages/firmware/src/board-vm.ts`:

1. Import the board kind and the reading type from core:

   ```ts
   import type { BoardKind, SensorValue, TickError } from '@turing-city/core';
   ```

2. Give the action codes the two new actions:

   ```ts
   export const ACTION_CODES = { process: 1, cool: 2, setThermal: 3, setPriority: 4, sleep: 5, harvest: 6, dispatch: 7 } as const;
   ```

3. In `BoardVmOptions`, `kind` is a board kind: `readonly kind: BoardKind;`.

4. In the class, after `installError`, add the tables:

   ```ts
     /** The VM's own tables for the lists and records among the readings, by path, as registry references (see writeSensors). */
     private readonly tables = new Map<string, number>();
   ```

5. The parameter of `tick()` and of `baseline()` becomes `sensors: Readonly<Record<string, SensorValue>>`. In `bootBytes`' comment, "io with the sensor keys of the first frame" becomes "io with the readings of the first frame, their tables too".

6. In `deploy()`, the firmware that goes leaves its tables behind as well as its io. Replace the lines from the io comment to the end of the method with:

   ```ts
       // The firmware that goes starts with nothing it left in io: the new one gets an io of its own, and tables of its own for
       // the readings, which the next frame makes.
       lua.luaL_unref(L, REGISTRY, this.refs.io);
       this.refs.io = lua.luaL_ref(L, REGISTRY);
       lua.lua_settop(L, 0);
       this.dropSensorTables();
       this.collect();
       return null;
   ```

7. Replace `writeSensors` with these four methods:

   ```ts
     /**
      * Writes a frame of readings into io, with raw access only, so that no firmware metamethod runs outside a tick. A list or a
      * record goes into a table the VM keeps for its path (`farms`, `farms/1`, ...) and fills again every tick. After the first
      * frame, writing the readings allocates nothing, so a tick leaves no garbage for the RAM reading to count: the host writes
      * outside the RAM cap. A list that comes shorter loses its last items. A deploy drops the tables, so each firmware gets its own.
      */
     private writeSensors(sensors: Readonly<Record<string, SensorValue>>): void {
       const { lua, L } = this;
       this.pushRef('io');
       for (const [key, value] of Object.entries(sensors)) {
         lua.lua_pushstring(L, key);
         this.pushValue(value, key);
         lua.lua_rawset(L, -3);
       }
       lua.lua_settop(L, 0);
     }

     /** Pushes one reading: nil, an integer, a float, a string, or the VM's table for the list or record at this path, filled. */
     private pushValue(value: SensorValue, path: string): void {
       const { lua, L } = this;
       if (value === undefined) lua.lua_pushnil(L);
       else if (typeof value === 'number') {
         if (Number.isInteger(value)) lua.lua_pushinteger(L, BigInt(value));
         else lua.lua_pushnumber(L, value);
       } else if (typeof value === 'string') lua.lua_pushstring(L, value);
       else if (Array.isArray(value)) {
         const list = value as readonly SensorValue[];
         this.pushTable(path, list.length, 0);
         list.forEach((item, i) => {
           this.pushValue(item, `${path}/${i + 1}`);
           lua.lua_rawseti(L, -2, BigInt(i + 1));
         });
         for (let i = lua.lua_rawlen(L, -1); i > list.length; i--) {
           lua.lua_pushnil(L);
           lua.lua_rawseti(L, -2, BigInt(i));
         }
       } else {
         const fields = Object.entries(value as { readonly [key: string]: SensorValue });
         this.pushTable(path, 0, fields.length);
         for (const [key, field] of fields) {
           lua.lua_pushstring(L, key);
           this.pushValue(field, `${path}.${key}`);
           lua.lua_rawset(L, -3);
         }
       }
     }

     /** Pushes the VM's table for this path, made with room for its items and fields the first time the path comes. */
     private pushTable(path: string, items: number, fields: number): void {
       const { lua, L } = this;
       const ref = this.tables.get(path);
       if (ref !== undefined) {
         lua.lua_rawgeti(L, REGISTRY, BigInt(ref));
         return;
       }
       lua.lua_createtable(L, items, fields);
       lua.lua_pushvalue(L, -1);
       this.tables.set(path, lua.luaL_ref(L, REGISTRY));
     }

     /** Lets go of the tables of the firmware that goes: the next frame makes new ones. */
     private dropSensorTables(): void {
       for (const ref of this.tables.values()) this.lua.luaL_unref(this.L, REGISTRY, ref);
       this.tables.clear();
     }
   ```

The first frame goes through `writeSensors` in `baseline()`, before the board is measured, so its tables are part of the board, as the flat keys of milestone 1 were. A deploy drops them and collects. The tick's own `writeSensors` then makes new ones of the same size, so the reading after a deploy matches the one before it.

- [ ] **Step 4: Give each kind of board its actions**

In `packages/firmware/src/prelude.ts`, replace `function __boot(kind, fids, seed) … end` with:

```lua
function __boot(kind, fids, seed)
  M.randomseed(seed)
  -- The queue and the log keep the arrays they grow to, and an array never shrinks. They start at their limits (64
  -- numbers, 20 lines of an array of 32) so that the baseline holds them and no tick can leave them to the firmware.
  for k = 1, 64 do q[k] = 0 end
  for k = 1, 64 do q[k] = nil end
  for k = 1, 20 do logs[k] = "" end
  for k = 1, 20 do logs[k] = nil end
  -- Firmware names facilities by id, and the queue carries each one's index in fids: every facility of the town, in order.
  local fidx = {}
  for k = 1, #fids do fidx[fids[k]] = k end
  actions.log = log
  actions.sleep = function(seconds) push(5, tonumber(seconds) or 0) end
  if kind == "datacenter" then
    actions.process = function() push(1) end
    -- One cooling cycle; while one runs, another call does nothing (the game's rule, not the prelude's).
    actions.cool = function() push(2) end
  elseif kind == "power" then
    actions.set_thermal = function(output) push(3, tonumber(output) or 0) end
    actions.set_priority = function(list)
      if type(list) ~= "table" then error("set_priority expects a list of facility ids", 2) end
      local idx = {}
      for k = 1, #list do
        local i = fidx[list[k]]
        if not i then error("unknown facility: " .. safe_tostring(list[k]), 2) end
        idx[k] = i
      end
      push(4, #idx, T.unpack(idx))
    end
  elseif kind == "farm" then
    actions.harvest = function() push(6) end
  elseif kind == "warehouse" then
    actions.dispatch = function(truck, from, to, amount)
      local f, t = fidx[from], fidx[to]
      if not f then error("unknown facility: " .. safe_tostring(from), 2) end
      if not t then error("unknown facility: " .. safe_tostring(to), 2) end
      push(7, tonumber(truck) or 0, f, t, tonumber(amount) or 0)
    end
  end
  return fresh_io()
end
```

`push` keeps an action whole or drops it, so a dispatch takes its five numbers or none. The game checks the numbers: Task 8's `dispatchProblem` refuses a truck or an amount that is not a whole number in range.

- [ ] **Step 5: Decode the new actions**

`packages/firmware/src/host.ts` (whole file):

```ts
import type { Action, BootInfo, FirmwareHost, TickInput, TickOutcome } from '@turing-city/core';
import type { LuaWasm } from 'wasmoon';
import { ACTION_CODES, BoardVm } from './board-vm.ts';
import { createLuaRuntime } from './runtime.ts';

/**
 * Turns the VM's flat number queue into actions. A facility travels as its index from 1 in facilityIds. An index that names none
 * drops its id from a priority list, and drops a dispatch whole. An unknown code ends the decoding.
 */
export function decodeActions(queue: readonly number[], facilityIds: readonly string[]): Action[] {
  const out: Action[] = [];
  let i = 0;
  const next = (): number => queue[i++] ?? 0;
  const facility = (): string | undefined => facilityIds[next() - 1];
  while (i < queue.length) {
    const code = next();
    if (code === ACTION_CODES.process) out.push({ kind: 'process' });
    else if (code === ACTION_CODES.cool) out.push({ kind: 'cool' });
    else if (code === ACTION_CODES.setThermal) out.push({ kind: 'setThermal', output: next() });
    else if (code === ACTION_CODES.setPriority) {
      const n = next();
      const order: string[] = [];
      for (let k = 0; k < n; k++) {
        const id = facility();
        if (id !== undefined) order.push(id);
      }
      out.push({ kind: 'setPriority', order });
    } else if (code === ACTION_CODES.sleep) out.push({ kind: 'sleep', seconds: next() });
    else if (code === ACTION_CODES.harvest) out.push({ kind: 'harvest' });
    else if (code === ACTION_CODES.dispatch) {
      const truck = next();
      const from = facility();
      const to = facility();
      const amount = next();
      if (from !== undefined && to !== undefined) out.push({ kind: 'dispatch', truck, from, to, amount });
    } else break;
  }
  return out;
}

/**
 * Runs board firmware on wasmoon. Use one host per session: a fresh runtime is what
 * makes the boards' Lua states land at the same addresses in every run.
 */
export class WasmoonHost implements FirmwareHost {
  private readonly vms = new Map<string, { vm: BoardVm; facilityIds: readonly string[] }>();

  private readonly lua: LuaWasm;

  private constructor(lua: LuaWasm) {
    this.lua = lua;
  }

  static async create(): Promise<WasmoonHost> {
    return new WasmoonHost(await createLuaRuntime());
  }

  boot(info: BootInfo): void {
    this.shutdown(info.boardId);
    const vm = new BoardVm(this.lua, {
      kind: info.kind,
      facilityIds: info.facilityIds,
      seed: info.seed,
      instructionCap: info.spec.instructionCap,
      ramBytes: info.spec.ramKb * 1024,
    });
    this.vms.set(info.boardId, { vm, facilityIds: info.facilityIds });
  }

  tick(boardId: string, input: TickInput): TickOutcome {
    const entry = this.vms.get(boardId);
    if (!entry) throw new Error(`tick before boot: ${boardId}`);
    const r = entry.vm.tick(input.sensors, input.newSource);
    return {
      ok: r.ok,
      instructions: r.instructions,
      actions: r.ok ? decodeActions(r.queue, entry.facilityIds) : [],
      logs: r.logs,
      error: r.error,
      ramUsedBytes: r.ramUsedBytes,
    };
  }

  shutdown(boardId: string): void {
    const entry = this.vms.get(boardId);
    if (!entry) return;
    entry.vm.close();
    this.vms.delete(boardId);
  }

  close(): void {
    for (const id of [...this.vms.keys()]) this.shutdown(id);
  }
}
```

- [ ] **Step 6: Boot each board knowing the whole town**

In `runBoardTicks` (`packages/core/src/ticks.ts`), the boot info's `facilityIds` becomes every facility's id in place of the installed boards' ids:

```ts
  // Firmware names facilities by id, those with no board too: a truck goes to a farm, a priority list names housing.
  const facilityIds = ctx.world.facilities.map((f) => f.id);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm vitest run packages/firmware packages/core/test/session.test.ts`
Expected: PASS, every test in both, the hostile suite included.

- [ ] **Step 8: Run the project's checks**

Run: `pnpm fix && pnpm check`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/firmware/src/board-vm.ts packages/firmware/src/prelude.ts packages/firmware/src/host.ts packages/core/src/ticks.ts \
  packages/firmware/test/board-vm.test.ts packages/firmware/test/host.test.ts packages/firmware/test/hostile.test.ts \
  packages/firmware/test/hostile-worker.ts packages/core/test/session.test.ts
git commit -m "Firmware reads lists and records in io, rewritten in place each tick; harvest, dispatch, and a cooling cycle with no level"
```

---

### Task 13: The worker and the controller: the player's commands, deploys by player or agent, no agent rule

> **Corrections from assembling the plan (read first).**
> - **Already there from earlier tasks; don't add them again:**
>   - From Task 3: the worker's `repair` request with its snapshot, `GameController.repair()`, `rebuild()` returning `CommandResult`, `wrecked` in the default auto-pause, and the `hunger` and `agentLost` alert kinds.
>   - From Task 10: the test edits such as `.board!.firmwareVersion` and `inspection?.parts.clockHz`.
>   - From Task 11: the `manual` query, the worker's answer, `GameController.manual()`, and `gameApi.manual`.
> - Step 3's expected failure about `c.manual` no longer applies. Record what actually fails.
> - **Hand actions apply at once (decision D1).** The worker's `hand` handler calls `Session.hand` and, when it succeeds, sends a snapshot before it replies, as it does for a deploy. A paused game shows the result.
> - **A season counter (decision D3).** `ControllerStatus` gains `season: number`: 0 before the first season, plus 1 on each `startSeason`. The viewer resets per-season state when it changes. Add it to `status()` and test it.


Spec 10-10 §8 and §11, contract §16. Milestone 1 made an agent the gate to the whole game: no season without one, and a dropped agent paused play until it came back. Now the agent is a helper the player may connect for boards with a comm module (T2), and the player runs everything else from the viewer. This task carries the player's new commands (install, repair, hand) through the controller and the worker, lets the player deploy to any board and the agent only to a T2 board, sends refusals across the worker boundary with their codes, and replaces the connection rule with an `agentLost` alert that auto-pauses by default.

The state this task starts from: Tasks 1 to 12 left the server compiling and its tests passing against the new core, with:
- `Session.install`, `repair`, `rebuild`, `hand`, and `deploy(boardId, source, by?)`;
- `findFacility`;
- the views of contract §13 (`listBoards(world)`, `snapshot(ctx)` with `facilities`, `inspectBoard(ctx, id)`);
- `boardManual(scenario, id)` (Task 11), and `GameApi.manual(board)` in place of `datasheet` (Task 11), with the worker answering a `manual` query;
- the alert kind `wrecked`, and `scenarios/m1-power.json` with its three boards installed (T1, no comm module).

This task replaces `worker.ts` and `game-controller.ts` whole, so whatever Tasks 10 and 11 patched in them to keep them compiling is superseded.

**Files:**
- Modify: `packages/core/src/protocol.ts` (the worker and controller types; the viewer's messages are Task 15's)
- Replace: `packages/server/src/worker.ts`, `packages/server/src/game-controller.ts`
- Modify: `packages/viewer/src/ui/overlay.ts`, `packages/viewer/src/ui/start-screen.ts`, `packages/viewer/test/store.test.ts` (no agent rule, no `blockedByAgent`)
- Test: `packages/server/test/game-controller.test.ts`, `packages/server/test/game-server.test.ts`, `packages/server/test/mcp-controller.test.ts`

**Interfaces:**
- Consumes:
  - Task 2: `findFacility`, `Session.install`, `CommandResult`, `InstallPart`, `DeployedBy`, and the refusal codes `noBoard`, `unknownFacility`, `takesNoBoard`, `alreadyInstalled`;
  - Task 3: `Session.repair` and `Session.rebuild` as `CommandResult`, and the codes `notWrecked`, `repairFirst`, `notDestroyed`, `unknownBoard`;
  - Task 4: `Session.hand`, `FacilityAction`, and the code `cannotAct`;
  - Task 10: `listBoards`, `firmwareView`, `logsView`, `mapView`, `statusView`, `alertsView`, `alertView`, `inspectBoard`, `snapshot`, `timeView`, and `BoardState.comm`;
  - Task 11: `boardManual`, and `GameApi.manual`;
  - core's `ToolError` and `Refusal`, including `noComm` (contract §6).
- Produces:
  - `protocol.ts`:
    - `Query` with `{ kind: 'manual'; board }` and no `datasheet`;
    - `WorkerRequest` with `deploy … by`, `install`, `repair`, and `hand`;
    - `WorkerResponse`'s `refused` with `refusal?: Refusal`;
    - `ControllerStatus` without `blockedByAgent`;
    - `ControllerEvent`'s `deploy` with `by: DeployedBy`.
  - `GameController`:
    - `deploy(board, code, by: DeployedBy = 'player')`;
    - `install(facility, part)`, `repair(facility)`, `rebuild(board)`, and `hand(facility, action)`, each a `Promise<CommandResult>` that rejects with a `ToolError` while there is no season;
    - `manual(board): Promise<string | null>`;
    - `setAgent` raises `agentLost`;
    - the default `autoPause` is `['raid', 'wrecked', 'fire', 'firmwareError', 'agentLost']`.
  - `gameApi(c)`: `manual`, and an agent's deploys sent with `by: 'agent'`.
  - The worker's text for a board an agent cannot reach: `` `${id} has no comm module: the player installs one from the board's panel` `` with `{ code: 'noComm', board: id }`. The agent tools of Task 14 and the hub of Task 15 rely on it word for word.

- [ ] **Step 1: Change the worker and controller types**

In `packages/core/src/protocol.ts`, replace the imports, `Query`, `WorkerRequest`, `WorkerResponse`, `ControllerStatus`, and `ControllerEvent` with:

```ts
import type { DeployOutcome } from './agent-tools.ts';
import type { FacilityAction } from './firmware-host.ts';
import type { AlertView, BoardInspection, Snapshot, TimeView } from './queries.ts';
import type { Refusal } from './refusal.ts';
import type { DeployedBy, InstallPart } from './session.ts';
import type { AlertKind } from './world.ts';

/** A read the main thread asks the worker for. manual, firmware, and logs are the agent's: they reach a board with a comm module only. */
export type Query =
  | { readonly kind: 'listBoards' }
  | { readonly kind: 'manual'; readonly board: string }
  | { readonly kind: 'firmware'; readonly board: string }
  | { readonly kind: 'logs'; readonly board: string; readonly since: number | null }
  | { readonly kind: 'map' }
  | { readonly kind: 'status' }
  | { readonly kind: 'alerts'; readonly since: number | null }
  | { readonly kind: 'inspect'; readonly board: string };

export type WorkerRequest =
  | { readonly type: 'start'; readonly scenario: unknown; readonly seed: number }
  | { readonly type: 'advance'; readonly steps: number }
  | { readonly type: 'deploy'; readonly id: number; readonly board: string; readonly code: string; readonly by: DeployedBy }
  | { readonly type: 'install'; readonly id: number; readonly facility: string; readonly part: InstallPart }
  | { readonly type: 'repair'; readonly id: number; readonly facility: string }
  | { readonly type: 'rebuild'; readonly id: number; readonly board: string }
  | { readonly type: 'hand'; readonly id: number; readonly facility: string; readonly action: FacilityAction }
  | { readonly type: 'mark'; readonly kind: 'pause' | 'resume' }
  | { readonly type: 'query'; readonly id: number; readonly query: Query };

export type WorkerResponse =
  | { readonly type: 'started'; readonly snapshot: Snapshot }
  | { readonly type: 'advanced'; readonly snapshot: Snapshot; readonly alerts: readonly AlertView[] }
  /**
   * How the world stands after a command changed it between batches, sent ahead of that request's answer. It is not the answer to a
   * batch: it resolves none and disarms no watchdog.
   */
  | { readonly type: 'snapshot'; readonly snapshot: Snapshot }
  | { readonly type: 'reply'; readonly id: number; readonly value: unknown }
  /**
   * The request with this id threw (a deploy to an unknown board, an agent's read of a board with no comm module). Only that request
   * fails; the season goes on. A refusal the viewer can say in Korean carries its code.
   */
  | { readonly type: 'refused'; readonly id: number; readonly message: string; readonly refusal?: Refusal }
  | { readonly type: 'fatal'; readonly message: string };

export type GameState = 'idle' | 'paused' | 'running' | 'ended' | 'crashed';

export interface AgentStatus {
  readonly connected: boolean;
  readonly clientName: string | null;
}

export interface ControllerStatus {
  readonly state: GameState;
  readonly speed: 1 | 2 | 3;
  readonly agent: AgentStatus;
  /** Why the session stopped (the watchdog, or the worker failing), when it did. */
  readonly crash: string | null;
  readonly autoPause: readonly AlertKind[];
  readonly scenarioName: string;
}

export type ControllerEvent =
  | { readonly kind: 'status'; readonly status: ControllerStatus }
  | { readonly kind: 'snapshot'; readonly snapshot: Snapshot }
  | { readonly kind: 'alerts'; readonly alerts: readonly AlertView[] }
  | { readonly kind: 'deploy'; readonly board: string; readonly version: number; readonly time: TimeView; readonly by: DeployedBy };
```

`ServerToViewer` and `ViewerToServer` stay as they are; Task 15 changes them. Leave the `export type { BoardInspection, DeployOutcome };` line at the end.

- [ ] **Step 2: Write the failing tests**

In `packages/server/test/game-controller.test.ts`:

1. Change the core import to `import { type AlertView, type BoardKind, type ControllerEvent, parseScenario, runSeason, type Scenario, ToolError } from '@turing-city/core';`, and below `const scenario = …` add:

```ts
/** The whole town, every facility at T0: no boards. */
const m2 = parseScenario(JSON.parse(readFileSync('scenarios/m2-town.json', 'utf8')));
```

2. In `line()`, make the deploy line name who deployed:

```ts
    case 'deploy':
      return `deploy ${event.board} v${event.version} at ${event.time.seconds} by ${event.by}`;
```

3. In `describe('GameController', …)`, replace the test `'refuses to start a season without an agent, and starts paused with one'` with:

```ts
  it('starts a season without an agent, paused at its first step, and plays it', async () => {
    const c = make();
    await c.startSeason(1);
    expect(c.status()).toMatchObject({ state: 'paused', agent: { connected: false, clientName: null } });
    expect(c.latestSnapshot()?.step).toBe(0);
    c.play(); // an agent is a helper the player may never connect
    expect(c.status().state).toBe('running');
  });
```

4. In `"deploys through the syntax check and installs on the board's next tick"`, read the log through the viewer's inspection (the agent's `logs` needs a comm module now):

```ts
    const logs = (await c.inspect('DA'))?.logs;
    expect(logs?.some((l) => l.text === 'hi')).toBe(true);
```

5. Replace `"answers the agent tools' reads"` with:

```ts
  it("answers the agent tools' reads", async () => {
    const c = make();
    await expect(c.listBoards()).rejects.toThrow('season');
    await c.startSeason(1);
    expect((await c.listBoards()).map((b) => b.id)).toEqual(['P', 'DA', 'DB']);
    expect(await c.install('DA', 'comm')).toEqual({ ok: true }); // the agent reaches a board through its comm module
    expect(await c.manual('DA')).toContain('DA');
    expect(await c.manual('ZZ')).toBeNull();
    expect((await c.statusOf()).money).toBe(scenario.startMoney - scenario.tuning.install.commPrice);
  });
```

6. Replace `'pauses on a disconnect and refuses to play until the agent is back'` with these two:

```ts
  it('tells of an agent that drops during a season, pauses for it as the player picked by default, and plays on without it', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    const alerts: AlertView[] = [];
    c.onEvent((event) => {
      if (event.kind === 'alerts') alerts.push(...event.alerts);
    });
    c.play();
    c.setAgent({ connected: false, clientName: null });
    expect(c.status()).toMatchObject({ state: 'paused', agent: { connected: false } });
    expect(alerts).toEqual([
      { id: -1, kind: 'agentLost', facility: null, message: '에이전트 연결이 끊겼어요', day: 1, clock: '00:00', seconds: 0 },
    ]);
    c.play(); // nothing waits for the agent to come back
    expect(c.status().state).toBe('running');
  });

  it('tells of a dropped agent only when one was connected during a season, and pauses only when the player picked it', async () => {
    const c = make();
    const kinds: string[] = [];
    c.onEvent((event) => {
      if (event.kind === 'alerts') kinds.push(...event.alerts.map((a) => a.kind));
    });
    c.setAgent(AGENT);
    c.setAgent({ connected: false, clientName: null }); // no season yet
    await c.startSeason(1);
    c.setAgent({ connected: false, clientName: null }); // no agent was connected
    expect(kinds).toEqual([]);
    c.setAgent(AGENT);
    c.setAutoPause(['fire']);
    c.play();
    c.setAgent({ connected: false, clientName: null });
    expect(kinds).toEqual(['agentLost']);
    expect(c.status().state).toBe('running');
  });
```

7. In `'starts every season fresh'`, read the board's version from its `board`: `expect((await c.listBoards())[1]!.board!.firmwareVersion).toBeNull();`

8. In `describe('gameApi', …)`, in `'refuses a deploy to a board that does not exist with a tool error naming it, and the season goes on'`, give DA its comm module before the agent deploys to it:

```ts
    expect((await api.listBoards()).map((b) => b.id)).toEqual(['P', 'DA', 'DB']);
    expect(await c.install('DA', 'comm')).toEqual({ ok: true });
    await expect(api.deploy('DA', 'function tick() end')).resolves.toMatchObject({ ok: true, version: 1 });
```

and add to the same `describe`:

```ts
  it("reaches a board's manual, firmware, logs, and deploys only through its comm module, and tells the agent how to get one", async () => {
    const c = makeFor(m2);
    await c.startSeason(1);
    const api = gameApi(c);
    const refusalOf = (call: () => Promise<unknown>): Promise<unknown> =>
      call().then(
        () => 'answered',
        (error: unknown) => (error instanceof ToolError ? { message: error.message, refusal: error.refusal } : error),
      );
    const noComm = (id: string) => ({
      message: `${id} has no comm module: the player installs one from the board's panel`,
      refusal: { code: 'noComm', board: id },
    });
    // F1 has no board (T0); DA gets one but no comm module (T1).
    expect(await c.install('DA', 'board')).toEqual({ ok: true });
    for (const id of ['F1', 'DA']) {
      expect(await refusalOf(() => api.manual(id))).toEqual(noComm(id));
      expect(await refusalOf(() => api.firmware(id))).toEqual(noComm(id));
      expect(await refusalOf(() => api.logs(id, undefined))).toEqual(noComm(id));
      expect(await refusalOf(() => api.deploy(id, 'function tick() end'))).toEqual(noComm(id));
    }
    // An id that names no board slot (housing takes none, and ZZ is nothing) is an unknown board, as in milestone 1.
    expect(await api.manual('H1')).toBeNull();
    expect(await api.manual('ZZ')).toBeNull();
    // With the comm module (T2) the board is the agent's to work on.
    expect(await c.install('DA', 'comm')).toEqual({ ok: true });
    expect(await api.deploy('DA', 'function tick() end')).toMatchObject({ ok: true, version: 1 });
    expect(await api.firmware('DA')).toMatchObject({ version: null, pending: { version: 1 } });
    expect(await api.manual('DA')).toContain('DA');
    expect(await api.logs('DA', undefined)).toEqual(expect.any(Array));
  });
```

9. In `describe('GameController: its status and the rules of play', …)`, replace `'reports its status'` with:

```ts
  it('reports its status', () => {
    const c = make();
    const idle = {
      state: 'idle',
      speed: 1,
      agent: { connected: false, clientName: null },
      crash: null,
      autoPause: ['raid', 'wrecked', 'fire', 'firmwareError', 'agentLost'],
      scenarioName: scenario.name,
    };
    expect(scenario.name).not.toBe('');
    expect(c.status()).toEqual(idle);
    c.setAgent(AGENT);
    c.setSpeed(2);
    c.setAutoPause(['fire']);
    expect(c.status()).toEqual({ ...idle, speed: 2, agent: AGENT, autoPause: ['fire'] });
  });
```

10. In `describe('GameController: events', …)`, in `'tells its listeners about every change, in order, until they stop listening'`:
    - the first status has the new default: `expect(statuses[0]).toMatchObject({ speed: 2, autoPause: ['raid', 'wrecked', 'fire', 'firmwareError', 'agentLost'] });`
    - the deploy lines end in ` by player`: `['snapshot 0', 'deploy DA v1 at 0 by player']` and `['snapshot 40', 'deploy DB v1 at 2 by player']`;
    - the disconnect now raises the alert ahead of the pause:

```ts
    c.play();
    c.setAgent({ connected: false, clientName: null });
    expect(heard()).toEqual(['status running', 'alerts agentLost@null', 'status paused']);
    c.setAgent(AGENT);
    expect(heard()).toEqual(['status paused']);
```

11. In `'sends the new picture of the world with a deploy, ahead of its answer, though no time passes'`, read the board from the facility, and expect `by player`:

```ts
    const boardDA = () => c.latestSnapshot()!.facilities.find((f) => f.id === 'DA')!.board!;
```

```ts
    expect(heard()).toEqual(['snapshot 0', 'deploy DA v1 at 0 by player']);
```

12. Replace `'sends the new picture of the world when a rebuild starts, though no time passes'` with:

```ts
  it('sends the new picture of the world when a repair starts, though no time passes', async () => {
    const c = make();
    await c.startSeason(1);
    await c.runUntil({ alertKinds: ['wrecked'] }); // no firmware: the Luddites wreck a facility in the fifth game day
    const lost = (await c.alerts(undefined)).find((a) => a.kind === 'wrecked')!.facility!;
    const intact = ['P', 'DA', 'DB'].find((id) => id !== lost)!;
    const before = c.latestSnapshot()!;
    const events: ControllerEvent[] = [];
    c.onEvent((event) => events.push(event));

    expect(await c.repair(intact)).toMatchObject({ ok: false, refusal: { code: 'notWrecked', facility: intact } });
    expect(await c.rebuild(lost)).toMatchObject({ ok: false, refusal: { code: 'repairFirst', facility: lost } });
    expect(events).toEqual([]); // a refused command changed nothing

    expect(await c.repair(lost)).toEqual({ ok: true });
    const after = c.latestSnapshot()!; // already in date when the repair is answered
    expect(after.step).toBe(before.step);
    expect(after.facilities.find((f) => f.id === lost)!.condition).toBe('repairing');
    const kind = scenario.facilities.find((f) => f.id === lost)!.kind as BoardKind;
    expect(after.money).toBe(before.money - scenario.tuning.repair.cost[kind]);
    expect(events.map(line)).toEqual([`snapshot ${before.step}`]);
  });

  it("carries the player's installs, hand actions, and repairs to the season, each answered after the new picture of the world", async () => {
    const c = makeFor(m2);
    await c.startSeason(1);
    const events: ControllerEvent[] = [];
    c.onEvent((event) => events.push(event));
    const facility = (id: string) => c.latestSnapshot()!.facilities.find((f) => f.id === id)!;
    expect(facility('F1').tier).toBe(0);
    expect(await c.install('F1', 'board')).toEqual({ ok: true });
    expect(facility('F1').tier).toBe(1); // already in date when the install is answered
    expect(c.latestSnapshot()!.money).toBe(m2.startMoney - m2.tuning.install.boardPrice.farm);
    expect(await c.hand('DA', { kind: 'process' })).toEqual({ ok: true }); // a datacenter is worked by hand without a board
    // Refused, each with the code the viewer says in Korean; none changes the world.
    expect(await c.install('F1', 'board')).toMatchObject({ ok: false, refusal: { code: 'alreadyInstalled', facility: 'F1', part: 'board' } });
    expect(await c.install('H1', 'board')).toMatchObject({ ok: false, refusal: { code: 'takesNoBoard', facility: 'H1' } });
    expect(await c.install('ZZ', 'board')).toMatchObject({ ok: false, refusal: { code: 'unknownFacility', facility: 'ZZ' } });
    expect(await c.hand('F1', { kind: 'harvest' })).toMatchObject({ ok: false, refusal: { code: 'cannotAct', facility: 'F1' } }); // nothing is ripe yet
    expect(await c.repair('DA')).toMatchObject({ ok: false, refusal: { code: 'notWrecked', facility: 'DA' } });
    expect(events.map(line)).toEqual(['snapshot 0', 'snapshot 0']);
  });

  it('takes a deploy from the player for any board, refuses one for a facility without a board, and says who deployed', async () => {
    const c = makeFor(m2);
    await c.startSeason(1);
    const deploys: string[] = [];
    c.onEvent((event) => {
      if (event.kind === 'deploy') deploys.push(`${event.board} v${event.version} by ${event.by}`);
    });
    const refused = await c.deploy('F1', 'function tick() end').catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ToolError);
    expect((refused as ToolError).refusal).toEqual({ code: 'noBoard', facility: 'F1' });
    expect(await c.install('F1', 'board')).toEqual({ ok: true });
    expect(await c.deploy('F1', 'function tick() end')).toMatchObject({ ok: true, version: 1 });
    expect(await c.install('F1', 'comm')).toEqual({ ok: true });
    expect(await gameApi(c).deploy('F1', 'function tick() end')).toMatchObject({ ok: true, version: 2 });
    expect(deploys).toEqual(['F1 v1 by player', 'F1 v2 by agent']);
  });
```

13. In `describe('GameController: requests', …)`:
    - in `'refuses a deploy and a rebuild while there is no season, …'`, add `await expect(c.install('DA', 'comm')).rejects.toBeInstanceOf(ToolError);` after each `c.rebuild('DA')` refusal (before the season, and while it starts);
    - in `'refuses a deploy whose season was replaced while its code was being checked, …'`, read the versions from the board: `expect(await c.listBoards()).toMatchObject([{}, { board: { firmwareVersion: null, pendingVersion: null } }, {}]);`
    - in `'tells the agent that the season crashed, and why, …'`, the calls become:

```ts
    const calls = [
      () => c.listBoards(),
      () => c.manual('DA'),
      () => c.firmware('DA'),
      () => c.logs('DA', undefined),
      () => c.map(),
      () => c.statusOf(),
      () => c.alerts(undefined),
      () => c.inspect('DA'),
      () => c.deploy('DA', 'function tick() end'),
      () => c.install('DA', 'comm'),
      () => c.repair('DA'),
      () => c.rebuild('DA'),
      () => c.hand('DA', { kind: 'process' }),
    ];
```

    - replace `'gives each refusal the code that the viewer says in Korean: no agent, no season, and a crashed season with its reason'` with:

```ts
  it('gives each refusal the code that the viewer says in Korean: no season, and a crashed season with its reason', async () => {
    const c = make({ watchdogMs: 1 });
    const refusalOf = (error: unknown) => (error instanceof ToolError ? error.refusal : 'not a ToolError');
    const play = (): Promise<unknown> =>
      Promise.resolve()
        .then(() => c.play())
        .catch((e: unknown) => e);
    // No season yet: nothing to play, read, install, or rebuild.
    expect(refusalOf(await play())).toEqual({ code: 'noSeason' });
    expect(refusalOf(await c.listBoards().catch((e: unknown) => e))).toEqual({ code: 'noSeason' });
    expect(refusalOf(await c.rebuild('DA').catch((e: unknown) => e))).toEqual({ code: 'noSeason' });
    expect(refusalOf(await c.install('DA', 'comm').catch((e: unknown) => e))).toEqual({ code: 'noSeason' });
    // A crashed one.
    await c.startSeason(1);
    await expect(c.runUntil({ seconds: 600 })).rejects.toThrow('stopped');
    const crashed = { code: 'crashed', reason: 'the simulator stopped responding; the session stopped' };
    expect(refusalOf(await c.inspect('DA').catch((e: unknown) => e))).toEqual(crashed);
    expect(refusalOf(await play())).toEqual(crashed);
  });
```

    - in `'answers concurrent reads, each with its own answer'`, the fourth read is DB's manual, through its comm module:

```ts
    await c.startSeason(1);
    expect(await c.install('DB', 'comm')).toEqual({ ok: true });
    const [boards, map, status, manual] = await Promise.all([c.listBoards(), c.map(), c.statusOf(), c.manual('DB')]);
    expect(boards).toHaveLength(3);
    expect(map.width).toBe(20);
    expect(status.time.seconds).toBe(0);
    expect(manual).toContain('DB');
```

    - replace the body of `'answers each read of the agent tools and of the viewer from the season'` from `await c.startSeason(1);` on with:

```ts
    await c.startSeason(1);
    for (const id of ['DA', 'DB']) expect(await c.install(id, 'comm')).toEqual({ ok: true });
    await c.deploy('DA', FAILING);
    await c.deploy('DB', 'function tick(io) io.log("hello") end');
    await c.runUntil({ seconds: 5 });
    const api = gameApi(c);
    expect(await api.firmware('DA')).toEqual({ version: 1, source: FAILING, pending: null });
    expect(await api.firmware('ZZ')).toBeNull();
    expect((await api.logs('DA', undefined))?.filter((l) => l.kind !== 'system').map((l) => l.kind)).toEqual(['error']);
    expect((await api.logs('DA', 1))?.map((l) => l.kind)).toEqual(['error']);
    expect(await api.logs('DA', 1000)).toEqual([]);
    expect((await api.logs('DB', undefined))?.map((l) => l.text)).toContain('hello');
    expect(await api.logs('ZZ', undefined)).toBeNull();
    expect(await api.map()).toMatchObject({ width: 20, height: 12 });
    expect((await api.map()).facilities.map((f) => f.id)).toEqual(['P', 'DA', 'DB']);
    expect((await api.alerts(undefined)).map((a) => `${a.kind}@${a.facility}`)).toEqual(['firmwareError@DA']);
    expect(await api.alerts(1000)).toEqual([]);
    const inspection = await c.inspect('DA');
    expect(inspection?.firmware).toEqual({ version: 1, source: FAILING });
    expect(inspection?.parts.clockHz).toBe(5);
    expect(await c.inspect('ZZ')).toBeNull();
```

    - in `'keeps the reason a deploy failed to install in what the agent reads, …'`, read the error from the board and the log from the inspection:

```ts
    const da = (await c.listBoards()).find((b) => b.id === 'DA')!;
    expect(da.board!.lastError).toBe(`noTick: the last deploy failed to install: ${why}`);
    const errors = (await c.inspect('DA'))!.logs.filter((l) => l.kind === 'error');
```

    - replace `"says when a deploy installs: at the board's next tick, which comes after a sleep or a rebuild for a board that has none now"` with:

```ts
  it("says when a deploy installs: at the board's next tick, which comes after a sleep, or after a repair and a rebuild", async () => {
    const c = make();
    await c.startSeason(1);
    const installsAt = async (board: string): Promise<string> => {
      const outcome = await c.deploy(board, 'function tick() end');
      if (!outcome.ok) throw new Error('refused');
      return outcome.installsAt;
    };
    expect(await installsAt('DB')).toBe("the board's next tick");
    // DA sleeps from its first beat (step 3) for 30 seconds.
    await c.deploy('DA', 'function tick(io) io.sleep(30) end');
    await c.runUntil({ seconds: 1 });
    expect((await c.listBoards()).find((b) => b.id === 'DA')?.board?.status).toBe('asleep');
    expect(await installsAt('DA')).toBe("the board's next tick, after it wakes");
    // No firmware elsewhere, so the Luddites wreck a facility in the fifth game day, and its board with it.
    await c.runUntil({ alertKinds: ['wrecked'] });
    const lost = (await c.alerts(undefined)).find((a) => a.kind === 'wrecked')!.facility!;
    expect(await installsAt(lost)).toBe("the board's next tick, after the player rebuilds it");
  });
```

    - in `'says that a deploy to a board the grid has shed waits for its power'`, read status and power from the board: `expect(boards.map((b) => [b.id, b.board?.status, b.board?.powered])).toEqual([…the same three rows…]);`
    - replace `'rebuilds a destroyed board, and says why it cannot rebuild any other'` with:

```ts
  it('repairs a wrecked facility before it rebuilds its board, and says why it cannot do either for another', async () => {
    const c = make();
    await c.startSeason(1);
    expect(await c.rebuild('DA')).toMatchObject({ ok: false, refusal: { code: 'notDestroyed', board: 'DA' } });
    expect(await c.rebuild('ZZ')).toMatchObject({ ok: false, refusal: { code: 'unknownBoard', board: 'ZZ' } });
    expect(await c.repair('DA')).toMatchObject({ ok: false, refusal: { code: 'notWrecked', facility: 'DA' } });
    await c.runUntil({ alertKinds: ['wrecked'] }); // no firmware: the Luddites wreck a facility in the fifth game day
    const lost = (await c.alerts(undefined)).find((a) => a.kind === 'wrecked')!.facility!;
    expect((await c.listBoards()).find((b) => b.id === lost)).toMatchObject({ condition: 'wrecked', board: { status: 'destroyed' } });
    expect(await c.rebuild(lost)).toMatchObject({ ok: false, refusal: { code: 'repairFirst', facility: lost } });
    expect(await c.repair(lost)).toEqual({ ok: true });
    expect((await c.listBoards()).find((b) => b.id === lost)?.condition).toBe('repairing');
    expect(await c.repair(lost)).toMatchObject({ ok: false, refusal: { code: 'notWrecked', facility: lost } });
  });
```

The `c.setAgent(AGENT)` calls that remain across the file are harmless now. Leave them: they keep the diff to what changed.

In `packages/server/test/game-server.test.ts`:

1. Under the imports, add `const M1 = 'scenarios/m1-power.json';`. The tests that name P, DA, and DB play that scenario explicitly, because Task 15 makes the whole town the server's default.
2. The `start()` helper takes and passes it:

```ts
async function start(
  options: { dev?: boolean; viewerDist?: string | null; scenarioPath?: string; onStatus?: (status: ControllerStatus) => void } = {},
): Promise<{ server: GameServer; configDir: string }> {
  const configDir = tempDir('tc-server-');
  const server = await startGameServer({ port: 0, configDir, viewerDist: null, scenarioPath: M1, ...options });
  closers.push(() => server.close());
  return { server, configDir };
}
```

3. Replace `'runs a season end to end: viewer, agent, deploy, and the connection rule'` with:

```ts
  it('runs a season end to end: a viewer starts it without an agent, the agent connects, and its drop is told and paused for', async () => {
    const configDir = tempDir('tc-server-');
    const server = await startGameServer({ port: 0, configDir, dev: true, viewerDist: null, scenarioPath: M1 });
    stop = server.close;
    const v = await viewer(server.port);
    await until(() => last(v.seen, 'hello') !== undefined && last(v.seen, 'status') !== undefined);
    expect(last(v.seen, 'hello')!.connect).toContain(loadConfig(configDir).token);
    expect(last(v.seen, 'status')!.status).toMatchObject({ state: 'idle', agent: { connected: false } });

    v.send({ type: 'startSeason' }); // no agent is needed to play
    await until(() => last(v.seen, 'status')?.status.state === 'paused');

    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${loadConfig(configDir).token}` } },
    });
    const agent = new Client({ name: 'e2e-agent', version: '0.0.1' });
    await agent.connect(transport as Transport);
    await until(() => last(v.seen, 'status')?.status.agent.connected === true);
    // DA has a board (T1) and no comm module: the agent cannot reach it, and is told how the player opens it.
    const refused = await agent.callTool({
      name: 'deploy_firmware',
      arguments: { board: 'DA', code: 'function tick(io) io.log("on") end' },
    });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toBe("DA has no comm module: the player installs one from the board's panel");

    v.send({ type: 'play' });
    await until(() => last(v.seen, 'status')?.status.state === 'running');
    await transport.terminateSession();
    await agent.close();
    // The drop is told to the viewer, and the game pauses for it: agentLost auto-pauses by default.
    await until(() => last(v.seen, 'status')?.status.state === 'paused');
    expect(v.seen.flatMap((m) => (m.type === 'alerts' ? m.alerts : [])).map((a) => a.kind)).toContain('agentLost');
    v.ws.close();
  }, 30_000);
```

4. In `"streams the season to every viewer and carries the player's commands"`:
    - wait for the refused rebuild by its code: `await until(() => last(v.seen, 'error')?.refusal?.code === 'notDestroyed');`, followed by `expect(last(v.seen, 'error')!.refusal).toEqual({ code: 'notDestroyed', board: 'DA' });`;
    - replace everything from `// Alerts go to everyone.` to the end of the test with:

```ts
    // Alerts go to everyone. With no firmware the Luddites wreck a facility in the fifth game day.
    await call('dev_run_until', { alertKinds: ['wrecked'] });
    const wrecked = (x: typeof v) =>
      x.seen.flatMap((m) => (m.type === 'alerts' ? m.alerts : [])).find((a) => a.kind === 'wrecked');
    await until(() => wrecked(v) !== undefined && wrecked(late) !== undefined);
    const lost = wrecked(v)!.facility!;
    // Its board cannot come back before the facility is repaired, and the viewer that asked is told why.
    v.send({ type: 'rebuild', board: lost });
    await until(() => last(v.seen, 'error')?.refusal?.code === 'repairFirst');
    expect(last(v.seen, 'error')!.refusal).toEqual({ code: 'repairFirst', facility: lost });
```

5. In `'closes the connection of a viewer that sends more than a command can be, and the others go on'`, the late viewer sees the new default: `expect(last(late.seen, 'status')!.status.autoPause).toEqual(['raid', 'wrecked', 'fire', 'firmwareError', 'agentLost']);`
6. In `"hands every status change to onStatus, the agent's comings and goings among them, and nothing else"`, the last status has no `blockedByAgent`: `expect(heard.at(-1)).toMatchObject({ state: 'paused', agent: { connected: false, clientName: null } });`

In `packages/server/test/mcp-controller.test.ts`, the rig no longer waits for the agent before a season. A season starts without one, but the tests read the agent's view, so keep the wait and say why:

```ts
  await until(() => controller.status().agent.connected); // the tests speak as the connected agent
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `pnpm vitest run packages/server/test/game-controller.test.ts packages/server/test/game-server.test.ts`
Expected: FAIL. Among the failures:
- `'starts a season without an agent, …'`: `connect an agent first` thrown by `startSeason`;
- `c.install is not a function` and `c.manual is not a function`;
- the `agentLost` tests: `expected [] to deeply equal [ { id: -1, kind: 'agentLost', … } ]`;
- `'reports its status'`: `blockedByAgent` is still in the status;
- the end-to-end test: the viewer's `startSeason` answered `connect an agent first`.

The typecheck (`pnpm typecheck`) also fails here: `Property 'install' does not exist on type 'GameController'`.

- [ ] **Step 4: Replace the worker**

`packages/server/src/worker.ts`:

```ts
import { parentPort, workerData } from 'node:worker_threads';
import {
  alertsView,
  alertView,
  type BoardState,
  type BootInfo,
  boardManual,
  type CommandResult,
  type DeployedBy,
  type FirmwareHost,
  findBoard,
  findFacility,
  firmwareView,
  inspectBoard,
  listBoards,
  logsView,
  mapView,
  parseScenario,
  type Query,
  Session,
  snapshot,
  statusView,
  type TickInput,
  type TickOutcome,
  ToolError,
  type WorkerRequest,
  type WorkerResponse,
} from '@turing-city/core';
import { WasmoonHost } from '@turing-city/firmware';

if (!parentPort) throw new Error('worker.ts runs as a worker thread');
const port = parentPort;
/** [board index or -1, firmware version]: what the watchdog reports if this thread stops answering. */
const progress = new Int32Array((workerData as { progress: SharedArrayBuffer }).progress);

/** Writes which board is running into shared memory around each tick. */
class TrackingHost implements FirmwareHost {
  private readonly inner: FirmwareHost;
  private readonly index: (boardId: string) => [number, number];

  constructor(inner: FirmwareHost, index: (boardId: string) => [number, number]) {
    this.inner = inner;
    this.index = index;
  }
  boot(info: BootInfo): void {
    this.inner.boot(info);
  }
  tick(boardId: string, input: TickInput): TickOutcome {
    const [i, version] = this.index(boardId);
    Atomics.store(progress, 0, i);
    Atomics.store(progress, 1, version);
    try {
      return this.inner.tick(boardId, input);
    } finally {
      Atomics.store(progress, 0, -1);
    }
  }
  shutdown(boardId: string): void {
    this.inner.shutdown(boardId);
  }
  close(): void {
    this.inner.close();
  }
}

let session: Session | null = null;

function send(message: WorkerResponse): void {
  port.postMessage(message);
}

/**
 * Answers a request that carries an id. A handler that throws fails that one request and leaves the season running, and a
 * ToolError's refusal travels with its message, so that the viewer can say it in Korean. A plain Error that escaped to `handle`
 * would stop the whole season as 'fatal'.
 */
function reply(id: number, compute: () => unknown): void {
  try {
    send({ type: 'reply', id, value: compute() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const refusal = error instanceof ToolError ? error.refusal : undefined;
    send(refusal ? { type: 'refused', id, message, refusal } : { type: 'refused', id, message });
  }
}

/**
 * The board an agent may work on: one with a comm module (T2, spec 10-10 §8). An id that names no board slot (nothing at all, or
 * housing, which takes no board) is null, which the agent tools read as an unknown board, as in milestone 1.
 */
function agentBoard(s: Session, id: string): BoardState | null {
  const facility = findFacility(s.world, id);
  if (!facility || facility.boardSpec === null) return null;
  const board = findBoard(s.world, id);
  if (!board?.comm) {
    throw new ToolError(`${id} has no comm module: the player installs one from the board's panel`, { code: 'noComm', board: id });
  }
  return board;
}

/** Where a deploy goes: the player's needs a board, the agent's a comm module as well. */
function deployTarget(s: Session, id: string, by: DeployedBy): BoardState {
  const board = by === 'agent' ? agentBoard(s, id) : findBoard(s.world, id);
  if (board) return board;
  if (by === 'player' && findFacility(s.world, id)?.boardSpec) {
    throw new ToolError(`${id} has no board: install one from its panel first`, { code: 'noBoard', facility: id });
  }
  throw new ToolError(`unknown board ${id}; list_boards lists the boards`, { code: 'unknownBoard', board: id });
}

function answer(s: Session, query: Query): unknown {
  const ctx = s.ctx;
  switch (query.kind) {
    case 'listBoards':
      return listBoards(s.world);
    case 'manual':
      return agentBoard(s, query.board) ? boardManual(s.scenario, query.board) : null;
    case 'firmware':
      return agentBoard(s, query.board) ? firmwareView(s.world, query.board) : null;
    case 'logs':
      return agentBoard(s, query.board) ? logsView(ctx, query.board, query.since ?? undefined) : null;
    case 'map':
      return mapView(ctx);
    case 'status':
      return statusView(ctx);
    case 'alerts':
      return alertsView(ctx, query.since ?? undefined);
    case 'inspect':
      return inspectBoard(ctx, query.board);
  }
}

/**
 * A command that changed the world tells the main thread how it stands before it answers: snapshots otherwise come with a batch of
 * steps, and a game that stands still would show none of it. A refused command changed nothing.
 */
function changed(s: Session, result: CommandResult): CommandResult {
  if (result.ok) send({ type: 'snapshot', snapshot: snapshot(s.ctx) });
  return result;
}

async function handle(message: WorkerRequest): Promise<void> {
  if (message.type === 'start') {
    const scenario = parseScenario(message.scenario);
    const holder: { s: Session | null } = { s: null };
    const host = new TrackingHost(await WasmoonHost.create(), (boardId) => {
      const board = holder.s?.world.boards.find((b) => b.id === boardId);
      return [board?.index ?? -1, (board?.pending ?? board?.firmware)?.version ?? 0];
    });
    session = new Session(scenario, message.seed, host);
    holder.s = session;
    send({ type: 'started', snapshot: snapshot(session.ctx) });
    return;
  }
  const s = session;
  if (!s) throw new Error(`no season for ${message.type}`);
  switch (message.type) {
    case 'advance': {
      const alerts = [];
      for (let i = 0; i < message.steps && !s.world.ended; i++) {
        for (const a of s.step().alerts) alerts.push(alertView(s.scenario, a));
      }
      send({ type: 'advanced', snapshot: snapshot(s.ctx), alerts });
      return;
    }
    case 'deploy':
      reply(message.id, () => {
        const board = deployTarget(s, message.board, message.by);
        const result = s.deploy(message.board, message.code, message.by);
        send({ type: 'snapshot', snapshot: snapshot(s.ctx) });
        // The controller tells when the code installs, which depends on what the board is doing and on its power.
        return { ...result, boardStatus: board.status, powered: board.powered };
      });
      return;
    case 'install':
      reply(message.id, () => changed(s, s.install(message.facility, message.part)));
      return;
    case 'repair':
      reply(message.id, () => changed(s, s.repair(message.facility)));
      return;
    case 'rebuild':
      reply(message.id, () => changed(s, s.rebuild(message.board)));
      return;
    case 'hand':
      reply(message.id, () => changed(s, s.hand(message.facility, message.action)));
      return;
    case 'mark':
      s.mark(message.kind);
      return;
    case 'query':
      reply(message.id, () => answer(s, message.query));
      return;
  }
}

port.on('message', (message: WorkerRequest) => {
  handle(message).catch((error: unknown) => send({ type: 'fatal', message: error instanceof Error ? error.message : String(error) }));
});
```

- [ ] **Step 5: Replace the controller**

`packages/server/src/game-controller.ts`:

```ts
import { Worker } from 'node:worker_threads';
import {
  type AgentStatus,
  type AlertKind,
  type AlertView,
  type BoardInspection,
  type BoardStatus,
  type BoardSummary,
  type CommandResult,
  type ControllerEvent,
  type ControllerStatus,
  type DeployedBy,
  type DeployOutcome,
  type FacilityAction,
  type FirmwareView,
  type GameApi,
  type GameState,
  type InstallPart,
  type LogView,
  type MapView,
  type Query,
  type Scenario,
  type Snapshot,
  type StatusView,
  type StatusWithRun,
  ToolError,
  timeView,
  type WorkerRequest,
  type WorkerResponse,
} from '@turing-city/core';
import { SyntaxChecker } from '@turing-city/firmware';

export interface ControllerOptions {
  readonly scenario: Scenario;
  /** A batch of steps taking longer than this stops the session (spec §6.8). */
  readonly watchdogMs?: number;
  /** The most steps one batch may carry. */
  readonly stepsPerBatch?: number;
}

const CLOCK_MS = 50;
/**
 * The most time the clock makes up after it was kept from running (a tick that found a batch out, a slow worker). A process that
 * stood still (Ctrl+Z and fg, a debugger) comes back owing all the time it lost, and running through that would fast-forward the
 * game: batches of 200 steps, an auto-pause landing a whole batch after its alert. Past this, the time is skipped.
 */
const CATCH_UP_MS = 200;
/**
 * A watchdog timer that runs this much later than it was due means that the process itself stood still (Ctrl+Z and fg, a debugger),
 * and the worker thread with it: the worker has had no time yet to answer, so the batch gets a fresh period instead of failing.
 */
const STALL_MS = 1000;
const NO_SEASON = "The season hasn't started: ask the player to press Start.";
/** What the feed says when the agent that was connected drops while a season is in play. */
const AGENT_LOST = '에이전트 연결이 끊겼어요';
/** The alert kinds that pause the game until the player turns them off (spec 10-10 §8 adds the dropped agent). */
const DEFAULT_AUTO_PAUSE: readonly AlertKind[] = ['raid', 'wrecked', 'fire', 'firmwareError', 'agentLost'];

/**
 * When a deploy installs: at the board's next tick, which a board that sleeps, is smashed, or is being rebuilt reaches only later, and
 * which a board the grid has shed does not reach until its power returns. A smashed or rebuilding board draws nothing, so its power
 * flag says nothing: the rebuild comes first.
 */
export function installsAt(status: BoardStatus, powered: boolean): string {
  const next = "the board's next tick";
  switch (status) {
    case 'running':
      return powered ? next : `${next}, after its power returns`;
    case 'asleep':
      return powered ? `${next}, after it wakes` : `${next}, after it wakes and its power returns`;
    case 'destroyed':
      return `${next}, after the player rebuilds it`;
    case 'rebuilding':
      return `${next}, after its rebuild finishes`;
  }
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

/** A command of the player that the worker answers with a CommandResult. */
type CommandRequest = Extract<WorkerRequest, { type: 'install' | 'repair' | 'rebuild' | 'hand' }>;

/**
 * The main thread's side of a season: the clock, the worker, the watchdog, and the player's commands. An agent is a helper the
 * player may connect for boards with a comm module; nothing waits for one (spec 10-10 §8).
 *
 * A call that needs a season rejects with a ToolError while there is none (before the first, while one starts, after the
 * session failed), and so does a request the worker refuses, such as a deploy to a board that does not exist.
 */
export class GameController {
  private readonly scenario: Scenario;
  private readonly watchdogMs: number;
  private readonly stepsPerBatch: number;
  private readonly listeners = new Set<(event: ControllerEvent) => void>();
  private readonly pending = new Map<number, Pending>();
  private checker: Promise<SyntaxChecker> | null = null;
  private worker: Worker | null = null;
  private progress: Int32Array | null = null;
  private nextId = 1;
  private state: GameState = 'idle';
  private speed: 1 | 2 | 3 = 1;
  private agent: AgentStatus = { connected: false, clientName: null };
  private crash: string | null = null;
  private autoPause: AlertKind[] = [...DEFAULT_AUTO_PAUSE];
  private snapshotNow: Snapshot | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastClock = 0;
  private debt = 0;

  constructor(options: ControllerOptions) {
    this.scenario = options.scenario;
    this.watchdogMs = options.watchdogMs ?? 5000;
    this.stepsPerBatch = options.stepsPerBatch ?? 200;
  }

  onEvent(listener: (event: ControllerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  status(): ControllerStatus {
    return {
      state: this.state,
      speed: this.speed,
      agent: this.agent,
      crash: this.crash,
      autoPause: [...this.autoPause],
      scenarioName: this.scenario.name,
    };
  }

  latestSnapshot(): Snapshot | null {
    return this.snapshotNow;
  }

  /**
   * The agent's connection. An agent that was connected and drops while a season is in play raises an agentLost alert (the core
   * knows nothing of the connection, so the alert comes from here), and that pauses a running game when the player kept it in
   * autoPause. Play never waits for an agent to come back.
   */
  setAgent(agent: AgentStatus): void {
    const dropped = this.agent.connected && !agent.connected;
    this.agent = agent;
    if (dropped && (this.state === 'running' || this.state === 'paused')) {
      this.emit({ kind: 'alerts', alerts: [this.agentLostAlert()] });
      if (this.state === 'running' && this.autoPause.includes('agentLost')) {
        this.pause(); // it tells the new status, the agent's with it
        return;
      }
    }
    this.emitStatus();
  }

  setAutoPause(kinds: readonly AlertKind[]): void {
    this.autoPause = [...kinds];
    this.emitStatus();
  }

  setSpeed(speed: 1 | 2 | 3): void {
    this.speed = speed;
    this.emitStatus();
  }

  /** A new season in a fresh worker (a fresh Lua runtime). It starts paused. */
  async startSeason(seed = Math.floor(Math.random() * 2 ** 31)): Promise<void> {
    this.stopClock();
    this.terminate('a new season started');
    // Until the new worker answers 'started', reads and deploys get "the season hasn't started".
    this.state = 'idle';
    this.crash = null;
    this.progress = new Int32Array(new SharedArrayBuffer(8));
    this.progress[0] = -1;
    // Node strips the worker's types itself and warns about it once per thread; the server runs with this flag already.
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      workerData: { progress: this.progress.buffer },
      execArgv: ['--disable-warning=ExperimentalWarning'],
    });
    this.worker = worker;
    // A worker that was stopped still delivers what it had already posted (Node drains its port as the thread exits), and an
    // error it raised on the way out. That is the voice of a season that is over: only the worker the controller holds is heard.
    worker.on('message', (m: WorkerResponse) => {
      if (this.worker === worker) this.onWorker(m);
    });
    worker.on('error', (e) => {
      if (this.worker === worker) this.fail(`the simulator failed: ${e instanceof Error ? e.message : String(e)}`);
    });
    const started = new Promise<Snapshot>((resolve, reject) => {
      this.startWaiter = { resolve, reject };
    });
    this.post({ type: 'start', scenario: this.scenarioJson(), seed });
    this.snapshotNow = await started;
    this.state = 'paused';
    this.emit({ kind: 'snapshot', snapshot: this.snapshotNow });
    this.emitStatus();
  }

  play(): void {
    if (this.state === 'idle' || this.state === 'crashed') throw this.noSeason(); // nothing to play, and the caller is to hear it
    if (this.state !== 'paused') return;
    this.state = 'running';
    this.post({ type: 'mark', kind: 'resume' });
    this.lastClock = performance.now();
    this.debt = 0;
    this.timer = setInterval(() => this.onClock(), CLOCK_MS);
    this.emitStatus();
  }

  pause(): void {
    if (this.state !== 'running') return;
    this.stopClock();
    this.state = 'paused';
    this.post({ type: 'mark', kind: 'pause' });
    this.emitStatus();
  }

  /** As fast as possible, without the clock: for tests and the dev tools. */
  async runUntil(goal: { seconds?: number; alertKinds?: readonly AlertKind[] }): Promise<void> {
    if (this.state !== 'paused') throw new Error('run_until needs a paused season');
    const sps = this.scenario.time.stepsPerSecond;
    const target = goal.seconds === undefined ? Number.POSITIVE_INFINITY : (this.snapshotNow?.step ?? 0) + goal.seconds * sps;
    for (;;) {
      const at = this.snapshotNow?.step ?? 0;
      if (at >= target || (this.state as GameState) !== 'paused' || this.snapshotNow?.ended) return;
      const alerts = await this.advance(Math.min(this.stepsPerBatch, target - at));
      if (goal.alertKinds && alerts.some((a) => goal.alertKinds!.includes(a.kind))) return;
    }
  }

  /**
   * A deploy, by the player (the editor, to any board) or by the agent (MCP, to a board with a comm module only). The worker refuses
   * the rest with the code the viewer says in Korean.
   */
  async deploy(board: string, code: string, by: DeployedBy = 'player'): Promise<DeployOutcome> {
    const worker = this.requireSeason();
    this.checker ??= SyntaxChecker.create();
    const problem = (await this.checker).check(code);
    if (problem !== null) return { ok: false, error: problem };
    // The checker takes about 100 ms to load the first time, and the season can change meanwhile. A deploy posted to a season that
    // is still starting would crash it ("no season for deploy"), and one posted to a season that is gone would wait for ever.
    if (this.worker !== worker) {
      throw this.worker === null
        ? this.noSeason()
        : new ToolError('A new season started while the code was being checked; deploy it again.');
    }
    const result = (await this.request({ type: 'deploy', id: 0, board, code, by })) as {
      version: number;
      boardStatus: BoardStatus;
      powered: boolean;
    };
    const time = timeView(this.scenario, this.snapshotNow?.step ?? 0);
    this.emit({ kind: 'deploy', board, version: result.version, time, by });
    return { ok: true, version: result.version, installsAt: installsAt(result.boardStatus, result.powered) };
  }

  /** The player's purchase of a board (T1) or a comm module (T2) for a facility. */
  install(facility: string, part: InstallPart): Promise<CommandResult> {
    return this.command({ type: 'install', id: 0, facility, part });
  }

  /** The player's repair of a wrecked facility. */
  repair(facility: string): Promise<CommandResult> {
    return this.command({ type: 'repair', id: 0, facility });
  }

  /** The player's rebuild of a smashed board, once its facility stands again. */
  rebuild(board: string): Promise<CommandResult> {
    return this.command({ type: 'rebuild', id: 0, board });
  }

  /** A facility's work done by the player's hand; it applies at the next step. */
  hand(facility: string, action: FacilityAction): Promise<CommandResult> {
    return this.command({ type: 'hand', id: 0, facility, action });
  }

  listBoards(): Promise<BoardSummary[]> {
    return this.query({ kind: 'listBoards' }) as Promise<BoardSummary[]>;
  }
  /** A board's manual for the agent (a board with a comm module only); null for an id that names no board slot. */
  manual(board: string): Promise<string | null> {
    return this.query({ kind: 'manual', board }) as Promise<string | null>;
  }
  firmware(board: string): Promise<FirmwareView | null> {
    return this.query({ kind: 'firmware', board }) as Promise<FirmwareView | null>;
  }
  logs(board: string, since: number | undefined): Promise<LogView[] | null> {
    return this.query({ kind: 'logs', board, since: since ?? null }) as Promise<LogView[] | null>;
  }
  map(): Promise<MapView> {
    return this.query({ kind: 'map' }) as Promise<MapView>;
  }
  /** The season's status for the agent tools (status() is the controller's own), with how the player has set the clock. */
  async statusOf(): Promise<StatusWithRun> {
    const view = (await this.query({ kind: 'status' })) as StatusView;
    return { ...view, run: { paused: this.state !== 'running', speed: this.speed } };
  }
  alerts(since: number | undefined): Promise<AlertView[]> {
    return this.query({ kind: 'alerts', since: since ?? null }) as Promise<AlertView[]>;
  }
  inspect(board: string): Promise<BoardInspection | null> {
    return this.query({ kind: 'inspect', board }) as Promise<BoardInspection | null>;
  }

  close(): void {
    this.stopClock();
    this.terminate('the server is shutting down');
    this.listeners.clear();
  }

  // ---- internals ----

  private startWaiter: { resolve: (s: Snapshot) => void; reject: (e: Error) => void } | null = null;
  private advanceWaiter: { resolve: (alerts: readonly AlertView[]) => void; reject: (e: Error) => void } | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;

  private onClock(): void {
    if (this.state !== 'running' || this.advanceWaiter) return;
    const now = performance.now();
    const stepsPerMs = (this.scenario.time.stepsPerSecond * this.speed) / 1000;
    this.debt = Math.min(this.debt + (now - this.lastClock) * stepsPerMs, CATCH_UP_MS * stepsPerMs);
    this.lastClock = now;
    const n = Math.min(Math.floor(this.debt), this.stepsPerBatch);
    if (n <= 0) return;
    this.debt -= n;
    this.advance(n).catch(() => undefined); // a batch cut short by a new season or a failure has nobody to tell
  }

  private advance(steps: number): Promise<readonly AlertView[]> {
    // One waiter and one watchdog serve one batch: a second batch would orphan the first one's answer and its timer.
    // A batch that is out ends on its own, so the caller can retry; the message says so because dev_run_until hands it to an agent.
    if (this.advanceWaiter) return Promise.reject(new Error('a batch of steps is already running; try again in a moment'));
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      this.advanceWaiter = waiter;
      this.armWatchdog(waiter);
      this.post({ type: 'advance', steps });
    });
  }

  /** Starts the timer that stops the session if the batch `waiter` waits for is still out when it falls due. */
  private armWatchdog(waiter: NonNullable<GameController['advanceWaiter']>): void {
    const due = performance.now() + this.watchdogMs;
    this.watchdog = setTimeout(() => {
      if (this.advanceWaiter !== waiter) return;
      // Long after it was due: the process stood still, the worker with it, and has not yet had the time to answer.
      if (performance.now() - due > STALL_MS) {
        this.armWatchdog(waiter);
        return;
      }
      // On time, the answer can still be posted and not yet read (the loop was busy), and the loop runs its timers before it reads
      // messages. One more turn reads the answer first: the batch is hung only if it is still out then.
      setImmediate(() => {
        if (this.advanceWaiter === waiter) this.onWatchdog();
      });
    }, this.watchdogMs);
  }

  private onWorker(m: WorkerResponse): void {
    switch (m.type) {
      case 'started':
        this.startWaiter?.resolve(m.snapshot);
        this.startWaiter = null;
        return;
      case 'advanced': {
        if (this.watchdog) clearTimeout(this.watchdog);
        this.watchdog = null;
        this.snapshotNow = m.snapshot;
        this.emit({ kind: 'snapshot', snapshot: m.snapshot });
        if (m.alerts.length > 0) this.emit({ kind: 'alerts', alerts: m.alerts });
        if (m.snapshot.ended) {
          this.stopClock();
          this.state = 'ended';
          this.emitStatus();
        } else if (this.state === 'running' && m.alerts.some((a) => this.autoPause.includes(a.kind))) {
          this.pause();
        }
        const waiter = this.advanceWaiter;
        this.advanceWaiter = null;
        waiter?.resolve(m.alerts);
        return;
      }
      case 'snapshot':
        this.snapshotNow = m.snapshot;
        this.emit({ kind: 'snapshot', snapshot: m.snapshot });
        return;
      case 'reply': {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        p?.resolve(m.value);
        return;
      }
      case 'refused': {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        p?.reject(new ToolError(m.message, m.refusal));
        return;
      }
      case 'fatal':
        this.fail(`the simulator failed: ${m.message}`);
        return;
    }
  }

  private onWatchdog(): void {
    const index = this.progress ? Atomics.load(this.progress, 0) : -1;
    const version = this.progress ? Atomics.load(this.progress, 1) : 0;
    const board = index >= 0 ? this.scenario.facilities[index]?.id : undefined;
    this.fail(
      board
        ? `the simulator stopped responding while ${board} ran firmware v${version}; the session stopped`
        : 'the simulator stopped responding; the session stopped',
    );
  }

  private fail(message: string): void {
    this.stopClock();
    this.terminate(message);
    this.state = 'crashed';
    this.crash = message;
    this.emitStatus();
  }

  /** The alert the feed shows for a dropped agent; the core never raises it, so it has no id of the season's. */
  private agentLostAlert(): AlertView {
    return { ...timeView(this.scenario, this.snapshotNow?.step ?? 0), id: -1, kind: 'agentLost', facility: null, message: AGENT_LOST };
  }

  private async command(message: CommandRequest): Promise<CommandResult> {
    this.requireSeason();
    return (await this.request(message)) as CommandResult;
  }

  private query(query: Query): Promise<unknown> {
    if (!this.worker || this.state === 'idle' || this.state === 'crashed') return Promise.reject(this.noSeason());
    return this.request({ type: 'query', id: 0, query });
  }

  private request(message: WorkerRequest & { id: number }): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.post({ ...message, id } as WorkerRequest);
    });
  }

  /** The worker of the season in play; a ToolError when there is none. */
  private requireSeason(): Worker {
    if (!this.worker || this.state === 'idle' || this.state === 'crashed') throw this.noSeason();
    return this.worker;
  }

  /** Why there is no season to work on: none has started, or the one that did crashed, and the player can start another. */
  private noSeason(): ToolError {
    if (this.state !== 'crashed') return new ToolError(NO_SEASON, { code: 'noSeason' });
    const reason = this.crash ?? 'unknown';
    return new ToolError(`The season crashed (${reason}). The player can start a new season.`, { code: 'crashed', reason });
  }

  private post(message: WorkerRequest): void {
    this.worker?.postMessage(message);
  }

  private stopClock(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Stops the worker and fails everything still waiting on it, so no caller hangs. */
  private terminate(reason: string): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    if (this.worker) void this.worker.terminate();
    this.worker = null;
    const error = new Error(reason);
    this.startWaiter?.reject(error);
    this.startWaiter = null;
    this.advanceWaiter?.reject(error);
    this.advanceWaiter = null;
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }

  private scenarioJson(): unknown {
    return JSON.parse(JSON.stringify(this.scenario));
  }

  private emitStatus(): void {
    this.emit({ kind: 'status', status: this.status() });
  }

  private emit(event: ControllerEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

/** The agent tools' view of the controller: its deploys are the agent's, which reach a board with a comm module only. */
export function gameApi(c: GameController): GameApi {
  return {
    listBoards: () => c.listBoards(),
    manual: (board) => c.manual(board),
    firmware: (board) => c.firmware(board),
    deploy: (board, code) => c.deploy(board, code, 'agent'),
    logs: (board, since) => c.logs(board, since),
    map: () => c.map(),
    status: () => c.statusOf(),
    alerts: (since) => c.alerts(since),
  };
}
```

- [ ] **Step 6: Take the agent rule out of the viewer**

`packages/viewer/src/ui/overlay.ts` loses the lost-agent box and the new-season button's wait for an agent:

```ts
import { clear, el } from '../dom.ts';
import { endingLabel, moneyLabel } from '../format.ts';
import type { Connection } from '../net.ts';
import type { Store } from '../store.ts';

/** A crashed session, or the season's end. Hidden otherwise. */
export function renderOverlay(root: HTMLElement, store: Store, net: Connection): void {
  clear(root);
  const status = store.status;
  const s = store.snapshot;
  const newSeason = el('button', { class: 'primary', onclick: () => net.send({ type: 'startSeason' }) }, ['새 시즌']);
  let box: HTMLElement | null = null;
  if (status?.state === 'crashed') {
    box = el('div', { class: 'box bad' }, [el('h2', { class: 'bad' }, ['시뮬레이터가 멈췄어요']), el('p', {}, [status.crash ?? '']), newSeason]);
  } else if (status?.state === 'ended' && s?.ended) {
    box = el('div', { class: 'box' }, [
      el('h2', {}, [endingLabel(s.ended.kind)]),
      el('p', {}, [`최종 자금 ${moneyLabel(s.money)}`]),
      el('p', { class: 'dim' }, ['시즌 결산 화면(내역과 지난 시즌 목록)은 플레이테스트 뒤에 붙어요.']),
      newSeason,
    ]);
  }
  root.hidden = box === null;
  if (box) root.append(box);
}
```

In `packages/viewer/src/ui/start-screen.ts`, the start button no longer waits for an agent. Replace its line with:

```ts
      el('button', { class: 'start-button', onclick: () => net.send({ type: 'startSeason' }) }, ['시즌 시작']),
```

Task 17 redraws both screens; this keeps them true to the server meanwhile.

In `packages/viewer/test/store.test.ts`, drop `blockedByAgent: false,` from the status in `'goes away at once when a season is up and running, as before'`.

`pnpm shots` pins the old rule in two places: scene 7 (Space refused without an agent) and scene 10 (the overlay's 새 시즌 disabled without one). Task 21 rewrites those scenes. This task doesn't run `pnpm shots`.

- [ ] **Step 7: Run the tests to see them pass**

Run: `pnpm vitest run packages/server packages/viewer`
Expected: PASS, every file of both packages.

- [ ] **Step 8: Check and commit**

Run: `pnpm fix && pnpm check`
Expected: exit 0.

```bash
git add packages/core/src/protocol.ts packages/server/src/worker.ts packages/server/src/game-controller.ts \
  packages/viewer/src/ui/overlay.ts packages/viewer/src/ui/start-screen.ts packages/viewer/test/store.test.ts \
  packages/server/test/game-controller.test.ts packages/server/test/game-server.test.ts packages/server/test/mcp-controller.test.ts
git commit -m "Let the player play without an agent, carry the player's commands, and gate the agent at T2

The controller and the worker carry installs, repairs, rebuilds, and hand actions,
each answered after the new picture of the world, with refusals that keep their
code across the worker boundary. A deploy says who made it: the player's goes to
any board, the agent's only to a board with a comm module, and the agent's reads
of a board need one too. No season waits for an agent any more; a dropped agent
raises agentLost, which auto-pauses by default."
```

(End the message with the trailer lines the dispatch gives.)

---

### Task 14: MCP: board tools at T2, the manual as the datasheet, dev tools for the hand

> **Corrections from assembling the plan (read first).**
> - Task 3 already added `GameController.repair()` and `rebuild()` returning `CommandResult`, and Task 11 added `manual` to `GameApi`, the worker, and the controller. Use them.


Spec 10-10 §8, contract §16. Task 13 put the gate in the worker: the agent's board tools reach a board with a comm module only, and say how the player opens one. This task finishes the MCP side:
- **Shapes.** The command shapes the server checks at its doors live in one core module, used by the MCP tools here and by the viewer's socket in Task 15.
- **Text.** `get_datasheet` hands over the board's manual as markdown text, not as a JSON string.
- **Dev tools.** QA agents, who cannot click, get the player's hand: `dev_hand`, `dev_install`, and `dev_repair`.

**Files:**
- Create: `packages/core/src/commands.ts` (`FIRMWARE_SOURCE`, `FACILITY_ACTION`, `INSTALL_PART`)
- Modify: `packages/core/src/index.ts`, `packages/core/src/agent-tools.ts` (`deploy_firmware`'s `code` comes from `FIRMWARE_SOURCE`)
- Modify: `packages/server/src/mcp.ts` (`DevTools`, the three dev tools, string results as text), `packages/server/src/game-server.ts` (dev wiring), `packages/server/src/main.ts` (the dev tools line)
- Test: `packages/core/test/commands.test.ts`, `packages/server/test/mcp.test.ts`, `packages/server/test/mcp-controller.test.ts`, `packages/server/test/game-server.test.ts`

**Interfaces:**
- Consumes:
  - Task 13: `GameController.install`, `repair`, `rebuild`, and `hand`; the T2 gate and its words.
  - Task 11: `boardManual`, and `AGENT_TOOLS`' `get_datasheet` calling `api.manual`.
  - Task 4: `FacilityAction`.
  - Task 2: `InstallPart`, `CommandResult`.
  - Task 10: `StatusView` with `food` and `population`; `BoardSummary.tier`.
- Produces:
  - `commands.ts`: `FIRMWARE_SOURCE` (zod string: at most 65,536 characters, no NUL byte), `FACILITY_ACTION: z.ZodType<FacilityAction>` (strict, bounded), and `INSTALL_PART: z.ZodType<InstallPart>`. Task 15's hub schema uses all three.
  - `mcp.ts`: `interface DevTools` gains `repair(facility): Promise<CommandResult>`, `install(facility, part): Promise<CommandResult>`, and `hand(facility, action): Promise<CommandResult>`, and `rebuild` answers a `CommandResult`. The tools are `dev_hand { facility, action }`, `dev_install { facility, part }`, and `dev_repair { facility }`. A tool whose result is a string returns it as the text itself.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/commands.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FACILITY_ACTION, FIRMWARE_SOURCE, INSTALL_PART } from '../src/commands.ts';
import type { FacilityAction } from '../src/firmware-host.ts';

describe('command shapes', () => {
  it('takes every facility action, exactly', () => {
    const good: FacilityAction[] = [
      { kind: 'process' },
      { kind: 'cool' },
      { kind: 'setThermal', output: 120 },
      { kind: 'setPriority', order: ['H1', 'DA'] },
      { kind: 'harvest' },
      { kind: 'dispatch', truck: 1, from: 'F1', to: 'W', amount: 24 },
    ];
    for (const action of good) expect(FACILITY_ACTION.safeParse(action).success, JSON.stringify(action)).toBe(true);
  });

  it('refuses any other shape: an unknown kind, a field too many or missing, and numbers out of their range', () => {
    const bad: unknown[] = [
      {},
      { kind: 'fly' },
      { kind: 'process', seconds: 5 },
      { kind: 'cool', level: 2 }, // cooling is a cycle now, with no level
      { kind: 'setThermal' },
      { kind: 'setThermal', output: -1 },
      { kind: 'setThermal', output: 1.5 },
      { kind: 'setPriority', order: 'DA' },
      { kind: 'setPriority', order: [''] },
      { kind: 'dispatch', truck: 0, from: 'F1', to: 'W', amount: 24 },
      { kind: 'dispatch', truck: 1, from: 'F1', to: 'W' },
      { kind: 'dispatch', truck: 1, from: 'F1', to: 'W', amount: 0 },
      { kind: 'dispatch', truck: 1, from: 'X'.repeat(33), to: 'W', amount: 24 },
    ];
    for (const action of bad) expect(FACILITY_ACTION.safeParse(action).success, JSON.stringify(action)).toBe(false);
  });

  it('takes a source of up to 64 KB with no NUL byte, and a board or a comm module to install', () => {
    expect(FIRMWARE_SOURCE.safeParse('x'.repeat(65_536)).success).toBe(true);
    expect(FIRMWARE_SOURCE.safeParse('x'.repeat(65_537)).success).toBe(false);
    expect(FIRMWARE_SOURCE.safeParse('function tick() end\u0000os.exit()').success).toBe(false);
    expect(FIRMWARE_SOURCE.safeParse(42).success).toBe(false);
    expect(INSTALL_PART.safeParse('board').success).toBe(true);
    expect(INSTALL_PART.safeParse('comm').success).toBe(true);
    expect(INSTALL_PART.safeParse('shield').success).toBe(false);
  });
});
```

In `packages/server/test/mcp.test.ts`:

1. `fakeApi()` answers as the GameApi of Tasks 10 and 11 do:

```ts
function fakeApi(): GameApi & { deployed: Array<[string, string]> } {
  const deployed: Array<[string, string]> = [];
  return {
    deployed,
    listBoards: async () => [],
    manual: async () => null,
    firmware: async () => null,
    deploy: async (board, code) => {
      deployed.push([board, code]);
      return { ok: true, version: 1, installsAt: "the board's next tick" };
    },
    logs: async () => [],
    map: async () => ({ width: 20, height: 12, facilities: [] }),
    status: async () => ({
      time: { day: 1, clock: '00:00', seconds: 0 },
      seasonDays: 30,
      money: 5000,
      power: { generation: 0, demand: 0, shed: [] },
      food: { warehouse: 0, housing: 0 },
      population: { fed: 0, hungry: 0, unpowered: 0 },
      ended: null,
      run: { paused: true, speed: 1 },
    }),
    alerts: async () => [],
  };
}
```

2. In `start()`, the dev tools have the player's hand too:

```ts
  const devTools: DevTools = {
    play: () => {},
    pause: () => {},
    setSpeed: () => {},
    runUntil: async () => {},
    newSeason: async () => {},
    rebuild: async () => ({ ok: true }),
    repair: async () => ({ ok: true }),
    install: async () => ({ ok: true }),
    hand: async () => ({ ok: true }),
  };
```

3. In `'lists the eight agent tools, and the dev tools only in dev mode'`, the dev list grows:

```ts
    expect(names).toEqual(
      expect.arrayContaining([
        'dev_play',
        'dev_pause',
        'dev_set_speed',
        'dev_run_until',
        'dev_new_season',
        'dev_rebuild',
        'dev_repair',
        'dev_install',
        'dev_hand',
      ]),
    );
```

4. Add to `describe('MCP endpoint', …)`:

```ts
  it("hands over a string result as the text itself, so that a board's manual reads as markdown, and anything else as JSON", async () => {
    const r = await start();
    const manual = '# DA · 데이터센터\n\n- `io.process()`\n';
    r.api.manual = async () => manual;
    const { client } = await connect(r.url);
    expect(textOf(await client.callTool({ name: 'get_datasheet', arguments: { board: 'DA' } }))).toBe(manual);
    expect(JSON.parse(textOf(await client.callTool({ name: 'get_status', arguments: {} }))).money).toBe(5000);
    await client.close();
  });
```

5. In `'reaches the agent as a tool error, for every tool'`:
    - the failing api has `manual: rejects` in place of `datasheet: rejects`;
    - the dev tools: `Object.assign(r.dev, { play: throws, pause: throws, setSpeed: throws, runUntil: rejects, newSeason: rejects, rebuild: rejects, repair: rejects, install: rejects, hand: rejects });`
    - `calls` gains `dev_repair: { facility: 'DA' }`, `dev_install: { facility: 'F1', part: 'board' }`, and `dev_hand: { facility: 'DA', action: { kind: 'process' } }`.
6. Replace `'hands each dev tool its arguments, and returns what the game answers'` with:

```ts
  it('hands each dev tool its arguments, and returns what the game answers', async () => {
    const r = await start(true);
    const calls: unknown[][] = [];
    const done = { ok: true };
    Object.assign(r.dev, {
      play: () => void calls.push(['play']),
      pause: () => void calls.push(['pause']),
      setSpeed: (speed: number) => void calls.push(['setSpeed', speed]),
      runUntil: async (goal: unknown) => void calls.push(['runUntil', goal]),
      newSeason: async (seed: number) => void calls.push(['newSeason', seed]),
      rebuild: async (board: string) => {
        calls.push(['rebuild', board]);
        return { ok: false, reason: 'DB is not destroyed', refusal: { code: 'notDestroyed', board: 'DB' } };
      },
      repair: async (facility: string) => {
        calls.push(['repair', facility]);
        return done;
      },
      install: async (facility: string, part: string) => {
        calls.push(['install', facility, part]);
        return done;
      },
      hand: async (facility: string, action: unknown) => {
        calls.push(['hand', facility, action]);
        return done;
      },
    });
    const { client } = await connect(r.url);
    const answer = async (name: string, args: Record<string, unknown>): Promise<unknown> =>
      JSON.parse(textOf(await client.callTool({ name, arguments: args })));
    expect(await answer('dev_play', {})).toEqual(done);
    expect(await answer('dev_pause', {})).toEqual(done);
    expect(await answer('dev_set_speed', { speed: 3 })).toEqual(done);
    expect(await answer('dev_run_until', { seconds: 5, alertKinds: ['raid'] })).toEqual(done);
    expect(await answer('dev_run_until', { alertKinds: ['fire'] })).toEqual(done);
    expect(await answer('dev_run_until', {})).toEqual(done);
    expect(await answer('dev_new_season', { seed: 7 })).toEqual(done);
    expect(await answer('dev_rebuild', { board: 'DB' })).toEqual({
      ok: false,
      reason: 'DB is not destroyed',
      refusal: { code: 'notDestroyed', board: 'DB' },
    });
    expect(await answer('dev_repair', { facility: 'DA' })).toEqual(done);
    expect(await answer('dev_install', { facility: 'F1', part: 'board' })).toEqual(done);
    const dispatch = { kind: 'dispatch', truck: 1, from: 'F1', to: 'W', amount: 20 };
    expect(await answer('dev_hand', { facility: 'W', action: dispatch })).toEqual(done);
    expect(await answer('dev_hand', { facility: 'DA', action: { kind: 'process' } })).toEqual(done);
    expect(calls).toStrictEqual([
      ['play'],
      ['pause'],
      ['setSpeed', 3],
      ['runUntil', { seconds: 5, alertKinds: ['raid'] }],
      ['runUntil', { alertKinds: ['fire'] }], // what the agent left out stays out
      ['runUntil', {}],
      ['newSeason', 7],
      ['rebuild', 'DB'],
      ['repair', 'DA'],
      ['install', 'F1', 'board'],
      ['hand', 'W', dispatch],
      ['hand', 'DA', { kind: 'process' }],
    ]);
    await client.close();
  });
```

7. In `'refuses dev arguments that fit no speed, no time, and no seed, before the game sees them'`, the dev tools record their calls too, and the refused list grows:

```ts
    Object.assign(r.dev, {
      setSpeed: (speed: number) => calls.push(speed),
      runUntil: async (goal: unknown) => calls.push(goal),
      newSeason: async (seed: number) => calls.push(seed),
      repair: async (facility: unknown) => calls.push(facility),
      install: async (facility: unknown) => calls.push(facility),
      hand: async (facility: unknown) => calls.push(facility),
    });
```

and at the end of `refused`:

```ts
      ['dev_install', { facility: 'F1', part: 'shield' }],
      ['dev_install', { facility: 'F1' }],
      ['dev_repair', {}],
      ['dev_hand', { facility: 'DA' }],
      ['dev_hand', { facility: 'DA', action: { kind: 'fly' } }],
      ['dev_hand', { facility: 'P', action: { kind: 'setThermal', output: -5 } }],
      ['dev_hand', { facility: 'W', action: { kind: 'dispatch', truck: 1, from: 'F1', to: 'W' } }],
```

In `packages/server/test/mcp-controller.test.ts`:

1. Import `boardManual` with `parseScenario`: `import { boardManual, parseScenario } from '@turing-city/core';`
2. The rig's dev tools are the controller's:

```ts
    dev: {
      play: () => controller.play(),
      pause: () => controller.pause(),
      setSpeed: (speed) => controller.setSpeed(speed),
      runUntil: (goal) => controller.runUntil(goal),
      newSeason: (seed) => controller.startSeason(seed),
      rebuild: (board) => controller.rebuild(board),
      repair: (facility) => controller.repair(facility),
      install: (facility, part) => controller.install(facility, part),
      hand: (facility, action) => controller.hand(facility, action),
    },
```

3. Add to `describe('MCP endpoint over the real controller', …)`:

```ts
  it("tells the agent it reaches a board only through its comm module, and hands over the board's manual as it is once it does", async () => {
    const r = await start();
    const call = async (name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> => {
      const result = await r.client.callTool({ name, arguments: args });
      return { isError: result.isError === true, text: textOf(result) };
    };
    const boards = JSON.parse((await call('list_boards', {})).text) as Array<{ id: string; tier: number }>;
    expect(boards.map((b) => [b.id, b.tier])).toEqual([
      ['P', 1],
      ['DA', 1],
      ['DB', 1],
    ]);
    const noComm = { isError: true, text: "DA has no comm module: the player installs one from the board's panel" };
    expect(await call('get_datasheet', { board: 'DA' })).toEqual(noComm);
    expect(await call('get_firmware', { board: 'DA' })).toEqual(noComm);
    expect(await call('read_logs', { board: 'DA' })).toEqual(noComm);
    expect(await call('deploy_firmware', { board: 'DA', code: 'function tick() end' })).toEqual(noComm);
    expect(JSON.parse((await call('dev_install', { facility: 'DA', part: 'comm' })).text)).toEqual({ ok: true });
    expect(await call('get_datasheet', { board: 'DA' })).toEqual({ isError: false, text: boardManual(scenario, 'DA') });
    expect(JSON.parse((await call('deploy_firmware', { board: 'DA', code: 'function tick() end' })).text)).toMatchObject({
      ok: true,
      version: 1,
    });
  });
```

In `packages/server/test/game-server.test.ts`:

1. `'offers the dev tools only to a server started with the dev flag'` lists all nine:

```ts
    expect((await toolNames(true)).filter((name) => name.startsWith('dev_')).sort()).toEqual([
      'dev_hand',
      'dev_install',
      'dev_new_season',
      'dev_pause',
      'dev_play',
      'dev_rebuild',
      'dev_repair',
      'dev_run_until',
      'dev_set_speed',
    ]);
```

2. The end-to-end test, now that the agent can be given a board, deploys to it. Replace the test Task 13 wrote with:

```ts
  it('runs a season end to end: a viewer starts it without an agent, the agent works a board through its comm module, and its drop is told', async () => {
    const configDir = tempDir('tc-server-');
    const server = await startGameServer({ port: 0, configDir, dev: true, viewerDist: null, scenarioPath: M1 });
    stop = server.close;
    const v = await viewer(server.port);
    await until(() => last(v.seen, 'hello') !== undefined && last(v.seen, 'status') !== undefined);
    expect(last(v.seen, 'hello')!.connect).toContain(loadConfig(configDir).token);
    expect(last(v.seen, 'status')!.status).toMatchObject({ state: 'idle', agent: { connected: false } });

    v.send({ type: 'startSeason' }); // no agent is needed to play
    await until(() => last(v.seen, 'status')?.status.state === 'paused');

    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${loadConfig(configDir).token}` } },
    });
    const agent = new Client({ name: 'e2e-agent', version: '0.0.1' });
    await agent.connect(transport as Transport);
    await until(() => last(v.seen, 'status')?.status.agent.connected === true);
    const deploy = () =>
      agent.callTool({ name: 'deploy_firmware', arguments: { board: 'DA', code: 'function tick(io) io.log("on") end' } });
    // DA has a board (T1) and no comm module: the agent is told how the player opens it.
    const refused = await deploy();
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toBe("DA has no comm module: the player installs one from the board's panel");
    await agent.callTool({ name: 'dev_install', arguments: { facility: 'DA', part: 'comm' } });
    expect((await deploy()).isError).toBeFalsy();
    await until(() => last(v.seen, 'deploy') !== undefined);
    await agent.callTool({ name: 'dev_run_until', arguments: { seconds: 1 } });
    await until(() => last(v.seen, 'snapshot')!.snapshot.facilities.find((f) => f.id === 'DA')!.board!.hasFirmware);

    v.send({ type: 'inspect', board: 'DA' });
    await until(() => last(v.seen, 'inspection') !== undefined);
    expect(last(v.seen, 'inspection')!.inspection!.logs.some((l) => l.text === 'on')).toBe(true);

    v.send({ type: 'play' });
    await until(() => last(v.seen, 'status')?.status.state === 'running');
    await transport.terminateSession();
    await agent.close();
    // The drop is told to the viewer, and the game pauses for it: agentLost auto-pauses by default.
    await until(() => last(v.seen, 'status')?.status.state === 'paused');
    expect(v.seen.flatMap((m) => (m.type === 'alerts' ? m.alerts : [])).map((a) => a.kind)).toContain('agentLost');
    v.ws.close();
  }, 30_000);
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run packages/core/test/commands.test.ts packages/server/test/mcp.test.ts packages/server/test/mcp-controller.test.ts packages/server/test/game-server.test.ts`
Expected: FAIL.
- `commands.test.ts` can't load `../src/commands.ts`.
- `mcp.test.ts` fails on:
  - `dev_repair`, `dev_install`, and `dev_hand` missing from the tool list;
  - the calls to them answering an unknown-tool error;
  - the string result arriving as a JSON string (`"# DA · 데이터센터\n…"` in quotes, with `\n` escaped).
- `mcp-controller.test.ts` fails on the manual check: it gets a quoted JSON string. Its `dev_install` call also fails as an unknown tool.
- `game-server.test.ts` fails on the nine dev tools and the end-to-end deploy.

- [ ] **Step 3: Write the shared command shapes**

`packages/core/src/commands.ts`:

```ts
import { z } from 'zod';
import type { FacilityAction } from './firmware-host.ts';
import type { InstallPart } from './session.ts';

// The shapes of a firmware source and of the player's commands, checked at the server's doors (MCP and the viewer's socket) before
// the game sees them. These check what a command is; the game checks what it means (an unknown facility, a truck already out).

/**
 * A firmware source: up to 64 KB, counted in characters (UTF-16 units). A board's Lua state takes the source as a C string, which ends
 * at the first NUL byte: the code after it would vanish without an error, and a syntax error behind it would pass the check.
 */
export const FIRMWARE_SOURCE = z
  .string()
  .max(65_536)
  .refine(
    (source) => !source.includes('\u0000'),
    'the source contains a NUL byte (\\u0000); the board would cut the code off there, so remove it',
  );

/** A facility's id as a command names it: bounded, so that no message carries a huge one. The game refuses an id it does not know. */
const facilityId = z.string().min(1).max(32);

/** A facility action for the player's hand: exactly the shapes of FacilityAction, with bounded numbers. */
export const FACILITY_ACTION: z.ZodType<FacilityAction> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('process') }),
  z.strictObject({ kind: z.literal('cool') }),
  z.strictObject({ kind: z.literal('setThermal'), output: z.number().int().min(0).max(1_000_000) }),
  z.strictObject({ kind: z.literal('setPriority'), order: z.array(facilityId).max(64) }),
  z.strictObject({ kind: z.literal('harvest') }),
  z.strictObject({
    kind: z.literal('dispatch'),
    truck: z.number().int().min(1).max(64),
    from: facilityId,
    to: facilityId,
    amount: z.number().int().min(1).max(1_000_000),
  }),
]);

/** What the player installs in a facility: a board (T1) or a comm module (T2). */
export const INSTALL_PART: z.ZodType<InstallPart> = z.enum(['board', 'comm']);
```

Add `export * from './commands.ts';` to `packages/core/src/index.ts`, in alphabetical place after `./boards.ts`.

In `packages/core/src/agent-tools.ts`, `deploy_firmware`'s source schema becomes the shared one. Replace the definition of `code` (the `z.string().max(65_536).refine(…).describe(…)` chain, with the comment above it about the NUL byte) with:

```ts
const code = FIRMWARE_SOURCE.describe('The Lua source, up to 64 KB.');
```

and add `import { FIRMWARE_SOURCE } from './commands.ts';` to its imports.

- [ ] **Step 4: Give the dev tools the player's hand, and hand strings over as text**

In `packages/server/src/mcp.ts`:

1. Imports from core:

```ts
import {
  AGENT_INSTRUCTIONS,
  AGENT_TOOLS,
  type AgentStatus,
  ALERT_KINDS,
  type AlertKind,
  type CommandResult,
  FACILITY_ACTION,
  type FacilityAction,
  type GameApi,
  INSTALL_PART,
  type InstallPart,
} from '@turing-city/core';
```

2. `DevTools`:

```ts
/** Time control and the player's hand for QA agents. Never part of the game: it exists only with the server's --dev flag. */
export interface DevTools {
  play(): void;
  pause(): void;
  setSpeed(speed: 1 | 2 | 3): void;
  runUntil(goal: { seconds?: number; alertKinds?: readonly AlertKind[] }): Promise<void>;
  newSeason(seed: number): Promise<void>;
  rebuild(board: string): Promise<CommandResult>;
  repair(facility: string): Promise<CommandResult>;
  install(facility: string, part: InstallPart): Promise<CommandResult>;
  hand(facility: string, action: FacilityAction): Promise<CommandResult>;
}
```

3. `text()`:

```ts
/** A tool's result as text: a string as it is (a board's manual is markdown for the agent to read), anything else as JSON. */
function text(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}
```

4. After the `dev_rebuild` registration in `buildServer()`:

```ts
      mcp.registerTool(
        'dev_repair',
        { description: 'DEV: repair a wrecked facility, paid from the town, as the player does from its panel.', inputSchema: { facility: z.string() } },
        async ({ facility }) => run(() => dev.repair(facility)),
      );
      mcp.registerTool(
        'dev_install',
        {
          description:
            'DEV: install a board (T1) or a comm module (T2) in a facility, paid from the town, as the player does from its panel.',
          inputSchema: { facility: z.string(), part: INSTALL_PART },
        },
        async ({ facility, part }) => run(() => dev.install(facility, part)),
      );
      mcp.registerTool(
        'dev_hand',
        {
          description:
            "DEV: do a facility's work by hand, as the player does from its panel: process, cool, setThermal, setPriority, harvest, or dispatch. It applies at the next step.",
          inputSchema: { facility: z.string(), action: FACILITY_ACTION },
        },
        async ({ facility, action }) => run(() => dev.hand(facility, action)),
      );
```

In `packages/server/src/game-server.ts`, the dev tools reach the controller's commands:

```ts
  const dev: DevTools | undefined = options.dev
    ? {
        play: () => controller.play(),
        pause: () => controller.pause(),
        setSpeed: (s) => controller.setSpeed(s),
        runUntil: (goal) => controller.runUntil(goal),
        newSeason: (seed) => controller.startSeason(seed),
        rebuild: (board) => controller.rebuild(board),
        repair: (facility) => controller.repair(facility),
        install: (facility, part) => controller.install(facility, part),
        hand: (facility, action) => controller.hand(facility, action),
      }
    : undefined;
```

In `packages/server/src/main.ts`, the line that announces them names all nine:

```ts
if (dev)
  process.stdout.write(
    'Dev tools are on: agents get dev_play, dev_pause, dev_set_speed, dev_run_until, dev_new_season, dev_rebuild, dev_repair, dev_install, dev_hand.\n',
  );
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm vitest run packages/core/test/commands.test.ts packages/server/test/mcp.test.ts packages/server/test/mcp-controller.test.ts packages/server/test/game-server.test.ts`
Expected: PASS.

- [ ] **Step 6: Check and commit**

Run: `pnpm fix && pnpm check`
Expected: exit 0.

```bash
git add packages/core/src/commands.ts packages/core/src/index.ts packages/core/src/agent-tools.ts packages/core/test/commands.test.ts \
  packages/server/src/mcp.ts packages/server/src/game-server.ts packages/server/src/main.ts \
  packages/server/test/mcp.test.ts packages/server/test/mcp-controller.test.ts packages/server/test/game-server.test.ts
git commit -m "Give QA agents the player's hand, and hand the board's manual over as text

dev_hand, dev_install, and dev_repair do what the player does from a panel,
checked against the shapes of core's new commands module (a firmware source,
a facility action, a part to install), which the viewer's socket will use too.
A tool whose answer is a string, a board's manual, returns it as the text
itself instead of a JSON string. The MCP tests over the real controller show
the agent refused below T2 with the way to open a board, and served once the
board has a comm module."
```

(End the message with the trailer lines the dispatch gives.)

---

### Task 15: The viewer hub: the new commands, hello with the scenario

> **Corrections from assembling the plan (read first).**
> - **Hand actions apply at once (decision D1).** A `hand` command's effect is in the snapshot the worker sends before its reply. Tests that waited a step for it read it at once.


Spec 10-10 §10 and §11, contract §16. The viewer's socket carries the player's new commands to the controller, with exact schemas:
- the editor's deploy, answered to the viewer that sent it with a `deployResult`;
- a hand action;
- an install of a board or a comm module;
- a repair.

A refused command is told, with its code, to the viewer that sent it, as a rebuild is in milestone 1.

Two more changes:
- **Message size.** A firmware source of 64 KB in JSON can take up to 6 bytes a character, so a message may now weigh 512 KiB.
- **The scenario in hello.** `hello` carries the game's scenario, from which the viewer renders the boards' manuals (contract §14). The server's default scenario becomes the whole town, `scenarios/m2-town.json`.

**Files:**
- Modify: `packages/core/src/protocol.ts` (`ServerToViewer`, `ViewerToServer`)
- Modify: `packages/server/src/viewer-hub.ts` (schemas, handlers, payload limit, deploys with `by`)
- Modify: `packages/server/src/game-server.ts` (the default scenario, `hello` with the scenario)
- Test: `packages/server/test/game-server.test.ts`

**Interfaces:**
- Consumes:
  - Task 14: `FIRMWARE_SOURCE`, `FACILITY_ACTION`, `INSTALL_PART`.
  - Task 13: `GameController.deploy(board, code, by)`, `install`, `repair`, `rebuild`, `hand`, and the `deploy` event with `by`.
  - Task 1: `scenarios/m2-town.json`.
  - Task 2: `DeployedBy`, `InstallPart`.
- Produces:
  - `ServerToViewer`: `hello { connect, port, scenario: Scenario }`, `deploy { board, version, time, by }`, `deployResult { board, outcome: DeployOutcome }`.
  - `ViewerToServer`: `deploy { board, code }`, `hand { facility, action: FacilityAction }`, `install { facility, part: InstallPart }`, `repair { facility }`.
  - `/ws` reads messages of up to 512 KiB; a bigger one closes that viewer's connection (1009).
  - The server's default scenario is `scenarios/m2-town.json`.

The viewer's own code needs no change here: it reads `hello`'s `connect` and `port` and ignores the rest. Tasks 17 to 20 use the new messages.

- [ ] **Step 1: Write the failing tests**

In `packages/server/test/game-server.test.ts`:

1. Add `readFileSync` to the `node:fs` import and `parseScenario` to the core import, and under `const M1 = …` add:

```ts
/** The whole town, every facility at T0: the server's own scenario. */
const TOWN = 'scenarios/m2-town.json';
```

2. Add these tests to `describe('game server', …)`:

```ts
  it("tells a viewer the game's scenario in hello, the whole town by default, so that it can render the boards' manuals", async () => {
    const server = await startGameServer({ port: 0, configDir: tempDir('tc-server-'), viewerDist: null });
    stop = server.close;
    const v = await viewer(server.port);
    await until(() => last(v.seen, 'hello') !== undefined);
    expect(last(v.seen, 'hello')!.scenario).toEqual(parseScenario(JSON.parse(readFileSync(TOWN, 'utf8'))));
  });

  it("carries the player's deploys, hand actions, installs, and repairs, and answers the viewer that sent each", async () => {
    const { server } = await start({ scenarioPath: TOWN });
    const v = await viewer(server.port);
    const other = await viewer(server.port);
    await until(() => last(v.seen, 'status') !== undefined && last(other.seen, 'status') !== undefined);
    v.send({ type: 'startSeason' });
    await until(() => last(v.seen, 'status')?.status.state === 'paused');
    const facility = (id: string) => last(v.seen, 'snapshot')!.snapshot.facilities.find((f) => f.id === id)!;

    // A deploy to a facility with no board is refused, with the code the viewer says in Korean.
    v.send({ type: 'deploy', board: 'F1', code: 'function tick() end' });
    await until(() => last(v.seen, 'error') !== undefined);
    expect(last(v.seen, 'error')!.refusal).toEqual({ code: 'noBoard', facility: 'F1' });
    // With a board, the editor's code goes in: a syntax error and an accepted deploy both come back as the editor's answer.
    v.send({ type: 'install', facility: 'F1', part: 'board' });
    await until(() => facility('F1').tier === 1);
    v.send({ type: 'deploy', board: 'F1', code: 'function tick( end' });
    await until(() => last(v.seen, 'deployResult') !== undefined);
    expect(last(v.seen, 'deployResult')).toMatchObject({
      board: 'F1',
      outcome: { ok: false, error: expect.stringMatching(/^firmware:1:/) },
    });
    v.send({ type: 'deploy', board: 'F1', code: 'function tick(io) io.log("hi") end' });
    await until(() => last(v.seen, 'deployResult')?.outcome.ok === true);
    expect(last(v.seen, 'deployResult')).toEqual({
      type: 'deployResult',
      board: 'F1',
      outcome: { ok: true, version: 1, installsAt: "the board's next tick" },
    });
    // The deploy is everyone's news, with who made it.
    await until(() => last(other.seen, 'deploy') !== undefined);
    expect(last(other.seen, 'deploy')).toMatchObject({ board: 'F1', version: 1, by: 'player' });

    // A hand action is taken (a datacenter is worked by hand without a board); one that cannot apply is refused, and so is a repair
    // of a facility that stands.
    v.send({ type: 'hand', facility: 'DA', action: { kind: 'process' } });
    v.send({ type: 'hand', facility: 'F2', action: { kind: 'harvest' } }); // nothing is ripe yet
    await until(() => last(v.seen, 'error')?.refusal?.code === 'cannotAct');
    expect(last(v.seen, 'error')!.refusal).toMatchObject({ code: 'cannotAct', facility: 'F2' });
    v.send({ type: 'repair', facility: 'DA' });
    await until(() => last(v.seen, 'error')?.refusal?.code === 'notWrecked');
    expect(v.seen.filter((m) => m.type === 'error')).toHaveLength(3); // noBoard, cannotAct, notWrecked: the hand on DA was taken
    // The answers went to the viewer that asked, and to no other.
    expect(other.seen.filter((m) => m.type === 'error' || m.type === 'deployResult')).toEqual([]);
  });

  it('refuses commands of the wrong shape, a source over 64 KB among them, before the game sees them', async () => {
    const { server } = await start({ scenarioPath: TOWN });
    const v = await viewer(server.port);
    await until(() => last(v.seen, 'status') !== undefined);
    const malformed = [
      { type: 'hand', facility: 'DA' },
      { type: 'hand', facility: 'DA', action: { kind: 'fly' } },
      { type: 'hand', facility: 'DA', action: { kind: 'process', seconds: 5 } },
      { type: 'hand', facility: 'P', action: { kind: 'setThermal', output: 'max' } },
      { type: 'hand', facility: 'W', action: { kind: 'dispatch', truck: 1, from: 'F1', to: 'W' } },
      { type: 'hand', facility: 'W', action: { kind: 'dispatch', truck: 0, from: 'F1', to: 'W', amount: 10 } },
      { type: 'install', facility: 'F1', part: 'shield' },
      { type: 'install', facility: 'F1' },
      { type: 'repair' },
      { type: 'repair', facility: 'X'.repeat(40) },
      { type: 'deploy', board: 'F1' },
      { type: 'deploy', board: 'F1', code: 7 },
      { type: 'deploy', board: 'F1', code: 'function tick() end\u0000os.exit()' },
      { type: 'deploy', board: 'F1', code: 'x'.repeat(70 * 1024) }, // over 64 KB, though well under what a message may weigh
    ];
    for (const command of malformed) v.ws.send(JSON.stringify(command));
    const errors = () => v.seen.flatMap((m) => (m.type === 'error' ? [m] : []));
    await until(() => errors().length === malformed.length);
    for (const m of errors()) expect(m.refusal?.code, m.message).toBe('badCommand');
    // None reached the controller, and the connection is still open.
    v.send({ type: 'speed', speed: 2 });
    await until(() => last(v.seen, 'status')?.status.speed === 2);
    expect(errors()).toHaveLength(malformed.length);
  });

  it('accepts a 64 KB deploy with Korean text and refuses a larger one', async () => {
    const { server } = await start({ scenarioPath: TOWN });
    const v = await viewer(server.port);
    await until(() => last(v.seen, 'status') !== undefined);
    v.send({ type: 'startSeason' });
    await until(() => last(v.seen, 'status')?.status.state === 'paused');
    v.send({ type: 'install', facility: 'F1', part: 'board' });
    await until(() => last(v.seen, 'snapshot')?.snapshot.facilities.find((f) => f.id === 'F1')?.tier === 1);
    // 65,536 UTF-16 units of firmware, a tick and a Korean comment up to the limit: about 196 KB of UTF-8 in one message, which
    // the milestone-1 socket (64 KiB) would have closed.
    const head = 'function tick(io, mem) end\n-- ';
    const full = head + '가'.repeat(65_536 - head.length);
    v.send({ type: 'deploy', board: 'F1', code: full });
    await until(() => last(v.seen, 'deployResult') !== undefined);
    expect(last(v.seen, 'deployResult')!.outcome).toMatchObject({ ok: true, version: 1 });
    // One unit over the limit is refused by the hub with a reason, and the connection stays open.
    v.send({ type: 'deploy', board: 'F1', code: `${full}가` });
    await until(() => last(v.seen, 'error') !== undefined);
    expect(last(v.seen, 'error')!.refusal?.code).toBe('badCommand');
    v.send({ type: 'speed', speed: 3 });
    await until(() => last(v.seen, 'status')?.status.speed === 3);
  });
```

3. In `'answers what a viewer sends that is not a command with an error, and nothing else happens'`, the commands the game understands are twelve now. Add these to `commands`, after `{ type: 'inspect', board: 'DA' }`:

```ts
      { type: 'deploy', board: 'DA', code: 'function tick() end' },
      { type: 'hand', facility: 'DA', action: { kind: 'process' } },
      { type: 'install', facility: 'DA', part: 'comm' },
      { type: 'repair', facility: 'DA' },
```

Change the comment above it to "…the commands the game understands being these twelve". Then delete the parenthesis "(which would also answer a play with no agent, or a rebuild with no season, with an error)" from the comment further down. A play needs no agent now. The comment reads: "Each is refused by the hub itself, not by the controller, with something to read, and short, whatever the message was."

4. In `'closes the connection of a viewer that sends more than a command can be, and the others go on'`, the limit is 512 KiB:

```ts
    // Under the limit a message is read and answered, however useless it is: a firmware source of 64 KB can take 384 KiB of JSON.
    const reader = await viewer(server.port);
    reader.ws.send('x'.repeat(500 * 1024));
    await until(() => reader.seen.some((m) => m.type === 'error'));
    // Over it the connection is closed (1009, message too big): a little over, and a flood of auto-pause kinds.
    const tooBig = ['x'.repeat(513 * 1024), JSON.stringify({ type: 'autoPause', kinds: Array.from({ length: 1_000_000 }, () => 'fire') })];
```

5. In `"streams the season to every viewer and carries the player's commands"`, the wrecked facility is repaired from the viewer. After the `repairFirst` check that Task 13 wrote, add:

```ts
    // Repairing it is accepted: the game says nothing to the viewer, and the facility is being repaired.
    const told = v.seen.filter((m) => m.type === 'error').length;
    v.send({ type: 'repair', facility: lost });
    await eventually(async () => {
      const boards = JSON.parse(textOf(await call('list_boards', {}))) as Array<{ id: string; condition: string }>;
      return boards.find((b) => b.id === lost)?.condition === 'repairing';
    });
    expect(v.seen.filter((m) => m.type === 'error')).toHaveLength(told);
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run packages/server/test/game-server.test.ts`
Expected: FAIL.
- The `hello` test fails because the scenario is missing (`expected undefined to deeply equal { id: 'm2-town', … }`).
- The new commands are refused as `bad command: type: Invalid input` (the hub knows only eight).
- The 500 KiB message closes its connection (1009) instead of being answered.
- The `hello` and `deploy` assertions also fail to typecheck (`Property 'scenario' does not exist`).

- [ ] **Step 3: Add the viewer's messages**

In `packages/core/src/protocol.ts`, import `type { Scenario } from './scenario.ts'`, and replace `ServerToViewer` and `ViewerToServer` with:

```ts
/** Server to viewer, over the WebSocket. */
export type ServerToViewer =
  /** The connect command, the port, and the game's scenario: the viewer renders the boards' manuals from it. */
  | { readonly type: 'hello'; readonly connect: string; readonly port: number; readonly scenario: Scenario }
  | { readonly type: 'status'; readonly status: ControllerStatus }
  | { readonly type: 'snapshot'; readonly snapshot: Snapshot }
  | { readonly type: 'alerts'; readonly alerts: readonly AlertView[] }
  | { readonly type: 'deploy'; readonly board: string; readonly version: number; readonly time: TimeView; readonly by: DeployedBy }
  /** The answer to this viewer's deploy: accepted, with when it installs, or the syntax error with its line. */
  | { readonly type: 'deployResult'; readonly board: string; readonly outcome: DeployOutcome }
  | { readonly type: 'inspection'; readonly board: string; readonly inspection: BoardInspection | null }
  /** The English message is for agents and logs; the viewer says the refusal in Korean from its code, when it has one. */
  | { readonly type: 'error'; readonly message: string; readonly refusal?: Refusal };

/**
 * Viewer to server: the player's commands. The server's viewer hub accepts exactly these and refuses anything else, so a
 * new command also goes into its schema (viewer-hub.ts).
 */
export type ViewerToServer =
  | { readonly type: 'startSeason' }
  | { readonly type: 'play' }
  | { readonly type: 'pause' }
  | { readonly type: 'speed'; readonly speed: 1 | 2 | 3 }
  | { readonly type: 'deploy'; readonly board: string; readonly code: string }
  | { readonly type: 'hand'; readonly facility: string; readonly action: FacilityAction }
  | { readonly type: 'install'; readonly facility: string; readonly part: InstallPart }
  | { readonly type: 'repair'; readonly facility: string }
  | { readonly type: 'rebuild'; readonly board: string }
  | { readonly type: 'autoPause'; readonly kinds: readonly AlertKind[] }
  | { readonly type: 'reissueToken' }
  | { readonly type: 'inspect'; readonly board: string };
```

- [ ] **Step 4: Carry the commands through the hub**

In `packages/server/src/viewer-hub.ts`:

1. Imports from core:

```ts
import {
  ALERT_KINDS,
  type CommandResult,
  type ControllerEvent,
  FACILITY_ACTION,
  FIRMWARE_SOURCE,
  INSTALL_PART,
  type ServerToViewer,
  ToolError,
  type ViewerToServer,
} from '@turing-city/core';
```

2. `toMessage`'s deploy case says who deployed:

```ts
    case 'deploy':
      return { type: 'deploy', board: event.board, version: event.version, time: event.time, by: event.by };
```

3. The payload limit:

```ts
/**
 * The most a viewer's message may weigh. A command is a few dozen bytes, but the editor's deploy carries a firmware source of up to
 * 65,536 characters, which JSON can spend 6 bytes on each (a control character's \u escape): 384 KiB. A bigger message closes its
 * connection.
 */
const MAX_MESSAGE_BYTES = 512 * 1024;
```

4. The schema:

```ts
/** What a viewer may send: the commands of ViewerToServer, exactly. Nothing else reaches the controller. */
const viewerCommand: z.ZodType<ViewerToServer> = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('startSeason') }),
  z.strictObject({ type: z.literal('play') }),
  z.strictObject({ type: z.literal('pause') }),
  z.strictObject({ type: z.literal('speed'), speed: z.literal([1, 2, 3]) }),
  z.strictObject({ type: z.literal('deploy'), board: boardId, code: FIRMWARE_SOURCE }),
  z.strictObject({ type: z.literal('hand'), facility: boardId, action: FACILITY_ACTION }),
  z.strictObject({ type: z.literal('install'), facility: boardId, part: INSTALL_PART }),
  z.strictObject({ type: z.literal('repair'), facility: boardId }),
  z.strictObject({ type: z.literal('rebuild'), board: boardId }),
  z.strictObject({ type: z.literal('autoPause'), kinds: z.array(z.enum(ALERT_KINDS)).max(ALERT_KINDS.length) }),
  z.strictObject({ type: z.literal('reissueToken') }),
  z.strictObject({ type: z.literal('inspect'), board: boardId }),
]);
```

5. In `createViewerHub`, after `broadcast`, add the helper that tells a refused command to the viewer that sent it:

```ts
  /** A command the game refused is told to the viewer that sent it, with its code; a done one says nothing (the snapshot shows it). */
  const tell = (ws: WebSocket, result: CommandResult): void => {
    if (!result.ok) send(ws, { type: 'error', message: result.reason, refusal: result.refusal });
  };
```

and in `handle`, replace the `rebuild` case with these, keeping the cases around them:

```ts
      case 'deploy': {
        // The editor's deploy: its answer, a syntax error included, goes to the viewer that sent it. A refusal (a facility with no
        // board, no season) is told like any other, by the catch around handle().
        const outcome = await controller.deploy(message.board, message.code, 'player');
        send(ws, { type: 'deployResult', board: message.board, outcome });
        return;
      }
      case 'hand':
        tell(ws, await controller.hand(message.facility, message.action));
        return;
      case 'install':
        tell(ws, await controller.install(message.facility, message.part));
        return;
      case 'repair':
        tell(ws, await controller.repair(message.facility));
        return;
      case 'rebuild':
        tell(ws, await controller.rebuild(message.board));
        return;
```

In `packages/server/src/game-server.ts`, the default scenario is the whole town, and `hello` carries it:

```ts
const DEFAULT_SCENARIO = fileURLToPath(new URL('../../../scenarios/m2-town.json', import.meta.url));
```

```ts
  const hello = (): ServerToViewer => ({ type: 'hello', connect: connectCommand(portConfig()), port, scenario });
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm vitest run packages/server/test/game-server.test.ts`
Expected: PASS.

- [ ] **Step 6: Check and commit**

Run: `pnpm fix && pnpm check`
Expected: exit 0.

`pnpm shots` still drives the milestone-1 screens and agent, and now meets the whole town by default. Task 21 rewrites it, and this task doesn't run it.

```bash
git add packages/core/src/protocol.ts packages/server/src/viewer-hub.ts packages/server/src/game-server.ts \
  packages/server/test/game-server.test.ts
git commit -m "Carry the player's deploys, hand actions, installs, and repairs over the viewer's socket

The hub takes four new commands with exact shapes (core's firmware source,
facility action, and part to install). It answers the editor's deploy to the
viewer that sent it, and tells a refused command, with its code, to that
viewer alone. A message may weigh 512 KiB, enough for a 64 KB source in JSON.
hello carries the game's scenario, and the server plays the whole town by
default."
```

(End the message with the trailer lines the dispatch gives.)

---

### Task 16: Seasons with installs, reference firmware for the town, season checks, `pnpm sim --install`

> **Corrections from assembling the plan (read first).**
> - Task 3 already wrote `standInForThePlayer(session)`, which repairs and then rebuilds, and `runSeason`'s `autoRebuild` uses it. Build on it; don't write a second one.
> - **Tuning (decision D2).** You may tune `farm.*`, `housing.*`, `datacenter.coolingPower`, `emf.rumourThreshold`, `install.*`, and `repair.*` in `scenarios/m2-town.json` so that the careful set completes seeds 1 to 3. Report the numbers before and after. Never change rules.


Spec 10-10 §13, contract §18.
- **Installs.** In the whole town every facility starts without a board, so a headless season installs the boards its firmware is for, and pays for them at step 0, before it deploys.
- **The stand-in.** With `autoRebuild` it stands in for the player in two steps: it repairs every wrecked facility, then rebuilds a board whose facility stands again, each as soon as the money allows.
- **Reference firmware.** Two sets, careless and careful, cover all seven boards: P, DA, DB, W, F1, F2, and F3. The milestone-1 sets go.
- **Season checks** play the town:
  - the careful set completes its season and ends richer than the careless one;
  - a rerun gives the same hash;
  - a recorded session with every kind of input replays on real Lua into the same state.

The careful set is ours to tune; the scenario's tuning is not. Step 7 says what to do when the careful set cannot complete a season with the scenario's numbers.

**Files:**
- Modify: `packages/core/src/season.ts` (installs, the stand-in)
- Modify: `packages/server/src/sim-cli.ts` (`--install`, the whole town by default)
- Create: `scenarios/firmware/m2/careless/{P,DA,DB,W,F1,F2,F3}.lua`, `scenarios/firmware/m2/careful/{P,DA,DB,W,F1,F2,F3}.lua`
- Delete: `scenarios/firmware/m1/` (both sets)
- Modify: `packages/server/scripts/shots.ts` (the careless set it loads), `CLAUDE.md` (`pnpm sim`)
- Test: `packages/core/test/season.test.ts` (new), `packages/server/test/seasons.test.ts` (rewritten), `packages/server/test/game-controller.test.ts` (`'a season through the controller'`)

**Interfaces:**
- Consumes:
  - Task 2: `Session.install`, `findBoard`, and the scenario's `facilities[].board` (`null` for housing);
  - Task 3: `Session.repair`, `Session.rebuild`, `FacilityState.condition`, `BoardStatus`, `Ledger.installs`, `Ledger.repairs`, and `Stats.wrecks`;
  - Task 4: `Session.hand`;
  - Task 12: the firmware API of contract §15 (`io.harvest`, `io.dispatch`, `io.cool()`, the warehouse's `farms`, `housing`, and `trucks`);
  - Task 13: `GameController.install`;
  - Task 1: `m2Scenario`, `m1Scenario`, and `scenarios/m2-town.json`.
- Produces:
  - `SeasonOptions.install?: 'all' | readonly string[]`. These boards are installed and paid for at step 0, before the firmware is deployed. `'all'` means every facility that takes a board. A board the scenario already installed is left as it is.
  - `autoRebuild` repairs wrecked facilities, then rebuilds destroyed boards.
  - `pnpm sim [scenario.json] [--firmware dir] [--install all|ids] [--seed n] [--until day] [--rebuild]`. It plays `scenarios/m2-town.json` by default. Without `--install`, it installs the boards the firmware is for.
  - `scenarios/firmware/m2/careless` and `careful`.

- [ ] **Step 1: Write the failing core tests**

`packages/core/test/season.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MICRO } from '../src/fixed.ts';
import { runSeason } from '../src/season.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario, m2Scenario } from './helpers/scenarios.ts';

describe('runSeason', () => {
  it('installs and pays for the boards it is told to at step 0, before it deploys the firmware onto them', () => {
    const scenario = m2Scenario();
    const host = new FakeHost();
    const firmware = { DA: host.program('da', () => ({})), F1: host.program('f1', () => ({})) };
    const result = runSeason(scenario, 1, host, firmware, { install: ['DA', 'F1'], untilDay: 1 });
    const prices = scenario.tuning.install.boardPrice;
    expect(result.ledger.installs).toBe((prices.datacenter + prices.farm) * MICRO);
    expect(result.stats.deploys).toBe(2); // both installed on their boards' first tick
  });

  it("installs a board in every facility that takes one with 'all'", () => {
    const scenario = m2Scenario();
    const prices = scenario.tuning.install.boardPrice;
    const result = runSeason(scenario, 1, new FakeHost(), {}, { install: 'all', untilDay: 1 });
    expect(result.ledger.installs).toBe((prices.power + 2 * prices.datacenter + prices.warehouse + 3 * prices.farm) * MICRO);
  });

  it('leaves a board the scenario installed as it is, and refuses firmware for a board that is not installed', () => {
    // The milestone-1 test scenario starts with its three boards installed.
    expect(runSeason(m1Scenario(), 1, new FakeHost(), {}, { install: 'all', untilDay: 1 }).ledger.installs).toBe(0);
    const host = new FakeHost();
    expect(() => runSeason(m2Scenario(), 1, host, { DA: host.program('da', () => ({})) }, { untilDay: 1 })).toThrow();
  });

  it('stands in for the player: repairs every wrecked facility, then rebuilds its board, as the money allows', () => {
    // A town raided early and often, with the money to repair it.
    const raided = m1Scenario((json) => {
      json.startMoney = 100_000;
      json.tuning.emf.rumourThreshold = 5_000;
    });
    const alone = runSeason(raided, 1, new FakeHost(), {}, { untilDay: 10 });
    expect(alone.stats.wrecks).toBeGreaterThan(0);
    expect(alone.ledger.repairs).toBe(0);
    expect(alone.ledger.rebuild).toBe(0);
    const helped = runSeason(raided, 1, new FakeHost(), {}, { untilDay: 10, autoRebuild: true });
    expect(helped.ledger.repairs).toBeGreaterThan(0);
    expect(helped.ledger.rebuild).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/core/test/season.test.ts`
Expected: FAIL. `ledger.installs` is 0 where the prices were expected, because `install` is ignored. The firmware for DA is deployed to a facility with no board, which throws in a test that expected an install first. With `autoRebuild`, `ledger.repairs` stays 0: the milestone-1 stand-in only rebuilds, and a rebuild is refused before a repair.

- [ ] **Step 3: Install the boards, and stand in for repairs and rebuilds**

`packages/core/src/season.ts`:

```ts
import type { FirmwareHost } from './firmware-host.ts';
import { idiv, MICRO } from './fixed.ts';
import { stateHash } from './hash.ts';
import type { Scenario } from './scenario.ts';
import { Session } from './session.ts';
import { gameTime, stepsPerDay } from './time.ts';
import { findBoard, type Ledger, type Stats, type WorldState } from './world.ts';

export interface SeasonOptions {
  /** Stop at the end of this day instead of the season's. */
  readonly untilDay?: number;
  /** Stand in for the human: repair each wrecked facility, then rebuild its board, as soon as the money allows. */
  readonly autoRebuild?: boolean;
  /**
   * Boards to install, and pay for, at step 0 before the firmware is deployed: every facility that takes one ('all'), or these ids.
   * Firmware runs only on an installed board. A board the scenario installed already is left as it is.
   */
  readonly install?: 'all' | readonly string[];
}

export interface SeasonResult {
  /** null when the run stopped at untilDay before the season ended. */
  readonly ended: WorldState['ended'];
  readonly day: number;
  /** Whole money units. */
  readonly money: number;
  /** Micro-units. */
  readonly ledger: Ledger;
  readonly stats: Stats;
  readonly hash: string;
}

/** Installs the boards, deploys the firmware at step 0, and runs to the end (or to untilDay). Closes the host. */
export function runSeason(
  scenario: Scenario,
  seed: number,
  host: FirmwareHost,
  firmware: Readonly<Record<string, string>>,
  options: SeasonOptions = {},
): SeasonResult {
  const session = new Session(scenario, seed, host);
  try {
    const install =
      options.install === 'all' ? scenario.facilities.filter((f) => f.board !== null).map((f) => f.id) : (options.install ?? []);
    for (const id of install) {
      if (findBoard(session.world, id)) continue;
      const result = session.install(id, 'board');
      if (!result.ok) throw new Error(`cannot install a board in ${id}: ${result.reason}`);
    }
    for (const boardId of Object.keys(firmware).sort()) session.deploy(boardId, firmware[boardId]!);
    const stop = options.untilDay === undefined ? Number.POSITIVE_INFINITY : options.untilDay * stepsPerDay(scenario.time);
    while (!session.world.ended && session.world.step < stop) {
      if (options.autoRebuild) standIn(session);
      session.step();
    }
    const w = session.world;
    return {
      ended: w.ended,
      day: gameTime(scenario.time, Math.max(0, w.step - 1)).day, // the day of the last step run
      money: idiv(w.money, MICRO),
      ledger: { ...w.ledger },
      stats: { ...w.stats },
      hash: stateHash(w),
    };
  } finally {
    session.close();
  }
}

/**
 * The human of a headless season: repairs every wrecked facility, then rebuilds a smashed board whose facility stands again. The
 * session refuses what the money cannot pay for (or a rebuild before its repair), and a refused command changes nothing and is not
 * recorded, so asking costs nothing.
 */
function standIn(session: Session): void {
  for (const f of session.world.facilities) if (f.condition === 'wrecked') session.repair(f.id);
  for (const b of session.world.boards) if (b.status === 'destroyed') session.rebuild(b.id);
}
```

Run: `pnpm vitest run packages/core/test/season.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the reference firmware**

The numbers in the comments are the scenario's, as the board manual gives them (Task 11):
- a day is 40 seconds;
- thermal fuel costs about 7 per unit per day;
- a crop ripens in 120 seconds and rots 40 seconds after;
- an outbox holds 50 and a harvest yields 24;
- a truck carries 40 and pays 1 for every cell it drives;
- a home of 40 residents eats 40 a day.

The warehouse's id is `W`.

`scenarios/firmware/m2/careless/P.lua`:

```lua
-- Careless: burn a fixed amount of fuel, whatever the town needs.
function tick(io, mem)
  io.set_thermal(200)
end
```

`scenarios/firmware/m2/careless/DA.lua` and `scenarios/firmware/m2/careless/DB.lua` (the same file twice):

```lua
-- Careless: work whenever it isn't too hot. No cooling, no price, no Luddites.
function tick(io, mem)
  if io.temp < 80 then io.process() end
end
```

`scenarios/firmware/m2/careless/F1.lua`, `F2.lua`, and `F3.lua` (the same file three times):

```lua
-- Careless: harvest whenever the crop is ripe, awake all the time.
function tick(io, mem)
  if io.ripeness >= 100 then io.harvest() end
end
```

`scenarios/firmware/m2/careless/W.lua`:

```lua
-- Careless: truck 1 always fetches 40 from F1, and truck 2 always takes 40 to H1, whatever there is.
function tick(io, mem)
  for _, t in ipairs(io.trucks) do
    if t.status == "idle" then
      if t.id == 1 then
        io.dispatch(1, "F1", "W", 40)
      else
        io.dispatch(2, "W", "H1", 40)
      end
    end
  end
end
```

`scenarios/firmware/m2/careful/P.lua`:

```lua
-- Careful: fuel costs fuel_price per unit per day, and a day is 40 seconds. Powering a home with fuel costs more than its people
-- pay in tax, while a datacenter job at a good price pays for its fuel. So the datacenters come first on the grid, and the plant
-- burns fuel only for the load above BASE, which is theirs: the homes and the other boards share the wind. With nothing to burn
-- for it sleeps, silent: the thermal setting and the supply order stay set while it does.
-- BASE: both homes (77 and 92 with their transmission loss) and the boards awake (about 50).
local BASE = 220

function tick(io, mem)
  if not mem.ready then
    io.set_priority({ "DA", "DB", "H1", "H2", "W", "F1", "F2", "F3" })
    mem.ready = true
  end
  local need = (io.demand - BASE + 9) // 10 * 10
  if need < 0 then need = 0 elseif need > 300 then need = 300 end
  if need ~= mem.last then
    io.set_thermal(need)
    mem.last = need
  end
  if need == 0 then io.sleep(10) end
end
```

`scenarios/firmware/m2/careful/DA.lua`:

```lua
-- Careful: a job pays price per second, and its power costs fuel: DA draws 153 units with its transmission loss, about 27 a second
-- at the usual fuel price, so work only at a price above that. A second of work heats the datacenter 2 °C and it cools very slowly
-- by itself, so work in short spells below SAFE and sleep in between: a sleeping board is silent, and a busy datacenter is the
-- loudest thing in town. A cooling cycle burns 400 units of power for a few seconds: only past DANGER (fire starts above 90 °C).
-- Hide from Luddites.
local MIN_PRICE = 32
local SAFE = 75
local DANGER = 86

function tick(io, mem)
  if io.luddite_dist then
    io.sleep(40)
  elseif io.temp >= DANGER then
    io.cool()
  elseif io.temp >= SAFE then
    io.sleep(8)
  elseif io.price >= MIN_PRICE then
    io.process()
  else
    io.sleep(10)
  end
end
```

`scenarios/firmware/m2/careful/DB.lua`:

```lua
-- Careful: as DA, but DB is 16 cells from the plant: it draws 198 units with its transmission loss, about 35 a second in fuel,
-- so it works only at a higher price.
local MIN_PRICE = 42
local SAFE = 75
local DANGER = 86

function tick(io, mem)
  if io.luddite_dist then
    io.sleep(40)
  elseif io.temp >= DANGER then
    io.cool()
  elseif io.temp >= SAFE then
    io.sleep(8)
  elseif io.price >= MIN_PRICE then
    io.process()
  else
    io.sleep(10)
  end
end
```

`scenarios/firmware/m2/careful/F1.lua`, `F2.lua`, and `F3.lua` (the same file three times):

```lua
-- Careful: harvest a ripe crop at once (a crop left ripe for 40 seconds rots), and sleep until the next one is due: a sleeping
-- board is silent and nearly free. A crop ripens in 120 seconds, and ripeness is in percent.
local RIPEN_SECONDS = 120

function tick(io, mem)
  if io.ripeness >= 100 then
    io.harvest()
    return
  end
  local left = (100 - io.ripeness) * RIPEN_SECONDS // 100
  if left > 2 then io.sleep(math.min(40, left - 1)) end
end
```

`scenarios/firmware/m2/careful/W.lua`:

```lua
-- Careful: people who have not eaten pay no tax, so the hungriest block is fed first, while it has less than a day's food left.
-- Food comes in from the fullest outbox before it spills (an outbox holds 50, and a harvest is 24). A truck carries 40 and pays
-- fuel for every cell it drives, so it drives only for a worthwhile load, and never to where another truck is already going.
-- With nothing to send the board sleeps: trucks on the road finish their trips.
local CAP = 40
local MIN_LOAD = 12
local HOME = "W"

function tick(io, mem)
  local idle, busy = {}, {}
  for _, t in ipairs(io.trucks) do
    if t.status == "idle" then
      idle[#idle + 1] = t.id
    elseif t.target then
      busy[t.target] = true
    end
  end
  local sent = false
  if #idle > 0 and io.stock >= MIN_LOAD then
    local home, least = nil, 1e9
    for _, h in ipairs(io.housing) do
      local per = h.food / h.residents
      if not busy[h.id] and h.food < h.residents and per < least then home, least = h, per end
    end
    if home then
      io.dispatch(table.remove(idle, 1), HOME, home.id, math.min(io.stock, CAP))
      sent = true
    end
  end
  if #idle > 0 then
    local farm, most = nil, MIN_LOAD - 1
    for _, f in ipairs(io.farms) do
      if not busy[f.id] and f.outbox > most then farm, most = f, f.outbox end
    end
    if farm then
      io.dispatch(table.remove(idle, 1), farm.id, HOME, math.min(most, CAP))
      sent = true
    end
  end
  if not sent then io.sleep(5) end
end
```

Delete the milestone-1 sets:

```bash
git rm -r scenarios/firmware/m1
```

- [ ] **Step 5: Rewrite the season checks, and the controller's season test**

`packages/server/test/seasons.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { parseScenario, replay, runSeason, type SeasonResult, Session, stateHash, stepsPerDay } from '@turing-city/core';
import { WasmoonHost } from '@turing-city/firmware';
import { describe, expect, it } from 'vitest';
import { loadFirmwareDir } from '../src/firmware-files.ts';

const town = parseScenario(JSON.parse(readFileSync('scenarios/m2-town.json', 'utf8')));
const careless = loadFirmwareDir('scenarios/firmware/m2/careless');
const careful = loadFirmwareDir('scenarios/firmware/m2/careful');
const BOARDS = ['DA', 'DB', 'F1', 'F2', 'F3', 'P', 'W'];

/** A season the way `pnpm sim --rebuild` plays it: the firmware's boards installed at step 0, and repairs and rebuilds as the money allows. */
async function season(firmware: Record<string, string>, seed: number): Promise<SeasonResult> {
  return runSeason(town, seed, await WasmoonHost.create(), firmware, { install: Object.keys(firmware), autoRebuild: true });
}

describe('season checks', () => {
  it('has a firmware for every board of the town, in both sets', () => {
    expect(Object.keys(careless)).toEqual(BOARDS);
    expect(Object.keys(careful)).toEqual(BOARDS);
  });

  it.each([1, 2, 3])(
    'careful firmware completes its season and ends richer than careless firmware (seed %i)',
    async (seed) => {
      const a = await season(careless, seed);
      const b = await season(careful, seed);
      expect(b.ended).toMatchObject({ kind: 'completed' });
      expect(b.money).toBeGreaterThan(a.money);
    },
    120_000,
  );

  it.each([1, 3, 8])(
    'gives the same result when run twice (seed %i)',
    async (seed) => {
      const first = await season(careful, seed);
      const second = await season(careful, seed);
      expect(second.hash).toBe(first.hash);
      expect(second.money).toBe(first.money);
    },
    120_000,
  );

  it('replays a recorded session with installs, hand work, deploys, repairs, and rebuilds into the same state on a fresh Lua runtime', async () => {
    // A town raided often, with the money to repair it: every kind of input turns up within a few days.
    const raw = JSON.parse(readFileSync('scenarios/m2-town.json', 'utf8'));
    raw.startMoney = 100_000;
    raw.tuning.emf.rumourThreshold = 20_000;
    const scenario = parseScenario(raw);
    const seed = 3;
    const day = stepsPerDay(scenario.time);
    const live = new Session(scenario, seed, await WasmoonHost.create());
    // The player installs four boards and gives DA a comm module; DA's firmware is the agent's.
    for (const id of ['P', 'DA', 'W', 'F1']) expect(live.install(id, 'board')).toEqual({ ok: true });
    expect(live.install('DA', 'comm')).toEqual({ ok: true });
    for (const id of ['P', 'DA', 'W', 'F1']) live.deploy(id, careful[id]!, id === 'DA' ? 'agent' : 'player');
    while (live.world.step < 8 * day && !live.world.ended) {
      const step = live.world.step;
      // The player's hands: DB is worked twice a second, F2 and F3 are harvested when ripe (an unripe harvest is refused and not
      // recorded), and the plant's thermal output is set once.
      if (step % 10 === 0) live.hand('DB', { kind: 'process' });
      if (step % 20 === 0) for (const id of ['F2', 'F3']) live.hand(id, { kind: 'harvest' });
      if (step === day) live.hand('P', { kind: 'setThermal', output: 100 });
      // Repairs, then rebuilds, as the money allows.
      for (const f of live.world.facilities) if (f.condition === 'wrecked') live.repair(f.id);
      for (const b of live.world.boards) if (b.status === 'destroyed') live.rebuild(b.id);
      // The agent swaps DA's firmware in mid-season, with the game paused.
      if (step === 4 * day) {
        live.mark('pause');
        live.deploy('DA', careless.DA!, 'agent');
        live.mark('resume');
      }
      live.step();
    }
    const kinds = [...new Set(live.record.inputs.map((i) => i.kind))].sort();
    expect(kinds).toEqual(['deploy', 'hand', 'install', 'pause', 'rebuild', 'repair', 'resume']);
    expect(live.record.inputs.some((i) => i.kind === 'deploy' && i.step === 4 * day)).toBe(true);

    const replayed = replay(scenario, seed, live.record, await WasmoonHost.create(), live.world.step);
    expect(replayed.world.step).toBe(live.world.step);
    expect(replayed.world.ended).toEqual(live.world.ended);
    expect(stateHash(replayed.world)).toBe(stateHash(live.world));
    live.close();
    replayed.close();
  }, 120_000);
});
```

In `packages/server/test/game-controller.test.ts`, replace `describe('a season through the controller', …)` with:

```ts
describe('a season through the controller', () => {
  const town = parseScenario(JSON.parse(readFileSync('scenarios/m2-town.json', 'utf8')));
  const careless = loadFirmwareDir('scenarios/firmware/m2/careless');
  const careful = loadFirmwareDir('scenarios/firmware/m2/careful');

  it.each([
    { name: 'careless', firmware: careless, stepsPerBatch: 200 },
    { name: 'careful', firmware: careful, stepsPerBatch: 7 },
  ])(
    'ends where the headless runner says it does ($name firmware, $stepsPerBatch steps a batch)',
    async ({ firmware, stepsPerBatch }) => {
      const boards = Object.keys(firmware).sort();
      const headless = runSeason(town, 3, await WasmoonHost.create(), firmware, { install: boards });
      const c = makeFor(town, { stepsPerBatch });
      await c.startSeason(3);
      for (const board of boards) expect(await c.install(board, 'board')).toEqual({ ok: true });
      for (const board of boards) await c.deploy(board, firmware[board]!);
      await c.runUntil({});
      expect(c.latestSnapshot()?.ended).toEqual(headless.ended);
      expect(c.latestSnapshot()?.money).toBe(headless.money);
    },
    60_000,
  );
});
```

In `packages/server/scripts/shots.ts`, the raid scene loads the careless set for the three boards of its scenario. Task 21 rewrites the scene; until then the file names no deleted directory:

```ts
  for (const [board, code] of Object.entries(loadFirmwareDir('scenarios/firmware/m2/careless')).filter(([id]) =>
    ['P', 'DA', 'DB'].includes(id),
  ))
    await agent.call('deploy_firmware', { board, code });
```

- [ ] **Step 6: Give `pnpm sim` the installs**

`packages/server/src/sim-cli.ts`:

```ts
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseScenario, runSeason } from '@turing-city/core';
import { WasmoonHost } from '@turing-city/firmware';
import { loadFirmwareDir } from './firmware-files.ts';

const USAGE =
  'usage: pnpm sim [scenario.json] [--firmware <dir of BOARD.lua files>] [--install all|<ids, comma-separated>] [--seed <n>] [--until <day>] [--rebuild]';

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      firmware: { type: 'string' },
      install: { type: 'string' },
      seed: { type: 'string', default: '1' },
      until: { type: 'string' },
      rebuild: { type: 'boolean', default: false },
    },
  });
  const scenario = parseScenario(JSON.parse(readFileSync(positionals[0] ?? 'scenarios/m2-town.json', 'utf8')));
  const firmware = values.firmware === undefined ? {} : loadFirmwareDir(values.firmware);
  // Firmware runs only on an installed board: without --install, the boards the firmware is for are installed.
  const install =
    values.install === undefined
      ? Object.keys(firmware)
      : values.install === 'all'
        ? ('all' as const)
        : values.install.split(',').filter((id) => id !== '');
  const options = { autoRebuild: values.rebuild, install, ...(values.until === undefined ? {} : { untilDay: Number(values.until) }) };
  const result = runSeason(scenario, Number(values.seed), await WasmoonHost.create(), firmware, options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`);
  process.exit(1);
});
```

In `CLAUDE.md` ("Code and checks"), replace the `pnpm sim` line with:

```
  - `pnpm sim [scenario.json] [--firmware dir] [--install all|ids] [--seed n] [--until day] [--rebuild]`: plays a season headless and prints the result as JSON (`money` in whole units, the `ledger` in micro-units). It plays `scenarios/m2-town.json` by default, where every facility starts without a board. Firmware runs only on an installed board: `--install` installs and pays for boards at step 0 (`all`, or ids separated by commas), and without it the boards the firmware is for are installed. `--rebuild` stands in for the player: it repairs every wrecked facility, then rebuilds its board, as soon as the money allows. The reference firmware sets are in `scenarios/firmware/m2/careless` and `careful`.
```

- [ ] **Step 7: Run the seasons, and tune the careful set if it must be**

Run, for seeds 1, 2, and 3:

```bash
pnpm sim --firmware scenarios/firmware/m2/careful --seed 1 --rebuild
pnpm sim --firmware scenarios/firmware/m2/careless --seed 1 --rebuild
```

Expected: careful ends `{ "kind": "completed" }` with more money than careless. Careless burns 200 units of fuel all season and ends bankrupt, or poorer.

If careful does not complete a seed, tune the careful set only:
- its constants (`BASE`, `MIN_PRICE`, `SAFE`, the sleep lengths, `MIN_LOAD`);
- leaving a board idle by making its firmware sleep for 40 seconds every tick.

Don't change the scenario's tuning. Record every run's ending and money in the report.

If no change to the careful set completes seeds 1 to 3, stop and report NEEDS_CONTEXT with the runs. It means the scenario's numbers leave no careful town standing, which is a balance finding for the user, not this task's to fix.

Then run the checks:

Run: `pnpm vitest run packages/server/test/seasons.test.ts packages/server/test/game-controller.test.ts -t "season"`
Expected: PASS.

The replay test needs a seed whose live run has at least one repair and one rebuild. If seed 3 has neither by day 8, take the first seed from 1 to 10 that has both, and say so in the test's comment.

- [ ] **Step 8: Check and commit**

Run: `pnpm fix && pnpm check`
Expected: exit 0.

```bash
git add packages/core/src/season.ts packages/core/test/season.test.ts packages/server/src/sim-cli.ts \
  scenarios/firmware/m2 packages/server/test/seasons.test.ts packages/server/test/game-controller.test.ts \
  packages/server/scripts/shots.ts CLAUDE.md
git commit -m "Play the whole town headless: installs, a stand-in that repairs, and reference firmware for seven boards

runSeason installs and pays for the boards it is told to at step 0, before the
firmware; pnpm sim --install picks them, and installs the firmware's boards by
default. The stand-in repairs every wrecked facility, then rebuilds its board,
as the money allows. Careless and careful sets cover P, DA, DB, W, and the
three farms, and the milestone-1 sets are gone. The season checks play the
town: careful completes and ends richer than careless on seeds 1-3, reruns
match, and a session with installs, hand work, deploys by player and agent,
repairs, and rebuilds replays on real Lua into the same state."
```

Before committing, replace the season claim in this message with the runs Step 7 recorded.

(End the message with the trailer lines the dispatch gives.)

---

### Task 17: Viewer: store, start screen, guide card, top bar, feed, refusals

> **Corrections from assembling the plan (read first).**
> - **A season counter (decision D3, Task 13).** When `status.season` changes, the store resets the feed, the editor drafts, and the dispatch draft, and shows the guide again unless it was dismissed. Use the counter in place of detecting a step that went back, or alongside it.


The viewer's state and its first screens for the early stage (10-10 spec §10.1 to §10.3):
- **The store** keeps what milestone 2 adds (contract §17): the scenario from `hello`, the guide card, the manual and editor windows, the editor's last deploy result, the editor drafts, and the truck form's draft.
- **The start screen** no longer needs an agent. "시즌 시작" is enabled whenever the server is reachable, and the agent's section is optional.
- **The guide card** shows when a season starts, until the player ticks "다시 보지 않기" (kept in localStorage, read and written inside try/catch).
- **The top bar** adds food, population, [매뉴얼], and [도움말].
- **The feed** says who deployed (the player or the agent). Its auto-pause toggles cover every alert kind but the season's end, `agentLost` included, in place of milestone 1's fixed "연결 끊김 (항상)".
- **Every refusal code** of contract §6 has its Korean text.
- **The end overlay** knows two endings, completed and bankrupt. Its "새 시즌" is always enabled.

**The interim map and panel.** Tasks 11 to 16 reshaped the snapshot (contract §13: `facilities` in place of `boards`) and the protocol (contract §16). This task replaces every viewer file that reads them with a complete version written against the contract, so the viewer compiles whatever minimal adjustments earlier tasks made.
- **The map and the panel get interim versions here.** They are milestone 1's drawing and panel, adapted to facilities. Task 18 replaces the map, and Task 19 the panel.
- **The interim panel offers no repair, rebuild, install, or hand controls.** Task 19 brings them.

**Files:**
- Modify (whole file): `packages/viewer/src/store.ts`, `packages/viewer/src/refusals.ts`, `packages/viewer/src/format.ts`, `packages/viewer/src/ui/start-screen.ts`, `packages/viewer/src/ui/top-bar.ts`, `packages/viewer/src/ui/feed.ts`, `packages/viewer/src/ui/overlay.ts`, `packages/viewer/src/ui/panel.ts` (interim), `packages/viewer/src/map/map-scene.ts` (interim), `packages/viewer/src/keys.ts`, `packages/viewer/src/main.ts`, `packages/viewer/index.html`
- Create: `packages/viewer/src/ui/guide.ts`
- Modify: `packages/viewer/src/style.css` (append the guide card's and the top bar's new rules)
- Test (whole file): `packages/viewer/test/store.test.ts`, `packages/viewer/test/refusals.test.ts`, `packages/viewer/test/format.test.ts`

**Interfaces:**
- **Consumes** (all from `@turing-city/core`):
  - Task 10's `Snapshot`, `FacilityView`, `BoardInspection`, `TimeView`, and `AlertView` (contract §13);
  - Tasks 13 and 15's `ControllerStatus` (no `blockedByAgent`), `ServerToViewer` (`hello` with `scenario`, `deploy` with `by`, `deployResult`), and `ViewerToServer` (contract §16);
  - Task 1's `Scenario`, `FacilityKind`, and `BoardKind`;
  - Task 2's `FacilityCondition`;
  - Task 3's `EndKind` (`completed` or `bankrupt`);
  - Task 4's `FacilityAction`;
  - `ALERT_KINDS`, `AlertKind`, `DeployedBy`, `DeployOutcome`, `SensorValue`, `Refusal` (contract §2, §3, §5, §6).
- **Produces:**
  - **`store.ts`:**
    - `Store`, with milestone 1's fields plus `scenario: Scenario | null`, `guideOpen: boolean`, `manualFor: string | 'index' | null`, `editorFor: string | null`, `deployResult: { board; outcome } | null`, `editorDrafts: Record<string, string>`, and `dispatchDraft: DispatchDraft`;
    - methods `openGuide()`, `closeGuide(dontShowAgain)`, `openManual(target)`, `closeManual()`, `openEditor(board)`, `closeEditor(text?)`, and `setDispatchDraft(patch)`;
    - the constructor `new Store(storage?: KeyValue | null)`;
    - exports `KeyValue`, `browserStorage()`, `GUIDE_DISMISSED_KEY`, `ERROR_SHOWN_MS`, `FeedItem` (deploys carry `by`), `DispatchTrip`, and `DispatchDraft`.
  - **`format.ts`:**
    - money and time: `moneyLabel`, `timeLabel`;
    - the light: `Led`, `ledOf(facility: FacilityView): Led | null` (null without a board), `LED_COLORS`, `LED_LABELS`;
    - labels: `KIND_LABELS` (five kinds), `TIER_LABELS`, `CONDITION_LABELS`, `firmwareLabel`, `ALERT_LABELS` (every kind), `endingLabel`, `populationLabel(population)`, `sensorLabel(value)`;
    - the map's helpers: `heatAlpha`, `consumersOf(snapshot, selectedId)` (facilities that draw or are shed).
  - **`ui/guide.ts`:** `renderGuide(root, store)`.
  - **`keys.ts`:** `bindKeys(store, net)`. Escape closes the guide card first.

- [ ] **Step 1: Write the failing tests**

`packages/viewer/test/store.test.ts` (whole file):

```ts
import type { ControllerStatus, Scenario, ServerToViewer, Snapshot } from '@turing-city/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_SHOWN_MS, GUIDE_DISMISSED_KEY, type KeyValue, Store } from '../src/store.ts';

/** A storage in memory, the way localStorage behaves. */
function memoryStorage(initial: Record<string, string> = {}): KeyValue & { readonly data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

/** A storage that refuses every call, as a blocked or private one can. */
const throwingStorage: KeyValue = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

const status = (state: ControllerStatus['state']): ServerToViewer => ({
  type: 'status',
  status: { state, speed: 1, agent: { connected: false, clientName: null }, crash: null, autoPause: [], scenarioName: 'm2' },
});

/** A snapshot at a step: the store reads only its step here. */
const snapshotAt = (step: number): ServerToViewer => ({ type: 'snapshot', snapshot: { step } as unknown as Snapshot });

describe('Store: a command the server refused', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is told for a few seconds and then goes away by itself, drawing the screen again', () => {
    const store = new Store(null);
    let draws = 0;
    store.subscribe(() => {
      draws += 1;
    });
    store.apply({ type: 'error', message: 'DA is not destroyed', refusal: { code: 'notDestroyed', board: 'DA' } });
    expect(store.error).toBe("'DA' 보드는 부서진 상태가 아니라서 재건할 수 없어요.");
    expect(draws).toBe(1);

    vi.advanceTimersByTime(ERROR_SHOWN_MS - 1);
    expect(store.error).toBe("'DA' 보드는 부서진 상태가 아니라서 재건할 수 없어요.");
    vi.advanceTimersByTime(1);
    expect(store.error).toBeNull();
    expect(draws).toBe(2); // the screen is told it is gone
  });

  it('starts the time over when another refusal comes, so the newer one is not cut short by the older one', () => {
    const store = new Store(null);
    store.apply({ type: 'error', message: 'first' });
    vi.advanceTimersByTime(ERROR_SHOWN_MS - 1000);
    store.apply({ type: 'error', message: 'second' });
    vi.advanceTimersByTime(ERROR_SHOWN_MS - 1000); // the first one's time is up, the second one's is not
    expect(store.error).toContain('second');
    vi.advanceTimersByTime(1000);
    expect(store.error).toBeNull();
  });

  it("shows a refusal in Korean: by its code when it has one, and in a Korean sentence that carries the server's text when it has none", () => {
    const store = new Store(null);
    store.apply({ type: 'error', message: 'not enough money', refusal: { code: 'tooPoor' } });
    expect(store.error).toBe('자금이 모자라요.');
    store.apply({ type: 'error', message: 'a new season started' });
    expect(store.error).toBe('서버가 명령을 받아들이지 않았어요: a new season started');
  });

  it('goes away at once when a season is up and running, as before', () => {
    const store = new Store(null);
    store.apply({ type: 'error', message: 'not enough money', refusal: { code: 'tooPoor' } });
    store.apply(status('paused'));
    expect(store.error).toBeNull();
  });
});

describe('Store: what the server says', () => {
  it('keeps the scenario that hello carries, for the manual and the truck form', () => {
    const store = new Store(null);
    const scenario = { id: 'm2-town', name: '작은 마을' } as unknown as Scenario;
    store.apply({ type: 'hello', connect: 'claude mcp add …', port: 7840, scenario });
    expect(store.hello).toEqual({ connect: 'claude mcp add …', port: 7840 });
    expect(store.scenario).toBe(scenario);
  });

  it('says in the feed who deployed: the player from the editor, or the agent over MCP', () => {
    const store = new Store(null);
    const time = { day: 1, clock: '00:00', seconds: 0 };
    store.apply({ type: 'deploy', board: 'DA', version: 1, time, by: 'player' });
    store.apply({ type: 'deploy', board: 'DA', version: 2, time, by: 'agent' });
    expect(store.feed.map((item) => (item.kind === 'deploy' ? `${item.by} v${item.version}` : ''))).toEqual(['agent v2', 'player v1']);
  });

  it("keeps the editor's last deploy result, and forgets the board's draft once the server took a deploy", () => {
    const store = new Store(null);
    store.openEditor('DA');
    store.closeEditor('function tick(io) io.process( end');
    expect(store.editorDrafts.DA).toBe('function tick(io) io.process( end');
    store.apply({ type: 'deployResult', board: 'DA', outcome: { ok: false, error: "firmware:1: ')' expected near 'end'" } });
    expect(store.deployResult?.outcome.ok).toBe(false);
    expect(store.editorDrafts.DA).toBe('function tick(io) io.process( end'); // a refused deploy keeps the draft
    store.apply({ type: 'deployResult', board: 'DA', outcome: { ok: true, version: 3, installsAt: "the board's next tick" } });
    expect(store.editorDrafts.DA).toBeUndefined();
  });
});

describe('Store: the guide card', () => {
  it('opens when a season starts, and not for a page that joins a season in the middle', () => {
    const joining = new Store(memoryStorage());
    joining.apply(snapshotAt(1234));
    expect(joining.guideOpen).toBe(false);

    const starting = new Store(memoryStorage());
    starting.apply(snapshotAt(0));
    expect(starting.guideOpen).toBe(true);
  });

  it('opens again at the next season, until the player says not to show it again, and that is remembered', () => {
    const storage = memoryStorage();
    const store = new Store(storage);
    store.apply(snapshotAt(0));
    store.closeGuide(false);
    expect(store.guideOpen).toBe(false);
    store.apply(snapshotAt(900));
    store.apply(snapshotAt(0)); // a new season
    expect(store.guideOpen).toBe(true);
    store.closeGuide(true);
    expect(storage.data[GUIDE_DISMISSED_KEY]).toBe('1');
    store.apply(snapshotAt(900));
    store.apply(snapshotAt(0));
    expect(store.guideOpen).toBe(false);
    // Another page of the same browser reads it too.
    const later = new Store(storage);
    later.apply(snapshotAt(0));
    expect(later.guideOpen).toBe(false);
  });

  it('still opens from the help button after the player dismissed it', () => {
    const store = new Store(memoryStorage({ [GUIDE_DISMISSED_KEY]: '1' }));
    store.apply(snapshotAt(0));
    expect(store.guideOpen).toBe(false);
    store.openGuide();
    expect(store.guideOpen).toBe(true);
  });

  it('works with a storage that refuses every call: the card shows, and closing it does not throw', () => {
    const store = new Store(throwingStorage);
    store.apply(snapshotAt(0));
    expect(store.guideOpen).toBe(true);
    expect(() => store.closeGuide(true)).not.toThrow();
    expect(store.guideOpen).toBe(false);
  });
});

describe('Store: windows and drafts', () => {
  it('closes the editor and forgets its drafts when a new season starts: its boards are not the old ones', () => {
    const store = new Store(null);
    store.apply(snapshotAt(500));
    store.openEditor('DA');
    store.closeEditor('-- unsaved');
    store.openEditor('DB');
    store.setDispatchDraft({ truck: 1 });
    store.apply(snapshotAt(0));
    expect(store.editorFor).toBeNull();
    expect(store.editorDrafts).toEqual({});
    expect(store.deployResult).toBeNull();
    expect(store.dispatchDraft).toEqual({ truck: null, trip: null, amount: null });
  });

  it("starts the truck form over when another facility is selected, and keeps it when the same one is", () => {
    const store = new Store(null);
    store.select('W');
    store.setDispatchDraft({ truck: 2, amount: 20 });
    store.select('W');
    expect(store.dispatchDraft).toEqual({ truck: 2, trip: null, amount: 20 });
    store.select('F1');
    expect(store.dispatchDraft).toEqual({ truck: null, trip: null, amount: null });
  });

  it('opens the manual on a board or on the index, and closes it', () => {
    const store = new Store(null);
    store.openManual('DA');
    expect(store.manualFor).toBe('DA');
    store.openManual('index');
    expect(store.manualFor).toBe('index');
    store.closeManual();
    expect(store.manualFor).toBeNull();
  });
});
```

`packages/viewer/test/refusals.test.ts` (whole file):

```ts
import type { Refusal } from '@turing-city/core';
import { describe, expect, it } from 'vitest';
import { refusalText } from '../src/refusals.ts';

/** One refusal of every code. A Record, so that a code that core gets is a type error here until it is listed. */
const SAMPLES: Record<Refusal['code'], Refusal> = {
  noAgent: { code: 'noAgent' },
  noSeason: { code: 'noSeason' },
  crashed: { code: 'crashed', reason: 'the simulator stopped responding; the session stopped' },
  seasonEnded: { code: 'seasonEnded' },
  unknownBoard: { code: 'unknownBoard', board: 'ZZ' },
  notDestroyed: { code: 'notDestroyed', board: 'DA' },
  tooPoor: { code: 'tooPoor' },
  badCommand: { code: 'badCommand', detail: 'speed: Invalid input' },
  unknownFacility: { code: 'unknownFacility', facility: 'QQ' },
  noBoard: { code: 'noBoard', facility: 'F1' },
  takesNoBoard: { code: 'takesNoBoard', facility: 'H1' },
  alreadyInstalled: { code: 'alreadyInstalled', facility: 'DA', part: 'comm' },
  boardDown: { code: 'boardDown', facility: 'DB' },
  wrecked: { code: 'wrecked', facility: 'W' },
  notWrecked: { code: 'notWrecked', facility: 'P' },
  repairFirst: { code: 'repairFirst', facility: 'DA' },
  noComm: { code: 'noComm', board: 'F2' },
  cannotAct: { code: 'cannotAct', facility: 'F3', detail: 'nothing is ripe' },
};

const hangul = /[가-힣]/;

describe('refusalText', () => {
  it.each(Object.entries(SAMPLES))('says the %s refusal in Korean, with no sentence of the server in it', (_code, refusal) => {
    const text = refusalText('the server says this in English, for agents and logs', refusal);
    expect(text).toMatch(hangul);
    expect(text).not.toContain('the server says this');
    expect(text.trim()).not.toBe('');
  });

  it('names the facility, the board, the reason, or what was wrong, where the refusal has one', () => {
    expect(refusalText('x', SAMPLES.unknownBoard)).toContain('ZZ');
    expect(refusalText('x', SAMPLES.notDestroyed)).toContain('DA');
    expect(refusalText('x', SAMPLES.crashed)).toContain('the simulator stopped responding; the session stopped');
    expect(refusalText('x', SAMPLES.badCommand)).toContain('speed: Invalid input');
    expect(refusalText('x', SAMPLES.unknownFacility)).toContain('QQ');
    expect(refusalText('x', SAMPLES.noBoard)).toContain('F1');
    expect(refusalText('x', SAMPLES.takesNoBoard)).toContain('H1');
    expect(refusalText('x', SAMPLES.boardDown)).toContain('DB');
    expect(refusalText('x', SAMPLES.wrecked)).toContain('W');
    expect(refusalText('x', SAMPLES.notWrecked)).toContain('P');
    expect(refusalText('x', SAMPLES.repairFirst)).toContain('DA');
    expect(refusalText('x', SAMPLES.noComm)).toContain('F2');
    expect(refusalText('x', SAMPLES.cannotAct)).toContain('nothing is ripe');
  });

  it('tells a second board from a second comm module', () => {
    expect(refusalText('x', { code: 'alreadyInstalled', facility: 'DA', part: 'board' })).toBe("'DA'에는 이미 보드가 있어요.");
    expect(refusalText('x', { code: 'alreadyInstalled', facility: 'DA', part: 'comm' })).toBe("'DA' 보드에는 이미 통신 모듈이 있어요.");
  });

  it('says what the refusals the player meets most say: too little money, a wrecked facility, the season over, a bad message', () => {
    expect(refusalText('x', SAMPLES.tooPoor)).toBe('자금이 모자라요.');
    expect(refusalText('x', SAMPLES.wrecked)).toBe("'W' 시설이 부서졌거나 복구 중이에요. 복구가 끝난 뒤에 해보세요.");
    expect(refusalText('x', SAMPLES.repairFirst)).toBe("'DA' 시설을 먼저 복구해야 보드를 재건할 수 있어요.");
    expect(refusalText('x', SAMPLES.seasonEnded)).toBe('시즌이 이미 끝나서 할 수 없어요.');
    expect(refusalText('x', SAMPLES.badCommand)).toBe('서버가 알아듣지 못하는 명령이에요 (speed: Invalid input).');
  });

  it('falls back to a Korean sentence that carries the original text, for a refusal with no code or one it does not know', () => {
    const original = 'a new season started';
    expect(refusalText(original, undefined)).toBe(`서버가 명령을 받아들이지 않았어요: ${original}`);
    // A code that a newer server sends and this viewer has no text for.
    const newer = { code: 'somethingNew' } as unknown as Refusal;
    expect(refusalText(original, newer)).toBe(`서버가 명령을 받아들이지 않았어요: ${original}`);
  });
});
```

`packages/viewer/test/format.test.ts` (whole file):

```ts
import type { FacilityView, Snapshot } from '@turing-city/core';
import { describe, expect, it } from 'vitest';
import {
  ALERT_LABELS,
  consumersOf,
  endingLabel,
  firmwareLabel,
  heatAlpha,
  KIND_LABELS,
  ledOf,
  moneyLabel,
  populationLabel,
  sensorLabel,
  timeLabel,
} from '../src/format.ts';

const facility = (over: Partial<FacilityView>): FacilityView => ({
  id: 'DA',
  kind: 'datacenter',
  x: 5,
  y: 4,
  tier: 1,
  condition: 'ok',
  repairHoursLeft: null,
  powered: true,
  demand: 10,
  board: { status: 'running', powered: true, hasFirmware: true, erroring: false },
  datacenter: { tempC: 40, processing: false, cooling: false },
  farm: null,
  warehouse: null,
  housing: null,
  ...over,
});
const board = (over: Partial<NonNullable<FacilityView['board']>>): FacilityView['board'] => ({
  status: 'running',
  powered: true,
  hasFirmware: true,
  erroring: false,
  ...over,
});

describe('format', () => {
  it('labels money and time', () => {
    expect(moneyLabel(12400)).toBe('12,400');
    expect(moneyLabel(-30)).toBe('-30');
    expect(timeLabel({ day: 7, clock: '14:20', seconds: 0 }, 30)).toBe('7일차 14:20 / 30일');
  });

  it('gives a light only to a facility with a board', () => {
    expect(ledOf(facility({ board: null, tier: 0 }))).toBeNull();
    expect(ledOf(facility({ kind: 'housing', board: null, tier: 0 }))).toBeNull();
  });

  it('picks a status light: destroyed, asleep, unpowered, error, no firmware, running', () => {
    expect(ledOf(facility({ board: board({ status: 'destroyed' }) }))).toBe('destroyed');
    expect(ledOf(facility({ board: board({ status: 'rebuilding' }) }))).toBe('destroyed');
    expect(ledOf(facility({ board: board({ status: 'asleep' }) }))).toBe('asleep');
    expect(ledOf(facility({ board: board({ powered: false }) }))).toBe('unpowered');
    expect(ledOf(facility({ board: board({ erroring: true }) }))).toBe('error');
    expect(ledOf(facility({ board: board({ hasFirmware: false }) }))).toBe('off');
    expect(ledOf(facility({}))).toBe('running');
  });

  it('shows a board as down with its wrecked or repairing facility, whatever its own state says', () => {
    expect(ledOf(facility({ condition: 'wrecked' }))).toBe('destroyed');
    expect(ledOf(facility({ condition: 'repairing', board: board({ status: 'destroyed' }) }))).toBe('destroyed');
  });

  // A board's last tick keeps its error after the board is smashed, put to sleep, or shed, so the states really do overlap.
  it('keeps that order when states overlap: each light wins over the ones after it', () => {
    const everythingWrong = { powered: false, erroring: true, hasFirmware: false };
    expect(ledOf(facility({ board: board({ ...everythingWrong, status: 'destroyed' }) }))).toBe('destroyed');
    expect(ledOf(facility({ board: board({ ...everythingWrong, status: 'asleep' }) }))).toBe('asleep');
    expect(ledOf(facility({ board: board(everythingWrong) }))).toBe('unpowered');
    expect(ledOf(facility({ board: board({ erroring: true, hasFirmware: false }) }))).toBe('error');
  });

  it('names the firmware a board runs and the deploy waiting to install on it', () => {
    expect(firmwareLabel(null, null)).toBe('펌웨어 없음');
    expect(firmwareLabel(2, null)).toBe('펌웨어 v2');
    expect(firmwareLabel(null, 1)).toBe('설치 대기 v1');
    expect(firmwareLabel(2, 3)).toBe('펌웨어 v2 · 설치 대기 v3');
  });

  it('shades the heatmap from 1 EMF up, capped', () => {
    expect(heatAlpha(0)).toBe(0);
    expect(heatAlpha(1)).toBeCloseTo(1 / 166, 5);
    expect(heatAlpha(50)).toBeCloseTo(0.3);
    expect(heatAlpha(10_000)).toBe(0.6);
  });

  it("lists the plant's consumers that draw power or are cut off, with draw, priority, and shedding, only when the plant is selected", () => {
    const snapshot = {
      facilities: [
        facility({ id: 'P', kind: 'power' }),
        facility({ id: 'H1', kind: 'housing', board: null, tier: 0, demand: 72 }),
        facility({ id: 'DA', demand: 163 }),
        facility({ id: 'F1', kind: 'farm', board: null, tier: 0, demand: 0 }), // draws nothing: not drawn
        facility({ id: 'DB', demand: 0 }), // cut off: drawn, though it asks for nothing now
      ],
      plant: { priority: ['H1', 'DA', 'F1', 'DB'], shed: ['DB'] },
    } as unknown as Snapshot;
    expect(consumersOf(snapshot, 'P')).toEqual([
      { id: 'H1', demand: 72, rank: 1, shed: false },
      { id: 'DA', demand: 163, rank: 2, shed: false },
      { id: 'DB', demand: 0, rank: 4, shed: true },
    ]);
    expect(consumersOf(snapshot, 'DA')).toBeNull();
    expect(consumersOf(snapshot, null)).toBeNull();
  });

  it('has a Korean name for every facility kind and every alert kind, and two endings', () => {
    expect(Object.values(KIND_LABELS)).toEqual(['발전소', '데이터센터', '밭', '물류창고', '주거지']);
    expect(ALERT_LABELS.wrecked).toBe('시설 파괴');
    expect(ALERT_LABELS.agentLost).toBe('에이전트 끊김');
    expect(ALERT_LABELS.hunger).toBe('굶주림');
    expect(endingLabel('completed')).toBe('시즌 완주');
    expect(endingLabel('bankrupt')).toBe('파산');
  });

  it('says how many people are fed, out of all, and names the hungry and those without power only when there are some', () => {
    expect(populationLabel({ fed: 80, hungry: 0, unpowered: 0 })).toBe('80/80');
    expect(populationLabel({ fed: 40, hungry: 40, unpowered: 0 })).toBe('40/80 · 굶주림 40');
    expect(populationLabel({ fed: 0, hungry: 40, unpowered: 40 })).toBe('0/80 · 굶주림 40 · 정전 40');
  });

  it('shows a sensor value: numbers rounded, nil for none, strings as they are, lists one item a line', () => {
    expect(sensorLabel(81.256)).toBe('81.26');
    expect(sensorLabel(undefined)).toBe('nil');
    expect(sensorLabel('idle')).toBe('idle');
    expect(
      sensorLabel([
        { id: 'F1', outbox: 12, distance: 12 },
        { id: 'F2', outbox: 0, distance: 11 },
      ]),
    ).toBe('id=F1 outbox=12 distance=12\nid=F2 outbox=0 distance=11');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/viewer`
Expected: FAIL. Among the failures:
- `GUIDE_DISMISSED_KEY` is undefined, and `store.guideOpen` is `undefined` where `true` is expected;
- `refusalText` returns the fallback, which carries the server's English, for `unknownFacility` and the other new codes;
- `populationLabel` and `sensorLabel` are not functions;
- `ledOf` returns `'running'` for a facility with no board, where `null` is expected.

- [ ] **Step 3: Write the store**

`packages/viewer/src/store.ts` (whole file):

```ts
import type {
  AlertView,
  BoardInspection,
  ControllerStatus,
  DeployedBy,
  DeployOutcome,
  Scenario,
  ServerToViewer,
  Snapshot,
  TimeView,
} from '@turing-city/core';
import { refusalText } from './refusals.ts';

export type FeedItem =
  | { readonly kind: 'alert'; readonly alert: AlertView }
  | { readonly kind: 'deploy'; readonly board: string; readonly version: number; readonly time: TimeView; readonly by: DeployedBy };

const FEED_LIMIT = 50;

/** How long the screen tells the player that the server refused a command. */
export const ERROR_SHOWN_MS = 5000;

/** Where the guide card's "다시 보지 않기" is kept. A per-browser convenience: a lost or blocked storage only shows the card again. */
export const GUIDE_DISMISSED_KEY = 'turing-city:guide-dismissed';

/** The part of localStorage the store uses; tests pass their own. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The page's localStorage, or null where there is none or it cannot be reached (Node, a blocked or private storage). */
export function browserStorage(): KeyValue | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** A trip the truck form can send: collect from a farm's outbox, or deliver to a housing block. */
export interface DispatchTrip {
  readonly kind: 'collect' | 'deliver';
  readonly target: string;
}

/** What the warehouse's truck form has picked so far. */
export interface DispatchDraft {
  readonly truck: number | null;
  readonly trip: DispatchTrip | null;
  readonly amount: number | null;
}

const NO_DRAFT: DispatchDraft = { truck: null, trip: null, amount: null };

/** What the screens read; every change notifies the subscribers. */
export class Store {
  hello: { connect: string; port: number } | null = null;
  /** The scenario the server plays, from hello: the manual and the truck form read their numbers from it. */
  scenario: Scenario | null = null;
  status: ControllerStatus | null = null;
  snapshot: Snapshot | null = null;
  feed: FeedItem[] = [];
  inspection: { board: string; inspection: BoardInspection | null } | null = null;
  error: string | null = null;
  socketOpen = false;
  selected: string | null = null;
  heatmap = false;
  guideOpen = false;
  /** What the manual window shows: a board slot's id, the index, or nothing (closed). */
  manualFor: string | 'index' | null = null;
  /** The board whose firmware the editor window edits, or null (closed). */
  editorFor: string | null = null;
  /** The server's answer to the editor's last deploy. */
  deployResult: { board: string; outcome: DeployOutcome } | null = null;
  /** The text an editor held when it was closed without a deploy, by board: reopening it brings the text back. */
  editorDrafts: Record<string, string> = {};
  dispatchDraft: DispatchDraft = NO_DRAFT;
  private readonly storage: KeyValue | null;
  private readonly listeners = new Set<() => void>();
  private errorTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(storage: KeyValue | null = browserStorage()) {
    this.storage = storage;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  apply(message: ServerToViewer): void {
    switch (message.type) {
      case 'hello':
        this.hello = { connect: message.connect, port: message.port };
        this.scenario = message.scenario;
        break;
      case 'status':
        this.status = message.status;
        if (message.status.state === 'paused' || message.status.state === 'running') this.error = null;
        break;
      case 'snapshot': {
        const previous = this.snapshot;
        if (previous && message.snapshot.step < previous.step) this.feed = []; // a new season
        this.snapshot = message.snapshot;
        // A season starting: at its first step, seen fresh or after a later one. A page that joins a season in the middle sees no start.
        if (message.snapshot.step === 0 && (previous === null || previous.step > 0)) this.seasonStarted();
        break;
      }
      case 'alerts':
        this.push(...message.alerts.map((alert): FeedItem => ({ kind: 'alert', alert })).reverse());
        break;
      case 'deploy':
        this.push({ kind: 'deploy', board: message.board, version: message.version, time: message.time, by: message.by });
        break;
      case 'inspection':
        this.inspection = { board: message.board, inspection: message.inspection };
        break;
      case 'deployResult':
        this.deployResult = { board: message.board, outcome: message.outcome };
        // The server took the code: what the editor would bring back is now the board's own firmware, not a draft.
        if (message.outcome.ok) {
          const { [message.board]: _taken, ...rest } = this.editorDrafts;
          this.editorDrafts = rest;
        }
        break;
      case 'error':
        this.showError(refusalText(message.message, message.refusal));
        break;
    }
    this.notify();
  }

  setSocketOpen(open: boolean): void {
    this.socketOpen = open;
    this.notify();
  }

  select(id: string | null): void {
    if (id !== this.selected) this.dispatchDraft = NO_DRAFT;
    this.selected = id;
    this.inspection = null;
    this.notify();
  }

  toggleHeatmap(): void {
    this.heatmap = !this.heatmap;
    this.notify();
  }

  openGuide(): void {
    this.guideOpen = true;
    this.notify();
  }

  /** Closes the guide card; with dontShowAgain, it stays closed at the next seasons, in this browser. */
  closeGuide(dontShowAgain: boolean): void {
    this.guideOpen = false;
    if (dontShowAgain) {
      try {
        this.storage?.setItem(GUIDE_DISMISSED_KEY, '1');
      } catch {
        // A storage that refuses only means the card shows again next season.
      }
    }
    this.notify();
  }

  openManual(target: string | 'index'): void {
    this.manualFor = target;
    this.notify();
  }

  closeManual(): void {
    this.manualFor = null;
    this.notify();
  }

  openEditor(board: string): void {
    this.editorFor = board;
    this.deployResult = null;
    this.notify();
  }

  /** Closes the editor; the text it held comes back when the same board's editor opens again. */
  closeEditor(text?: string): void {
    if (this.editorFor !== null && text !== undefined) this.editorDrafts = { ...this.editorDrafts, [this.editorFor]: text };
    this.editorFor = null;
    this.notify();
  }

  setDispatchDraft(patch: Partial<DispatchDraft>): void {
    this.dispatchDraft = { ...this.dispatchDraft, ...patch };
    this.notify();
  }

  /** A new season: its boards are not the old ones, so the editor and its drafts go; the guide card shows unless dismissed. */
  private seasonStarted(): void {
    this.editorFor = null;
    this.deployResult = null;
    this.editorDrafts = {};
    this.dispatchDraft = NO_DRAFT;
    if (!this.guideDismissed()) this.guideOpen = true;
  }

  private guideDismissed(): boolean {
    try {
      return this.storage?.getItem(GUIDE_DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  }

  /** A refusal is told for a few seconds; a newer one starts the time over. */
  private showError(text: string): void {
    this.error = text;
    if (this.errorTimer !== null) clearTimeout(this.errorTimer);
    this.errorTimer = setTimeout(() => {
      this.errorTimer = null;
      this.error = null;
      this.notify();
    }, ERROR_SHOWN_MS);
  }

  private push(...items: FeedItem[]): void {
    this.feed = [...items, ...this.feed].slice(0, FEED_LIMIT);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}
```

- [ ] **Step 4: Write the refusals and the display rules**

`packages/viewer/src/refusals.ts` (whole file):

```ts
import type { Refusal } from '@turing-city/core';

/** What the player reads when the server refuses something with no code of its own, or with one this viewer has no text for. */
const unknown = (message: string): string => `서버가 명령을 받아들이지 않았어요: ${message}`;

/**
 * A refusal of the server, in Korean (the server's own words are English, for agents and logs). Every code of core's Refusal has its
 * text here: a new code is a type error at the end of the switch until it gets one. A refusal with no code, or a code of a newer
 * server, is a Korean sentence that carries the server's English text.
 */
export function refusalText(message: string, refusal: Refusal | undefined): string {
  if (!refusal) return unknown(message);
  switch (refusal.code) {
    case 'noAgent':
      return '에이전트가 연결돼 있지 않아요. 에이전트를 연결한 뒤에 다시 해보세요.';
    case 'noSeason':
      return '시즌이 아직 시작되지 않았어요.';
    case 'crashed':
      return `시즌이 멈췄어요 (${refusal.reason}). 새 시즌을 시작할 수 있어요.`;
    case 'seasonEnded':
      return '시즌이 이미 끝나서 할 수 없어요.';
    case 'unknownBoard':
      return `'${refusal.board}' 보드는 없어요.`;
    case 'notDestroyed':
      return `'${refusal.board}' 보드는 부서진 상태가 아니라서 재건할 수 없어요.`;
    case 'tooPoor':
      return '자금이 모자라요.';
    case 'badCommand':
      return `서버가 알아듣지 못하는 명령이에요 (${refusal.detail}).`;
    case 'unknownFacility':
      return `'${refusal.facility}' 시설은 없어요.`;
    case 'noBoard':
      return `'${refusal.facility}'에는 보드가 없어요. 먼저 보드를 설치하세요.`;
    case 'takesNoBoard':
      return `'${refusal.facility}'에는 보드를 달 수 없어요.`;
    case 'alreadyInstalled':
      return refusal.part === 'board'
        ? `'${refusal.facility}'에는 이미 보드가 있어요.`
        : `'${refusal.facility}' 보드에는 이미 통신 모듈이 있어요.`;
    case 'boardDown':
      return `'${refusal.facility}' 보드가 부서져 있어서 통신 모듈을 달 수 없어요.`;
    case 'wrecked':
      return `'${refusal.facility}' 시설이 부서졌거나 복구 중이에요. 복구가 끝난 뒤에 해보세요.`;
    case 'notWrecked':
      return `'${refusal.facility}' 시설은 부서지지 않았어요.`;
    case 'repairFirst':
      return `'${refusal.facility}' 시설을 먼저 복구해야 보드를 재건할 수 있어요.`;
    case 'noComm':
      return `'${refusal.board}' 보드에는 통신 모듈이 없어요.`;
    case 'cannotAct':
      return `'${refusal.facility}'에서 지금은 할 수 없어요 (${refusal.detail}).`;
    default:
      return exhausted(refusal, message);
  }
}

/** Reached only with a code this viewer does not know; the parameter's type is `never` so that a handled code is not missing above. */
function exhausted(_refusal: never, message: string): string {
  return unknown(message);
}
```

`packages/viewer/src/format.ts` (whole file):

```ts
import type { AlertKind, EndKind, FacilityCondition, FacilityKind, FacilityView, SensorValue, Snapshot, TimeView } from '@turing-city/core';

export function moneyLabel(n: number): string {
  return n.toLocaleString('en-US');
}

export function timeLabel(t: TimeView, seasonDays: number): string {
  return `${t.day}일차 ${t.clock} / ${seasonDays}일`;
}

export type Led = 'running' | 'asleep' | 'unpowered' | 'error' | 'destroyed' | 'off';

/**
 * A facility's status light. Only a facility with a board has one: the light is the board's, and a facility at T0 is a plain
 * building. A wrecked or repairing facility's board is down with it, whatever its own state says.
 */
export function ledOf(f: FacilityView): Led | null {
  const b = f.board;
  if (!b) return null;
  if (f.condition !== 'ok' || b.status === 'destroyed' || b.status === 'rebuilding') return 'destroyed';
  if (b.status === 'asleep') return 'asleep';
  if (!b.powered) return 'unpowered';
  if (b.erroring) return 'error';
  if (!b.hasFirmware) return 'off';
  return 'running';
}

export const LED_COLORS: Record<Led, number> = {
  running: 0x3fd07a,
  asleep: 0xe6d34a,
  unpowered: 0x596370,
  error: 0xff4d4d,
  destroyed: 0x000000,
  off: 0x2a313a,
};

export const LED_LABELS: Record<Led, string> = {
  running: '동작',
  asleep: '휴면',
  unpowered: '정전',
  error: '에러',
  destroyed: '파괴',
  off: '펌웨어 없음',
};

export const KIND_LABELS: Record<FacilityKind, string> = {
  power: '발전소',
  datacenter: '데이터센터',
  farm: '밭',
  warehouse: '물류창고',
  housing: '주거지',
};

/** What each tier means to the player: by hand, a board, a board an agent can reach. */
export const TIER_LABELS: Record<0 | 1 | 2, string> = { 0: 'T0 손으로', 1: 'T1 보드', 2: 'T2 통신 모듈' };

export const CONDITION_LABELS: Record<FacilityCondition, string> = { ok: '정상', wrecked: '부서짐', repairing: '복구 중' };

/** The firmware a board runs and the deploy waiting to install on it, by version: '펌웨어 v2 · 설치 대기 v3'. */
export function firmwareLabel(installed: number | null, pending: number | null): string {
  const parts: string[] = [];
  if (installed !== null) parts.push(`펌웨어 v${installed}`);
  if (pending !== null) parts.push(`설치 대기 v${pending}`);
  return parts.length > 0 ? parts.join(' · ') : '펌웨어 없음';
}

/** Heatmap opacity for a cell's EMF: nothing under 1, at most 0.6. */
export function heatAlpha(units: number): number {
  if (units < 1) return 0;
  return Math.min(0.6, units / 166);
}

/**
 * When the power plant is selected: the facilities it supplies, with their draw, priority rank, and whether they're shed. A
 * facility that draws nothing (a farm with no board, an idle datacenter) is left out unless the grid has it cut off.
 */
export function consumersOf(
  snapshot: Snapshot,
  selectedId: string | null,
): Array<{ id: string; demand: number; rank: number; shed: boolean }> | null {
  const selected = snapshot.facilities.find((f) => f.id === selectedId);
  if (selected?.kind !== 'power') return null;
  return snapshot.facilities
    .filter((f) => f.kind !== 'power' && (f.demand > 0 || snapshot.plant.shed.includes(f.id)))
    .map((f) => ({
      id: f.id,
      demand: f.demand,
      rank: snapshot.plant.priority.indexOf(f.id) + 1,
      shed: snapshot.plant.shed.includes(f.id),
    }));
}

export const ALERT_LABELS: Record<AlertKind, string> = {
  raid: '러다이트 출현',
  ludditesNear: '러다이트 접근',
  wrecked: '시설 파괴',
  fire: '화재',
  overheat: '과열',
  powerShortage: '정전',
  hunger: '굶주림',
  firmwareError: '펌웨어 에러',
  moneyBelowZero: '자금 마이너스',
  seasonEnd: '시즌 종료',
  agentLost: '에이전트 끊김',
};

export function endingLabel(kind: EndKind): string {
  return kind === 'completed' ? '시즌 완주' : '파산';
}

/** The town's people in one line: the fed out of everyone, then the hungry and those without power, when there are some. */
export function populationLabel(p: Snapshot['town']['population']): string {
  const parts = [`${p.fed}/${p.fed + p.hungry + p.unpowered}`];
  if (p.hungry > 0) parts.push(`굶주림 ${p.hungry}`);
  if (p.unpowered > 0) parts.push(`정전 ${p.unpowered}`);
  return parts.join(' · ');
}

/** A sensor value as the panel shows it: numbers to two decimals, nil for a missing one, strings as they are, one list item a line. */
export function sensorLabel(v: SensorValue): string {
  if (v === undefined) return 'nil';
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((item: SensorValue) => sensorLabel(item)).join('\n');
  return Object.entries(v)
    .map(([key, item]) => `${key}=${sensorLabel(item)}`)
    .join(' ');
}
```

- [ ] **Step 5: Write the start screen, the guide card, the top bar, the feed, and the overlay**

`packages/viewer/src/ui/start-screen.ts` (whole file):

```ts
import { clear, el } from '../dom.ts';
import type { Connection } from '../net.ts';
import type { Store } from '../store.ts';
import { noticeLines } from './notice.ts';

/**
 * 10-10 spec §10.1: start a season; connecting an agent is optional (it takes over the boards that get a comm module, T2). The
 * button waits only for the server: with the socket down a click would be dropped.
 */
export function renderStartScreen(root: HTMLElement, store: Store, net: Connection): void {
  clear(root);
  const agent = store.status?.agent;
  const connected = agent?.connected === true;
  const command = store.hello?.connect ?? '서버에 연결하는 중…';
  root.append(
    el('div', { class: 'start' }, [
      el('h1', {}, ['turing-city']),
      el('p', { class: 'dim' }, [store.status?.scenarioName ?? '']),
      el('button', { class: 'start-button', disabled: !store.socketOpen, onclick: () => net.send({ type: 'startSeason' }) }, ['시즌 시작']),
      ...noticeLines(store),
      el('div', { class: 'agent-section' }, [
        el('h2', {}, ['에이전트 연결 (선택)']),
        el('p', { class: 'dim' }, [
          '통신 모듈을 단 보드(T2)는 MCP로 연결한 에이전트가 맡을 수 있어요. 에이전트 없이도 시즌을 시작할 수 있어요.',
        ]),
        el('pre', { class: 'cmd' }, [command]),
        el('div', { class: 'row' }, [
          el('button', { onclick: () => void navigator.clipboard.writeText(command) }, ['복사']),
          el('button', { onclick: () => net.send({ type: 'reissueToken' }) }, ['토큰 재발급']),
          el('span', { class: connected ? 'ok' : 'dim' }, [
            connected ? `● 에이전트 연결됨 (${agent?.clientName ?? 'agent'})` : '○ 연결된 에이전트 없음',
          ]),
        ]),
      ]),
    ]),
  );
}
```

`packages/viewer/src/ui/guide.ts`:

```ts
import { clear, el } from '../dom.ts';
import type { Store } from '../store.ts';

/** Whether the card is in the page: it is built once when it opens, so that the page's renders do not reset its checkbox. */
let mounted = false;

/**
 * 10-10 spec §10.2: what to do, shown when a season starts until the player ticks "다시 보지 않기". [도움말] in the top bar opens it
 * again. The season's length comes from the snapshot, like every number the player reads.
 */
export function renderGuide(root: HTMLElement, store: Store): void {
  if (!store.guideOpen) {
    if (mounted) clear(root);
    mounted = false;
    root.hidden = true;
    return;
  }
  root.hidden = false;
  if (mounted) return; // a render of the page must not undo a tick the player just made
  mounted = true;
  const days = store.snapshot?.seasonDays ?? 30;
  const dontShowAgain = el('input', { type: 'checkbox' });
  root.append(
    el('div', { class: 'card' }, [
      el('h2', {}, ['이렇게 해요']),
      el('ul', {}, [
        el('li', {}, [`목표: ${days}일 동안 마을을 돌려서, 시즌이 끝날 때 자금을 최대한 남기세요.`]),
        el('li', {}, [
          '모든 시설은 손으로 돌릴 수 있어요. 시설을 클릭하면 오른쪽 패널에 버튼이 나와요: 밭 수확, 트럭 보내기, 발전소 화력, 데이터센터 처리와 냉각.',
        ]),
        el('li', {}, [
          '손이 바빠지면 시설에 보드를 설치하세요. 보드의 펌웨어(Lua)가 그 일을 대신해요. [편집]에서 짜고 [매뉴얼]을 보세요. 매뉴얼을 AI 채팅에 붙여넣어도 돼요.',
        ]),
        el('li', {}, ['보드에 통신 모듈을 달면 MCP로 연결한 에이전트(Claude Code 등)가 그 보드를 맡을 수 있어요.']),
        el('li', {}, ['보드와 일하는 데이터센터는 전자파를 내요. 러다이트가 전자파를 따라와 시설을 부숴요.']),
        el('li', {}, ['스페이스로 멈추고 재생해요. 시즌은 멈춘 채로 시작해요.']),
      ]),
      el('div', { class: 'row' }, [
        el('label', { class: 'dismiss' }, [dontShowAgain, ' 다시 보지 않기']),
        el('button', { class: 'primary', onclick: () => store.closeGuide(dontShowAgain.checked) }, ['알겠어요']),
      ]),
    ]),
  );
}
```

`packages/viewer/src/ui/top-bar.ts` (whole file):

```ts
import { clear, el } from '../dom.ts';
import { moneyLabel, populationLabel, timeLabel } from '../format.ts';
import type { Connection } from '../net.ts';
import type { Store } from '../store.ts';

export function renderTopBar(root: HTMLElement, store: Store, net: Connection): void {
  const s = store.snapshot;
  const status = store.status;
  if (!s || !status) return;
  clear(root);
  const running = status.state === 'running';
  const speedButton = (speed: 1 | 2 | 3) =>
    el('button', { class: status.speed === speed ? 'on' : '', onclick: () => net.send({ type: 'speed', speed }) }, [`${speed}×`]);
  const short = s.plant.generation < s.plant.demand;
  const people = s.town.population;
  const agent = status.agent;
  root.append(
    el('span', {}, [el('b', {}, [timeLabel(s.time, s.seasonDays)])]),
    el('span', { class: 'speed' }, [
      el('button', { class: running ? '' : 'on', onclick: () => net.send({ type: running ? 'pause' : 'play' }) }, [running ? '⏸' : '▶']),
      speedButton(1),
      speedButton(2),
      speedButton(3),
    ]),
    el('span', {}, ['자금 ', el('b', { class: s.money < 0 ? 'bad' : '' }, [moneyLabel(s.money)])]),
    el('span', {}, ['식량 ', el('b', {}, [moneyLabel(s.town.food)])]),
    el('span', {}, ['인구 ', el('b', { class: people.hungry > 0 || people.unpowered > 0 ? 'bad' : '' }, [populationLabel(people)])]),
    el('span', {}, [
      '전력 ',
      el('b', { class: short ? 'bad' : '' }, [`${s.plant.generation} / ${s.plant.demand}`]),
      el('span', { class: 'dim' }, [' 발전/수요']),
    ]),
    el('span', {}, ['풍력 ', el('b', {}, [String(s.plant.wind)]), ' · 화력 ', el('b', {}, [String(s.plant.thermal)])]),
    el('span', { class: 'tools' }, [
      el('button', { onclick: () => store.openManual('index') }, ['매뉴얼']),
      el('button', { onclick: () => store.openGuide() }, ['도움말']),
    ]),
    el('span', { class: `agent ${agent.connected ? 'ok' : 'dim'}` }, [
      agent.connected ? `● 에이전트 연결 (${agent.clientName ?? 'agent'})` : '○ 에이전트 없음',
    ]),
  );
}
```

`packages/viewer/src/ui/feed.ts` (whole file):

```ts
import { ALERT_KINDS, type AlertKind } from '@turing-city/core';
import { clear, el } from '../dom.ts';
import { ALERT_LABELS } from '../format.ts';
import type { Connection } from '../net.ts';
import type { Store } from '../store.ts';

/** Every alert kind can pause the game but the season's end, which ends it. A lost agent is one of them now, on by default. */
const TOGGLABLE: readonly AlertKind[] = ALERT_KINDS.filter((kind) => kind !== 'seasonEnd');
const SEVERE: readonly AlertKind[] = ['raid', 'wrecked', 'fire', 'hunger', 'agentLost'];

export function renderFeed(root: HTMLElement, store: Store, net: Connection): void {
  clear(root);
  for (const item of store.feed.slice(0, 12)) {
    if (item.kind === 'deploy') {
      root.append(
        el('div', { class: 'item', onclick: () => store.select(item.board) }, [
          el('span', { class: 't' }, [`${item.time.day}일 ${item.time.clock}`]),
          el('span', { class: 'deploy' }, [
            `${item.by === 'agent' ? '에이전트' : '플레이어'}: ${item.board}에 펌웨어 v${item.version} 배포`,
          ]),
        ]),
      );
    } else {
      const a = item.alert;
      root.append(
        el('div', { class: 'item', onclick: () => store.select(a.facility) }, [
          el('span', { class: 't' }, [`${a.day}일 ${a.clock}`]),
          el('span', { class: SEVERE.includes(a.kind) ? 'bad' : 'warn' }, [a.message]),
        ]),
      );
    }
  }
  const auto = store.status?.autoPause ?? [];
  const toggles = el('div', { class: 'toggles' }, ['자동 정지: ']);
  for (const kind of TOGGLABLE) {
    const box = el('input', { type: 'checkbox', checked: auto.includes(kind) });
    box.addEventListener('change', () => {
      const next = box.checked ? [...auto, kind] : auto.filter((k) => k !== kind);
      net.send({ type: 'autoPause', kinds: next });
    });
    toggles.append(el('label', {}, [box, ` ${ALERT_LABELS[kind]}`]));
  }
  root.append(toggles);
}
```

`packages/viewer/src/ui/overlay.ts` (whole file):

```ts
import { clear, el } from '../dom.ts';
import { endingLabel, moneyLabel } from '../format.ts';
import type { Connection } from '../net.ts';
import type { Store } from '../store.ts';

/** A crashed session or the season's end; hidden otherwise. A new season needs no agent (10-10 spec §8). */
export function renderOverlay(root: HTMLElement, store: Store, net: Connection): void {
  clear(root);
  const status = store.status;
  const s = store.snapshot;
  const newSeason = el('button', { class: 'primary', onclick: () => net.send({ type: 'startSeason' }) }, ['새 시즌']);
  let box: HTMLElement | null = null;
  if (status?.state === 'crashed') {
    box = el('div', { class: 'box bad' }, [el('h2', { class: 'bad' }, ['시뮬레이터가 멈췄어요']), el('p', {}, [status.crash ?? '']), newSeason]);
  } else if (status?.state === 'ended' && s?.ended) {
    box = el('div', { class: 'box' }, [
      el('h2', {}, [endingLabel(s.ended.kind)]),
      el('p', {}, [`최종 자금 ${moneyLabel(s.money)}`]),
      el('p', { class: 'dim' }, ['시즌 결산 화면(내역과 지난 시즌 목록)은 이번 플레이테스트 뒤에 붙어요.']),
      newSeason,
    ]);
  }
  root.hidden = box === null;
  if (box) root.append(box);
}
```

- [ ] **Step 6: Write the interim map and panel**

The interim map is milestone 1's, drawn from `facilities`:
- a light only on a facility with a board;
- one colour per kind;
- the plant's consumers when it is selected.

Task 18 replaces it with the full map (tiers, wrecks, farms, trucks, routes).

`packages/viewer/src/map/map-scene.ts` (whole file):

```ts
import type { FacilityKind, Snapshot } from '@turing-city/core';
import Phaser from 'phaser';
import { consumersOf, heatAlpha, LED_COLORS, ledOf } from '../format.ts';

export const CELL = 34;

const FACILITY_COLORS: Record<FacilityKind, number> = {
  power: 0xf2c14e,
  datacenter: 0xc49bff,
  farm: 0x7fc97f,
  warehouse: 0xd9a066,
  housing: 0x8fb8e0,
};

/** The town: drawn from scratch on every snapshot, selection change, and blink. */
export class MapScene extends Phaser.Scene {
  onSelect: (id: string | null) => void = () => {};
  private gfx: Phaser.GameObjects.Graphics | null = null;
  private labels: Phaser.GameObjects.Text[] = [];
  private snapshot: Snapshot | null = null;
  private selected: string | null = null;
  private heatmap = false;
  private blinkOn = true;

  constructor() {
    super('map');
  }

  create(): void {
    this.gfx = this.add.graphics();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const x = Math.floor(p.x / CELL);
      const y = Math.floor(p.y / CELL);
      const hit = this.snapshot?.facilities.find((f) => f.x === x && f.y === y);
      this.onSelect(hit?.id ?? null);
    });
    this.time.addEvent({
      delay: 450,
      loop: true,
      callback: () => {
        this.blinkOn = !this.blinkOn;
        this.redraw();
      },
    });
    this.redraw();
  }

  show(snapshot: Snapshot, selected: string | null, heatmap: boolean): void {
    this.snapshot = snapshot;
    this.selected = selected;
    this.heatmap = heatmap;
    this.redraw();
  }

  private text(x: number, y: number, value: string, color: string, size = 11): void {
    this.labels.push(
      this.add.text(x, y, value, {
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: `${size}px`,
        color,
        backgroundColor: '#0c0f13cc',
      }),
    );
  }

  private redraw(): void {
    const s = this.snapshot;
    const g = this.gfx;
    if (!s || !g) return;
    g.clear();
    for (const t of this.labels) t.destroy();
    this.labels = [];
    const { width, height } = s.grid;

    g.fillStyle(0x141a20, 1);
    g.fillRect(0, 0, width * CELL, height * CELL);
    g.lineStyle(1, 0x232b34, 1);
    for (let x = 0; x <= width; x++) g.lineBetween(x * CELL, 0, x * CELL, height * CELL);
    for (let y = 0; y <= height; y++) g.lineBetween(0, y * CELL, width * CELL, y * CELL);

    if (this.heatmap) {
      s.emf.forEach((units, i) => {
        const alpha = heatAlpha(units);
        if (alpha > 0) {
          g.fillStyle(0xff5a28, alpha);
          g.fillRect((i % width) * CELL, Math.floor(i / width) * CELL, CELL, CELL);
        }
      });
    }

    const consumers = consumersOf(s, this.selected);
    for (const f of s.facilities) {
      const px = f.x * CELL;
      const py = f.y * CELL;
      const led = ledOf(f);
      const dim = f.condition !== 'ok' || !f.powered;
      const consumer = consumers?.find((c) => c.id === f.id);
      if (consumer) {
        g.lineStyle(2, consumer.shed ? 0x59636f : 0xf2c14e, 1);
        g.strokeRect(px, py, CELL, CELL);
        this.text(
          px + CELL + 2,
          py + 2,
          `−${consumer.demand} · ${consumer.rank}순위${consumer.shed ? ' · 정전' : ''}`,
          consumer.shed ? '#9aa3ad' : '#f2c14e',
        );
      }
      g.fillStyle(FACILITY_COLORS[f.kind], dim ? 0.45 : 1);
      g.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
      if (led !== null) {
        g.fillStyle(LED_COLORS[led], 1);
        g.fillCircle(px + CELL - 5, py + 5, 4);
        if (led === 'error' && !this.blinkOn) {
          g.fillStyle(0x141a20, 1);
          g.fillCircle(px + CELL - 5, py + 5, 4);
        }
      }
      this.text(px + 6, py + 10, f.id, '#ffffff');
      if (f.datacenter) {
        const temp = f.datacenter.tempC;
        this.text(px, py + CELL + 1, `${temp}°C${f.datacenter.processing ? ' ▲' : ''}`, temp >= 85 ? '#ffb020' : '#d7dde4', 10);
      }
      if (f.id === this.selected) {
        g.lineStyle(2, 0xffffff, 1);
        g.strokeRect(px, py, CELL, CELL);
      }
    }

    for (const group of s.luddites) {
      if (this.blinkOn && group.path.length > 0) {
        g.lineStyle(2, 0xff4d4d, 1);
        g.beginPath();
        g.moveTo(group.x * CELL + CELL / 2, group.y * CELL + CELL / 2);
        for (const [x, y] of group.path) g.lineTo(x * CELL + CELL / 2, y * CELL + CELL / 2);
        g.strokePath();
      }
      g.fillStyle(0xff4d4d, 1);
      for (let k = 0; k < group.size; k++) g.fillCircle(group.x * CELL + 9 + (k % 2) * 10, group.y * CELL + 10 + Math.floor(k / 2) * 12, 4);
      this.text(
        group.x * CELL + CELL + 2,
        group.y * CELL,
        `러다이트 ${group.size}${group.targetId ? ` → ${group.targetId}` : ''}`,
        '#ff4d4d',
      );
    }
  }
}

/** Creates the Phaser game for the map, sized to the scenario's grid. */
export function mountMap(parent: HTMLElement, snapshot: Snapshot, onSelect: (id: string | null) => void): MapScene {
  const scene = new MapScene();
  scene.onSelect = onSelect;
  new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: snapshot.grid.width * CELL + 140,
    height: snapshot.grid.height * CELL + 14,
    backgroundColor: '#11151a',
    scene,
  });
  return scene;
}
```

The interim panel shows:
- the facility's name, tier, and light;
- the readings the snapshot carries for every kind;
- for a facility with a board: the board's parts, sensors, log, pending firmware, and firmware, from the inspection.

Task 19 adds the controls, the installs, repair and rebuild, and the window buttons.

`packages/viewer/src/ui/panel.ts` (whole file):

```ts
import type { FacilityView, Snapshot } from '@turing-city/core';
import { clear, el } from '../dom.ts';
import { CONDITION_LABELS, firmwareLabel, KIND_LABELS, LED_LABELS, ledOf, sensorLabel, TIER_LABELS } from '../format.ts';
import type { Connection } from '../net.ts';
import type { Store } from '../store.ts';

const section = (label: string, ...children: Array<Node | string>): HTMLElement =>
  el('div', { class: 'sec' }, [el('div', { class: 'label' }, [label]), ...children]);

const kv = (pairs: Array<[string, string]>): HTMLElement =>
  el(
    'div',
    { class: 'kv' },
    pairs.flatMap(([k, v]) => [el('span', { class: 'dim' }, [k]), el('span', {}, [v])]),
  );

const SCROLL_KEY = 'data-scroll';

/** The scroll offsets of the panel's scrollable blocks, by their keys. */
function scrollOffsets(root: HTMLElement): Map<string, number> {
  const offsets = new Map<string, number>();
  for (const pre of root.querySelectorAll<HTMLElement>(`pre[${SCROLL_KEY}]`))
    offsets.set(pre.getAttribute(SCROLL_KEY) ?? '', pre.scrollTop);
  return offsets;
}

/** What the snapshot says of a facility of each kind: the readings a player at T0 works from. */
function readings(s: Snapshot, f: FacilityView): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (f.kind === 'power') {
    rows.push(['풍력', String(s.plant.wind)], ['화력', `${s.plant.thermal} / ${s.plant.thermalMax}`]);
    rows.push(['연료비', `${s.plant.fuelPrice}/단위·일`], ['발전 / 수요', `${s.plant.generation} / ${s.plant.demand}`]);
  }
  if (f.datacenter) {
    rows.push(['온도', `${f.datacenter.tempC}°C`]);
    rows.push(['상태', [f.datacenter.processing ? '처리 중' : '대기', ...(f.datacenter.cooling ? ['냉각 중'] : [])].join(' · ')]);
  }
  if (f.farm) rows.push(['익음', `${f.farm.ripeness}%${f.farm.ripe ? ' (수확 가능)' : ''}`], ['출고함', String(f.farm.outbox)]);
  if (f.warehouse) rows.push(['재고', String(f.warehouse.stock)]);
  if (f.housing) {
    rows.push(['주민', `${f.housing.residents}명`], ['식량', String(f.housing.food)]);
    rows.push(['상태', `${f.housing.fed ? '먹음' : '굶주림'} · ${f.powered ? '전기 있음' : '정전'}`]);
  }
  return rows;
}

export function renderPanel(root: HTMLElement, store: Store, _net: Connection): void {
  // The panel is rebuilt on every change, so a block the player scrolled would jump back to its top: put each one back.
  const scrolled = scrollOffsets(root);
  clear(root);
  const s = store.snapshot;
  const f = s?.facilities.find((x) => x.id === store.selected);
  if (!s || !f) {
    root.append(el('p', { class: 'dim' }, ['시설을 클릭하면 여기에 정보가 떠요']));
    return;
  }
  const led = ledOf(f);
  const inspection = store.inspection?.board === f.id ? store.inspection.inspection : null;
  const state =
    f.condition !== 'ok'
      ? el('span', { class: 'bad' }, [`● ${CONDITION_LABELS[f.condition]}`])
      : led === null
        ? el('span', { class: 'dim' }, ['손으로 운영'])
        : el('span', { class: led === 'running' ? 'ok' : led === 'error' || led === 'destroyed' ? 'bad' : 'warn' }, [`● ${LED_LABELS[led]}`]);
  root.append(
    el('h2', {}, [`${KIND_LABELS[f.kind]} ${f.id}`]),
    el('div', {}, [
      el('span', { class: 'tier' }, [TIER_LABELS[f.tier]]),
      ' ',
      state,
      f.board ? el('span', { class: 'dim' }, [` · ${firmwareLabel(inspection?.firmware?.version ?? null, inspection?.pending?.version ?? null)}`]) : '',
    ]),
    section('현재', kv(readings(s, f))),
  );
  if (!f.board) return;
  if (!inspection) {
    root.append(el('p', { class: 'dim' }, ['불러오는 중…']));
    return;
  }
  const parts = inspection.parts;
  root.append(
    section(
      '부품',
      kv([
        ['CPU', `${parts.clockHz}Hz · 틱당 ${parts.instructionsPerTick}명령`],
        ['RAM', `${Math.round(parts.ramBytes / 1024)}KB (사용 ${((parts.ramUsedBytes ?? 0) / 1024).toFixed(1)}KB)`],
        ['기본 전자파', String(inspection.baseEmfPerSecond)],
      ]),
    ),
    section('실시간 센서', kv(Object.entries(inspection.sensors).map(([k, v]): [string, string] => [k, sensorLabel(v)]))),
    section(
      '로그',
      el('pre', { [SCROLL_KEY]: `${f.id}/log` }, [
        [...inspection.logs]
          .reverse()
          .map((l) => `${l.day}일 ${l.clock}  ${l.kind === 'log' ? '' : `[${l.kind}] `}${l.text}${l.repeat > 1 ? ` ×${l.repeat}` : ''}`)
          .join('\n') || '(없음)',
      ]),
    ),
    // A deploy installs at the board's next tick, which for a board that is asleep or smashed is a while off: until then it shows here.
    ...(inspection.pending
      ? [
          section(
            `설치 대기 중인 펌웨어 v${inspection.pending.version} (읽기 전용)`,
            el('pre', { [SCROLL_KEY]: `${f.id}/pending` }, [inspection.pending.source]),
          ),
        ]
      : []),
    section(
      `펌웨어${inspection.firmware ? ` v${inspection.firmware.version}` : ''} (읽기 전용)`,
      el('pre', { [SCROLL_KEY]: `${f.id}/firmware` }, [inspection.firmware?.source ?? '(없음)']),
    ),
  );
  // Only now are the blocks in the page with a layout, which setting scrollTop needs. Another facility's blocks have other keys.
  for (const pre of root.querySelectorAll<HTMLElement>(`pre[${SCROLL_KEY}]`))
    pre.scrollTop = scrolled.get(pre.getAttribute(SCROLL_KEY) ?? '') ?? 0;
}
```

- [ ] **Step 7: Wire the page: the keys, main.ts, the HTML, and the style**

`packages/viewer/src/keys.ts` (whole file):

```ts
import type { Connection } from './net.ts';
import type { Store } from './store.ts';

/** Whether the key goes to something the player types in: a form field. */
function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

/** Space pauses or plays, 1-3 set the speed, H toggles the heatmap, Escape closes the guide card or clears the selection. */
export function bindKeys(store: Store, net: Connection): void {
  window.addEventListener('keydown', (event) => {
    if (typing(event.target)) return;
    if (event.code === 'Space') event.preventDefault(); // else the page scrolls
    // A held key repeats keydown, and a held Space would flip pause and play at the repeat rate. With Cmd, Ctrl or Alt down a key is the
    // system's or the browser's shortcut (Cmd+H, Ctrl+1), not a command to the game.
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const state = store.status?.state;
    if (event.code === 'Space') {
      if (state === 'running') net.send({ type: 'pause' });
      else if (state === 'paused') net.send({ type: 'play' });
    } else if (event.key === '1' || event.key === '2' || event.key === '3') {
      net.send({ type: 'speed', speed: Number(event.key) as 1 | 2 | 3 });
    } else if (event.code === 'KeyH') {
      // By position, not by character: with the Korean input source on, Chrome reports this key as 'Process', and only its code is KeyH.
      store.toggleHeatmap();
    } else if (event.key === 'Escape') {
      if (store.guideOpen) store.closeGuide(false);
      else store.select(null);
    }
  });
}
```

`packages/viewer/src/main.ts` (whole file):

```ts
import './style.css';
import { bindKeys } from './keys.ts';
import { type MapScene, mountMap } from './map/map-scene.ts';
import { Connection, gameSocketUrl } from './net.ts';
import { Store } from './store.ts';
import { renderFeed } from './ui/feed.ts';
import { renderGuide } from './ui/guide.ts';
import { renderNotice } from './ui/notice.ts';
import { renderOverlay } from './ui/overlay.ts';
import { renderPanel } from './ui/panel.ts';
import { renderStartScreen } from './ui/start-screen.ts';
import { renderTopBar } from './ui/top-bar.ts';

const store = new Store();
const net = new Connection(
  gameSocketUrl(window.location),
  (m) => store.apply(m),
  (open) => store.setSocketOpen(open),
);
const $ = (id: string): HTMLElement => document.querySelector<HTMLElement>(id)!;
let map: MapScene | null = null;
let pointerDown = false;
let renderOwed = false;

function render(): void {
  renderOwed = false;
  const inSeason = store.status !== null && store.status.state !== 'idle';
  $('#start').hidden = inSeason;
  $('#game').hidden = !inSeason;
  renderOverlay($('#overlay'), store, net);
  renderNotice($('#notice'), store, inSeason);
  if (!inSeason) {
    $('#guide').hidden = true;
    renderStartScreen($('#start'), store, net);
    return;
  }
  renderGuide($('#guide'), store);
  renderTopBar($('#topbar'), store, net);
  renderFeed($('#feed'), store, net);
  renderPanel($('#panel'), store, net);
  if (store.snapshot) {
    map ??= mountMap($('#map'), store.snapshot, (id) => store.select(id));
    map.show(store.snapshot, store.selected, store.heatmap);
  }
}

/**
 * render() replaces the page's buttons, and a snapshot arrives about every 50 ms while the clock runs. A click needs the button
 * the press began on to still be in the page at the release, so while a pointer is down the render waits.
 */
function requestRender(): void {
  if (pointerDown) renderOwed = true;
  else render();
}

function pressPointer(): void {
  pointerDown = true;
}

function releasePointer(): void {
  pointerDown = false;
  // On a timer, not here: the click is dispatched after pointerup, and rendering now would detach the pressed button first.
  setTimeout(() => {
    if (renderOwed && !pointerDown) render();
  }, 0);
}

window.addEventListener('pointerdown', pressPointer, true);
// A press that never gets its pointerup must not freeze the screen: a cancelled pointer, a window that lost focus, and a context
// menu (which takes the release) all end it.
for (const type of ['pointerup', 'pointercancel', 'contextmenu']) window.addEventListener(type, releasePointer, true);
window.addEventListener('blur', releasePointer);

// The panel's live sensors and log: ask again twice a second while a facility is selected (one without a board gets null).
setInterval(() => {
  if (store.selected) net.send({ type: 'inspect', board: store.selected });
}, 500);

bindKeys(store, net);
store.subscribe(requestRender);
render();
```

`packages/viewer/index.html` (whole file):

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>turing-city</title>
  </head>
  <body>
    <div id="start"></div>
    <div id="game" hidden>
      <header id="topbar"></header>
      <main>
        <section id="left">
          <div id="map"></div>
          <div id="feed"></div>
        </section>
        <aside id="panel"></aside>
      </main>
      <footer id="keys">스페이스 일시정지 · 1/2/3 배속 · H 히트맵 · Esc 닫기 · 시설 클릭 = 패널 · 알림 클릭 = 그 시설로</footer>
    </div>
    <div id="guide" hidden></div>
    <div id="overlay" hidden></div>
    <div id="notice" hidden></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

Append to `packages/viewer/src/style.css`:

```css
/* The start screen's optional agent section (10-10 spec §10.1). */
.agent-section {
  margin-top: 28px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}
.agent-section h2 {
  margin: 0 0 4px;
  font-size: 14px;
}
#topbar .tools button {
  padding: 2px 9px;
  margin-right: 2px;
}
#feed .deploy {
  color: #7fb6ff;
}
#panel .tier {
  font-size: 11px;
  color: #0c0f13;
  background: #9aa7b4;
  border-radius: 4px;
  padding: 1px 6px;
}
/* The guide card (10-10 spec §10.2): over the game, under the notice. */
#guide {
  position: fixed;
  inset: 0;
  background: rgba(8, 10, 13, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
}
#guide[hidden] {
  display: none;
}
#guide .card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 18px 22px;
  max-width: 560px;
}
#guide .card h2 {
  margin: 0 0 8px;
  font-size: 16px;
  color: #fff;
}
#guide .card li {
  margin: 6px 0;
  line-height: 1.45;
}
#guide .card .row {
  justify-content: flex-end;
  gap: 14px;
}
```

- [ ] **Step 8: Run the tests, the typecheck, and the build**

Run: `pnpm vitest run packages/viewer`
Expected: PASS. The counts are store 14, refusals 22, and format 11; the refusal count is the 18 codes of `it.each` plus 4 tests.

Run: `pnpm --filter @turing-city/viewer typecheck && pnpm --filter @turing-city/viewer build`
Expected: no type errors, and the build succeeds (Phaser's chunk-size warning is fine).

Run: `pnpm fix && pnpm check`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/viewer
git commit -m "Viewer: the store, start screen, guide card, top bar, and feed for the early stage"
```

---

### Task 18: Viewer: the map of the whole town

The full map of the early stage (10-10 spec §10.3, 10-09 spec §8.2). It replaces Task 17's interim map.
- **Facilities.** Every kind has its colour and label. A status light appears only on a facility with a board, and a T1 or T2 board carries a tier mark.
- **Wrecks.** A wrecked facility is drawn dark with a red cross. A repairing one is hatched, with its hours left.
- **Captions.** Under each facility: a datacenter's temperature (amber from the scenario's overheat threshold); a farm's ripeness and outbox, with a ripeness bar inside its cell; a warehouse's stock; a housing block's food.
- **Trucks.** Each is drawn at its cell. The idle ones wait in their warehouse's cell.
- **Selection rules:**
  - the warehouse shows every route its trucks are on;
  - a farm shows only the trucks collecting from it;
  - a housing block shows only the deliveries coming to it;
  - the plant shows the facilities it supplies (milestone 1's rule, now over facilities).
- **Threat paths** (the Luddites') show whatever is selected, as before.

**Routes and the core's paths.** The routes are the legs the core drives (contract §9): out from the warehouse to the target, then back, each along the row first and then the column (core's `pathTo`).

**Pure helpers.** The rules the map draws from are pure functions in `map-rules.ts`, tested in Node. `map-scene.ts` (Phaser) only draws them.

**Files:**
- Create: `packages/viewer/src/map-rules.ts`
- Modify (whole file): `packages/viewer/src/map/map-scene.ts`, `packages/viewer/src/main.ts` (it passes the overheat threshold to the map)
- Test: `packages/viewer/test/map-rules.test.ts`

**Interfaces:**
- **Consumes:**
  - Task 17: `consumersOf`, `heatAlpha`, `ledOf`, `LED_COLORS`, `Store` (its `scenario`).
  - Task 10: `Snapshot` with `facilities`, `trucks`, and `luddites`, and `FacilityView` (contract §13).
  - Core's `pathTo(fromX, fromY, toX, toY): Array<[number, number]>` (luddites.ts, milestone 1).
  - Task 8's legs: outbound `pathTo(warehouse → target)`, returning `pathTo(target → warehouse)`.
- **Produces:**
  - **`map-rules.ts`:**
    - `FACILITY_COLORS`;
    - the routes: `type Cell`, `interface Route { warehouse; truck; target; kind: 'collect' | 'deliver'; status: 'outbound' | 'returning'; cells }`, `legOf(snapshot, truck): Route | null`, `routesFor(snapshot, selectedId): Route[]`;
    - the trucks: `trucksByCell(snapshot): Map<string, Truck[]>`, `truckLabel(truck): string`;
    - the captions: `cellCaption(facility, overheatC): { text; tone: 'normal' | 'warn' | 'good' } | null`;
    - the threshold: `overheatCelsius(scenario: Scenario | null): number`.
  - **`map-scene.ts`:** `CELL`, `class MapScene` with `show(snapshot, selected, heatmap, overheatC)`, and `mountMap(parent, snapshot, onSelect)`.

- [ ] **Step 1: Write the failing tests**

`packages/viewer/test/map-rules.test.ts`:

```ts
import type { FacilityView, Scenario, Snapshot } from '@turing-city/core';
import { describe, expect, it } from 'vitest';
import { cellCaption, legOf, overheatCelsius, routesFor, truckLabel, trucksByCell } from '../src/map-rules.ts';

type Truck = Snapshot['trucks'][number];

const facility = (over: Partial<FacilityView>): FacilityView => ({
  id: 'X',
  kind: 'farm',
  x: 0,
  y: 0,
  tier: 0,
  condition: 'ok',
  repairHoursLeft: null,
  powered: true,
  demand: 0,
  board: null,
  datacenter: null,
  farm: null,
  warehouse: null,
  housing: null,
  ...over,
});
const truck = (over: Partial<Truck>): Truck => ({ warehouse: 'W', id: 1, x: 11, y: 6, status: 'idle', load: 0, targetId: null, ...over });

/** The small town's warehouse, two farms and a housing block, at their places in m2-town.json. */
const town = (trucks: Truck[]): Snapshot =>
  ({
    facilities: [
      facility({ id: 'H1', kind: 'housing', x: 2, y: 1 }),
      facility({ id: 'W', kind: 'warehouse', x: 11, y: 6 }),
      facility({ id: 'F1', kind: 'farm', x: 2, y: 9 }),
      facility({ id: 'F2', kind: 'farm', x: 3, y: 9 }),
      facility({ id: 'P', kind: 'power', x: 4, y: 4 }),
    ],
    trucks,
  }) as unknown as Snapshot;

describe('map rules: truck routes', () => {
  it('draws an outbound leg from the warehouse to the target, along the row first and then the column', () => {
    const route = legOf(town([]), truck({ status: 'outbound', targetId: 'F1', x: 9, y: 6 }));
    expect(route).toMatchObject({ warehouse: 'W', truck: 1, target: 'F1', kind: 'collect', status: 'outbound' });
    expect(route?.cells[0]).toEqual([11, 6]);
    expect(route?.cells[1]).toEqual([10, 6]); // the row first
    expect(route?.cells.at(-1)).toEqual([2, 9]);
    expect(route?.cells).toHaveLength(1 + 9 + 3);
  });

  it('draws a returning leg from the target back to the warehouse, again along the row first', () => {
    const route = legOf(town([]), truck({ status: 'returning', targetId: 'H1', x: 2, y: 1 }));
    expect(route).toMatchObject({ target: 'H1', kind: 'deliver', status: 'returning' });
    expect(route?.cells[0]).toEqual([2, 1]);
    expect(route?.cells[1]).toEqual([3, 1]);
    expect(route?.cells.at(-1)).toEqual([11, 6]);
  });

  it('has no leg for an idle truck', () => {
    expect(legOf(town([]), truck({}))).toBeNull();
  });

  it("shows the warehouse every route its trucks are on, a farm only the trucks collecting from it, housing only the deliveries to it", () => {
    const trucks = [
      truck({ id: 1, status: 'outbound', targetId: 'F1', x: 8, y: 6 }),
      truck({ id: 2, status: 'returning', targetId: 'H1', x: 4, y: 1 }),
    ];
    const s = town(trucks);
    expect(routesFor(s, 'W').map((r) => r.truck)).toEqual([1, 2]);
    expect(routesFor(s, 'F1').map((r) => r.truck)).toEqual([1]);
    expect(routesFor(s, 'F2')).toEqual([]);
    expect(routesFor(s, 'H1').map((r) => r.truck)).toEqual([2]);
    expect(routesFor(s, 'P')).toEqual([]); // the plant draws its consumers instead (format.consumersOf)
    expect(routesFor(s, null)).toEqual([]);
  });

  it('groups the trucks by cell, so that two in one cell are drawn side by side', () => {
    const cells = trucksByCell(town([truck({ id: 1 }), truck({ id: 2 }), truck({ id: 3, x: 5, y: 6, status: 'outbound', targetId: 'F1' })]));
    expect(cells.get('11,6')?.map((t) => t.id)).toEqual([1, 2]);
    expect(cells.get('5,6')?.map((t) => t.id)).toEqual([3]);
  });

  it('labels a truck by its number, where it is going, and its load', () => {
    expect(truckLabel(truck({}))).toBe('1');
    expect(truckLabel(truck({ status: 'outbound', targetId: 'F1' }))).toBe('1→F1');
    expect(truckLabel(truck({ status: 'returning', targetId: 'F1', load: 24 }))).toBe('1←F1 24');
  });
});

describe('map rules: what a cell says', () => {
  it("says a datacenter's temperature, amber from the overheat threshold, and whether it is processing or cooling", () => {
    const dc = (tempC: number, processing = false, cooling = false) =>
      facility({ kind: 'datacenter', datacenter: { tempC, processing, cooling } });
    expect(cellCaption(dc(40), 85)).toEqual({ text: '40°C', tone: 'normal' });
    expect(cellCaption(dc(85, true), 85)).toEqual({ text: '85°C ▲', tone: 'warn' });
    expect(cellCaption(dc(60, false, true), 85)).toEqual({ text: '60°C ❄', tone: 'normal' });
  });

  it("says a farm's ripeness and outbox, good when it is ripe", () => {
    expect(cellCaption(facility({ farm: { ripeness: 40, ripe: false, outbox: 0 } }), 85)).toEqual({ text: '40% · 0', tone: 'normal' });
    expect(cellCaption(facility({ farm: { ripeness: 100, ripe: true, outbox: 24 } }), 85)).toEqual({ text: '100% · 24', tone: 'good' });
  });

  it("says a warehouse's stock and a housing block's food, warning when its people go hungry", () => {
    expect(cellCaption(facility({ kind: 'warehouse', warehouse: { stock: 31 } }), 85)).toEqual({ text: '재고 31', tone: 'normal' });
    expect(cellCaption(facility({ kind: 'housing', housing: { food: 0, residents: 40, fed: false } }), 85)).toEqual({
      text: '식량 0',
      tone: 'warn',
    });
  });

  it('says a wrecked or repairing facility is so, whatever else it is', () => {
    const wrecked = facility({ kind: 'datacenter', condition: 'wrecked', datacenter: { tempC: 92, processing: false, cooling: false } });
    expect(cellCaption(wrecked, 85)).toEqual({ text: '부서짐', tone: 'warn' });
    expect(cellCaption(facility({ condition: 'repairing', repairHoursLeft: 7 }), 85)).toEqual({ text: '복구 중 7시간', tone: 'warn' });
  });

  it('says nothing under the plant: the top bar and its panel carry its numbers', () => {
    expect(cellCaption(facility({ kind: 'power' }), 85)).toBeNull();
  });

  it("takes the overheat threshold from the scenario, in whole degrees, and 85 before the scenario is known", () => {
    expect(overheatCelsius({ tuning: { datacenter: { overheatAlertMilli: 80_500 } } } as unknown as Scenario)).toBe(80);
    expect(overheatCelsius(null)).toBe(85);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/viewer/test/map-rules.test.ts`
Expected: FAIL: `../src/map-rules.ts` does not exist.

- [ ] **Step 3: Write the map's rules**

`packages/viewer/src/map-rules.ts`:

```ts
import { type FacilityKind, type FacilityView, pathTo, type Scenario, type Snapshot } from '@turing-city/core';

export type Cell = readonly [number, number];
type Truck = Snapshot['trucks'][number];

export const FACILITY_COLORS: Record<FacilityKind, number> = {
  power: 0xf2c14e,
  datacenter: 0xc49bff,
  farm: 0x7fc97f,
  warehouse: 0xd9a066,
  housing: 0x8fb8e0,
};

/** A truck's current leg: from where it started to where it ends, cell by cell. */
export interface Route {
  readonly warehouse: string;
  readonly truck: number;
  readonly target: string;
  /** collect: to a farm and back with its food; deliver: to a housing block with food, and back empty. */
  readonly kind: 'collect' | 'deliver';
  readonly status: 'outbound' | 'returning';
  readonly cells: readonly Cell[];
}

/**
 * The leg a truck is on, as the core drives it: out from its warehouse to its target, then back, each leg along the row first and
 * then the column (pathTo). Null for an idle truck.
 */
export function legOf(snapshot: Snapshot, truck: Truck): Route | null {
  if (truck.status === 'idle' || truck.targetId === null) return null;
  const warehouse = snapshot.facilities.find((f) => f.id === truck.warehouse);
  const target = snapshot.facilities.find((f) => f.id === truck.targetId);
  if (!warehouse || !target) return null;
  const [from, to] = truck.status === 'outbound' ? [warehouse, target] : [target, warehouse];
  return {
    warehouse: warehouse.id,
    truck: truck.id,
    target: target.id,
    kind: target.kind === 'farm' ? 'collect' : 'deliver',
    status: truck.status,
    cells: [[from.x, from.y], ...pathTo(from.x, from.y, to.x, to.y)],
  };
}

/**
 * The truck routes the map draws for the selection (10-09 spec §8.2): the warehouse shows every route its trucks are on, a farm only
 * the trucks collecting from it, a housing block only the deliveries coming to it. Anything else, and nothing selected, shows none:
 * routine paths show only with a related block.
 */
export function routesFor(snapshot: Snapshot, selectedId: string | null): Route[] {
  const selected = snapshot.facilities.find((f) => f.id === selectedId);
  if (!selected) return [];
  const legs = snapshot.trucks.map((t) => legOf(snapshot, t)).filter((r): r is Route => r !== null);
  if (selected.kind === 'warehouse') return legs.filter((r) => r.warehouse === selected.id);
  if (selected.kind === 'farm' || selected.kind === 'housing') return legs.filter((r) => r.target === selected.id);
  return [];
}

/** The trucks by the cell they are in ("x,y"), so that two in one cell are drawn side by side. The idle ones wait in their warehouse's. */
export function trucksByCell(snapshot: Snapshot): Map<string, Truck[]> {
  const cells = new Map<string, Truck[]>();
  for (const t of snapshot.trucks) {
    const key = `${t.x},${t.y}`;
    cells.set(key, [...(cells.get(key) ?? []), t]);
  }
  return cells;
}

/** A truck on the map: its number, where it is going (→) or coming back from (←), and its load when it carries one. */
export function truckLabel(t: Truck): string {
  const where = t.status === 'idle' || t.targetId === null ? '' : `${t.status === 'outbound' ? '→' : '←'}${t.targetId}`;
  return `${t.id}${where}${t.load > 0 ? ` ${t.load}` : ''}`;
}

export type Tone = 'normal' | 'warn' | 'good';

/** What a facility's cell says under it. The plant says nothing: the top bar and its panel carry its numbers. */
export function cellCaption(f: FacilityView, overheatC: number): { text: string; tone: Tone } | null {
  if (f.condition === 'wrecked') return { text: '부서짐', tone: 'warn' };
  if (f.condition === 'repairing') return { text: `복구 중 ${f.repairHoursLeft ?? 0}시간`, tone: 'warn' };
  if (f.datacenter) {
    const d = f.datacenter;
    return { text: `${d.tempC}°C${d.processing ? ' ▲' : ''}${d.cooling ? ' ❄' : ''}`, tone: d.tempC >= overheatC ? 'warn' : 'normal' };
  }
  if (f.farm) return { text: `${f.farm.ripeness}% · ${f.farm.outbox}`, tone: f.farm.ripe ? 'good' : 'normal' };
  if (f.warehouse) return { text: `재고 ${f.warehouse.stock}`, tone: 'normal' };
  if (f.housing) return { text: `식량 ${f.housing.food}`, tone: f.housing.fed ? 'normal' : 'warn' };
  return null;
}

/** The temperature from which the map shows a datacenter in amber: the scenario's overheat alert, in whole degrees. */
export function overheatCelsius(scenario: Scenario | null): number {
  return scenario ? Math.floor(scenario.tuning.datacenter.overheatAlertMilli / 1000) : 85;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/viewer/test/map-rules.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Draw the town**

`packages/viewer/src/map/map-scene.ts` (whole file):

```ts
import type { Snapshot } from '@turing-city/core';
import Phaser from 'phaser';
import { consumersOf, heatAlpha, LED_COLORS, ledOf } from '../format.ts';
import { cellCaption, FACILITY_COLORS, routesFor, type Tone, truckLabel, trucksByCell } from '../map-rules.ts';

export const CELL = 34;

const TONE_COLORS: Record<Tone, string> = { normal: '#d7dde4', warn: '#ffb020', good: '#7fe08a' };
const TRUCK_COLOR = 0xff9f43;

/** The town: drawn from scratch on every snapshot, selection change, and blink. */
export class MapScene extends Phaser.Scene {
  onSelect: (id: string | null) => void = () => {};
  private gfx: Phaser.GameObjects.Graphics | null = null;
  private labels: Phaser.GameObjects.Text[] = [];
  private snapshot: Snapshot | null = null;
  private selected: string | null = null;
  private heatmap = false;
  private overheatC = 85;
  private blinkOn = true;

  constructor() {
    super('map');
  }

  create(): void {
    this.gfx = this.add.graphics();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const x = Math.floor(p.x / CELL);
      const y = Math.floor(p.y / CELL);
      const hit = this.snapshot?.facilities.find((f) => f.x === x && f.y === y);
      this.onSelect(hit?.id ?? null);
    });
    this.time.addEvent({
      delay: 450,
      loop: true,
      callback: () => {
        this.blinkOn = !this.blinkOn;
        this.redraw();
      },
    });
    this.redraw();
  }

  show(snapshot: Snapshot, selected: string | null, heatmap: boolean, overheatC: number): void {
    this.snapshot = snapshot;
    this.selected = selected;
    this.heatmap = heatmap;
    this.overheatC = overheatC;
    this.redraw();
  }

  private text(x: number, y: number, value: string, color: string, size = 11, background = '#0c0f13cc'): void {
    this.labels.push(
      this.add.text(x, y, value, { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: `${size}px`, color, backgroundColor: background }),
    );
  }

  /** A line through the centres of the cells. */
  private path(g: Phaser.GameObjects.Graphics, cells: ReadonlyArray<readonly [number, number]>, color: number, width: number, alpha = 1): void {
    const [first, ...rest] = cells;
    if (!first) return;
    g.lineStyle(width, color, alpha);
    g.beginPath();
    g.moveTo(first[0] * CELL + CELL / 2, first[1] * CELL + CELL / 2);
    for (const [x, y] of rest) g.lineTo(x * CELL + CELL / 2, y * CELL + CELL / 2);
    g.strokePath();
  }

  private redraw(): void {
    const s = this.snapshot;
    const g = this.gfx;
    if (!s || !g) return;
    g.clear();
    for (const t of this.labels) t.destroy();
    this.labels = [];
    const { width, height } = s.grid;

    g.fillStyle(0x141a20, 1);
    g.fillRect(0, 0, width * CELL, height * CELL);
    g.lineStyle(1, 0x232b34, 1);
    for (let x = 0; x <= width; x++) g.lineBetween(x * CELL, 0, x * CELL, height * CELL);
    for (let y = 0; y <= height; y++) g.lineBetween(0, y * CELL, width * CELL, y * CELL);

    if (this.heatmap) {
      s.emf.forEach((units, i) => {
        const alpha = heatAlpha(units);
        if (alpha > 0) {
          g.fillStyle(0xff5a28, alpha);
          g.fillRect((i % width) * CELL, Math.floor(i / width) * CELL, CELL, CELL);
        }
      });
    }

    // Routine paths, only with a related block selected: the trucks' legs (a returning leg drawn fainter).
    for (const route of routesFor(s, this.selected)) this.path(g, route.cells, TRUCK_COLOR, 2, route.status === 'outbound' ? 0.9 : 0.45);

    const consumers = consumersOf(s, this.selected);
    for (const f of s.facilities) {
      const px = f.x * CELL;
      const py = f.y * CELL;
      const consumer = consumers?.find((c) => c.id === f.id);
      if (consumer) {
        g.lineStyle(2, consumer.shed ? 0x59636f : 0xf2c14e, 1);
        g.strokeRect(px, py, CELL, CELL);
        this.text(
          px + CELL + 2,
          py + 2,
          `−${consumer.demand} · ${consumer.rank}순위${consumer.shed ? ' · 정전' : ''}`,
          consumer.shed ? '#9aa3ad' : '#f2c14e',
        );
      }
      const down = f.condition !== 'ok';
      g.fillStyle(down ? 0x2a2f36 : FACILITY_COLORS[f.kind], down || !f.powered ? 0.55 : 1);
      g.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
      if (f.condition === 'wrecked') {
        g.lineStyle(2, 0xff4d4d, 1);
        g.lineBetween(px + 7, py + 7, px + CELL - 7, py + CELL - 7);
        g.lineBetween(px + CELL - 7, py + 7, px + 7, py + CELL - 7);
      } else if (f.condition === 'repairing') {
        g.lineStyle(1, 0xffb020, 0.8);
        for (let k = 6; k < CELL; k += 7) g.lineBetween(px + 2, py + k, px + k, py + 2);
      }
      if (f.farm && !down) {
        // A ripeness bar along the bottom of the cell: green once ripe.
        g.fillStyle(0x0c0f13, 0.6);
        g.fillRect(px + 4, py + CELL - 5, CELL - 8, 2);
        g.fillStyle(f.farm.ripe ? 0x3fd07a : 0xe6d34a, 1);
        g.fillRect(px + 4, py + CELL - 5, Math.round(((CELL - 8) * f.farm.ripeness) / 100), 2);
      }
      const led = ledOf(f);
      if (led !== null) {
        g.fillStyle(LED_COLORS[led], 1);
        g.fillCircle(px + CELL - 5, py + 5, 4);
        if (led === 'error' && !this.blinkOn) {
          g.fillStyle(0x141a20, 1);
          g.fillCircle(px + CELL - 5, py + 5, 4);
        }
      }
      // The cell, from the top: the tier mark of a facility with a board, the id, and the trucks at the bottom right.
      if (f.tier > 0) this.text(px + 3, py + 3, `T${f.tier}`, '#0c0f13', 9, '#c9d3dc');
      this.text(px + 4, py + (f.tier > 0 ? 14 : 9), f.id, '#ffffff');
      const caption = cellCaption(f, this.overheatC);
      if (caption) this.text(px, py + CELL + 1, caption.text, TONE_COLORS[caption.tone], 10);
      if (f.id === this.selected) {
        g.lineStyle(2, 0xffffff, 1);
        g.strokeRect(px, py, CELL, CELL);
      }
    }

    // The trucks, at their cells, side by side when two share one; an idle one waits in its warehouse's cell.
    for (const [, trucks] of trucksByCell(s)) {
      trucks.forEach((t, k) => {
        const tx = t.x * CELL + CELL - 13 - k * 11;
        const ty = t.y * CELL + CELL - 12;
        g.fillStyle(TRUCK_COLOR, 1);
        g.fillRect(tx, ty, 10, 7);
        if (t.status !== 'idle') this.text(tx, ty + 8, truckLabel(t), '#ffcf99', 9);
      });
    }

    // Threats show whatever is selected: the Luddites, their path blinking.
    for (const group of s.luddites) {
      if (this.blinkOn && group.path.length > 0) this.path(g, [[group.x, group.y], ...group.path], 0xff4d4d, 2);
      g.fillStyle(0xff4d4d, 1);
      for (let k = 0; k < group.size; k++) g.fillCircle(group.x * CELL + 9 + (k % 2) * 10, group.y * CELL + 10 + Math.floor(k / 2) * 12, 4);
      this.text(
        group.x * CELL + CELL + 2,
        group.y * CELL,
        `러다이트 ${group.size}${group.targetId ? ` → ${group.targetId}` : ''}`,
        '#ff4d4d',
      );
    }
  }
}

/** Creates the Phaser game for the map, sized to the scenario's grid. */
export function mountMap(parent: HTMLElement, snapshot: Snapshot, onSelect: (id: string | null) => void): MapScene {
  const scene = new MapScene();
  scene.onSelect = onSelect;
  new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: snapshot.grid.width * CELL + 140,
    height: snapshot.grid.height * CELL + 14,
    backgroundColor: '#11151a',
    scene,
  });
  return scene;
}
```

In `packages/viewer/src/main.ts`, import `overheatCelsius` and pass the threshold to the map. Replace

```ts
    map.show(store.snapshot, store.selected, store.heatmap);
```

with

```ts
    map.show(store.snapshot, store.selected, store.heatmap, overheatCelsius(store.scenario));
```

and add the import line `import { overheatCelsius } from './map-rules.ts';` beside the others (Biome's `pnpm fix` sorts it).

- [ ] **Step 6: Run the checks and the build**

Run: `pnpm vitest run packages/viewer`
Expected: PASS: Task 17's 47 tests, plus map-rules' 12.

Run: `pnpm --filter @turing-city/viewer build`
Expected: builds (Phaser's chunk-size warning is fine).

Run: `pnpm fix && pnpm check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/viewer
git commit -m "Viewer: the map of the whole town, with tiers, wrecks, farms, trucks, and the selection rules"
```

---

### Task 19: Viewer: the panel and its hand controls

The right panel of the early stage (10-10 spec §4.3, §6, §10.3). It replaces Task 17's interim panel. For the selected facility it shows:

- **The header:** the kind and id, the tier, and the state. The state is the light of a facility with a board, "손으로 운영" for one without, or the facility's damage.
- **Damage:**
  - a wrecked facility offers [시설 복구 (cost · hours)];
  - a repairing one says how many hours are left;
  - once the facility stands again, a destroyed board offers [보드 재건 (cost · hours)];
  - a board being rebuilt says so.
- **Readings:** what the snapshot says of the facility, for every tier.
- **The hand controls** (10-10 spec §4.3), when the facility stands:

  | Facility | Controls |
  |---|---|
  | Farm | [수확], enabled when the crop is ripe |
  | Datacenter | [처리] (each press runs a job), and [냉각] (disabled while a cycle runs) |
  | Power plant | the thermal slider, from 0 to the module's maximum, sent on release; the supply order with ↑ and ↓ |
  | Warehouse | its trucks, and a form: pick an idle truck, a trip (collect from a farm, or deliver to a housing block), and an amount, then [보내기] |
  | Housing | none |

- **The hardware:** [보드 설치 (price)] at T0, and [통신 모듈 (price)] at T1. Each is disabled with its reason (too little money, a wrecked facility, a board that is down).
- **Buttons:** [매뉴얼] for a facility that takes a board, and [편집] and [로그 복사] for one with a board.
- **For a board:** the details Task 17's panel showed: parts, sensors, log, pending firmware, and firmware.

**Every button keeps working while the clock runs** and the panel is rebuilt with every snapshot (about 20 a second), because of milestone 1's pointer hold (`main.ts` holds renders while a pointer is down).
- The controls are buttons, so they take their click.
- The truck form keeps its choices in the store (`dispatchDraft`), not in form fields that a rebuild would reset.
- The slider sends on `change`, which comes with the release, after the render that was held during the drag.

**Pure helpers.** The rules for what a button says, whether it is enabled, and why not are pure functions in `panel-rules.ts`, tested in Node. `ui/controls.ts` and `ui/panel.ts` build the DOM from them.

**Files:**
- Create: `packages/viewer/src/panel-rules.ts`, `packages/viewer/src/ui/controls.ts`
- Modify (whole file): `packages/viewer/src/ui/panel.ts`
- Modify: `packages/viewer/src/style.css` (append the controls' rules)
- Test: `packages/viewer/test/panel-rules.test.ts`

**Interfaces:**
- **Consumes:**
  - Task 17: `Store` (`dispatchDraft`, `setDispatchDraft`, `openManual`, `openEditor`, `scenario`, `inspection`), `DispatchDraft`, `DispatchTrip`, `moneyLabel`, `KIND_LABELS`, `TIER_LABELS`, `CONDITION_LABELS`, `LED_LABELS`, `ledOf`, `firmwareLabel`, `sensorLabel`, `el`, `clear`.
  - Task 10: `Snapshot` (`prices`, `plant.thermalMax`, `plant.priority`, `plant.shed`, `trucks`, `facilities`), `FacilityView`, `BoardInspection`, `LogView`.
  - Task 4: `FacilityAction`.
  - Task 15: `ViewerToServer` (`hand`, `install`, `repair`, `rebuild`).
- **Produces:**
  - **`panel-rules.ts`:**
    - buttons: `interface ButtonState { label; disabled; reason }`, `installButton`, `commButton`, `repairButton`, `rebuildButton`, `harvestButton`, `processButton`, `coolButton`, `sendButton(snapshot, warehouse, draft)`;
    - the truck form: `interface TripChoice { trip; label; available }`, `tripChoices(snapshot, warehouseId)`, `idleTrucks(snapshot, warehouseId)`, `amountChoices(capacity)`, `dispatchAction(draft, warehouseId): FacilityAction | null`, `truckStatusLabel(truck)`;
    - the plant: `movedInPriority(order, id, delta)`;
    - the log: `logText(logs)`.
  - **`ui/controls.ts`:** `renderControls(snapshot, facility, store, net): HTMLElement | null`, `stateButton(state, onclick, cls?): HTMLElement[]`.
  - **`ui/panel.ts`:** `renderPanel(root, store, net)`.

- [ ] **Step 1: Write the failing tests**

`packages/viewer/test/panel-rules.test.ts`:

```ts
import type { FacilityView, LogView, Snapshot } from '@turing-city/core';
import { describe, expect, it } from 'vitest';
import {
  amountChoices,
  commButton,
  coolButton,
  dispatchAction,
  harvestButton,
  idleTrucks,
  installButton,
  logText,
  movedInPriority,
  processButton,
  rebuildButton,
  repairButton,
  sendButton,
  truckStatusLabel,
  tripChoices,
} from '../src/panel-rules.ts';

type Truck = Snapshot['trucks'][number];

const facility = (over: Partial<FacilityView>): FacilityView => ({
  id: 'DA',
  kind: 'datacenter',
  x: 5,
  y: 4,
  tier: 0,
  condition: 'ok',
  repairHoursLeft: null,
  powered: true,
  demand: 0,
  board: null,
  datacenter: { tempC: 30, processing: false, cooling: false },
  farm: null,
  warehouse: null,
  housing: null,
  ...over,
});
const withBoard = (status: NonNullable<FacilityView['board']>['status'] = 'running'): FacilityView['board'] => ({
  status,
  powered: true,
  hasFirmware: false,
  erroring: false,
});
const truck = (over: Partial<Truck>): Truck => ({ warehouse: 'W', id: 1, x: 11, y: 6, status: 'idle', load: 0, targetId: null, ...over });

/** The small town as the panel reads it: money, prices, two farms, a housing block, the warehouse and its trucks. */
const snapshotWith = (money: number, facilities: FacilityView[] = [], trucks: Truck[] = []): Snapshot =>
  ({
    money,
    prices: {
      board: { farm: 200, warehouse: 400, power: 400, datacenter: 600 },
      comm: 300,
      repair: { farm: 150, warehouse: 300, power: 300, datacenter: 500 },
      repairHours: 12,
      rebuild: 500,
      rebuildHours: 12,
    },
    facilities,
    trucks,
  }) as unknown as Snapshot;

describe('panel rules: the hardware', () => {
  it('offers a board at T0 for its price, and not to housing or a facility that has one', () => {
    expect(installButton(snapshotWith(5000), facility({}))).toEqual({ label: '보드 설치 (600)', disabled: false, reason: null });
    expect(installButton(snapshotWith(5000), facility({ kind: 'farm', datacenter: null }))?.label).toBe('보드 설치 (200)');
    expect(installButton(snapshotWith(5000), facility({ kind: 'housing', datacenter: null }))).toBeNull();
    expect(installButton(snapshotWith(5000), facility({ tier: 1, board: withBoard() }))).toBeNull();
  });

  it('disables the board with the reason: too little money, or a wrecked facility', () => {
    expect(installButton(snapshotWith(450), facility({}))).toEqual({
      label: '보드 설치 (600)',
      disabled: true,
      reason: '자금이 모자라요 (필요 600, 보유 450)',
    });
    expect(installButton(snapshotWith(5000), facility({ condition: 'wrecked' }))?.reason).toBe('시설이 부서져 있어요. 먼저 복구하세요.');
  });

  it('offers a comm module at T1 only, and not while the board is down', () => {
    expect(commButton(snapshotWith(5000), facility({ tier: 1, board: withBoard() }))).toEqual({
      label: '통신 모듈 (300)',
      disabled: false,
      reason: null,
    });
    expect(commButton(snapshotWith(5000), facility({}))).toBeNull(); // T0
    expect(commButton(snapshotWith(5000), facility({ tier: 2, board: withBoard() }))).toBeNull(); // T2 already
    expect(commButton(snapshotWith(5000), facility({ tier: 1, board: withBoard('rebuilding') }))?.reason).toBe('보드가 부서져 있어요.');
    expect(commButton(snapshotWith(100), facility({ tier: 1, board: withBoard() }))?.disabled).toBe(true);
  });

  it('offers the repair of a wrecked facility, then the rebuild of its board once it stands', () => {
    const wrecked = facility({ tier: 1, condition: 'wrecked', board: withBoard('destroyed') });
    expect(repairButton(snapshotWith(5000), wrecked)).toEqual({ label: '시설 복구 (500 · 12시간)', disabled: false, reason: null });
    expect(rebuildButton(snapshotWith(5000), wrecked)).toBeNull(); // the facility first
    const repaired = facility({ tier: 1, board: withBoard('destroyed') });
    expect(repairButton(snapshotWith(5000), repaired)).toBeNull();
    expect(rebuildButton(snapshotWith(5000), repaired)).toEqual({ label: '보드 재건 (500 · 12시간)', disabled: false, reason: null });
    expect(rebuildButton(snapshotWith(499), repaired)?.reason).toBe('자금이 모자라요 (필요 500, 보유 499)');
    expect(repairButton(snapshotWith(5000), facility({ condition: 'repairing' }))).toBeNull();
  });
});

describe('panel rules: the hand', () => {
  it('lets the farm harvest only a ripe crop, and nothing while the farm is wrecked', () => {
    const farm = (ripeness: number, ripe: boolean, condition: FacilityView['condition'] = 'ok') =>
      facility({ kind: 'farm', datacenter: null, condition, farm: { ripeness, ripe, outbox: 0 } });
    expect(harvestButton(farm(100, true))).toEqual({ label: '수확', disabled: false, reason: null });
    expect(harvestButton(farm(64, false))).toEqual({ label: '수확', disabled: true, reason: '아직 익지 않았어요 (64%)' });
    expect(harvestButton(farm(100, true, 'wrecked')).disabled).toBe(true);
  });

  it('lets the datacenter process at any press, and cool only between cycles', () => {
    expect(processButton(facility({}))).toEqual({ label: '처리', disabled: false, reason: null });
    expect(processButton(facility({ condition: 'repairing' })).disabled).toBe(true);
    expect(coolButton(facility({}))).toEqual({ label: '냉각', disabled: false, reason: null });
    expect(coolButton(facility({ datacenter: { tempC: 70, processing: true, cooling: true } }))).toEqual({
      label: '냉각 중…',
      disabled: true,
      reason: '냉각이 끝나면 다시 누를 수 있어요',
    });
  });

  it("moves a facility up or down the plant's supply order, and leaves the order alone at its ends", () => {
    const order = ['H1', 'H2', 'DA', 'W'];
    expect(movedInPriority(order, 'DA', -1)).toEqual(['H1', 'DA', 'H2', 'W']);
    expect(movedInPriority(order, 'DA', 1)).toEqual(['H1', 'H2', 'W', 'DA']);
    expect(movedInPriority(order, 'H1', -1)).toEqual(order);
    expect(movedInPriority(order, 'W', 1)).toEqual(order);
  });
});

describe('panel rules: the truck form', () => {
  const town = (stock: number, trucks: Truck[]) =>
    snapshotWith(
      5000,
      [
        facility({ id: 'H1', kind: 'housing', datacenter: null, housing: { food: 7, residents: 40, fed: true } }),
        facility({ id: 'W', kind: 'warehouse', datacenter: null, warehouse: { stock } }),
        facility({ id: 'F1', kind: 'farm', datacenter: null, farm: { ripeness: 10, ripe: false, outbox: 24 } }),
        facility({ id: 'F2', kind: 'farm', datacenter: null, farm: { ripeness: 90, ripe: false, outbox: 0 } }),
      ],
      trucks,
    );
  const warehouse = (s: Snapshot): FacilityView => s.facilities.find((f) => f.id === 'W')!;

  it('offers to collect from every farm and to deliver to every housing block, saying what each holds', () => {
    expect(tripChoices(town(31, []), 'W')).toEqual([
      { trip: { kind: 'collect', target: 'F1' }, label: 'F1에서 회수 (출고함 24)', available: 24 },
      { trip: { kind: 'collect', target: 'F2' }, label: 'F2에서 회수 (출고함 0)', available: 0 },
      { trip: { kind: 'deliver', target: 'H1' }, label: 'H1에 전달 (식량 7)', available: 31 },
    ]);
  });

  it('lists the idle trucks of the warehouse, and offers amounts by tens up to the capacity', () => {
    const s = town(0, [truck({ id: 1 }), truck({ id: 2, status: 'outbound', targetId: 'F1' }), truck({ warehouse: 'W2', id: 3 })]);
    expect(idleTrucks(s, 'W')).toEqual([1]);
    expect(amountChoices(40)).toEqual([10, 20, 30, 40]);
    expect(amountChoices(24)).toEqual([10, 20, 24]);
  });

  it('sends only a complete, possible trip, and says what is missing', () => {
    const s = town(0, [truck({ id: 1 }), truck({ id: 2, status: 'returning', targetId: 'F1' })]);
    const w = warehouse(s);
    const reason = (draft: Parameters<typeof sendButton>[2]) => sendButton(s, w, draft).reason;
    expect(reason({ truck: null, trip: null, amount: null })).toBe('트럭을 고르세요');
    expect(reason({ truck: 2, trip: null, amount: null })).toBe('2번 트럭은 지금 나가 있어요');
    expect(reason({ truck: 1, trip: null, amount: null })).toBe('어디로 갈지 고르세요');
    expect(reason({ truck: 1, trip: { kind: 'collect', target: 'F1' }, amount: null })).toBe('얼마나 실을지 고르세요');
    expect(reason({ truck: 1, trip: { kind: 'deliver', target: 'H1' }, amount: 20 })).toBe('창고에 보낼 식량이 없어요');
    expect(sendButton(s, w, { truck: 1, trip: { kind: 'collect', target: 'F1' }, amount: 20 })).toEqual({
      label: '보내기',
      disabled: false,
      reason: null,
    });
  });

  it('turns a complete form into the dispatch the core takes: from a farm to the warehouse, or from the warehouse to housing', () => {
    expect(dispatchAction({ truck: 1, trip: { kind: 'collect', target: 'F1' }, amount: 20 }, 'W')).toEqual({
      kind: 'dispatch',
      truck: 1,
      from: 'F1',
      to: 'W',
      amount: 20,
    });
    expect(dispatchAction({ truck: 2, trip: { kind: 'deliver', target: 'H1' }, amount: 40 }, 'W')).toEqual({
      kind: 'dispatch',
      truck: 2,
      from: 'W',
      to: 'H1',
      amount: 40,
    });
    expect(dispatchAction({ truck: 1, trip: null, amount: 20 }, 'W')).toBeNull();
  });

  it('says what a truck is doing', () => {
    expect(truckStatusLabel(truck({}))).toBe('1번 트럭: 대기');
    expect(truckStatusLabel(truck({ status: 'outbound', targetId: 'F1' }))).toBe('1번 트럭: F1(으)로 가는 중');
    expect(truckStatusLabel(truck({ status: 'returning', targetId: 'F1', load: 24 }))).toBe('1번 트럭: F1에서 돌아오는 중 · 24 실음');
  });
});

describe('panel rules: the log', () => {
  it('copies the log oldest first, one line each, as the panel shows it', () => {
    const line = (seconds: number, kind: LogView['kind'], text: string, repeat = 1): LogView =>
      ({ day: 1, clock: `00:0${seconds}`, seconds, kind, text, repeat }) as LogView;
    expect(logText([line(1, 'system', 'board installed'), line(2, 'log', 'temp 31'), line(3, 'error', 'runtime: boom', 4)])).toBe(
      '1일 00:01  [system] board installed\n1일 00:02  temp 31\n1일 00:03  [error] runtime: boom ×4',
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/viewer/test/panel-rules.test.ts`
Expected: FAIL: `../src/panel-rules.ts` does not exist.

- [ ] **Step 3: Write the panel's rules**

`packages/viewer/src/panel-rules.ts`:

```ts
import type { FacilityAction, FacilityView, LogView, Snapshot } from '@turing-city/core';
import { moneyLabel } from './format.ts';
import type { DispatchDraft, DispatchTrip } from './store.ts';

type Truck = Snapshot['trucks'][number];

/** What a button says, whether it can be pressed, and why not. */
export interface ButtonState {
  readonly label: string;
  readonly disabled: boolean;
  readonly reason: string | null;
}

const enabled = (label: string): ButtonState => ({ label, disabled: false, reason: null });
const disabled = (label: string, reason: string): ButtonState => ({ label, disabled: true, reason });
const shortOf = (need: number, have: number): string => `자금이 모자라요 (필요 ${moneyLabel(need)}, 보유 ${moneyLabel(have)})`;
const DOWN = '시설이 부서져 있어요. 먼저 복구하세요.';

/** A board for a facility at T0 (10-10 spec §4.1): its kind's price. Housing takes none. */
export function installButton(s: Snapshot, f: FacilityView): ButtonState | null {
  if (f.kind === 'housing' || f.board !== null) return null;
  const price = s.prices.board[f.kind];
  const label = `보드 설치 (${moneyLabel(price)})`;
  if (f.condition !== 'ok') return disabled(label, DOWN);
  if (s.money < price) return disabled(label, shortOf(price, s.money));
  return enabled(label);
}

/** A comm module for a board at T1, which lets an agent reach it (T2). A board that is down takes none. */
export function commButton(s: Snapshot, f: FacilityView): ButtonState | null {
  if (f.board === null || f.tier !== 1) return null;
  const label = `통신 모듈 (${moneyLabel(s.prices.comm)})`;
  if (f.condition !== 'ok' || f.board.status === 'destroyed' || f.board.status === 'rebuilding') return disabled(label, '보드가 부서져 있어요.');
  if (s.money < s.prices.comm) return disabled(label, shortOf(s.prices.comm, s.money));
  return enabled(label);
}

/** The repair of a wrecked facility: the first of the two payments that bring it back (10-10 spec §6). */
export function repairButton(s: Snapshot, f: FacilityView): ButtonState | null {
  if (f.condition !== 'wrecked' || f.kind === 'housing') return null;
  const cost = s.prices.repair[f.kind];
  const label = `시설 복구 (${moneyLabel(cost)} · ${s.prices.repairHours}시간)`;
  return s.money < cost ? disabled(label, shortOf(cost, s.money)) : enabled(label);
}

/** The rebuild of a destroyed board, once its facility stands again: the second payment. */
export function rebuildButton(s: Snapshot, f: FacilityView): ButtonState | null {
  if (f.condition !== 'ok' || f.board?.status !== 'destroyed') return null;
  const label = `보드 재건 (${moneyLabel(s.prices.rebuild)} · ${s.prices.rebuildHours}시간)`;
  return s.money < s.prices.rebuild ? disabled(label, shortOf(s.prices.rebuild, s.money)) : enabled(label);
}

export function harvestButton(f: FacilityView): ButtonState {
  if (f.condition !== 'ok') return disabled('수확', DOWN);
  if (!f.farm?.ripe) return disabled('수확', `아직 익지 않았어요 (${f.farm?.ripeness ?? 0}%)`);
  return enabled('수확');
}

/** Each press runs the datacenter for a short job; mashing it keeps it running (10-10 spec §4.3). */
export function processButton(f: FacilityView): ButtonState {
  return f.condition !== 'ok' ? disabled('처리', DOWN) : enabled('처리');
}

/** One cooling cycle at a time: a press during one would do nothing, so the button waits for its end. */
export function coolButton(f: FacilityView): ButtonState {
  if (f.condition !== 'ok') return disabled('냉각', DOWN);
  if (f.datacenter?.cooling) return disabled('냉각 중…', '냉각이 끝나면 다시 누를 수 있어요');
  return enabled('냉각');
}

/** A trip the form offers, with what its source holds now. */
export interface TripChoice {
  readonly trip: DispatchTrip;
  readonly label: string;
  readonly available: number;
}

/** Collect from each farm (its outbox), or deliver to each housing block (from the warehouse's stock), in the scenario's order. */
export function tripChoices(s: Snapshot, warehouseId: string): TripChoice[] {
  const stock = s.facilities.find((f) => f.id === warehouseId)?.warehouse?.stock ?? 0;
  const choices: TripChoice[] = [];
  for (const f of s.facilities) {
    if (f.kind === 'farm') {
      const outbox = f.farm?.outbox ?? 0;
      choices.push({ trip: { kind: 'collect', target: f.id }, label: `${f.id}에서 회수 (출고함 ${outbox})`, available: outbox });
    }
  }
  for (const f of s.facilities) {
    if (f.kind === 'housing') {
      choices.push({ trip: { kind: 'deliver', target: f.id }, label: `${f.id}에 전달 (식량 ${f.housing?.food ?? 0})`, available: stock });
    }
  }
  return choices;
}

export function idleTrucks(s: Snapshot, warehouseId: string): number[] {
  return s.trucks.filter((t) => t.warehouse === warehouseId && t.status === 'idle').map((t) => t.id);
}

/** Loads by tens up to a truck's capacity. A truck takes what is there, so the largest choice empties an outbox. */
export function amountChoices(capacity: number): number[] {
  const out: number[] = [];
  for (let amount = 10; amount < capacity; amount += 10) out.push(amount);
  out.push(capacity);
  return out;
}

export function sendButton(s: Snapshot, w: FacilityView, draft: DispatchDraft): ButtonState {
  const label = '보내기';
  if (w.condition !== 'ok') return disabled(label, DOWN);
  if (draft.truck === null) return disabled(label, '트럭을 고르세요');
  if (!idleTrucks(s, w.id).includes(draft.truck)) return disabled(label, `${draft.truck}번 트럭은 지금 나가 있어요`);
  if (draft.trip === null) return disabled(label, '어디로 갈지 고르세요');
  if (draft.amount === null) return disabled(label, '얼마나 실을지 고르세요');
  if (draft.trip.kind === 'deliver' && (w.warehouse?.stock ?? 0) < 1) return disabled(label, '창고에 보낼 식량이 없어요');
  return enabled(label);
}

/** The core's dispatch for a complete form (contract §9): a collection goes from the farm to the warehouse, a delivery the other way. */
export function dispatchAction(draft: DispatchDraft, warehouseId: string): FacilityAction | null {
  if (draft.truck === null || draft.trip === null || draft.amount === null) return null;
  const { kind, target } = draft.trip;
  return kind === 'collect'
    ? { kind: 'dispatch', truck: draft.truck, from: target, to: warehouseId, amount: draft.amount }
    : { kind: 'dispatch', truck: draft.truck, from: warehouseId, to: target, amount: draft.amount };
}

export function truckStatusLabel(t: Truck): string {
  const load = t.load > 0 ? ` · ${t.load} 실음` : '';
  if (t.status === 'outbound') return `${t.id}번 트럭: ${t.targetId}(으)로 가는 중${load}`;
  if (t.status === 'returning') return `${t.id}번 트럭: ${t.targetId}에서 돌아오는 중${load}`;
  return `${t.id}번 트럭: 대기${load}`;
}

/** The plant's supply order with one facility moved up (-1) or down (1); at either end, the order as it was. */
export function movedInPriority(order: readonly string[], id: string, delta: -1 | 1): string[] {
  const next = [...order];
  const i = next.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= next.length) return next;
  next[i] = next[j]!;
  next[j] = id;
  return next;
}

/** A board's log as [로그 복사] copies it: oldest first, one line each, the way the panel shows it. */
export function logText(logs: readonly LogView[]): string {
  return logs.map((l) => `${l.day}일 ${l.clock}  ${l.kind === 'log' ? '' : `[${l.kind}] `}${l.text}${l.repeat > 1 ? ` ×${l.repeat}` : ''}`).join('\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/viewer/test/panel-rules.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Write the controls and the panel**

`packages/viewer/src/ui/controls.ts`:

```ts
import type { FacilityAction, FacilityView, Snapshot } from '@turing-city/core';
import { el } from '../dom.ts';
import type { Connection } from '../net.ts';
import {
  amountChoices,
  type ButtonState,
  coolButton,
  dispatchAction,
  harvestButton,
  movedInPriority,
  processButton,
  sendButton,
  truckStatusLabel,
  tripChoices,
} from '../panel-rules.ts';
import type { Store } from '../store.ts';

/** A button from its state: disabled with its reason as the tooltip, and the reason on a line under it. */
export function stateButton(state: ButtonState, onclick: () => void, cls = ''): HTMLElement[] {
  const button = el('button', { class: cls, disabled: state.disabled, title: state.reason ?? '', onclick }, [state.label]);
  return state.reason ? [button, el('p', { class: 'dim reason' }, [state.reason])] : [button];
}

const choice = (label: string, on: boolean, onclick: () => void, off = false): HTMLElement =>
  el('button', { class: on ? 'on' : '', disabled: off, onclick }, [label]);

/** The plant: the thermal output on a slider (sent when the player lets go), and the supply order with ↑ and ↓. */
function plantControls(s: Snapshot, f: FacilityView, net: Connection): HTMLElement[] {
  const shown = el('b', {}, [String(s.plant.thermal)]);
  const slider = el('input', { type: 'range', min: '0', max: String(s.plant.thermalMax), step: '10', value: String(s.plant.thermal) });
  // While the pointer drags it, the page holds its renders; the number follows the thumb, and the server hears the value on release.
  slider.addEventListener('input', () => {
    shown.textContent = slider.value;
  });
  slider.addEventListener('change', () =>
    net.send({ type: 'hand', facility: f.id, action: { kind: 'setThermal', output: Number(slider.value) } }),
  );
  const order = s.plant.priority;
  const rows = order.map((id, i) =>
    el('div', { class: 'prio-row' }, [
      el('span', {}, [`${i + 1}. ${id}`]),
      el('span', { class: s.plant.shed.includes(id) ? 'dim' : 'ok' }, [s.plant.shed.includes(id) ? '○ 정전' : '● 공급']),
      el(
        'button',
        { disabled: i === 0, onclick: () => net.send({ type: 'hand', facility: f.id, action: { kind: 'setPriority', order: movedInPriority(order, id, -1) } }) },
        ['↑'],
      ),
      el(
        'button',
        {
          disabled: i === order.length - 1,
          onclick: () => net.send({ type: 'hand', facility: f.id, action: { kind: 'setPriority', order: movedInPriority(order, id, 1) } }),
        },
        ['↓'],
      ),
    ]),
  );
  return [
    el('div', { class: 'thermal' }, ['화력 ', shown, ` / ${s.plant.thermalMax}`, slider]),
    el('div', { class: 'label' }, ['공급 순서 (전력이 모자라면 아래부터 끊겨요)']),
    ...rows,
  ];
}

/** The warehouse: its trucks, and a form that picks a truck, a trip, and an amount from buttons that survive the page's renders. */
function warehouseControls(s: Snapshot, f: FacilityView, store: Store, net: Connection): HTMLElement[] {
  const draft = store.dispatchDraft;
  const trucks = s.trucks.filter((t) => t.warehouse === f.id);
  const capacity = store.scenario?.tuning.warehouse.truckCapacity ?? 40;
  const send = () => {
    const action = dispatchAction(draft, f.id);
    if (!action) return;
    net.send({ type: 'hand', facility: f.id, action });
    store.setDispatchDraft({ truck: null });
  };
  return [
    ...trucks.map((t) => el('div', { class: 'dim' }, [truckStatusLabel(t)])),
    el('div', { class: 'label' }, ['트럭 보내기']),
    el(
      'div',
      { class: 'choices' },
      trucks.map((t) => choice(`${t.id}번 트럭`, draft.truck === t.id, () => store.setDispatchDraft({ truck: t.id }), t.status !== 'idle')),
    ),
    el(
      'div',
      { class: 'choices' },
      tripChoices(s, f.id).map((c) =>
        choice(c.label, draft.trip?.kind === c.trip.kind && draft.trip.target === c.trip.target, () => store.setDispatchDraft({ trip: c.trip })),
      ),
    ),
    el(
      'div',
      { class: 'choices' },
      amountChoices(capacity).map((a) => choice(String(a), draft.amount === a, () => store.setDispatchDraft({ amount: a }))),
    ),
    ...stateButton(sendButton(s, f, draft), send, 'primary'),
  ];
}

/** The hand controls of a standing facility (10-10 spec §4.3); null for a kind that has none (housing). */
export function renderControls(s: Snapshot, f: FacilityView, store: Store, net: Connection): HTMLElement | null {
  const hand = (action: FacilityAction) => net.send({ type: 'hand', facility: f.id, action });
  let children: HTMLElement[];
  if (f.kind === 'farm') children = stateButton(harvestButton(f), () => hand({ kind: 'harvest' }), 'primary');
  else if (f.kind === 'datacenter')
    children = [
      el('div', { class: 'choices' }, [
        ...stateButton(processButton(f), () => hand({ kind: 'process' }), 'primary'),
        ...stateButton(coolButton(f), () => hand({ kind: 'cool' })),
      ]),
    ];
  else if (f.kind === 'power') children = plantControls(s, f, net);
  else if (f.kind === 'warehouse') children = warehouseControls(s, f, store, net);
  else return null;
  return el('div', { class: 'controls' }, children);
}
```

`packages/viewer/src/ui/panel.ts` (whole file):

```ts
import type { FacilityView, Snapshot } from '@turing-city/core';
import { clear, el } from '../dom.ts';
import { CONDITION_LABELS, firmwareLabel, KIND_LABELS, LED_LABELS, ledOf, sensorLabel, TIER_LABELS } from '../format.ts';
import type { Connection } from '../net.ts';
import { commButton, installButton, logText, rebuildButton, repairButton } from '../panel-rules.ts';
import type { Store } from '../store.ts';
import { renderControls, stateButton } from './controls.ts';

const section = (label: string, ...children: Array<Node | string>): HTMLElement =>
  el('div', { class: 'sec' }, [el('div', { class: 'label' }, [label]), ...children]);

const kv = (pairs: Array<[string, string]>): HTMLElement =>
  el(
    'div',
    { class: 'kv' },
    pairs.flatMap(([k, v]) => [el('span', { class: 'dim' }, [k]), el('span', {}, [v])]),
  );

const SCROLL_KEY = 'data-scroll';

/** The scroll offsets of the panel's scrollable blocks, by their keys. */
function scrollOffsets(root: HTMLElement): Map<string, number> {
  const offsets = new Map<string, number>();
  for (const pre of root.querySelectorAll<HTMLElement>(`pre[${SCROLL_KEY}]`))
    offsets.set(pre.getAttribute(SCROLL_KEY) ?? '', pre.scrollTop);
  return offsets;
}

/** What the snapshot says of a facility of each kind: the readings a player at T0 works from. */
function readings(s: Snapshot, f: FacilityView): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (f.kind === 'power') {
    rows.push(['풍력', String(s.plant.wind)], ['화력', `${s.plant.thermal} / ${s.plant.thermalMax}`]);
    rows.push(['연료비', `${s.plant.fuelPrice}/단위·일`], ['발전 / 수요', `${s.plant.generation} / ${s.plant.demand}`]);
  }
  if (f.datacenter) {
    rows.push(['온도', `${f.datacenter.tempC}°C`]);
    rows.push(['상태', [f.datacenter.processing ? '처리 중' : '대기', ...(f.datacenter.cooling ? ['냉각 중'] : [])].join(' · ')]);
  }
  if (f.farm) rows.push(['익음', `${f.farm.ripeness}%${f.farm.ripe ? ' (수확 가능)' : ''}`], ['출고함', String(f.farm.outbox)]);
  if (f.warehouse) rows.push(['재고', String(f.warehouse.stock)]);
  if (f.housing) {
    rows.push(['주민', `${f.housing.residents}명`], ['식량', String(f.housing.food)]);
    rows.push(['상태', `${f.housing.fed ? '먹음' : '굶주림'} · ${f.powered ? '전기 있음' : '정전'}`]);
  }
  if (f.kind !== 'power' && f.demand > 0) rows.push(['전력', `${f.demand} 사용${f.powered ? '' : ' (끊김)'}`]);
  return rows;
}

/** The facility's state in a word: its damage, its board's light, or that it runs by hand. */
function stateOf(f: FacilityView): HTMLElement {
  if (f.condition !== 'ok') return el('span', { class: 'bad' }, [`● ${CONDITION_LABELS[f.condition]}`]);
  const led = ledOf(f);
  if (led === null) return el('span', { class: 'dim' }, ['손으로 운영']);
  return el('span', { class: led === 'running' ? 'ok' : led === 'error' || led === 'destroyed' ? 'bad' : 'warn' }, [`● ${LED_LABELS[led]}`]);
}

export function renderPanel(root: HTMLElement, store: Store, net: Connection): void {
  // The panel is rebuilt on every change, so a block the player scrolled would jump back to its top: put each one back.
  const scrolled = scrollOffsets(root);
  clear(root);
  const s = store.snapshot;
  const f = s?.facilities.find((x) => x.id === store.selected);
  if (!s || !f) {
    root.append(el('p', { class: 'dim' }, ['시설을 클릭하면 여기에 정보가 떠요']));
    return;
  }
  const inspection = store.inspection?.board === f.id ? store.inspection.inspection : null;
  root.append(
    el('h2', {}, [`${KIND_LABELS[f.kind]} ${f.id}`]),
    el('div', {}, [
      el('span', { class: 'tier' }, [TIER_LABELS[f.tier]]),
      ' ',
      stateOf(f),
      f.board ? el('span', { class: 'dim' }, [` · ${firmwareLabel(inspection?.firmware?.version ?? null, inspection?.pending?.version ?? null)}`]) : '',
    ]),
  );

  // Damage first: a wrecked facility is repaired, then its board is rebuilt; each is paid for on its own (10-10 spec §6).
  const repair = repairButton(s, f);
  if (repair) root.append(section('피해', ...stateButton(repair, () => net.send({ type: 'repair', facility: f.id }), 'primary')));
  if (f.condition === 'repairing') root.append(section('피해', el('span', { class: 'warn' }, [`복구 중… (${f.repairHoursLeft ?? 0}시간 남음)`])));
  const rebuild = rebuildButton(s, f);
  if (rebuild) root.append(section('보드', ...stateButton(rebuild, () => net.send({ type: 'rebuild', board: f.id }), 'primary')));
  if (f.condition === 'ok' && f.board?.status === 'rebuilding') root.append(section('보드', el('span', { class: 'warn' }, ['재건 중…'])));

  root.append(section('현재', kv(readings(s, f))));
  const controls = f.condition === 'ok' ? renderControls(s, f, store, net) : null;
  if (controls) root.append(section('손으로', controls));

  const install = installButton(s, f);
  const comm = commButton(s, f);
  const hardware = [
    ...(install ? stateButton(install, () => net.send({ type: 'install', facility: f.id, part: 'board' })) : []),
    ...(comm ? stateButton(comm, () => net.send({ type: 'install', facility: f.id, part: 'comm' })) : []),
  ];
  if (hardware.length > 0) root.append(section('부품', ...hardware));

  if (f.kind !== 'housing') {
    root.append(
      el('div', { class: 'row' }, [
        el('button', { onclick: () => store.openManual(f.id) }, ['매뉴얼']),
        ...(f.board
          ? [
              el('button', { onclick: () => store.openEditor(f.id) }, ['편집']),
              el(
                'button',
                { disabled: !inspection, onclick: () => (inspection ? void navigator.clipboard.writeText(logText(inspection.logs)) : undefined) },
                ['로그 복사'],
              ),
            ]
          : []),
      ]),
    );
  }

  if (!f.board) return;
  if (!inspection) {
    root.append(el('p', { class: 'dim' }, ['불러오는 중…']));
    return;
  }
  const parts = inspection.parts;
  root.append(
    section(
      '보드 부품',
      kv([
        ['CPU', `${parts.clockHz}Hz · 틱당 ${parts.instructionsPerTick}명령`],
        ['RAM', `${Math.round(parts.ramBytes / 1024)}KB (사용 ${((parts.ramUsedBytes ?? 0) / 1024).toFixed(1)}KB)`],
        ['기본 전자파', String(inspection.baseEmfPerSecond)],
      ]),
    ),
    section('실시간 센서', kv(Object.entries(inspection.sensors).map(([k, v]): [string, string] => [k, sensorLabel(v)]))),
    section(
      '로그',
      el('pre', { [SCROLL_KEY]: `${f.id}/log` }, [
        [...inspection.logs]
          .reverse()
          .map((l) => `${l.day}일 ${l.clock}  ${l.kind === 'log' ? '' : `[${l.kind}] `}${l.text}${l.repeat > 1 ? ` ×${l.repeat}` : ''}`)
          .join('\n') || '(없음)',
      ]),
    ),
    // A deploy installs at the board's next tick, which for a board that is asleep or smashed is a while off: until then it shows here.
    ...(inspection.pending
      ? [
          section(
            `설치 대기 중인 펌웨어 v${inspection.pending.version} (읽기 전용)`,
            el('pre', { [SCROLL_KEY]: `${f.id}/pending` }, [inspection.pending.source]),
          ),
        ]
      : []),
    section(
      `펌웨어${inspection.firmware ? ` v${inspection.firmware.version}` : ''} (읽기 전용)`,
      el('pre', { [SCROLL_KEY]: `${f.id}/firmware` }, [inspection.firmware?.source ?? '(없음)']),
    ),
  );
  // Only now are the blocks in the page with a layout, which setting scrollTop needs. Another facility's blocks have other keys.
  for (const pre of root.querySelectorAll<HTMLElement>(`pre[${SCROLL_KEY}]`))
    pre.scrollTop = scrolled.get(pre.getAttribute(SCROLL_KEY) ?? '') ?? 0;
}
```

Append to `packages/viewer/src/style.css`:

```css
/* The panel's hand controls (10-10 spec §4.3). */
#panel .controls {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
#panel .choices {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
#panel .choices button {
  padding: 4px 8px;
}
#panel button.on {
  background: var(--accent);
  color: #fff;
}
#panel .reason {
  margin: 2px 0 0;
  font-size: 11px;
}
#panel .thermal input[type="range"] {
  width: 100%;
  margin-top: 4px;
}
#panel .prio-row {
  display: grid;
  grid-template-columns: 1fr 70px 28px 28px;
  gap: 4px;
  align-items: center;
}
#panel .prio-row button {
  padding: 1px 0;
}
```

- [ ] **Step 6: Run the checks and the build**

Run: `pnpm vitest run packages/viewer`
Expected: PASS: 47 from Task 17, 12 from Task 18, and panel-rules' 13.

Run: `pnpm --filter @turing-city/viewer build`
Expected: builds.

Run: `pnpm fix && pnpm check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/viewer
git commit -m "Viewer: the panel's hand controls, installs, repairs, and rebuilds"
```

---

### Task 20: Viewer: the manual window and the editor

The two windows of 10-10 spec §9 and §10.4. They open over the map: the manual on the left, the editor on the right, side by side when both are open.

**The manual window** shows the board's manual, or the index of every board slot followed by the common rules.
- It is rendered from the scenario that `hello` carried, with core's `boardManual` and `manualIndex` (Task 10), so its numbers are the scenario's.
- The markdown is the subset of contract §14, built with `el()` (text through `textContent`, never `innerHTML`).
- [마크다운 복사] puts the open document on the clipboard; [.md 다운로드] saves it as a file. Either way the player can hand it to an AI.

**The editor** is CodeMirror 6 with Lua highlighting (the design doc's tech stack).
- It opens on the board's draft, its pending firmware, its firmware, or a starting template.
- [배포] sends the code over `/ws` (Task 15's `deploy` command).
- The answer (`deployResult`) shows under the code:
  - a syntax error with its line ("2번째 줄: …");
  - or the version and when it installs, in Korean, from the board as the snapshot shows it. The server's `installsAt` words are English, for agents.

**The editor is built once per board and kept across renders.** A snapshot arrives about 20 times a second while the clock runs, and the page's renders rebuild the panel. Rebuilding the editor would throw away what the player types.

**The game's keys** (Space, 1-3, H) do nothing while the editor has focus: the keys go into the code.

**Escape** closes, in order:
1. the editor, keeping its text as a draft;
2. the manual;
3. the guide card;
4. then it clears the selection.

**Pure helpers.** The rules the windows show (the Korean of a deploy's answer, the file name, the starting template) and the markdown parser are pure functions, tested in Node. The DOM builders and the CodeMirror module are checked in headless Chrome by Task 21. The editor module stays out of the unit tests: `editor.ts` is imported only by `ui/editor-window.ts`, which no test imports.

**Files:**
- Create:
  - `packages/viewer/src/markdown.ts`
  - `packages/viewer/src/window-rules.ts`
  - `packages/viewer/src/editor.ts`
  - `packages/viewer/src/ui/manual-window.ts`
  - `packages/viewer/src/ui/editor-window.ts`
- Modify:
  - whole file: `packages/viewer/src/keys.ts`, `packages/viewer/src/main.ts`, `packages/viewer/index.html`
  - `packages/viewer/src/store.ts`: one method, `clearDeployResult()`
  - `packages/viewer/src/style.css`: append the windows' and the markdown's rules
  - `packages/viewer/package.json`: CodeMirror, through pnpm
- Test: `packages/viewer/test/markdown.test.ts`, `packages/viewer/test/window-rules.test.ts`

**Interfaces:**
- **Consumes:**
  - Task 17: `Store`'s `manualFor`, `editorFor`, `deployResult`, `editorDrafts`, `scenario`, `inspection`, `openManual`, `closeManual`, `closeEditor`, `closeGuide`; `KIND_LABELS`; `el`, `clear`.
  - Task 10: `boardManual(scenario, id)` and `manualIndex(scenario)`.
  - Task 15: `ViewerToServer`'s `deploy`, and `ServerToViewer`'s `deployResult`.
  - Task 10: `FacilityView` and `BoardInspection`.
  - `DeployOutcome` (milestone 1, unchanged).
- **Produces:**
  - **`markdown.ts`:** `Inline`, `Block`, `parseInline(text)`, `tableCells(line)`, `parseMarkdown(md): Block[]`, `renderMarkdown(md): DocumentFragment`.
  - **`window-rules.ts`:** `installsAtLabel(facility)`, `deployResultText(outcome, facility): { text; ok }`, `manualFileName(target)`, `starterFirmware(board)`.
  - **`editor.ts`:** `interface LuaEditor { getText(); setText(text); focus(); destroy() }` and `createLuaEditor(parent, doc)` (contract §17).
  - **The windows:** `ui/manual-window.ts`'s `renderManualWindow(root, store)` and `manualText(scenario, target)`; `ui/editor-window.ts`'s `renderEditorWindow(root, store, net)` and `closeEditorWindow(store)`.
  - **`Store.clearDeployResult()`.**
  - **Selectors** Task 21 reads:
    - `#manual-window`, `#editor-window`, `#editor-window .cm-content`, and `#editor-window .result`;
    - the buttons "마크다운 복사", ".md 다운로드", "배포", "매뉴얼", and "×".

- [ ] **Step 1: Add CodeMirror**

Run: `pnpm --filter @turing-city/viewer add --save-exact codemirror@6.0.2 @codemirror/language@6.13.1 @codemirror/legacy-modes@6.5.5 @codemirror/state@6.7.6 @codemirror/view@6.43.14`
Expected:
- the five packages are in `packages/viewer/package.json`'s `dependencies` at exactly these versions;
- `pnpm-lock.yaml` changes through pnpm, never by hand (the guard hook refuses hand edits).

- [ ] **Step 2: Write the failing tests**

`packages/viewer/test/markdown.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, tableCells } from '../src/markdown.ts';

describe('markdown: inline', () => {
  it('reads `code` and **bold** in text, and leaves the rest as text', () => {
    expect(parseInline('call `io.process()` **once** a tick')).toEqual([
      { kind: 'text', text: 'call ' },
      { kind: 'code', text: 'io.process()' },
      { kind: 'text', text: ' ' },
      { kind: 'bold', text: 'once' },
      { kind: 'text', text: ' a tick' },
    ]);
  });

  it('keeps everything inside a code span as it is, ** included', () => {
    expect(parseInline('`a ** b`')).toEqual([{ kind: 'code', text: 'a ** b' }]);
  });

  it('reads an unmatched marker as plain text', () => {
    expect(parseInline('a ` b')).toEqual([{ kind: 'text', text: 'a ` b' }]);
    expect(parseInline('5 ** 2')).toEqual([{ kind: 'text', text: '5 ** 2' }]);
  });
});

describe('markdown: blocks', () => {
  it('reads the three heading levels, and joins the lines of a paragraph', () => {
    expect(parseMarkdown('# 공통 규칙\n## 틱\n### mem\n첫 줄\n둘째 줄\n\n다음 문단')).toEqual([
      { kind: 'heading', level: 1, inlines: [{ kind: 'text', text: '공통 규칙' }] },
      { kind: 'heading', level: 2, inlines: [{ kind: 'text', text: '틱' }] },
      { kind: 'heading', level: 3, inlines: [{ kind: 'text', text: 'mem' }] },
      { kind: 'paragraph', inlines: [{ kind: 'text', text: '첫 줄 둘째 줄' }] },
      { kind: 'paragraph', inlines: [{ kind: 'text', text: '다음 문단' }] },
    ]);
  });

  it('reads a list of "- " items', () => {
    expect(parseMarkdown('- `day`\n- clock')).toEqual([
      {
        kind: 'list',
        items: [[{ kind: 'code', text: 'day' }], [{ kind: 'text', text: 'clock' }]],
      },
    ]);
  });

  it('reads a pipe table with a header row, and an escaped pipe inside a cell', () => {
    const blocks = parseMarkdown('| 필드 | 뜻 |\n|---|---|\n| `temp` | 온도 |\n| a \\| b | c |');
    expect(blocks).toEqual([
      {
        kind: 'table',
        header: [[{ kind: 'text', text: '필드' }], [{ kind: 'text', text: '뜻' }]],
        rows: [
          [[{ kind: 'code', text: 'temp' }], [{ kind: 'text', text: '온도' }]],
          [[{ kind: 'text', text: 'a | b' }], [{ kind: 'text', text: 'c' }]],
        ],
      },
    ]);
    expect(tableCells('| a | b |')).toEqual(['a', 'b']);
  });

  it('reads a fenced code block as it is, markup and blank lines included', () => {
    expect(parseMarkdown('```lua\nfunction tick(io, mem)\n\n  -- **not bold**\nend\n```\nafter')).toEqual([
      { kind: 'code', lang: 'lua', text: 'function tick(io, mem)\n\n  -- **not bold**\nend' },
      { kind: 'paragraph', inlines: [{ kind: 'text', text: 'after' }] },
    ]);
  });

  it('reads a line that starts with a pipe but has no rule under it as a paragraph', () => {
    expect(parseMarkdown('| not a table')).toEqual([{ kind: 'paragraph', inlines: [{ kind: 'text', text: '| not a table' }] }]);
  });

  it('ends an unclosed code block at the end of the text', () => {
    expect(parseMarkdown('```\nx = 1')).toEqual([{ kind: 'code', lang: '', text: 'x = 1' }]);
  });
});
```

`packages/viewer/test/window-rules.test.ts`:

```ts
import type { FacilityView } from '@turing-city/core';
import { describe, expect, it } from 'vitest';
import { deployResultText, installsAtLabel, manualFileName, starterFirmware } from '../src/window-rules.ts';

const facility = (board: FacilityView['board'], condition: FacilityView['condition'] = 'ok'): FacilityView => ({
  id: 'DA',
  kind: 'datacenter',
  x: 5,
  y: 4,
  tier: 1,
  condition,
  repairHoursLeft: null,
  powered: true,
  demand: 0,
  board,
  datacenter: { tempC: 30, processing: false, cooling: false },
  farm: null,
  warehouse: null,
  housing: null,
});
const board = (status: NonNullable<FacilityView['board']>['status'], powered = true): FacilityView['board'] => ({
  status,
  powered,
  hasFirmware: true,
  erroring: false,
});

describe('window rules', () => {
  it('says in Korean when a deploy installs, from what the board is doing', () => {
    expect(installsAtLabel(facility(board('running')))).toBe('보드의 다음 틱에 설치돼요');
    expect(installsAtLabel(facility(board('running', false)))).toBe('전력이 돌아오면 설치돼요');
    expect(installsAtLabel(facility(board('asleep')))).toBe('보드가 깨어나면 설치돼요');
    expect(installsAtLabel(facility(board('asleep', false)))).toBe('보드가 깨어나고 전력이 돌아오면 설치돼요');
    expect(installsAtLabel(facility(board('destroyed')))).toBe('보드를 재건하면 설치돼요');
    expect(installsAtLabel(facility(board('rebuilding')))).toBe('재건이 끝나면 설치돼요');
    expect(installsAtLabel(facility(board('destroyed'), 'wrecked'))).toBe('시설을 복구하고 보드를 재건하면 설치돼요');
    expect(installsAtLabel(facility(null))).toBe('보드가 없어요');
    expect(installsAtLabel(undefined)).toBe('보드가 없어요');
  });

  it("shows an accepted deploy's version with when it installs, and a syntax error with its line", () => {
    const f = facility(board('running'));
    expect(deployResultText({ ok: true, version: 3, installsAt: "the board's next tick" }, f)).toEqual({
      text: 'v3 배포됨 · 보드의 다음 틱에 설치돼요',
      ok: true,
    });
    expect(deployResultText({ ok: false, error: "firmware:2: '(' expected near 'end'" }, f)).toEqual({
      text: "2번째 줄: '(' expected near 'end'",
      ok: false,
    });
    expect(deployResultText({ ok: false, error: 'something else' }, f)).toEqual({ text: 'something else', ok: false });
  });

  it("names the downloaded manual after its board, or the index's after the game", () => {
    expect(manualFileName('DA')).toBe('turing-city-manual-DA.md');
    expect(manualFileName('index')).toBe('turing-city-manual.md');
  });

  it('starts a board with no firmware from a tick function that does nothing, and points to the manual', () => {
    const text = starterFirmware('F1');
    expect(text).toContain('function tick(io, mem)');
    expect(text).toContain('F1');
    expect(text).toContain('[매뉴얼]');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run packages/viewer/test/markdown.test.ts packages/viewer/test/window-rules.test.ts`
Expected: FAIL: `../src/markdown.ts` and `../src/window-rules.ts` do not exist.

- [ ] **Step 4: Write the markdown and the window rules**

`packages/viewer/src/markdown.ts`:

```ts
import { el } from './dom.ts';

/** A run of text inside a block: plain, `code`, or **bold**. */
export interface Inline {
  readonly kind: 'text' | 'code' | 'bold';
  readonly text: string;
}

/** The blocks of the markdown the manual uses (contract §14), and nothing else. */
export type Block =
  | { readonly kind: 'heading'; readonly level: 1 | 2 | 3; readonly inlines: readonly Inline[] }
  | { readonly kind: 'paragraph'; readonly inlines: readonly Inline[] }
  | { readonly kind: 'list'; readonly items: ReadonlyArray<readonly Inline[]> }
  | { readonly kind: 'table'; readonly header: ReadonlyArray<readonly Inline[]>; readonly rows: ReadonlyArray<ReadonlyArray<readonly Inline[]>> }
  | { readonly kind: 'code'; readonly lang: string; readonly text: string };

const HEADING = /^(#{1,3}) (.*)$/;
const ITEM = /^- (.*)$/;
const FENCE = /^```(\w*)\s*$/;
const FENCE_END = /^```\s*$/;
const RULE = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/**
 * `code` spans and **bold** in a line of text. Whichever opens first and also closes wins; nothing inside a code span is markup, and
 * an unmatched marker is plain text.
 */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pushText = (t: string): void => {
    if (t === '') return;
    const last = out[out.length - 1];
    if (last?.kind === 'text') out[out.length - 1] = { kind: 'text', text: last.text + t };
    else out.push({ kind: 'text', text: t });
  };
  let rest = text;
  while (rest !== '') {
    const tick = rest.indexOf('`');
    const tickEnd = tick >= 0 ? rest.indexOf('`', tick + 1) : -1;
    const bold = rest.indexOf('**');
    const boldEnd = bold >= 0 ? rest.indexOf('**', bold + 2) : -1;
    const code = tickEnd > tick ? tick : -1;
    const strong = boldEnd > bold && bold >= 0 ? bold : -1;
    if (code >= 0 && (strong < 0 || code < strong)) {
      pushText(rest.slice(0, code));
      out.push({ kind: 'code', text: rest.slice(code + 1, tickEnd) });
      rest = rest.slice(tickEnd + 1);
    } else if (strong >= 0) {
      pushText(rest.slice(0, strong));
      out.push({ kind: 'bold', text: rest.slice(strong + 2, boldEnd) });
      rest = rest.slice(boldEnd + 2);
    } else {
      pushText(rest);
      rest = '';
    }
  }
  return out;
}

/** A table row's cells: split on the pipes that are not escaped (\|), with the outer ones dropped and each cell trimmed. */
export function tableCells(line: string): string[] {
  const body = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\' && body[i + 1] === '|') {
      cell += '|';
      i += 1;
    } else if (c === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += c;
    }
  }
  cells.push(cell.trim());
  return cells;
}

const isTableStart = (lines: readonly string[], i: number): boolean =>
  (lines[i] ?? '').trimStart().startsWith('|') && i + 1 < lines.length && RULE.test(lines[i + 1] ?? '');

const startsBlock = (lines: readonly string[], i: number): boolean => {
  const line = lines[i] ?? '';
  return FENCE.test(line) || HEADING.test(line) || ITEM.test(line) || isTableStart(lines, i);
};

export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE_END.test(lines[i] ?? '')) body.push(lines[i++] ?? '');
      i += 1; // the closing fence, or past the end
      blocks.push({ kind: 'code', lang: fence[1] ?? '', text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: (heading[1] ?? '#').length as 1 | 2 | 3, inlines: parseInline(heading[2] ?? '') });
      i += 1;
      continue;
    }
    if (ITEM.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && ITEM.test(lines[i] ?? '')) items.push(parseInline(ITEM.exec(lines[i++] ?? '')?.[1] ?? ''));
      blocks.push({ kind: 'list', items });
      continue;
    }
    if (isTableStart(lines, i)) {
      const header = tableCells(line).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && (lines[i] ?? '').trimStart().startsWith('|')) rows.push(tableCells(lines[i++] ?? '').map(parseInline));
      blocks.push({ kind: 'table', header, rows });
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && (paragraph.length === 0 || !startsBlock(lines, i))) {
      paragraph.push((lines[i++] ?? '').trim());
    }
    blocks.push({ kind: 'paragraph', inlines: parseInline(paragraph.join(' ')) });
  }
  return blocks;
}

function inlineNodes(inlines: readonly Inline[]): Array<Node | string> {
  return inlines.map((x) => (x.kind === 'text' ? x.text : x.kind === 'code' ? el('code', {}, [x.text]) : el('strong', {}, [x.text])));
}

/** The markdown as page elements, built with el(): every piece of text goes in as text, never as markup. */
export function renderMarkdown(md: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const b of parseMarkdown(md)) {
    switch (b.kind) {
      case 'heading':
        fragment.append(el(b.level === 1 ? 'h1' : b.level === 2 ? 'h2' : 'h3', {}, inlineNodes(b.inlines)));
        break;
      case 'paragraph':
        fragment.append(el('p', {}, inlineNodes(b.inlines)));
        break;
      case 'list':
        fragment.append(el('ul', {}, b.items.map((item) => el('li', {}, inlineNodes(item)))));
        break;
      case 'table':
        fragment.append(
          el('table', {}, [
            el('thead', {}, [el('tr', {}, b.header.map((cell) => el('th', {}, inlineNodes(cell))))]),
            el('tbody', {}, b.rows.map((row) => el('tr', {}, row.map((cell) => el('td', {}, inlineNodes(cell)))))),
          ]),
        );
        break;
      case 'code':
        fragment.append(el('pre', {}, [el('code', b.lang === '' ? {} : { class: `lang-${b.lang}` }, [b.text])]));
        break;
    }
  }
  return fragment;
}
```

A paragraph's first line is never the start of another block (the checks above it ruled that out). The loop condition `paragraph.length === 0 || …` makes that explicit, so a paragraph always takes at least one line and the parser always moves on.

`packages/viewer/src/window-rules.ts`:

```ts
import type { DeployOutcome, FacilityView } from '@turing-city/core';

/**
 * When a deploy installs, in Korean, from the board as the snapshot shows it. The server's own answer (installsAt) is English, for
 * agents; the same rule (a board ticks only when it stands, is awake, and has power) decides both.
 */
export function installsAtLabel(f: FacilityView | undefined): string {
  const b = f?.board;
  if (!f || !b) return '보드가 없어요';
  if (f.condition !== 'ok') return '시설을 복구하고 보드를 재건하면 설치돼요';
  switch (b.status) {
    case 'destroyed':
      return '보드를 재건하면 설치돼요';
    case 'rebuilding':
      return '재건이 끝나면 설치돼요';
    case 'asleep':
      return b.powered ? '보드가 깨어나면 설치돼요' : '보드가 깨어나고 전력이 돌아오면 설치돼요';
    case 'running':
      return b.powered ? '보드의 다음 틱에 설치돼요' : '전력이 돌아오면 설치돼요';
  }
}

/** The editor's line after a deploy: the version and when it installs, or Lua's syntax error with its line ("firmware:2: ..."). */
export function deployResultText(outcome: DeployOutcome, f: FacilityView | undefined): { text: string; ok: boolean } {
  if (outcome.ok) return { text: `v${outcome.version} 배포됨 · ${installsAtLabel(f)}`, ok: true };
  const syntax = /^firmware:(\d+):\s*([\s\S]*)$/.exec(outcome.error);
  return { text: syntax ? `${syntax[1]}번째 줄: ${syntax[2]}` : outcome.error, ok: false };
}

/** The file [.md 다운로드] saves. */
export function manualFileName(target: string | 'index'): string {
  return target === 'index' ? 'turing-city-manual.md' : `turing-city-manual-${target}.md`;
}

/** The firmware the editor starts from on a board that has none: a tick that does nothing, and where to read what it may do. */
export function starterFirmware(board: string): string {
  return `-- ${board} 보드의 펌웨어. 쓸 수 있는 io와 행동은 [매뉴얼]에 있어요.\nfunction tick(io, mem)\nend\n`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run packages/viewer/test/markdown.test.ts packages/viewer/test/window-rules.test.ts`
Expected: PASS (markdown 9, window rules 4).

- [ ] **Step 6: Write the editor and the windows**

`packages/viewer/src/editor.ts`:

```ts
import { StreamLanguage } from '@codemirror/language';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { EditorState } from '@codemirror/state';
import { basicSetup, EditorView } from 'codemirror';

/** What the editor window needs of the code editor. */
export interface LuaEditor {
  getText(): string;
  setText(text: string): void;
  focus(): void;
  destroy(): void;
}

/**
 * A light sheet for the code in the dark page: basicSetup's highlighting is made for a light background, and a second theme
 * package for a dark one would be one more dependency.
 */
const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '12px', backgroundColor: '#fbfbf8', color: '#1d232b' },
  '.cm-scroller': { fontFamily: 'ui-monospace, Menlo, monospace', lineHeight: '1.5' },
  '.cm-gutters': { backgroundColor: '#f0f0ea', color: '#8a8f96', border: 'none' },
  '&.cm-focused': { outline: 'none' },
});

/** CodeMirror 6 with Lua (a legacy stream mode), the usual editing keys, and long lines wrapped. */
export function createLuaEditor(parent: HTMLElement, doc: string): LuaEditor {
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc, extensions: [basicSetup, StreamLanguage.define(lua), theme, EditorView.lineWrapping] }),
  });
  return {
    getText: () => view.state.doc.toString(),
    setText: (text) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
```

`packages/viewer/src/ui/manual-window.ts`:

```ts
import { boardManual, manualIndex, type Scenario } from '@turing-city/core';
import { clear, el } from '../dom.ts';
import { KIND_LABELS } from '../format.ts';
import { renderMarkdown } from '../markdown.ts';
import type { Store } from '../store.ts';
import { manualFileName } from '../window-rules.ts';

/** What the window shows: built once per subject, since a manual is the scenario's and does not change with the snapshots. */
let mounted: string | null = null;

/** The markdown of the index, or of a board slot's manual (null for an unknown id or housing). */
export function manualText(scenario: Scenario, target: string | 'index'): string | null {
  return target === 'index' ? manualIndex(scenario) : boardManual(scenario, target);
}

/** Saves the text as a file, through a link the browser downloads and that is gone again at once. */
function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = el('a', { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 10-10 spec §9: the manual of a board, or the index of every board slot with the common rules. Nominally the player's guide to
 * writing the firmware themselves; copy and download hand it to an AI.
 */
export function renderManualWindow(root: HTMLElement, store: Store): void {
  const target = store.manualFor;
  const scenario = store.scenario;
  if (target === null || scenario === null) {
    if (mounted !== null) clear(root);
    mounted = null;
    root.hidden = true;
    return;
  }
  root.hidden = false;
  if (mounted === target) return;
  mounted = target;
  clear(root);
  const text = manualText(scenario, target) ?? '';
  const said = el('span', { class: 'dim' }, []);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      said.textContent = '복사했어요';
    } catch {
      said.textContent = '복사하지 못했어요. 다운로드를 써 보세요.';
    }
  };
  const slots = scenario.facilities.filter((f) => f.board !== null);
  root.append(
    el('header', {}, [
      el('b', {}, [target === 'index' ? '매뉴얼' : `${target} 보드 매뉴얼`]),
      el('button', { onclick: () => void copy() }, ['마크다운 복사']),
      el('button', { onclick: () => download(manualFileName(target), text) }, ['.md 다운로드']),
      said,
      el('button', { class: 'close', title: '닫기 (Esc)', onclick: () => store.closeManual() }, ['×']),
    ]),
    el('nav', {}, [
      el('button', { class: target === 'index' ? 'on' : '', onclick: () => store.openManual('index') }, ['목차']),
      ...slots.map((f) =>
        el('button', { class: target === f.id ? 'on' : '', onclick: () => store.openManual(f.id) }, [`${f.id} ${KIND_LABELS[f.kind]}`]),
      ),
    ]),
    el('div', { class: 'body md' }, [renderMarkdown(text)]),
  );
}
```

`packages/viewer/src/ui/editor-window.ts`:

```ts
import { clear, el } from '../dom.ts';
import { createLuaEditor, type LuaEditor } from '../editor.ts';
import type { Connection } from '../net.ts';
import type { Store } from '../store.ts';
import { deployResultText, starterFirmware } from '../window-rules.ts';

interface Mounted {
  readonly board: string;
  readonly host: HTMLElement;
  readonly result: HTMLElement;
  editor: LuaEditor | null;
}

/** The window as it is in the page. The editor lives across renders: a snapshot (20 a second) must never rebuild what the player types. */
let mounted: Mounted | null = null;

/** Closes the editor, keeping its text as the board's draft for when it opens again ([×] and Escape). */
export function closeEditorWindow(store: Store): void {
  store.closeEditor(mounted?.editor?.getText());
}

/** 10-10 spec §10.4: the board's firmware in CodeMirror, [배포], and the server's answer under it. */
export function renderEditorWindow(root: HTMLElement, store: Store, net: Connection): void {
  const board = store.editorFor;
  if (board === null) {
    mounted?.editor?.destroy();
    if (mounted !== null) clear(root);
    mounted = null;
    root.hidden = true;
    return;
  }
  root.hidden = false;
  if (mounted?.board !== board) {
    mounted?.editor?.destroy();
    clear(root);
    const host = el('div', { class: 'cm-host' }, [el('p', { class: 'dim' }, ['불러오는 중…'])]);
    const result = el('div', { class: 'result' }, []);
    const frame: Mounted = { board, host, result, editor: null };
    const deploy = (): void => {
      if (!frame.editor) return;
      store.clearDeployResult(); // the last answer is not about the code on screen any more
      result.textContent = '보내는 중…';
      result.className = 'result dim';
      net.send({ type: 'deploy', board, code: frame.editor.getText() });
    };
    root.append(
      el('header', {}, [
        el('b', {}, [`${board} 펌웨어`]),
        el('button', { class: 'primary', onclick: deploy }, ['배포']),
        el('button', { onclick: () => store.openManual(board) }, ['매뉴얼']),
        el('button', { class: 'close', title: '닫기', onclick: () => closeEditorWindow(store) }, ['×']),
      ]),
      host,
      result,
    );
    mounted = frame;
  }
  const m = mounted;
  if (!m) return;
  if (m.editor === null) {
    // The board's code comes with its inspection (asked twice a second for the selected board); a draft needs no wait.
    const draft = store.editorDrafts[board];
    const inspection = store.inspection?.board === board ? store.inspection.inspection : undefined;
    if (draft !== undefined || inspection !== undefined) {
      clear(m.host);
      m.editor = createLuaEditor(m.host, draft ?? inspection?.pending?.source ?? inspection?.firmware?.source ?? starterFirmware(board));
      m.editor.focus();
    }
  }
  const answer = store.deployResult?.board === board ? store.deployResult.outcome : null;
  if (answer) {
    const { text, ok } = deployResultText(
      answer,
      store.snapshot?.facilities.find((f) => f.id === board),
    );
    if (m.result.textContent !== text) {
      m.result.textContent = text;
      m.result.className = `result ${ok ? 'ok' : 'bad'}`;
    }
  }
}
```

In `packages/viewer/src/store.ts`, add this method after `closeEditor`:

```ts
  /** The editor sent a deploy: the last answer no longer describes the code on screen. */
  clearDeployResult(): void {
    this.deployResult = null;
    this.notify();
  }
```

- [ ] **Step 7: Wire the windows and the keys**

`packages/viewer/src/keys.ts` (whole file):

```ts
import type { Connection } from './net.ts';
import type { Store } from './store.ts';
import { closeEditorWindow } from './ui/editor-window.ts';

/** Whether the key goes to something the player types in: a form field, or the firmware editor (CodeMirror's content is editable). */
function typing(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof Element && target.closest('.cm-editor') !== null;
}

/**
 * Space pauses or plays, 1-3 set the speed, H toggles the heatmap. Escape closes what is open, nearest first (the editor, keeping
 * its text; the manual; the guide card), then clears the selection. None of them reach the game while the player types code.
 */
export function bindKeys(store: Store, net: Connection): void {
  window.addEventListener('keydown', (event) => {
    if (typing(event.target)) return;
    if (event.code === 'Space') event.preventDefault(); // else the page scrolls
    // A held key repeats keydown, and a held Space would flip pause and play at the repeat rate. With Cmd, Ctrl or Alt down a key is the
    // system's or the browser's shortcut (Cmd+H, Ctrl+1), not a command to the game.
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const state = store.status?.state;
    if (event.code === 'Space') {
      if (state === 'running') net.send({ type: 'pause' });
      else if (state === 'paused') net.send({ type: 'play' });
    } else if (event.key === '1' || event.key === '2' || event.key === '3') {
      net.send({ type: 'speed', speed: Number(event.key) as 1 | 2 | 3 });
    } else if (event.code === 'KeyH') {
      // By position, not by character: with the Korean input source on, Chrome reports this key as 'Process', and only its code is KeyH.
      store.toggleHeatmap();
    } else if (event.key === 'Escape') {
      if (store.editorFor !== null) closeEditorWindow(store);
      else if (store.manualFor !== null) store.closeManual();
      else if (store.guideOpen) store.closeGuide(false);
      else store.select(null);
    }
  });
}
```

In `packages/viewer/src/main.ts` (Task 17's file), add the two imports

```ts
import { renderEditorWindow } from './ui/editor-window.ts';
import { renderManualWindow } from './ui/manual-window.ts';
```

and, in `render()`, after `renderPanel($('#panel'), store, net);`, the two windows:

```ts
  renderManualWindow($('#manual-window'), store);
  renderEditorWindow($('#editor-window'), store, net);
```

`packages/viewer/index.html` (whole file): the windows go inside `#game`, over the map.

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>turing-city</title>
  </head>
  <body>
    <div id="start"></div>
    <div id="game" hidden>
      <header id="topbar"></header>
      <main>
        <section id="left">
          <div id="map"></div>
          <div id="feed"></div>
        </section>
        <aside id="panel"></aside>
      </main>
      <div id="windows">
        <div id="manual-window" class="window" hidden></div>
        <div id="editor-window" class="window" hidden></div>
      </div>
      <footer id="keys">스페이스 일시정지 · 1/2/3 배속 · H 히트맵 · Esc 닫기 · 시설 클릭 = 패널 · 알림 클릭 = 그 시설로</footer>
    </div>
    <div id="guide" hidden></div>
    <div id="overlay" hidden></div>
    <div id="notice" hidden></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

Append to `packages/viewer/src/style.css`:

```css
/* The manual and the editor (10-10 spec §10.4): over the map, the manual on the left and the editor on the right. The container lets
   clicks through where no window is, so the map stays usable beside a single open window. */
#windows {
  position: fixed;
  top: 40px;
  left: 0;
  right: 340px;
  bottom: 32px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 8px;
  pointer-events: none;
}
.window {
  pointer-events: auto;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
}
.window[hidden] {
  display: none;
}
#manual-window {
  grid-column: 1;
}
#editor-window {
  grid-column: 2;
}
.window header {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
}
.window header b {
  margin-right: auto;
  color: #fff;
}
.window header .close {
  padding: 2px 9px;
}
.window nav {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--line);
}
.window nav button {
  padding: 2px 8px;
}
.window nav button.on {
  background: var(--accent);
  color: #fff;
}
.window .body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px 14px;
}
.window .cm-host {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.window .result {
  padding: 7px 10px;
  border-top: 1px solid var(--line);
  min-height: 30px;
  white-space: pre-wrap;
}
/* The manual's markdown. */
.md h1 {
  font-size: 18px;
  margin: 4px 0 10px;
  color: #fff;
}
.md h2 {
  font-size: 15px;
  margin: 18px 0 6px;
  color: #fff;
}
.md h3 {
  font-size: 13px;
  margin: 14px 0 4px;
}
.md p,
.md li {
  line-height: 1.55;
}
.md table {
  border-collapse: collapse;
  margin: 6px 0 10px;
}
.md th,
.md td {
  border: 1px solid var(--line);
  padding: 3px 7px;
  text-align: left;
  vertical-align: top;
}
.md code {
  font:
    11px ui-monospace,
    Menlo,
    monospace;
  background: #0d1116;
  border-radius: 3px;
  padding: 0 3px;
}
.md pre {
  background: #0d1116;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 8px 10px;
  margin: 6px 0 10px;
}
.md pre code {
  background: none;
  padding: 0;
}
```

- [ ] **Step 8: Run the checks and the build**

Run: `pnpm vitest run packages/viewer`
Expected: PASS: 47 from Task 17, 12 from Task 18, 13 from Task 19, and markdown 9 plus window rules 4.

Run: `pnpm --filter @turing-city/viewer build`
Expected: builds. CodeMirror adds about 400 kB to the bundle; Phaser's chunk-size warning is fine.

Run: `pnpm fix && pnpm check`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/viewer pnpm-lock.yaml
git commit -m "Viewer: the board manual window and the firmware editor"
```

---

### Task 21: Headless screenshots for milestone 2

> **Corrections from assembling the plan (read first).**
> - Several checks read a paused page right after a hand action. They rely on decision D1 (Task 4): hand actions apply at once.


`pnpm shots` checks the early stage's screens in headless Chrome, against a real server in dev mode and a scripted agent (10-10 spec §13). It has been broken since Task 13. Milestone 1's scenes needed an agent to play, and read milestone 1's scenario and firmware. This task rewrites `packages/server/scripts/shots.ts` whole.

**What it keeps.** The structure and the helpers:
- `check`, `shot`, `waitUntil`, `centerOf`, `clickOn`;
- the pixel counter, and `bothPhases` for whatever blinks;
- the perf measurement;
- milestone 1's pointer-hold, scroll, key, feed, and toggle checks.

**What it covers now:**
- the start screen with no agent;
- the guide card: it shows when a season starts, can be ticked away (the browser keeps that), and opens again from [도움말];
- the town at T0: no boards, food and people in the top bar, power short;
- each hand control:
  - the plant's slider and supply order;
  - the datacenter's [처리], mashed, and a cooling cycle from [냉각];
  - a farm's [수확];
  - the truck form, collecting and then delivering, with the warehouse's routes drawn;
- installing a board, then a comm module, and the agent reaching the board only at T2;
- the manual window: the board's manual, its copy (read back from the clipboard) and its download (read back from the file), and the index;
- the editor:
  - a syntax error with its line;
  - an accepted deploy, with the feed saying the player made it;
  - the deploy waiting to install;
  - the game's keys going into the code;
  - a draft kept across close and open;
- the board's log copy, and an erroring board's light blinking;
- a raid, the facility wrecked, its repair, then its board's rebuild;
- a board too dear to install, money below zero, and bankruptcy;
- the end overlay, whose 새 시즌 needs no agent;
- the `agentLost` alert pausing the game;
- the server going away.

**How it drives the game.**
- **The player.** The player's actions are real clicks and keys in the page.
- **The scripted agent** uses only:
  - the T2 board tools (`deploy_firmware`, `get_datasheet`) and the town reads;
  - the dev tools for time and seasons (`dev_new_season`, `dev_run_until`, `dev_play`, `dev_pause`, `dev_set_speed`).
- **Time.** `dev_run_until` needs a paused game, so the script pauses before every run.
- **Waiting for an alert.** The script runs a second at a time until the alert comes. `dev_run_until`'s own alert goal ends at the end of a batch, up to 10 game seconds late, and by then the Luddites have walked 10 cells.
- **The raid.** It is made with the plant: a T2 board whose firmware acts on every tick. That makes the most EMF for its price, burns no fuel (it sets the thermal output to 0), and leaves nothing to overheat. The datacenter sleeps meanwhile, so the plant is the strongest target.

**Files:**
- Modify (whole file): `packages/server/scripts/shots.ts`
- Modify: `CLAUDE.md` (the `pnpm shots` line)

**Interfaces:**
- **Consumes:**
  - Tasks 17 to 20: the page, its selectors, and its Korean labels:
    - containers: `.start`, `#guide`, `#topbar`, `#feed`, `#panel`, `#overlay`, `#notice`;
    - panel parts: `#panel .prio-row`, `#panel .controls`, `#panel input[type=range]`;
    - windows: `#manual-window` (and its `.body`), `#editor-window`, `#editor-window .cm-content`, `#editor-window .result`;
    - `truckStatusLabel`'s and the buttons' texts.
  - Decision D1 (`reconcile.md`): a hand action applies at once, so a paused game shows it.
  - Task 13: no agent rule, the `agentLost` alert, and the default auto-pause.
  - Task 14: the T2 gate's words ("has no comm module"), `get_datasheet` as text, and the dev tools.
  - Task 15: `hello` with the scenario, the viewer's `deploy`, `hand`, `install`, and `repair`, and `deployResult`; `m2-town` as the server's default.
  - Task 10: `boardManual(scenario, id)`, the text that the copy, the download, and `get_datasheet` must all carry.
  - Task 1: `scenarios/m2-town.json`, whose positions, prices, and times the script reads rather than repeats.
- **Produces:** `pnpm shots`. It writes 20 PNGs to `scratch/shots/` and exits 1 on a failed check.

- [ ] **Step 1: Rewrite the screenshot script**

`packages/server/scripts/shots.ts` (whole file):

```ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { type BoardKind, boardManual, parseScenario } from '@turing-city/core';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/config.ts';
import { startGameServer } from '../src/game-server.ts';

/**
 * pnpm shots: the real viewer in headless Chrome, against a real server and a scripted agent. It writes screenshots to
 * scratch/shots, to be looked at, and runs the checks that need a browser. A failed check ends the run with exit code 1.
 *
 * The player's part is played in the page with real clicks and keys: the hand controls, installs, the manual, the editor, repairs
 * and rebuilds. The scripted agent uses the board tools a player's agent has at T2, and the dev tools for time and seasons.
 */
const out = 'scratch/shots';
/** The seasons the script starts itself, so that its numbers repeat from run to run. */
const SEED = 3;
/** The map's cell size in pixels: CELL in the viewer's map-scene.ts, which pulls in Phaser and cannot load here. */
const CELL = 34;
/** The server's own scenario (its default): the cells, the prices on the buttons, the times, and the manuals come from it. */
const scenario = parseScenario(JSON.parse(readFileSync('scenarios/m2-town.json', 'utf8')));
const tuning = scenario.tuning;
const cellOf = (id: string): readonly [number, number] => {
  const facility = scenario.facilities.find((f) => f.id === id);
  if (!facility) throw new Error(`no facility ${id} in the scenario`);
  return [facility.x, facility.y];
};
/** The facilities that take a board: every one but housing. */
const boardSlots = scenario.facilities.filter((f) => f.board !== null).map((f) => f.id);
/** Game seconds in the hours the buttons show (a repair, a rebuild). */
const hours = (seconds: number): number => Math.floor((seconds * 24) / scenario.time.secondsPerDay);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
// The copy buttons are checked on the clipboard, and the manual's download in its file.
const context = await browser.newContext({
  viewport: { width: 1320, height: 860 },
  permissions: ['clipboard-read', 'clipboard-write'],
  acceptDownloads: true,
});
const page = await context.newPage();

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` (${detail})`}\n`);
  if (!ok) failures.push(name);
}

const shot = async (name: string): Promise<void> => {
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, `${name}.png`) });
  process.stdout.write(`${out}/${name}.png\n`);
};

/** Polls until the condition holds or the time is up. */
async function waitUntil(condition: () => Promise<boolean>, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) return false;
    await page.waitForTimeout(40);
  }
  return true;
}

/**
 * The centre of the first element that matches the selector and holds the text (with exact, whose text is the text). It is read in
 * one turn of the page, so a re-render cannot make it stale, which a Playwright locator can (the page rebuilds its buttons about 20
 * times a second while the clock runs).
 */
function centerOf(selector: string, text = '', exact = false): Promise<{ x: number; y: number } | null> {
  return page.evaluate(
    ({ selector, text, exact }) => {
      const target = [...document.querySelectorAll(selector)].find((e) => {
        const content = e.textContent ?? '';
        return exact ? content === text : content.includes(text);
      });
      const r = target?.getBoundingClientRect();
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    },
    { selector, text, exact },
  );
}

/** A real mouse click on it, the way a player makes one; fails at once when it is not on the page. */
async function clickOn(selector: string, text = '', exact = false): Promise<void> {
  const at = await centerOf(selector, text, exact);
  if (!at) throw new Error(`nothing to click: ${selector} ${text}`);
  await page.mouse.click(at.x, at.y);
}

const textOf = (selector: string): Promise<string> => page.evaluate((s) => document.querySelector(s)?.textContent ?? '', selector);
const isShown = async (selector: string): Promise<boolean> => !(await page.locator(selector).isHidden());

/** The first button in the scope whose label starts with the text: its label, and whether it is disabled. Null when there is none. */
const buttonNamed = (scope: string, text: string): Promise<{ text: string; disabled: boolean } | null> =>
  page.evaluate(
    ({ scope, text }) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>(`${scope} button`)].find((b) =>
        (b.textContent ?? '').startsWith(text),
      );
      return button ? { text: button.textContent ?? '', disabled: button.disabled } : null;
    },
    { scope, text },
  );

/** What the page's clipboard holds (the context grants reading it). */
const clipboard = (): Promise<string> => page.evaluate(() => navigator.clipboard.readText());

/** How many snapshots the page's socket has received: proof that the page was being re-rendered during a press. */
let snapshotFrames = 0;
page.on('websocket', (ws) => {
  ws.on('framereceived', (frame) => {
    if (typeof frame.payload === 'string' && frame.payload.startsWith('{"type":"snapshot"')) snapshotFrames += 1;
  });
});

interface Agent {
  /** A tool's result, parsed (the tools answer JSON text); a tool error throws. */
  call(tool: string, args?: Record<string, unknown>): Promise<unknown>;
  /** A tool's result as it came: get_datasheet answers the manual as markdown, not JSON. A tool error throws. */
  text(tool: string, args?: Record<string, unknown>): Promise<string>;
  disconnect(): Promise<void>;
}
const agents: Agent[] = [];

/** An MCP client the way a player's agent connects: the token from the server's config, over HTTP. */
async function connectAgent(name: string): Promise<Agent> {
  const transport = new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${loadConfig(configDir).token}` } },
  });
  const client = new Client({ name, version: '0.0.1' });
  await client.connect(transport as Transport);
  let connected = true;
  const raw = async (tool: string, args: Record<string, unknown>): Promise<string> => {
    const result = (await client.callTool({ name: tool, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
    const text = result.content[0]?.text ?? '';
    if (result.isError) throw new Error(`${tool}: ${text}`);
    return text;
  };
  const agent: Agent = {
    call: async (tool, args = {}) => JSON.parse(await raw(tool, args)),
    text: (tool, args = {}) => raw(tool, args),
    async disconnect() {
      if (!connected) return;
      connected = false;
      await transport.terminateSession();
      await client.close();
    },
  };
  agents.push(agent);
  return agent;
}

interface Status {
  readonly time: { readonly seconds: number };
  readonly money: number;
  readonly power: { readonly generation: number; readonly demand: number };
  readonly food: { readonly warehouse: number; readonly housing: number };
  readonly ended: { readonly kind: string } | null;
  readonly run: { readonly paused: boolean; readonly speed: number };
}
interface BoardRow {
  readonly id: string;
  readonly kind: BoardKind;
  readonly tier: number;
  readonly condition: string;
  readonly board: { readonly status: string } | null;
}

/** What the browser computes for a CSS colour: the cascade has been applied, which a class name does not show. */
const computedColor = (css: string): Promise<string> =>
  page.evaluate((value) => {
    const probe = document.createElement('i');
    probe.style.color = value;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, css);

/** The computed colours of the numbers after "자금" and "전력" in the top bar. */
const topBarColors = (): Promise<{ money: string; power: string }> =>
  page.evaluate(() => {
    const numberAfter = (label: string): string => {
      const span = [...document.querySelectorAll('#topbar > span')].find((s) => s.textContent?.startsWith(label));
      const number = span?.querySelector('b');
      return number ? getComputedStyle(number).color : 'missing';
    };
    return { money: numberAfter('자금'), power: numberAfter('전력') };
  });

type Rgb = readonly [number, number, number];
interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
/** The map's red: the error light and the Luddites' path (LED_COLORS.error in the viewer's format.ts). */
const RED: Rgb = [0xff, 0x4d, 0x4d];
/** The trucks (TRUCK_COLOR in the viewer's map-scene.ts), and the map's ground under them. */
const TRUCK: Rgb = [0xff, 0x9f, 0x43];
const GROUND: Rgb = [0x14, 0x1a, 0x20];
const blend = (top: Rgb, under: Rgb, alpha: number): Rgb => [
  Math.round(alpha * top[0] + (1 - alpha) * under[0]),
  Math.round(alpha * top[1] + (1 - alpha) * under[1]),
  Math.round(alpha * top[2] + (1 - alpha) * under[2]),
];
/** An outbound truck's route: the trucks' colour at 0.9 opacity on the ground (map-scene.ts draws a returning leg fainter). */
const ROUTE = blend(TRUCK, GROUND, 0.9);

/** A second page, in a context of its own, that only decodes PNGs: the browser reads the pixels, so no image library is needed. */
const decoder = await (await browser.newContext()).newPage();

/** How many pixels of the PNG inside the rectangle are within the tolerance of the colour. */
function countPixels(png: Buffer, rect: Rect, rgb: Rgb, tolerance = 12): Promise<number> {
  return decoder.evaluate(
    async ({ base64, rect, rgb, tolerance }) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const canvas = new OffscreenCanvas(rect.width, rect.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('no 2d context');
      context.drawImage(bitmap, -rect.x, -rect.y);
      const { data } = context.getImageData(0, 0, rect.width, rect.height);
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (
          Math.abs(data[i]! - rgb[0]) <= tolerance &&
          Math.abs(data[i + 1]! - rgb[1]) <= tolerance &&
          Math.abs(data[i + 2]! - rgb[2]) <= tolerance
        )
          count += 1;
      }
      return count;
    },
    { base64: png.toString('base64'), rect, rgb, tolerance },
  );
}

/**
 * The map blinks every 450 ms, so one screenshot can catch only one phase. This takes screenshots until the colour's pixel count
 * inside the rectangle has differed by at least `minDifference` between two of them, and keeps the fullest as `-lit` and the
 * emptiest as `-dark`. The pixels of the screenshots decide, so the files hold the phases they are named for.
 */
async function bothPhases(name: string, what: string, rect: Rect, rgb: Rgb, minDifference: number): Promise<void> {
  const frames: Array<{ png: Buffer; count: number }> = [];
  const deadline = Date.now() + 3000; // more than three blink periods, so a blinking part shows both phases
  do {
    const png = await page.screenshot();
    frames.push({ png, count: await countPixels(png, rect, rgb) });
    const counts = frames.map((f) => f.count);
    if (Math.max(...counts) - Math.min(...counts) >= minDifference) break;
  } while (Date.now() < deadline);
  const lit = frames.reduce((a, b) => (b.count > a.count ? b : a));
  const dark = frames.reduce((a, b) => (b.count < a.count ? b : a));
  for (const [phase, frame] of [
    ['lit', lit],
    ['dark', dark],
  ] as const) {
    writeFileSync(join(out, `${name}-${phase}.png`), frame.png);
    process.stdout.write(`${out}/${name}-${phase}.png\n`);
  }
  check(
    `${what} blinks: lit in one screenshot, dark in another`,
    lit.count - dark.count >= minDifference,
    `${lit.count} pixels lit, ${dark.count} dark, ${frames.length} screenshots`,
  );
}

/**
 * A rough price of keeping up with the game, for a few seconds of the page as it is: the frame times seen by requestAnimationFrame,
 * and Chrome's own counters for the main thread's work and the JS heap. Headless Chrome draws Phaser's WebGL in software and
 * holds its frames to a 60 Hz cadence, so the frame times show dropped frames, not cost; the busy shares and the heap are the cost.
 */
async function measure(label: string, seconds: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const counters = async (): Promise<Record<string, number>> =>
    Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  await cdp.send('HeapProfiler.collectGarbage'); // so the first heap figure is what the page keeps, not what it has yet to sweep
  const start = await counters();
  const snapshotsBefore = snapshotFrames;
  const heapSamples: number[] = [];
  let measuring = true;
  const sampler = (async () => {
    while (measuring) {
      heapSamples.push((await counters()).JSHeapUsedSize ?? 0);
      await page.waitForTimeout(250);
    }
  })();
  const frames = await page.evaluate(
    (ms) =>
      new Promise<number[]>((resolve) => {
        const times: number[] = [];
        let last = performance.now();
        const end = last + ms;
        const tick = (now: number): void => {
          times.push(now - last);
          last = now;
          if (now < end) requestAnimationFrame(tick);
          else resolve(times);
        };
        requestAnimationFrame(tick);
      }),
    seconds * 1000,
  );
  measuring = false;
  await sampler;
  const snapshots = snapshotFrames - snapshotsBefore;
  await cdp.send('HeapProfiler.collectGarbage');
  const end = await counters();
  await cdp.detach();

  const ms = frames.slice(1).sort((a, b) => a - b); // the first interval includes the wait for the first frame
  if (ms.length === 0) throw new Error(`perf ${label}: the page drew no frame in ${seconds} s`);
  const at = (p: number): number => ms[Math.min(ms.length - 1, Math.floor(ms.length * p))] ?? 0;
  const span = (end.Timestamp ?? 0) - (start.Timestamp ?? 0);
  const share = (name: string): number => Math.round((100 * ((end[name] ?? 0) - (start[name] ?? 0))) / span);
  const mb = (bytes: number | undefined): string => ((bytes ?? 0) / 1e6).toFixed(1);
  process.stdout.write(
    `perf ${label}, ${seconds} s: ${ms.length} frames, frame ms p50 ${at(0.5).toFixed(1)} p95 ${at(0.95).toFixed(1)} max ${at(1).toFixed(1)}; ` +
      `${(snapshots / seconds).toFixed(1)} snapshots/s; main thread busy ${share('TaskDuration')}%, script ${share('ScriptDuration')}%, ` +
      `layout+style ${Math.round(share('LayoutDuration') + share('RecalcStyleDuration'))}%; ` +
      `JS heap ${mb(start.JSHeapUsedSize)} -> ${mb(end.JSHeapUsedSize)} MB after GC (peak ${mb(Math.max(...heapSamples))}); ` +
      `DOM nodes ${start.Nodes} -> ${end.Nodes}\n`,
  );
}

// The server and its config directory (it holds a token) are made last, just before the try that removes them: a Chrome that fails
// to launch, above, must not leave either behind.
const configDir = mkdtempSync(join(tmpdir(), 'tc-shots-'));
const server = await startGameServer({ port: 0, configDir, dev: true }).catch((error: unknown) => {
  rmSync(configDir, { recursive: true, force: true });
  throw error;
});
let serverClosed = false;
try {
  await page.goto(server.url);
  const BAD = await computedColor('var(--bad)');
  const WHITE = await computedColor('#fff');

  // ---- The start screen: an agent is optional (10-10 spec §8) ----
  check(
    '"시즌 시작" is enabled with no agent connected',
    await waitUntil(async () => (await buttonNamed('.start', '시즌 시작'))?.disabled === false),
  );
  check('the start screen offers an agent as optional', (await textOf('.start')).includes('에이전트 연결 (선택)'));
  await shot('1-start');

  // ---- The guide card (10-10 spec §10.2) ----
  await clickOn('.start button', '시즌 시작');
  check(
    'a season starts with no agent, and the guide card says what to do',
    await waitUntil(async () => (await isShown('#guide')) && (await textOf('#guide')).includes('이렇게 해요'), 5000),
  );
  await shot('2-guide');
  await clickOn('#guide button', '알겠어요');
  check('"알겠어요" closes the card', await waitUntil(async () => !(await isShown('#guide'))));

  // The scripted agent: game time run as fast as the server can while the game is paused, and seasons with a fixed seed.
  let agent: Agent = await connectAgent('shots');
  const status = async (): Promise<Status> => (await agent.call('get_status')) as Status;
  const boards = async (): Promise<BoardRow[]> => (await agent.call('list_boards')) as BoardRow[];
  const boardOf = async (id: string): Promise<BoardRow | undefined> => (await boards()).find((b) => b.id === id);
  const alertKinds = async (): Promise<string[]> =>
    ((await agent.call('get_alerts')) as { alerts: Array<{ kind: string }> }).alerts.map((a) => a.kind);
  /** Game time, as fast as the server runs it. The game must be paused. */
  const run = (seconds: number): Promise<unknown> => agent.call('dev_run_until', { seconds });
  /**
   * Runs a second at a time until an alert of the kind comes, for at most the seconds given. dev_run_until's own alert goal stops at
   * the end of a batch, up to 10 game seconds late, and the Luddites walk a cell a second.
   */
  const runUntilAlert = async (kind: string, maxSeconds: number): Promise<boolean> => {
    for (let s = 0; s < maxSeconds; s++) {
      await run(1);
      if ((await alertKinds()).includes(kind)) return true;
    }
    return false;
  };
  const clockLabel = (): Promise<string> => page.evaluate(() => document.querySelector('#topbar b')?.textContent ?? '');
  /**
   * A new season with the fixed seed, once the page shows it. The page knows that a season started from a snapshot at its first step
   * after one at a later step, so the season it replaces runs a second first.
   */
  const newSeason = async (): Promise<void> => {
    await run(1);
    await agent.call('dev_new_season', { seed: SEED });
    await page.waitForFunction(() => document.querySelector('#topbar b')?.textContent?.startsWith('1일차 00:00') === true);
  };
  /** Waits until the top bar shows the server's money and power, then checks the colours of those two numbers. */
  const expectTopBar = async (what: string, now: Status, money: string, power: string): Promise<void> => {
    await page.waitForFunction(
      ({ powerText, moneyText }) => {
        const text = document.querySelector('#topbar')?.textContent ?? '';
        return text.includes(powerText) && text.includes(moneyText);
      },
      { powerText: `${now.power.generation} / ${now.power.demand}`, moneyText: now.money.toLocaleString('en-US') },
    );
    const colors = await topBarColors();
    check(`${what}: the money is ${money === BAD ? 'red' : 'white'}`, colors.money === money, `computed ${colors.money}`);
    check(`${what}: the power is ${power === BAD ? 'red' : 'white'}`, colors.power === power, `computed ${colors.power}`);
  };

  await newSeason();
  check('the card shows again at the next season', await waitUntil(() => isShown('#guide')));
  await clickOn('#guide label', '다시 보지 않기');
  await clickOn('#guide button', '알겠어요');
  await newSeason();
  await page.waitForTimeout(800);
  check(
    'with "다시 보지 않기" ticked, the card stays away at the next season, and the browser keeps that',
    !(await isShown('#guide')) && (await page.evaluate(() => localStorage.getItem('turing-city:guide-dismissed'))) === '1',
  );
  await clickOn('#topbar button', '도움말');
  check('[도움말] opens the card again', await waitUntil(() => isShown('#guide')));
  await page.keyboard.press('Escape');
  check('Escape closes it', await waitUntil(async () => !(await isShown('#guide'))));

  // ---- The town at T0: every facility runs by hand, none has a board ----
  const map = await page.locator('#map canvas').boundingBox();
  if (!map) throw new Error('the map canvas is missing');
  const mapRect = { x: Math.round(map.x), y: Math.round(map.y), width: Math.round(map.width), height: Math.round(map.height) };
  /** Selects a facility with a click on its cell. The windows lie over the map, so none may be open. */
  const select = async (id: string, title: string): Promise<void> => {
    const [x, y] = cellOf(id);
    await page.mouse.click(map.x + x * CELL + CELL / 2, map.y + y * CELL + CELL / 2);
    if (!(await waitUntil(async () => (await textOf('#panel h2')) === title))) throw new Error(`the panel did not open ${title}`);
  };
  await run(1); // the power phase has run once
  const atT0 = await boards();
  check(
    'every facility that takes a board starts without one (T0)',
    atT0.length === boardSlots.length && atT0.every((b) => b.tier === 0 && b.board === null),
    atT0.map((b) => `${b.id}:T${b.tier}`).join(' '),
  );
  check(
    'the top bar shows the food and the people',
    await waitUntil(async () => {
      const bar = await textOf('#topbar');
      return bar.includes('식량') && bar.includes('인구');
    }),
  );
  const t0 = await status();
  await expectTopBar('the town at T0', t0, WHITE, t0.power.generation < t0.power.demand ? BAD : WHITE);
  await shot('3-town-t0');

  // ---- The plant by hand: the thermal slider, and the supply order (10-10 spec §4.3) ----
  await select('P', '발전소 P');
  const thermalMax = tuning.thermal.max;
  await page.locator('#panel input[type=range]').fill(String(thermalMax)); // sent on change, as when a drag is let go
  check(
    "the thermal slider sets the plant's output, and the paused game shows it at once",
    await waitUntil(async () => (await textOf('#topbar')).includes(`화력 ${thermalMax}`)),
    (await textOf('#topbar')).slice(0, 160),
  );
  /** A facility's place in the supply order, as the panel shows it (1 is supplied first), and the centre of its ↑. */
  const priorityRow = (id: string): Promise<{ rank: number; up: { x: number; y: number } | null }> =>
    page.evaluate((id) => {
      const rows = [...document.querySelectorAll('#panel .prio-row')];
      const index = rows.findIndex((r) => r.firstElementChild?.textContent?.endsWith(` ${id}`));
      const r = rows[index]?.querySelector('button')?.getBoundingClientRect();
      return { rank: index + 1, up: r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null };
    }, id);
  const startRank = (await priorityRow('DA')).rank;
  for (let k = 0; k < 10; k++) {
    const { rank, up } = await priorityRow('DA');
    if (rank <= 1 || !up) break;
    await page.mouse.click(up.x, up.y);
    await waitUntil(async () => (await priorityRow('DA')).rank === rank - 1);
  }
  check('↑ moves a facility up the supply order, to the top', startRank > 1 && (await priorityRow('DA')).rank === 1, `from ${startRank}`);

  // ---- The datacenter by hand: [처리] mashed, then a cooling cycle (10-10 spec §4.3) ----
  await select('DA', '데이터센터 DA');
  const tempOf = async (): Promise<number> => Number(/온도\s*(\d+)°C/.exec(await textOf('#panel'))?.[1] ?? Number.NaN);
  const cold = await tempOf();
  await agent.call('dev_play');
  let processing = false;
  for (let k = 0; k < 14; k++) {
    await clickOn('#panel button', '처리');
    await page.waitForTimeout(150);
    if ((await textOf('#panel')).includes('처리 중')) processing = true;
  }
  await agent.call('dev_pause');
  await page.waitForTimeout(300);
  const hot = await tempOf();
  check('mashing [처리] keeps the datacenter processing, and it heats up', processing && hot > cold, `${cold} -> ${hot} °C`);
  await run(1); // the last press's job ends
  await clickOn('#panel button', '냉각');
  check(
    '[냉각] starts a cycle, and the button waits for its end',
    await waitUntil(async () => {
      const button = await buttonNamed('#panel', '냉각');
      return button?.disabled === true && button.text === '냉각 중…';
    }),
    JSON.stringify(await buttonNamed('#panel', '냉각')),
  );
  await shot('4-datacenter-by-hand');
  await run(tuning.datacenter.coolingCycleMs / 1000 + 0.5);
  const cooled = await tempOf();
  check(
    'when the cycle ends, the button is back and the datacenter is cooler',
    (await waitUntil(async () => (await buttonNamed('#panel', '냉각'))?.disabled === false)) && cooled < hot,
    `${hot} -> ${cooled} °C`,
  );

  // ---- A board, then a comm module (10-10 spec §4.1, §8) ----
  const boardPrice = tuning.install.boardPrice.datacenter;
  const commPrice = tuning.install.commPrice;
  const beforeInstall = (await status()).money;
  check(
    'the board button shows its price',
    (await buttonNamed('#panel', '보드 설치'))?.text === `보드 설치 (${boardPrice.toLocaleString('en-US')})`,
    JSON.stringify(await buttonNamed('#panel', '보드 설치')),
  );
  await clickOn('#panel button', '보드 설치');
  check(
    '[보드 설치] puts a board in the datacenter (T1) for its price',
    (await waitUntil(async () => (await textOf('#panel')).includes('T1 보드'))) &&
      (await boardOf('DA'))?.tier === 1 &&
      (await status()).money === beforeInstall - boardPrice,
  );
  check('a new board has no firmware, and the panel says so', (await textOf('#panel')).includes('펌웨어 없음'));
  const refused = await agent.text('get_datasheet', { board: 'DA' }).then(
    () => 'answered',
    (error: unknown) => String(error),
  );
  check("the agent's board tools do not reach a board without a comm module", refused.includes('no comm module'), refused);
  await clickOn('#panel button', '통신 모듈');
  check(
    '[통신 모듈] mounts a comm module (T2) for its price',
    (await waitUntil(async () => (await textOf('#panel')).includes('T2 통신 모듈'))) &&
      (await boardOf('DA'))?.tier === 2 &&
      (await status()).money === beforeInstall - boardPrice - commPrice,
  );
  const manualDA = boardManual(scenario, 'DA') ?? '';
  check(
    "at T2 the agent reads the board's manual, the same text the player reads",
    manualDA !== '' && (await agent.text('get_datasheet', { board: 'DA' })) === manualDA,
  );
  await shot('5-installed');

  // ---- The manual: the board's, copied and downloaded, and the index (10-10 spec §9) ----
  await clickOn('#panel button', '매뉴얼');
  check(
    "[매뉴얼] opens the board's manual beside the map",
    await waitUntil(async () => (await isShown('#manual-window')) && (await textOf('#manual-window')).includes('DA 보드 매뉴얼')),
  );
  await clickOn('#manual-window button', '마크다운 복사');
  check(
    '[마크다운 복사] puts the whole manual on the clipboard, as markdown',
    await waitUntil(async () => (await clipboard()) === manualDA),
  );
  const [download] = await Promise.all([page.waitForEvent('download'), clickOn('#manual-window button', '.md 다운로드')]);
  const saved = readFileSync(await download.path(), 'utf8');
  check(
    '[.md 다운로드] saves the same text as a .md file',
    download.suggestedFilename() === 'turing-city-manual-DA.md' && saved === manualDA,
    download.suggestedFilename(),
  );
  await shot('6-manual');
  await clickOn('#topbar button', '매뉴얼');
  check(
    "the top bar's [매뉴얼] opens the index, which lists every board slot",
    await waitUntil(async () => {
      const text = await textOf('#manual-window .body');
      return text.includes('매뉴얼 목차') && boardSlots.every((id) => text.includes(id));
    }),
  );

  // ---- The editor: a syntax error, a deploy, the game's keys, a draft (10-10 spec §10.4) ----
  await clickOn('#panel button', '편집');
  const code = (): Promise<string> => textOf('#editor-window .cm-content');
  check(
    '[편집] opens the editor beside the manual, on a starting firmware',
    await waitUntil(async () => (await isShown('#editor-window')) && (await code()).includes('function tick(io, mem)')),
  );
  /** Replaces the editor's text the way a paste from an AI chat does: in one insertion, so that no bracket or indent is added. */
  const setCode = async (source: string): Promise<void> => {
    await clickOn('#editor-window .cm-content');
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText(source);
  };
  const result = (): Promise<string> => textOf('#editor-window .result');
  await setCode('function tick\nend\n');
  await clickOn('#editor-window button', '배포');
  check(
    'a deploy with a syntax error is refused, with the line it is on',
    await waitUntil(async () => (await result()).startsWith('2번째 줄')),
    await result(),
  );
  await shot('7-editor-syntax-error');
  // A board that counts its ticks in its log: no processing, so no heat, and a log that grows by a line a tick.
  const logging = 'function tick(io, mem)\n  mem.n = (mem.n or 0) + 1\n  io.log("tick", mem.n)\nend\n';
  await setCode(logging);
  await clickOn('#editor-window button', '배포');
  check(
    'a deploy from the editor is accepted, and says when it installs',
    await waitUntil(async () => (await result()).startsWith('v1 배포됨 · 보드의 다음 틱에 설치돼요')),
    await result(),
  );
  check(
    'the feed says the player deployed it',
    await waitUntil(async () => (await textOf('#feed')).includes('플레이어: DA에 펌웨어 v1 배포')),
  );
  check(
    'with the game paused, the panel shows the deploy waiting to install',
    await waitUntil(async () => (await textOf('#panel')).includes('설치 대기 v1')),
  );
  // The game's keys go into the code while the editor has the focus.
  await clickOn('#editor-window .cm-content');
  await page.keyboard.press('ControlOrMeta+End');
  const still = await status();
  for (const key of ['Space', '3', 'h']) await page.keyboard.press(key);
  await page.waitForTimeout(400);
  const after = await status();
  check(
    "the game's keys do nothing while the editor has the focus: they type into the code",
    after.run.paused === still.run.paused && after.run.speed === still.run.speed && (await code()).includes(' 3h'),
    `paused ${still.run.paused} -> ${after.run.paused}, speed ${still.run.speed} -> ${after.run.speed}`,
  );
  await clickOn('#editor-window button', '×');
  check('[×] closes the editor', await waitUntil(async () => !(await isShown('#editor-window'))));
  await clickOn('#panel button', '편집');
  check(
    'the editor opens again on the text it was closed with',
    await waitUntil(async () => (await code()).includes('io.log') && (await code()).includes(' 3h')),
  );
  // The editor survives a running game: snapshots arrive about 20 times a second, and the screens around it are rebuilt on each one.
  await clickOn('#editor-window .cm-content');
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('\n-- half-typed');
  await clickOn('#topbar button', '▶');
  await page.waitForTimeout(1500);
  check(
    'the editor keeps its text while the game runs',
    (await isShown('#editor-window')) && (await code()).includes('-- half-typed') && !(await status()).run.paused,
    await code(),
  );
  await clickOn('#topbar button', '⏸');
  await waitUntil(async () => (await status()).run.paused);
  await setCode(logging); // back to the code the board runs
  await clickOn('#panel h2'); // the focus leaves the editor, so the keys reach the game again
  await page.keyboard.press('Escape');
  check(
    'Escape closes the editor first, and leaves the manual open',
    await waitUntil(async () => !(await isShown('#editor-window')) && (await isShown('#manual-window'))),
  );
  await page.keyboard.press('Escape');
  check('the next Escape closes the manual', await waitUntil(async () => !(await isShown('#manual-window'))));

  // ---- The board at work: its log, and its light when its firmware fails ----
  await run(2);
  await clickOn('#panel button', '로그 복사');
  check(
    "[로그 복사] puts the board's log on the clipboard",
    await waitUntil(async () => (await clipboard()).includes('firmware v1 installed')),
  );
  await agent.call('deploy_firmware', { board: 'DA', code: 'function tick(io) local board = nil; return board.id end' });
  check(
    "the agent's deploy reaches the T2 board, and the feed says the agent made it",
    await waitUntil(async () => (await textOf('#feed')).includes('에이전트: DA에 펌웨어 v2 배포')),
  );
  await run(2);
  const [lx, ly] = cellOf('DA');
  // The light is a dot 5 px in from the top right corner of its cell; the rectangle is a little square around it.
  const light = { x: Math.round(map.x + (lx + 1) * CELL - 5 - 6), y: Math.round(map.y + ly * CELL + 5 - 6), width: 12, height: 12 };
  await bothPhases('8-board-error', "DA's light", light, RED, 20);
  await agent.call('deploy_firmware', { board: 'DA', code: logging });
  await run(1);

  // ---- The clock running: what the page's controls do while it redraws about 20 times a second ----
  await agent.call('dev_play');
  await waitUntil(async () => (await textOf('#topbar .speed button')) === '⏸');
  // A click is a press and a release on the same button; the page used to replace the button between the two.
  const pauseButton = await centerOf('#topbar .speed button');
  if (!pauseButton) throw new Error('the pause button is missing');
  await page.mouse.move(pauseButton.x, pauseButton.y);
  const before = snapshotFrames;
  await page.mouse.down();
  await page.waitForTimeout(300);
  const during = snapshotFrames - before;
  await page.mouse.up();
  const paused = await waitUntil(async () => (await status()).run.paused, 1500);
  check(
    'a press held across several snapshots still clicks the pause button',
    during >= 3 && paused,
    `${during} snapshots arrived during the press, paused: ${paused}`,
  );
  check(
    'the screen shows the pause once the pointer is up',
    await waitUntil(async () => (await textOf('#topbar .speed button')) === '▶', 1500),
  );
  await agent.call('dev_play');

  // A press whose release is lost must not freeze the screen: the page draws again at once.
  for (const lost of ['pointercancel', 'blur', 'contextmenu']) {
    await page.mouse.move(700, 800);
    await page.mouse.down();
    await page.evaluate((type) => window.dispatchEvent(new Event(type)), lost);
    const was = await clockLabel();
    check(
      `the screen draws again after ${lost}, though the release never came`,
      await waitUntil(async () => (await clockLabel()) !== was, 600),
    );
    await page.mouse.up();
  }

  // The panel is rebuilt with every snapshot: a block the player scrolled stays where it was.
  const scrollable = await page.evaluate(() => {
    const pre = document.querySelector<HTMLElement>('#panel pre');
    return pre ? pre.scrollHeight - pre.clientHeight : -1;
  });
  check('the panel log is long enough to scroll', scrollable > 150, `${scrollable} px to scroll`);
  await page.evaluate(() => {
    const pre = document.querySelector<HTMLElement>('#panel pre');
    if (pre) pre.scrollTop = 120;
  });
  const renders = snapshotFrames;
  await page.waitForTimeout(1200);
  const scrolledTo = await page.evaluate(() => document.querySelector<HTMLElement>('#panel pre')?.scrollTop ?? -1);
  check(
    'the panel log keeps its scroll position across re-renders',
    Math.abs(scrolledTo - 120) <= 1,
    `scrollTop ${scrolledTo} after ${snapshotFrames - renders} snapshots`,
  );

  // ---- What the page costs while the clock runs, with DA's panel open: the numbers go to the output, no limit is checked ----
  await agent.call('dev_pause');
  await measure('paused', 2);
  await agent.call('dev_play');
  await measure('1x', 4);
  await agent.call('dev_set_speed', { speed: 3 });
  await measure('3x', 4);
  await agent.call('dev_set_speed', { speed: 1 });

  // ---- The keys, the feed's click-to-jump and the auto-pause toggles, with the clock running ----
  // A key acts on the state the page last showed, so each press waits for the page to show the last one's result.
  const playButton = (): Promise<string> => textOf('#topbar .speed button');
  await page.keyboard.press('Space');
  check('Space pauses a running game', await waitUntil(async () => (await status()).run.paused && (await playButton()) === '▶'));
  await page.keyboard.press('Space');
  check('Space plays a paused game', await waitUntil(async () => !(await status()).run.paused && (await playButton()) === '⏸'));

  // A held key repeats keydown (repeat set), and the repeats come after the page has shown the first one's result: if they acted,
  // a held Space would flip pause and play at the repeat rate.
  await page.keyboard.down('Space');
  check('a held Space pauses a running game', await waitUntil(async () => (await status()).run.paused && (await playButton()) === '▶'));
  await page.keyboard.down('Space'); // the key repeating
  await page.waitForTimeout(300);
  check('the repeat of a held Space does not play again', (await status()).run.paused);
  // A Space left to the page would scroll it, and a held one would on every repeat.
  const repeatCancelled = await page.evaluate(() => {
    const repeat = new KeyboardEvent('keydown', { code: 'Space', key: ' ', repeat: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(repeat);
    return repeat.defaultPrevented;
  });
  check('the repeat of a held Space is kept from scrolling the page', repeatCancelled);
  await page.keyboard.up('Space');
  await page.keyboard.press('Space');
  check('Space plays again once it is released', await waitUntil(async () => !(await status()).run.paused && (await playButton()) === '⏸'));

  for (const speed of [3, 2, 1]) {
    await page.keyboard.press(String(speed));
    check(`${speed} sets the speed to ${speed}x`, await waitUntil(async () => (await status()).run.speed === speed));
  }

  // H toggles the heatmap; with the game paused the map holds still (nothing blinks: no Luddites, no failing board), so equal
  // screenshots mean the same picture.
  await agent.call('dev_pause');
  const mapShot = (): Promise<Buffer> => page.screenshot({ clip: { x: map.x, y: map.y, width: map.width, height: map.height } });
  const plain = await mapShot();
  /** Presses twice, and says whether the heatmap came on after the first press and was off again after the second. */
  const heatmapToggledBy = async (press: () => Promise<unknown>): Promise<boolean> => {
    await press();
    await page.waitForTimeout(300);
    const heated = await mapShot();
    await press();
    await page.waitForTimeout(300);
    return !plain.equals(heated) && plain.equals(await mapShot());
  };
  check('H shows the heatmap and hides it again', await heatmapToggledBy(() => page.keyboard.press('h')));
  // With the Korean input source on, Chrome reports the H key as 'Process': only its code says which key it was.
  const processedH = (): Promise<unknown> =>
    page.evaluate(() =>
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', code: 'KeyH', keyCode: 229, bubbles: true })),
    );
  check('H toggles the heatmap when it is reported as key "Process", code "KeyH"', await heatmapToggledBy(processedH));

  // With Cmd, Ctrl or Alt down a key is the system's or the browser's shortcut (Cmd+H, Ctrl+1), not a command to the game.
  for (const modifier of ['Meta', 'Control', 'Alt']) {
    await page.keyboard.down(modifier);
    await page.keyboard.press('3');
    await page.keyboard.press('h');
    await page.keyboard.up(modifier);
  }
  await page.waitForTimeout(300);
  check(
    'the speed and heatmap keys pressed with Cmd, Ctrl or Alt do nothing',
    (await status()).run.speed === 1 && plain.equals(await mapShot()),
  );
  await agent.call('dev_play');

  await page.keyboard.press('Escape');
  check('Escape clears the selection', await waitUntil(async () => (await textOf('#panel')).includes('시설을 클릭하면')));
  await clickOn('#feed .item', 'DA에 펌웨어');
  check('clicking a deploy in the feed selects its board', await waitUntil(async () => (await textOf('#panel h2')) === '데이터센터 DA'));

  const toggles = (): Promise<Array<[string, boolean]>> =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLInputElement>('#feed .toggles input')].map((box): [string, boolean] => [
        box.parentElement?.textContent?.trim() ?? '',
        box.checked,
      ]),
    );
  const flipped = (list: Array<[string, boolean]>, label: string): string =>
    JSON.stringify(list.map(([name, on]) => [name, name === label ? !on : on]));
  const untouched = await toggles();
  check(
    'the feed offers a toggle for a lost agent, on by default',
    untouched.some(([name, on]) => name === '에이전트 끊김' && on),
    JSON.stringify(untouched),
  );
  await clickOn('#feed .toggles label', '러다이트 접근');
  check(
    'clicking a toggle turns it, and only it, over',
    await waitUntil(async () => JSON.stringify(await toggles()) === flipped(untouched, '러다이트 접근')),
  );
  await page.waitForTimeout(600);
  check(
    "the toggle still holds after the page has redrawn from the server's status",
    JSON.stringify(await toggles()) === flipped(untouched, '러다이트 접근'),
  );
  await clickOn('#feed .toggles label', '러다이트 접근');
  check('clicking it again puts it back', await waitUntil(async () => JSON.stringify(await toggles()) === JSON.stringify(untouched)));
  await agent.call('dev_pause');

  // ---- A raid: the facility is wrecked, repaired, and its board rebuilt, each paid for on its own (10-10 spec §6) ----
  // The plant gets a T2 board whose firmware acts on every tick: machine labour is the loudest EMF for the money (10-10 spec §5), and
  // an output of 0 burns no fuel. The datacenter sleeps, so that the plant is the strongest target.
  await select('P', '발전소 P');
  await clickOn('#panel button', '보드 설치');
  await waitUntil(async () => (await textOf('#panel')).includes('T1 보드'));
  await clickOn('#panel button', '통신 모듈');
  check('the plant takes a board and a comm module too (T2)', await waitUntil(async () => (await boardOf('P'))?.tier === 2));
  await agent.call('deploy_firmware', { board: 'P', code: 'function tick(io) io.set_thermal(0) end' });
  await agent.call('deploy_firmware', { board: 'DA', code: 'function tick(io) io.sleep(40) end' });
  check(
    'a raid comes to the noisy plant',
    await runUntilAlert('raid', scenario.time.seasonDays * scenario.time.secondsPerDay),
    `at ${(await status()).time.seconds} s`,
  );
  await run(1); // a group picks its target on its first step
  await bothPhases('9-raid', "the Luddites' path", mapRect, RED, 100);
  check('the Luddites wreck a facility', await runUntilAlert('wrecked', 60));
  const wreckedRow = (await boards()).find((b) => b.condition === 'wrecked');
  check(
    'they wreck the noisy plant, and its board with it',
    wreckedRow?.id === 'P' && wreckedRow.board?.status === 'destroyed',
    JSON.stringify(wreckedRow),
  );
  const target = wreckedRow ?? { id: 'P', kind: 'power' as const };
  await waitUntil(async () => (await centerOf('#feed .item', '부서졌어요')) !== null); // the page draws what the server just announced a moment later
  await clickOn('#feed .item', '부서졌어요');
  const repairCost = tuning.repair.cost[target.kind];
  const repairLabel = `시설 복구 (${repairCost.toLocaleString('en-US')} · ${hours(tuning.repair.seconds)}시간)`;
  check(
    'the alert opens the wrecked facility, which offers its repair',
    await waitUntil(async () => (await buttonNamed('#panel', '시설 복구'))?.text === repairLabel),
    `wanted "${repairLabel}", got ${JSON.stringify(await buttonNamed('#panel', '시설 복구'))}`,
  );
  check(
    'a wrecked facility says so, and has no hand controls',
    (await textOf('#panel')).includes('● 부서짐') && (await page.locator('#panel .controls').count()) === 0,
  );
  await shot('10-wrecked');
  const beforeRepair = await status();
  await clickOn('#panel button', '시설 복구');
  check(
    'the repair starts at once and takes its cost, and no game time passes',
    (await waitUntil(async () => (await textOf('#panel')).includes('복구 중'))) &&
      (await status()).money === beforeRepair.money - repairCost &&
      (await status()).time.seconds === beforeRepair.time.seconds,
  );
  await shot('11-repairing');
  await run(tuning.repair.seconds + 1);
  const rebuildLabel = `보드 재건 (${tuning.rebuild.cost.toLocaleString('en-US')} · ${hours(tuning.rebuild.seconds)}시간)`;
  check(
    'once the facility stands, its board offers its rebuild, paid for on its own',
    await waitUntil(async () => {
      const button = await buttonNamed('#panel', '보드 재건');
      return button?.text === rebuildLabel && !button.disabled;
    }),
    `wanted "${rebuildLabel}", got ${JSON.stringify(await buttonNamed('#panel', '보드 재건'))}`,
  );
  check(
    'the repaired facility works by hand again, while its board still reads 파괴',
    (await page.locator('#panel .controls').count()) === 1 && (await textOf('#panel')).includes('● 파괴'),
  );
  await clickOn('#panel button', '보드 재건');
  check('the rebuild starts', await waitUntil(async () => (await textOf('#panel')).includes('재건 중')));
  await run(tuning.rebuild.seconds + 1);
  const rebuilt = await boardOf(target.id);
  check(
    'the board comes back with its comm module (T2)',
    rebuilt?.condition === 'ok' && rebuilt.tier === 2 && rebuilt.board?.status === 'running',
    JSON.stringify(rebuilt),
  );
  await shot('12-rebuilt');

  // ---- Food by hand: a harvest, a truck to collect it, and a truck to deliver it (10-10 spec §4.3, contract §9) ----
  await newSeason();
  await run(tuning.farm.ripenSeconds + 1);
  await select('F1', '밭 F1');
  check('a ripe farm offers [수확]', await waitUntil(async () => (await buttonNamed('#panel', '수확'))?.disabled === false));
  await clickOn('#panel button', '수확');
  const crop = Math.min(tuning.farm.yield, tuning.farm.outboxCapacity);
  check(
    '[수확] puts the crop in the outbox',
    await waitUntil(async () => /출고함\s*(\d+)/.exec(await textOf('#panel'))?.[1] === String(crop)),
    (await textOf('#panel')).slice(0, 160),
  );
  await select('W', '물류창고 W');
  const capacity = tuning.warehouse.truckCapacity;
  /** The truck form: truck 1, a trip, and the largest load, picked with its buttons, then [보내기]. */
  const send = async (trip: string): Promise<void> => {
    await clickOn('#panel button', '1번 트럭');
    await clickOn('#panel button', trip);
    await clickOn('#panel button', String(capacity), true); // exactly: a trip's label can hold the same number
    await waitUntil(async () => (await buttonNamed('#panel', '보내기'))?.disabled === false);
    await clickOn('#panel button', '보내기');
  };
  await send('F1에서 회수');
  check(
    'the truck form sends a truck to collect from the farm',
    await waitUntil(async () => (await textOf('#panel')).includes('1번 트럭: F1(으)로 가는 중')),
    (await textOf('#panel')).slice(0, 200),
  );
  await run(1);
  // The warehouse shows the routes its trucks are on; a farm no truck serves shows none.
  const routePixels = async (): Promise<number> => {
    await page.waitForTimeout(300); // the map draws on its next frame
    return countPixels(await page.screenshot(), mapRect, ROUTE);
  };
  const withRoute = await routePixels();
  await select('F2', '밭 F2');
  const withoutRoute = await routePixels();
  check(
    "the warehouse selected shows its truck's route, and a farm the truck does not serve does not",
    withRoute - withoutRoute >= 300,
    `${withRoute} route pixels with W selected, ${withoutRoute} with F2`,
  );
  await select('W', '물류창고 W');
  await shot('13-truck-out');
  const [fx, fy] = cellOf('F1');
  const [wx, wy] = cellOf('W');
  await run((2 * (Math.abs(fx - wx) + Math.abs(fy - wy))) / tuning.warehouse.truckCellsPerSecond); // out and back
  const collected = Math.min(crop, capacity);
  check(
    'the truck comes back, and the crop goes into the stock',
    await waitUntil(async () => Number(/재고\s*(\d+)/.exec(await textOf('#panel'))?.[1] ?? 0) >= collected - 1),
    (await textOf('#panel')).slice(0, 200),
  );
  await send('H1에 전달');
  check(
    'the truck form sends a truck to deliver to a housing block, with the stock aboard',
    await waitUntil(async () => (await textOf('#panel')).includes('1번 트럭: H1(으)로 가는 중')),
  );
  // The homes only eat, so their food goes up only when the truck unloads.
  let delivered = false;
  for (let k = 0; k < 60 && !delivered; k++) {
    const food = (await status()).food.housing;
    await run(0.5);
    delivered = (await status()).food.housing > food;
  }
  check('the truck unloads at the housing block: the homes have more food', delivered);
  check('then it turns back, empty', await waitUntil(async () => (await textOf('#panel')).includes('1번 트럭: H1에서 돌아오는 중')));

  // ---- Money running out: the most fuel, and nothing earning ----
  await newSeason();
  await select('P', '발전소 P');
  await page.locator('#panel input[type=range]').fill(String(thermalMax));
  const farmPrice = tuning.install.boardPrice.farm;
  for (let k = 0; k < 60 && (await status()).money >= farmPrice; k++) await run(5);
  await select('F1', '밭 F1');
  const poor = await status();
  check(
    'with too little money the board button is disabled, and the panel says why',
    await waitUntil(
      async () => (await buttonNamed('#panel', '보드 설치'))?.disabled === true && (await textOf('#panel')).includes('자금이 모자라요'),
    ),
    `money ${poor.money}, price ${farmPrice}: ${JSON.stringify(await buttonNamed('#panel', '보드 설치'))}`,
  );
  await shot('14-too-poor');
  for (let k = 0; k < 60 && (await status()).money >= 0; k++) await run(5);
  const broke = await status();
  check('the money is below zero and the season goes on', broke.money < 0 && broke.ended === null, `money ${broke.money}`);
  await expectTopBar('money below zero', broke, BAD, WHITE);
  await shot('15-money-below-zero');

  // ... and three days below zero end the season.
  await agent.call('dev_run_until', { alertKinds: ['seasonEnd'] });
  const over = await status();
  check('three days below zero end the season in bankruptcy', over.ended?.kind === 'bankrupt', JSON.stringify(over.ended));
  check('the season-end overlay names the ending', await waitUntil(async () => (await textOf('#overlay')).startsWith('파산')));
  const overlayText = await textOf('#overlay');
  check(
    'the season-end overlay shows the final money',
    overlayText.includes(`최종 자금 ${over.money.toLocaleString('en-US')}`),
    overlayText,
  );
  await shot('16-season-ended');
  await agent.disconnect();
  await page.waitForTimeout(600);
  check('with no agent the overlay\'s "새 시즌" is still enabled', (await buttonNamed('#overlay', '새 시즌'))?.disabled === false);
  await clickOn('#overlay button', '새 시즌');
  check(
    'the overlay\'s "새 시즌" starts a season with no agent',
    await waitUntil(async () => !(await isShown('#overlay')) && (await clockLabel()).startsWith('1일차 00:00'), 5000),
  );

  // ---- A lost agent: an alert, and the default auto-pause (10-10 spec §8) ----
  agent = await connectAgent('shots-2');
  await waitUntil(async () => (await textOf('#topbar')).includes('에이전트 연결 (shots-2)'));
  await agent.call('dev_play');
  await waitUntil(async () => (await textOf('#topbar .speed button')) === '⏸');
  await agent.disconnect();
  check(
    'an agent that drops raises an alert, and the game pauses by itself',
    await waitUntil(
      async () => (await textOf('#feed')).includes('에이전트 연결이 끊겼어요') && (await textOf('#topbar .speed button')) === '▶',
      8000,
    ),
  );
  await shot('17-agent-lost');
  await page.keyboard.press('Space');
  check('play goes on without an agent', await waitUntil(async () => (await textOf('#topbar .speed button')) === '⏸'));

  // ---- The server goes away with the game on the screen: the page says so ----
  serverClosed = true;
  await server.close();
  check(
    'the game screen says when the server is gone',
    await waitUntil(async () => (await textOf('#notice')).includes('게임 서버에 연결할 수 없어요'), 4000),
    `the notice says "${await textOf('#notice')}"`,
  );
  await shot('18-server-lost');
} finally {
  for (const agent of agents) await agent.disconnect().catch(() => undefined);
  await browser.close();
  if (!serverClosed) await server.close();
  rmSync(configDir, { recursive: true, force: true }); // the token it holds belongs to this run only
}
if (failures.length > 0) {
  process.stderr.write(`${failures.length} check(s) failed: ${failures.join('; ')}\n`);
  process.exitCode = 1;
}
```

- [ ] **Step 2: Typecheck and lint the script**

Run: `pnpm --filter @turing-city/server typecheck && pnpm lint`
Expected: no errors. The script is in the server's typecheck: its `tsconfig.json` includes `scripts`, with the `dom` lib for the code run in the page.

- [ ] **Step 3: Run it, and look at every screenshot**

Run: `pnpm shots`
Expected:
- exit 0, with every check line `ok` (about 100);
- the three perf lines printed;
- 20 PNGs in `scratch/shots/`.

Read each image, and write in the report what you saw:
1. **`1-start`:** "시즌 시작", the agent section saying it is optional, with the connect command.
2. **`2-guide`:** the card over the game: the goal, the hand controls, boards and the editor, the comm module, EMF, and the checkbox.
3. **`3-town-t0`:**
   - all nine facilities in their kinds' colours, with no lights and no tier marks;
   - captions under them: temperatures, ripeness, stock, food;
   - two trucks in W;
   - in the top bar, 식량, 인구, and the power in red (the wind alone does not cover the homes).
4. **`4-datacenter-by-hand`:**
   - DA's panel: its temperature, [처리], and [냉각 중…] disabled;
   - on the map, ❄ in DA's caption.
5. **`5-installed`:**
   - DA's panel at "T2 통신 모듈" with [매뉴얼], [편집], [로그 복사];
   - on the map, DA's T2 mark and its light.
6. **`6-manual`:** the manual window on the left half of the map: its header and buttons, the nav, the heading, the common rules, and the tables as tables.
7. **`7-editor-syntax-error`:** the editor on the right half, with Lua highlighting and "2번째 줄: …" in red under it, beside the manual.
8. **`8-board-error-lit` and `-dark`:** DA's light red in one and dark in the other.
9. **`9-raid-lit` and `-dark`:** the Luddites' red path to P in one and not in the other.
10. **`10-wrecked`:**
    - on the map, P dark with a red cross;
    - in the panel, "● 부서짐" and [시설 복구 (…)], with no slider.
11. **`11-repairing`:**
    - on the map, P hatched with "복구 중 N시간";
    - in the panel, "복구 중… (N시간 남음)".
12. **`12-rebuilt`:** P's light back, with its T2 mark.
13. **`13-truck-out`:** W selected, the orange route to F1, and truck 1 on it with its label.
14. **`14-too-poor`:** F1's panel with [보드 설치 (…)] disabled and "자금이 모자라요 (필요 …, 보유 …)" under it.
15. **`15-money-below-zero`:** the money red in the top bar.
16. **`16-season-ended`:** the overlay "파산" with the final money and [새 시즌].
17. **`17-agent-lost`:** the feed's "에이전트 연결이 끊겼어요", and the top bar showing ▶.
18. **`18-server-lost`:** the notice at the bottom.

**A check that fails because of the game's numbers.** Report it with the numbers; do not loosen the check. Two examples:
- no raid within the season: the plant's noise is too quiet for the rumour threshold;
- a datacenter that cools no lower: cooling is shed even with the plant at its maximum and the datacenter first in the supply order.

These are tuning findings for the user, as in Task 16.

- [ ] **Step 4: Update CLAUDE.md**

In `CLAUDE.md` ("Code and checks"), replace the `pnpm shots` line with this, using the number of checks and the time from Step 3's run:

```markdown
  - `pnpm shots`: drives the real viewer in headless Chrome against a real server (dev mode) and a scripted agent, through the early stage: the guide card, the hand controls, installs, the manual's copy and download, the editor, a raid with its repair and rebuild, the trucks, bankruptcy, and a lost agent. It runs about 100 checks and exits 1 on a failure, takes about 90 s, needs Google Chrome installed, and writes its screenshots to `scratch/shots/`.
```

- [ ] **Step 5: Run the project's checks**

Run: `pnpm fix && pnpm check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/scripts/shots.ts CLAUDE.md
git commit -m "pnpm shots: check the early stage's screens in headless Chrome"
```

Put the run's numbers in the message (checks, PNGs, and the time), and end it with the trailer lines the dispatch gives.

---

### Task 22: Milestone 2: docs and the playtest checklist

10-10 spec §13 and §14, step 8.
- **The docs follow the code.** The spec, CLAUDE.md, and the QA agent's definition come to describe what the code now does. The changes come from:
  - this plan's decisions: hand actions apply at once (D1), and the town's food and cooling numbers (D2);
  - the scenario's tuning keys;
  - the exact viewer commands.
- **The playtest checklist.** The user gets one for the early stage: what to try at T0, T1, and T2, and what to note.
- **The milestone-1 checklist** stays, as the record of that playtest, with a note on what milestone 2 removed.

**Files:**
- Modify: `docs/superpowers/specs/2026-10-10-early-stage-design.md` (§4.2, §4.3, §5, §6, §8, §10.3, §10.4, §11, §12, §13, §15)
- Modify: `CLAUDE.md` (the opening, the QA bullet under "Agents", the `pnpm start` line)
- Modify: `.claude/agents/qa-tester.md` (how players play now; the manual)
- Modify: `docs/playtests/2026-10-10-m1-checklist.md` (one note at the top)
- Create: `docs/playtests/<today>-m2-checklist.md` (today's date, `YYYY-MM-DD`)

**Interfaces:**
- **Consumes:**
  - everything before it;
  - Task 16's report (its tuning and its season runs);
  - Task 21's `pnpm shots` run (its check count and time, already in CLAUDE.md).
- **Produces:** the milestone-2 build, ready for the user's playtest.

- [ ] **Step 1: Read what the code now says, and see the docs disagree**

Print the tuning values the spec's §12 quotes, as the scenario holds them now (Task 16 may have tuned some):

```bash
node -e "const t = JSON.parse(require('fs').readFileSync('scenarios/m2-town.json', 'utf8')).tuning; console.log(JSON.stringify({ install: t.install, datacenter: t.datacenter, repair: t.repair, rebuild: t.rebuild, farm: t.farm, housing: t.housing, emf: t.emf }, null, 1))"
```

Expected: D2's values unless Task 16 changed them:
- `farm` with `ripenSeconds` 40, `rotSeconds` 20, `yield` 40, `outboxCapacity` 80;
- `datacenter.coolingPower` 250;
- `emf.rumourThreshold` 200000;
- `housing.startFood` 120.

Keep the output for Step 2.

Run the checks that the docs still use the old words:

```bash
grep -nE "jobSeconds|coolingCycleSeconds|coolingCycleDrop|coolingCyclePower|passiveCoolingPctPerSecond|processingEmfPerSecond|facilityRepair|next step's phase 5|action, args|along the roads" docs/superpowers/specs/2026-10-10-early-stage-design.md
grep -nw "commBaseEmf" docs/superpowers/specs/2026-10-10-early-stage-design.md
grep -n "Milestone 2 is redirected\|reads datasheets and logs" CLAUDE.md .claude/agents/qa-tester.md
```

Expected: each prints matches. Those lines are what Steps 2 and 3 change.

- [ ] **Step 2: Sync the 10-10 spec with the code**

In `docs/superpowers/specs/2026-10-10-early-stage-design.md`:

**§4.2.** Replace the first two bullets ("Manual controls stay at every tier" and "Settings belong to the facility") with:

```markdown
- **Manual controls stay at every tier.** A manual action is the same facility method a firmware action calls.
  - It applies at once, between steps, so a paused game shows its effect. A job or a cooling cycle started by hand covers the coming step; one that firmware starts in phase 5 of a step covers the step after.
  - It is recorded with the step it came before, like a deploy, so replays stay deterministic.
- **Settings belong to the facility.** These are the thermal output and the priority list. Whoever set one last wins, in real order: firmware that acts in the coming step wins over a hand action made before it.
```

**§4.3, §5, §6, and §12: the scenario's keys.** Rename each value to the key it has under the scenario's `tuning`, wherever it appears:

| The spec says | The scenario's key |
|---|---|
| `jobSeconds` | `datacenter.jobMs` |
| `coolingCycleSeconds` | `datacenter.coolingCycleMs` |
| `coolingCycleDrop` | `datacenter.coolingDropMilli` |
| `coolingCyclePower` | `datacenter.coolingPower` |
| `passiveCoolingPctPerSecond` | `datacenter.passiveCoolingPermillePerSecond` |
| `processingEmfPerSecond` | `emf.processingPerSecond` |
| `commBaseEmf` | `install.commBaseEmfPerSecond` |
| `facilityRepairCost` / `facilityRepairSeconds` | `repair.cost` / `repair.seconds` |

In §4.3's datacenter row, "It draws `datacenter.coolingPower` while it runs, far more than processing." becomes "It draws `datacenter.coolingPower` while it runs, more than processing."

**§6.** In step 1 of "What a wreck costs", "A repaired datacenter comes back at ambient temperature." becomes "A repaired datacenter comes back at ambient temperature, and a repaired farm replants its field."

**§8.** Replace the "Dev-only tools" bullet and its list with:

```markdown
- **Dev-only tools (10-09 §7.4) gain the player's hand,** so QA agents can play the human's part:
  - the manual actions: `dev_hand {facility, action}`;
  - installing a board or a comm module: `dev_install {facility, part}`;
  - repairing a wrecked facility: `dev_repair {facility}`, beside `dev_rebuild`.
```

**§10.3.** In the map's list, replace "trucks moving along the roads;" with:

```markdown
  - the trucks at their cells, moving along their row-then-column paths;
```

**§10.4.** Replace the line "It loads the board's firmware, or the pending one." with:

```markdown
  - It loads, in this order: the text it held when it was closed without an accepted deploy (kept until a deploy is accepted or a new season starts), the pending deploy, the board's firmware, or a starting `tick(io, mem)` for a board with none.
```

After the "Keys" bullet, add:

```markdown
- **Closing.** [×] closes a window, and so does Escape while the focus is outside the editor. Escape closes the nearest first: the editor (keeping its text), then the manual, then the guide card, and then it clears the selection.
```

**§11.** Replace the first bullet ("New viewer commands on `/ws`", its list, and the paragraph under it) with:

```markdown
- **New viewer commands on `/ws`:**
  - `deploy {board, code}`, answered to the viewer that sent it with `deployResult {board, outcome}`: the version and when it installs, or the syntax error with its line;
  - `hand {facility, action}`, where the action is the facility action as firmware asks for it, arguments included (for example `{kind: 'dispatch', truck, from, to, amount}`);
  - `install {facility, part: board | comm}`;
  - `repair {facility}`.

  They are checked with exact schemas like the others. A deploy goes through the same checks as an MCP deploy (64 KB, NUL, syntax) and the same queue. A message may weigh up to 512 KiB, since 64 KB of source can take 6 bytes a character in JSON. A refused command comes back to its viewer as an error with its refusal code.
- **`hello`** carries the scenario, from which the viewer renders the manuals.
```

**§12.** Replace the section's "New tuning values" bullet, its table, and the "Unchanged" bullet with the text below. Take the numbers from Step 1's output. Where the output differs from a number here (Task 16 may have tuned it), write the output's number, and add Task 16's reason to the "Changed" list.

```markdown
- **New tuning values** (starting values, to be tuned; they live in the scenario, under `tuning`):

| Value | Start |
|---|---|
| Board price (T1), `install.boardPrice` | farm 200, warehouse 400, power plant 400, datacenter 600 |
| Comm module price (T2), `install.commPrice` | 300 |
| Comm module base EMF, `install.commBaseEmfPerSecond` | +5 per second |
| Datacenter job per press or `process()`, `datacenter.jobMs` | 500 ms from that moment, no stacking |
| Cooling cycle, `datacenter.coolingCycleMs` / `coolingDropMilli` / `coolingPower` | 4 s / 15 °C over the cycle, about 15 presses of heat at +2 °C per second / 250 while it runs |
| Passive cooling, `datacenter.passiveCoolingPermillePerSecond` | 0.3% of (temperature − 25 °C) per second (10-09: 2%), so a datacenter left alone cools very slowly |
| Facility repair, `repair.cost` / `repair.seconds` | farm 150, warehouse 300, power plant 300, datacenter 500 / half a day (20 s); the board's rebuild after it is the 10-09 rebuild (500, half a day) |
| Datacenter processing EMF, `emf.processingPerSecond` | 50 per second of processing (what 10 per action at 5 Hz gave in milestone 1) |
| Food in a housing block at the start, `housing.startFood` | 120, three days of eating |

- **Changed from the 10-09 spec, so that the town can feed itself.** The 10-09 numbers grew 24 food a day against the 80 the homes eat.
  - Farms: `ripenSeconds` 40, a day (10-09: 120); `rotSeconds` 20 (40); `yield` 40 (24); `outboxCapacity` 80 (50).
  - `emf.rumourThreshold`: 200,000 (100,000).
  - The cooling cycle's power: 250 (this spec's first value was 400, more than the plant could give a datacenter beside the homes).
- **Unchanged.** Every other 10-09 tuning value stays as it is. Board upkeep applies to installed boards only.
```

**§13.** Replace the `pnpm shots` bullet and its list with:

```markdown
- **`pnpm shots`:**
  - the start screen with no agent, and the guide card: shown, ticked away, opened again;
  - each manual control:
    - the thermal slider and the supply order;
    - mashing [처리], and a cooling cycle from [냉각];
    - [수확];
    - the truck form, collecting and then delivering, with the warehouse's routes on the map;
  - installing a board and a comm module, and the agent reaching the board only at T2;
  - the manual window's copy and download, and the index;
  - the editor: typing, a syntax error, a deploy, and a draft kept across close and open;
  - the game's keys staying quiet while the editor has focus;
  - a raid, the facility wrecked, its repair, then its board's rebuild;
  - a board too dear, money below zero, bankruptcy, and a new season with no agent;
  - a lost agent's alert, and its auto-pause.
```

Then the last bullet of §13, "The user's playtest: a new checklist for this milestone.", becomes "**The user's playtest:** `docs/playtests/<today>-m2-checklist.md`."

**§15.** Task 16 may have stopped with NEEDS_CONTEXT, or tuned the town to let the careful set complete. If it did either, add a bullet under "The pace of the hand stage" on whether the town's economy leaves room for a careful season. Give Task 16's runs in it: each seed's ending and money for both sets, and the values Task 16 changed.

**The rest of the spec.** Read §4 to §13 once against the code, and correct anything else that differs, in the spec's style. Use the code's names; give the reason when a rule changed.

- [ ] **Step 3: Update CLAUDE.md and the QA agent**

In `CLAUDE.md`, replace the two bullets under the opening paragraph ("Milestone 1 is built: …" and "Milestone 2 is redirected. …" with its list) with:

```markdown
- **Milestone 1** was the power plant and two datacenters, with the player's agent writing their firmware over MCP. The user played it on 2026-10-10 and redirected milestone 2 to the early stage.
- **Milestone 2 is built:** the whole small town (three farms, the warehouse and two trucks, two housing blocks, the power plant, two datacenters), every facility starting without a board.
  - Per-facility tiers: T0 by hand from the facility's panel; T1 a board, whose firmware the player writes in the game's editor; T2 a comm module, which lets the player's agent take the board over MCP.
  - A board manual generated from the scenario, read in the game or handed to an AI.
  - The playtest checklists are in `docs/playtests/`.
```

Under "Agents", in the bullet that starts "The game is made to be played by agents", replace the sentence that starts "`qa-tester` connects to the game's MCP server" with:

```markdown
`qa-tester` connects to the game's MCP server as a player's agent would: start `pnpm start:dev`, and add the server to the QA session with the `claude mcp add` command it prints. It plays the player's part with the dev tools: the hand, installs, repairs, and rebuilds (`dev_hand`, `dev_install`, `dev_repair`, `dev_rebuild`), and time and seasons (`dev_run_until` and the others). The dev tools exist only in dev mode. It plays the boards it gave a comm module with the agent tools.
```

Under "Code and checks", replace the `pnpm start` line with:

```markdown
  - `pnpm start`: builds the viewer and serves the game, the whole town of `scenarios/m2-town.json`, at http://127.0.0.1:7840 (MCP at `/mcp`, the viewer's socket at `/ws`).
    - It prints the connect command for an agent. An agent is optional: it reaches only the boards with a comm module.
    - It logs a timestamped line whenever the agent connects or disconnects.
    - `pnpm start:dev` adds the dev tools for QA agents: the player's hand (`dev_hand`, `dev_install`, `dev_repair`, `dev_rebuild`), and time and seasons (`dev_play`, `dev_run_until`, `dev_new_season`, …).
```

Check the two lines earlier tasks wrote:
- **`pnpm sim`** (Task 16): it must name the options of the usage line in `packages/server/src/sim-cli.ts`.
- **`pnpm shots`** (Task 21): it must give Task 21's check count and time.

Correct either if it doesn't.

In `.claude/agents/qa-tester.md`, replace the second sentence of the first paragraph ("Its players play through their own AI agent, which reads datasheets and logs and deploys firmware through the game's MCP tools, so you can play it the way they do.") with:

```markdown
Its players work the town by hand, write board firmware in the game's editor, and hand boards with a comm module (T2) to their own AI agent. That agent reads the board's manual and logs and deploys firmware through the game's MCP tools. You play the hand with the dev tools (`dev_hand`, `dev_install`, `dev_repair`, `dev_rebuild`) and the T2 boards with the agent tools, the way they do.
```

In its fun checklist, item 1 becomes:

```markdown
1. Readable to an agent: do the board's manual (`get_datasheet`), the logs, and the errors tell an agent what its firmware did and why it failed, without reading the game's code?
```

- [ ] **Step 4: Note what milestone 2 removed, on the milestone-1 checklist**

In `docs/playtests/2026-10-10-m1-checklist.md`, add this paragraph under the title:

```markdown
> Kept as the record of milestone 1's playtest. Milestone 2 replaced what it plays: the game now runs the whole town of `scenarios/m2-town.json`, an agent is optional, and `scenarios/firmware/m1/` is gone, so the `pnpm sim` commands below no longer run. Milestone 2's checklist is `<today>-m2-checklist.md`.
```

- [ ] **Step 5: Write the milestone-2 playtest checklist**

`docs/playtests/<today>-m2-checklist.md`:

```markdown
# Milestone 2 playtest (<today>)

You play the early stage in the browser. The whole small town is there:
- three farms (F1 to F3);
- the warehouse (W) with two trucks;
- two housing blocks (H1, H2);
- the power plant (P);
- two datacenters (DA, DB).

Every facility starts without a board, and you work it by hand. A board takes a facility's chore over with firmware you write in the game's editor, most likely by handing the board's manual to an AI chat. A comm module on a board lets your own Claude Code take that board over by MCP. The game's labels are in Korean, quoted below as they appear on screen.

## Getting started
1. Run `pnpm start` in a terminal and open http://127.0.0.1:7840 in a browser.
2. Press "시즌 시작". No agent is needed.
   - The season starts paused, with the guide card ("이렇게 해요") over the town. "다시 보지 않기" keeps it away, and the top bar's [도움말] brings it back.
   - Each "시즌 시작" and "새 시즌" draws a random seed that the screen doesn't show, so two seasons are two different towns.
3. The keys:
   - Space plays and pauses; 1, 2, and 3 set the speed; H shows the EMF heatmap.
   - Escape closes the open window, then clears the selection. Click outside the editor first: while you type in the editor, the game's keys go into the code.

   A season is 30 days of 40 seconds: about 20 minutes at 1×. The game pauses by itself at a raid, a wreck, a fire, a firmware error, and a lost agent. The "자동 정지" boxes under the alert feed change that.
4. Click a facility to open its panel. Every panel has:
   - its readings ("현재");
   - its hand controls ("손으로");
   - its parts ("부품": a board, then a comm module, each with its price);
   - [매뉴얼], its board's manual, which you can read before you buy the board (housing takes none).
5. For T2 only, connect Claude Code as in milestone 1:
   - Copy the connect command from the start screen ("복사").
   - Run it in an empty folder outside this repository, and start Claude Code there. Inside the repository Claude Code would read CLAUDE.md, the reference firmware in `scenarios/firmware/m2/`, and the sources, and the manual would no longer be what it works from.
   - After "토큰 재발급" (token reissue), run `claude mcp remove turing-city` in that folder before you run the new command.

## What to try
**T0, by hand:**
- **A farm:** [수확] when the crop is ripe (the bar along the bottom of its cell turns green). A ripe crop left alone rots.
- **The warehouse:** under "트럭 보내기", pick a truck, a trip, and an amount, then [보내기]. A trip collects a farm's outbox ("F1에서 회수") or delivers to a housing block ("H1에 전달"). With the warehouse selected, the map shows its trucks' routes.
- **The power plant:**
  - the thermal slider ("화력"), whose fuel costs money;
  - the supply order (↑ and ↓), where the bottom of the list loses power first when the plant falls short.
- **A datacenter:**
  - [처리] runs it for half a second per press and earns money, so you mash it to keep it running.
  - It heats up. [냉각] runs a cooling cycle of a few seconds that draws a lot of power. Above 90 °C it can catch fire.
- **Housing** eats food, and pays tax while fed and powered. The top bar shows 식량 (food) and 인구 (people: fed, hungry, without power).

**T1, a board and the editor:**
- **The board.** [보드 설치 (price)] in a facility's panel. A new board is empty: the facility goes on by hand until you deploy.
- **The manual.** [매뉴얼] opens the board's manual beside the map. Read it, or [마크다운 복사] (copy) or [.md 다운로드] (download) it, and give it to an AI chat with what you want the board to do.
- **The editor.** [편집] opens the editor beside the manual. Paste the code and press [배포].
  - A syntax error shows its line under the editor ("N번째 줄: …").
  - An accepted deploy says when it installs.
- **The log.** The panel shows the board's log. [로그 복사] copies it, for the AI when the board misbehaves.

**T2, a comm module and your agent:**
- [통신 모듈 (price)] on a board. Then ask your Claude Code to take it over, for example: "Read the manual of turing-city's DA board, then write and deploy its firmware."
- The agent's board tools reach only boards with a comm module, and say so for the others.

**The threat:**
- Boards, and a datacenter at work, leak EMF; H shows it.
- Luddites follow it and wreck the facility they reach, board and all. A wrecked facility stops, by hand too.
- Getting it back takes [시설 복구] (repair the facility), then [보드 재건] (rebuild its board), each paid for on its own.

## What to check
- [ ] Could you tell what to do from the guide card and the panels alone?
- [ ] Is T0 tedious enough that a board is a relief, and short enough not to bore? Which chore did you want off your hands first?
- [ ] Did the manual make you hand it to an AI? Did the AI's firmware work the first time? What did you fix, and were the log and the errors enough to find it?
- [ ] Which facility did you automate first, and why? Was it a real choice?
- [ ] How was handing a board to your agent, compared with pasting from a chat? Did the agent manage from the manual and the logs alone?
- [ ] Did you feel the trade-off: each board takes a chore away and adds EMF? How often and how hard did the Luddites come?
- [ ] Did a board pay for itself within the season? Note each season's ending ("시즌 완주" or "파산") and its final money ("최종 자금").
- [ ] Can you read the town on screen:
  - lights only on facilities with a board, and the tier marks;
  - the trucks and their routes;
  - the captions under the cells: temperature, ripeness and outbox, stock, food.
- [ ] With an agent connected: does the game pause when it drops ("에이전트 연결이 끊겼어요" in the feed), and only when you caused it (quitting Claude Code, or /mcp)? Note any drop you didn't cause, with the time of the terminal's "agent disconnected" line. Whether interactive Claude Code answers the game's pings is still unchecked.
- [ ] Does the H key work with the 한글 input source on? Only a synthetic key event has checked this.

## Out of scope for now
- the season wrap-up's breakdown and past seasons (the end overlay says "시즌 결산 화면(내역과 지난 시즌 목록)은 이번 플레이테스트 뒤에 붙어요.");
- firmware at T0, and `io.notify`;
- tiers past T2 (the wireless module, the control center);
- fuel as a stock;
- sprites.

## Notes
(What you felt while playing, and the time of anything odd. The terminal's timestamps show when an agent connected and disconnected.)
```

Check that every label the checklist quotes is on screen, and the same in the viewer's code:

```bash
for label in '시즌 시작' '새 시즌' '복사' '토큰 재발급' '이렇게 해요' '다시 보지 않기' '도움말' '자동 정지' '현재' '손으로' '부품' '매뉴얼' '수확' '트럭 보내기' '보내기' '회수' '전달' '화력' '처리' '냉각' '식량' '인구' '보드 설치' '마크다운 복사' '.md 다운로드' '편집' '배포' '번째 줄' '로그 복사' '통신 모듈' '시설 복구' '보드 재건' '시즌 완주' '파산' '최종 자금' '에이전트 연결이 끊겼어요' '시즌 결산 화면(내역과 지난 시즌 목록)은 이번 플레이테스트 뒤에 붙어요.'; do
  grep -rqF -- "$label" packages/viewer/src packages/server/src packages/core/src || echo "missing: $label"
done
```

Expected: no output.

- [ ] **Step 6: See the docs agree**

Run Step 1's three `grep` commands again.
Expected: no output from any of them (each exits 1).

Then read the edited sections of the spec once more against the code they name.

- [ ] **Step 7: Run the project's checks**

Run: `pnpm fix && pnpm check`
Expected: PASS. Nothing but docs changed; Biome leaves Markdown alone.

- [ ] **Step 8: Commit**

```bash
git add docs CLAUDE.md .claude/agents/qa-tester.md
git commit -m "Milestone 2: bring the spec, CLAUDE.md, and QA's brief up to the code, and write the playtest checklist"
```

End the message with the trailer lines the dispatch gives.
