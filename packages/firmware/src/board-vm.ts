import type { FacilityKind, TickError } from '@turing-city/core';
import { LuaEngine, LuaLibraries, type LuaWasm } from 'wasmoon';
import { PRELUDE } from './prelude.ts';

const REGISTRY = -1_001_000;
const MASK_COUNT = 8;
const T_NUMBER = 3;
const T_STRING = 4;
const ERR_MEM = 4;
const CPU_MESSAGE = 'CPU limit exceeded';
/**
 * Room for a board that ran out of RAM to start the firmware that frees it. mem survives a deploy, so a board whose
 * mem filled its RAM would otherwise have none: the new firmware's main chunk builds closures and globals before
 * its first tick() runs, and growing the globals table allocates the new node array before the old one is freed.
 * A board gets this on the tick that installs a firmware after a tick that ran out of RAM, only as far as it has
 * less free than this, and never more than this over the cap. Every other tick is held to the cap.
 */
const STARTUP_BYTES = 4096;

export const ACTION_CODES = { process: 1, cool: 2, setThermal: 3, setPriority: 4, sleep: 5 } as const;

export interface BoardVmOptions {
  readonly kind: FacilityKind;
  readonly facilityIds: readonly string[];
  readonly seed: number;
  readonly instructionCap: number;
  readonly ramBytes: number;
}

export interface VmTickResult {
  readonly ok: boolean;
  readonly instructions: number;
  /** The raw action queue; empty when the tick failed. */
  readonly queue: readonly number[];
  readonly logs: readonly string[];
  readonly error: TickError | null;
  /** Memory in use above the runtime and the installed code: mem, globals, and what a tick allocated and has not freed yet. */
  readonly ramUsedBytes: number;
}

type RefName = 'boot' | 'compile' | 'release' | 'collect' | 'step' | 'io' | 'queue' | 'logs';

/** One board's Lua state. Everything it runs goes through tick(), at a deterministic point. */
export class BoardVm {
  private readonly engine: LuaEngine;
  private readonly L: number;
  private readonly hook: number;
  private readonly refs: Record<RefName, number>;
  private ops = 0;
  private capped = false;
  private counting = false;
  /**
   * Memory in use by the board as it comes up, with no firmware: the runtime, the prelude with its queue and log at
   * their limits, and io with the sensor keys of the first frame. None of it is the firmware's to pay for. It is
   * measured on the first tick, after that frame, and fixed for the board's life.
   */
  private bootBytes = 0;
  private baselined = false;
  /** What compiling the installed firmware added: its chunk and its environment. Code doesn't count as RAM. */
  private codeBytes = 0;
  /** The last tick ran out of RAM, so the next deploy gets room to start (see STARTUP_BYTES). */
  private starved = false;

  private readonly lua: LuaWasm;
  private readonly options: BoardVmOptions;

  constructor(lua: LuaWasm, options: BoardVmOptions) {
    this.lua = lua;
    this.options = options;
    this.engine = new LuaEngine(lua, { openStandardLibs: false, injectObjects: false, enableProxy: false, traceAllocations: true });
    for (const lib of [LuaLibraries.Base, LuaLibraries.Coroutine, LuaLibraries.Table, LuaLibraries.String, LuaLibraries.Math]) {
      this.engine.global.loadLibrary(lib);
    }
    this.L = this.engine.global.address;
    this.engine.global.set('__charge', (n: number) => this.charge(n));
    this.hook = lua.module.addFunction((L: number) => this.onInstruction(L), 'vii');
    lua.lua_sethook(this.L, this.hook, MASK_COUNT, 1);
    this.engine.doStringSync(PRELUDE);
    this.refs = {
      boot: this.takeGlobal('__boot'),
      compile: this.takeGlobal('__compile'),
      release: this.takeGlobal('__release'),
      collect: this.takeGlobal('__collect'),
      step: this.takeGlobal('__step'),
      io: 0, // the first io table, which __boot returns
      queue: this.takeGlobal('__q'),
      logs: this.takeGlobal('__logs'),
    };
    this.pushRef('boot');
    lua.lua_pushstring(this.L, options.kind);
    lua.lua_createtable(this.L, options.facilityIds.length, 0);
    options.facilityIds.forEach((id, i) => {
      lua.lua_pushstring(this.L, id);
      lua.lua_rawseti(this.L, -2, BigInt(i + 1));
    });
    lua.lua_pushinteger(this.L, BigInt(options.seed));
    const status = lua.lua_pcallk(this.L, 3, 1, 0, 0, null);
    if (status !== 0) throw new Error(`board prelude failed: ${this.errorText(-1)}`);
    this.refs.io = lua.luaL_ref(this.L, REGISTRY);
  }

