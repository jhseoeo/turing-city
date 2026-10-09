import { parentPort, workerData } from 'node:worker_threads';
import type { TickErrorKind } from '@turing-city/core';
import { BoardVm } from '../src/board-vm.ts';
import { createLuaRuntime } from '../src/runtime.ts';

export interface TickReport {
  readonly kind: TickErrorKind | null;
  readonly message: string | null;
  readonly elapsedMs: number;
  readonly logs: readonly string[];
}

// Runs the given ticks (a source deploys, null runs what's there) on one fresh board and
// reports each. The suite runs this in a worker thread so it can stop a tick that never ends.
const sources = workerData as ReadonlyArray<string | null>;
const lua = await createLuaRuntime();
const vm = new BoardVm(lua, { kind: 'datacenter', facilityIds: ['P', 'DA', 'DB'], seed: 1, instructionCap: 2000, ramBytes: 8 * 1024 });
const reports: TickReport[] = [];
for (const source of sources) {
  const started = performance.now();
  const r = vm.tick({ temp: 50, price: 40, day: 1, clock: 1 }, source);
  reports.push({ kind: r.error?.kind ?? null, message: r.error?.message ?? null, elapsedMs: performance.now() - started, logs: r.logs });
}
vm.close();
parentPort?.postMessage(reports);
