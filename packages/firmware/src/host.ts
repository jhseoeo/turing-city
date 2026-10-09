import type { Action, BootInfo, FirmwareHost, TickInput, TickOutcome } from '@turing-city/core';
import type { LuaWasm } from 'wasmoon';
import { ACTION_CODES, BoardVm } from './board-vm.ts';
import { createLuaRuntime } from './runtime.ts';

/** Turns the VM's flat number queue into actions. An unknown code ends the decoding. */
export function decodeActions(queue: readonly number[], facilityIds: readonly string[]): Action[] {
  const out: Action[] = [];
  let i = 0;
  const next = (): number => queue[i++] ?? 0;
  while (i < queue.length) {
    const code = next();
    if (code === ACTION_CODES.process) out.push({ kind: 'process' });
    else if (code === ACTION_CODES.cool) out.push({ kind: 'cool', level: next() });
    else if (code === ACTION_CODES.setThermal) out.push({ kind: 'setThermal', output: next() });
    else if (code === ACTION_CODES.setPriority) {
      const n = next();
      const order: string[] = [];
      for (let k = 0; k < n; k++) {
        const id = facilityIds[next() - 1];
        if (id !== undefined) order.push(id);
      }
      out.push({ kind: 'setPriority', order });
    } else if (code === ACTION_CODES.sleep) out.push({ kind: 'sleep', seconds: next() });
    else break;
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