  /** Installs newSource (if given), writes the sensors into io, and runs one tick under the caps. */
  tick(sensors: Readonly<Record<string, number | undefined>>, newSource: string | null): VmTickResult {
    const { lua, L } = this;
    if (!this.baselined) this.baseline(sensors);
    if (newSource !== null) {
      const failure = this.deploy(newSource);
      if (failure) return this.result(false, 0, [], [], failure);
    }
    this.writeSensors(sensors);
    this.ops = 0;
    this.capped = false;
    // The RAM cap holds around the step only. What the host does outside it (writing the sensor keys, reading the text
    // of an error value, emptying the lists) allocates with no protected call around it, and a refused allocation
    // there aborts the whole Lua runtime instead of failing a tick.
    this.capRam(newSource !== null ? this.startupRoom() : 0);
    this.counting = true;
    this.pushRef('step');
    let status: number;
    try {
      status = lua.lua_pcallk(L, 0, 0, 0, 0, null);
    } finally {
      this.counting = false;
      this.engine.global.setMemoryMax(undefined);
    }
    const error = status === 0 ? null : this.classify(status, this.errorText(-1));
    this.starved = error?.kind === 'ram';
    lua.lua_settop(L, 0);
    const queue = this.drain('queue', () => lua.lua_tonumberx(L, -1, null));
    const logs = this.drain('logs', () => lua.lua_tolstring(L, -1, null));
    return this.result(status === 0, this.capped ? this.options.instructionCap : this.ops, status === 0 ? queue : [], logs, error);
  }

  close(): void {
    this.lua.lua_sethook(this.L, null, 0, 0);
    this.engine.global.close();
    this.lua.module.removeFunction(this.hook);
  }

  /** Takes the baseline: the first sensor frame goes into io, then everything the board holds is measured, collected. */
  private baseline(sensors: Readonly<Record<string, number | undefined>>): void {
    this.writeSensors(sensors);
    this.collect();
    this.bootBytes = this.engine.global.getMemoryUsed() - this.codeBytes;
    this.baselined = true;
  }

  /**
   * Compiles source, which the next step installs. Returns why it did not compile; the board is then as it was.
   * Code doesn't count as RAM (it would live in flash), so the cap, which holds only around the step, sits ramBytes
   * above the runtime and this code. The code's size is what compiling added to live memory: collect, measure,
   * compile, collect, measure. Only then is the installed firmware released, so its globals take no part in the
   * difference and only one firmware is alive when the cap is set. Nothing stays staged between ticks, since tick()
   * runs the step right after, so the chunk measured here is the only new one.
   */
  private deploy(source: string): TickError | null {
    const { lua, L } = this;
    this.collect();
    const before = this.engine.global.getMemoryUsed();
    this.pushRef('compile');
    lua.lua_pushstring(L, source);
    const status = lua.lua_pcallk(L, 1, 0, 0, 0, null);
    if (status !== 0) {
      const message = this.errorText(-1);
      lua.lua_settop(L, 0);
      return { kind: 'runtime', message };
    }
    this.collect();
    this.codeBytes = Math.max(0, this.engine.global.getMemoryUsed() - before);
    this.pushRef('release');
    const released = lua.lua_pcallk(L, 0, 1, 0, 0, null);
    if (released !== 0) throw new Error(`board release failed: ${this.errorText(-1)}`);
    // The firmware that goes starts with nothing it left in io: the new one gets a table of its own.
    lua.luaL_unref(L, REGISTRY, this.refs.io);
    this.refs.io = lua.luaL_ref(L, REGISTRY);
    lua.lua_settop(L, 0);
    this.collect();
    return null;
  }

  private collect(): void {
    this.pushRef('collect');
    this.lua.lua_pcallk(this.L, 0, 0, 0, 0, null);
    this.lua.lua_settop(this.L, 0);
  }

  private onInstruction(L: number): void {
    if (!this.counting) return;
    this.ops += 1;
    if (this.ops > this.options.instructionCap) {
      this.capped = true;
      this.lua.lua_pushstring(L, CPU_MESSAGE);
      this.lua.lua_error(L);
    }
  }

  /** Work a builtin is about to do, in instructions. Only a positive amount counts, so no argument buys budget back. */
  private charge(n: number): void {
    if (!this.counting || !(n > 0)) return;
    this.ops += Math.ceil(Math.min(n, this.options.instructionCap + 1));
    if (this.ops > this.options.instructionCap) {
      this.capped = true;
      throw new Error(CPU_MESSAGE);
    }
  }

  private classify(status: number, message: string): TickError {
    if (this.capped) return { kind: 'cpu', message: CPU_MESSAGE };
    if (status === ERR_MEM) return { kind: 'ram', message: 'out of RAM' };
    if (message.startsWith('__NOTICK__ ')) return { kind: 'noTick', message: message.slice('__NOTICK__ '.length) };
    return { kind: 'runtime', message };
  }

  /** The error value at idx as text, without running any firmware metamethod. */
  private errorText(idx: number): string {
    const type = this.lua.lua_type(this.L, idx);
    if (type === T_STRING || type === T_NUMBER) return this.lua.lua_tolstring(this.L, idx, null);
    return `(error object: ${this.lua.lua_typename(this.L, type)})`;
  }

  private writeSensors(sensors: Readonly<Record<string, number | undefined>>): void {
    const { lua, L } = this;
    this.pushRef('io');
    for (const [key, value] of Object.entries(sensors)) {
      lua.lua_pushstring(L, key);
      if (value === undefined) lua.lua_pushnil(L);
      else if (Number.isInteger(value)) lua.lua_pushinteger(L, BigInt(value));
      else lua.lua_pushnumber(L, value);
      lua.lua_rawset(L, -3);
    }
    lua.lua_settop(L, 0);
  }

  /** Reads and empties one of the prelude's lists, with raw access only. */
  private drain<T>(name: 'queue' | 'logs', read: () => T): T[] {
    const { lua, L } = this;
    this.pushRef(name);
    const n = lua.lua_rawlen(L, -1);
    const out: T[] = [];
    for (let i = 1; i <= n; i++) {
      lua.lua_rawgeti(L, -1, BigInt(i));
      out.push(read());
      lua.lua_settop(L, -2);
    }
    for (let i = n; i >= 1; i--) {
      lua.lua_pushnil(L);
      lua.lua_rawseti(L, -2, BigInt(i));
    }
    lua.lua_settop(L, 0);
    return out;
  }

  /** Firmware data may use ramBytes above the runtime and the installed code, plus extra on a tick that starts a firmware. */
  private capRam(extra = 0): void {
    this.engine.global.setMemoryMax(this.dataCap() + extra);
  }

  private dataCap(): number {
    return this.bootBytes + this.codeBytes + this.options.ramBytes;
  }

  /** How far over the cap this deploy's tick may go: STARTUP_BYTES less what the board has free, for a board that ran out of RAM. */
  private startupRoom(): number {
    if (!this.starved) return 0;
    const wanted = this.engine.global.getMemoryUsed() + STARTUP_BYTES - this.dataCap();
    return Math.min(STARTUP_BYTES, Math.max(0, wanted));
  }

  private result(
    ok: boolean,
    instructions: number,
    queue: readonly number[],
    logs: readonly string[],
    error: TickError | null,
  ): VmTickResult {
    const ramUsedBytes = Math.max(0, this.engine.global.getMemoryUsed() - this.bootBytes - this.codeBytes);
    return { ok, instructions, queue, logs, error, ramUsedBytes };
  }

  private takeGlobal(name: string): number {
    const { lua, L } = this;
    lua.lua_getglobal(L, name);
    const ref = lua.luaL_ref(L, REGISTRY);
    lua.lua_pushnil(L);
    lua.lua_setglobal(L, name);
    return ref;
  }

  private pushRef(name: RefName): void {
    this.lua.lua_rawgeti(this.L, REGISTRY, BigInt(this.refs[name]));
  }
}
