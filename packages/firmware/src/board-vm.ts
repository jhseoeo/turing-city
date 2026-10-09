import type { FacilityKind, TickError } from '@turing-city/core';
import { LuaEngine, LuaLibraries, type LuaWasm } from 'wasmoon';
import { PRELUDE } from './prelude.ts';

const REGISTRY = -1_001_000;
const MASK_COUNT = 8;
const T_NUMBER = 3;
const T_STRING = 4;
const ERR_MEM = 4;
const CPU_MESSAGE = 'CPU limit exceeded';

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
  readonly ramUsedBytes: number;
}

type RefName = 'boot' | 'compile' | 'collect' | 'step' | 'io' | 'queue' | 'logs';

/** One board's Lua state. Everything it runs goes through tick(), at a deterministic point. */
export class BoardVm {
  private readonly engine: LuaEngine;
  private readonly L: number;
  private readonly hook: number;
  private readonly refs: Record<RefName, number>;
  private ops = 0;
  private capped = false;
  private counting = false;
  /** Memory in use when the RAM cap was last set: code and runtime, not firmware data. */
  private capBase = 0;

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
      collect: this.takeGlobal('__collect'),
      step: this.takeGlobal('__step'),
      io: this.takeGlobal('__io'),
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
    const status = lua.lua_pcallk(this.L, 3, 0, 0, 0, null);
    if (status !== 0) throw new Error(`board prelude failed: ${this.errorText(-1)}`);
    this.capRam();
  }

  /** Installs newSource (if given), writes the sensors into io, and runs one tick under the caps. */
  tick(sensors: Readonly<Record<string, number | undefined>>, newSource: string | null): VmTickResult {
    const { lua, L } = this;
    if (newSource !== null) {
      // Code doesn't count as RAM (it would live in flash): compile without a cap, then cap the data.
      this.engine.global.setMemoryMax(undefined);
      this.pushRef('compile');
      lua.lua_pushstring(L, newSource);
      const status = lua.lua_pcallk(L, 1, 0, 0, 0, null);
      if (status !== 0) {
        const message = this.errorText(-1);
        lua.lua_settop(L, 0);
        this.capRam();
        return this.result(false, 0, [], [], { kind: 'runtime', message });
      }
      this.pushRef('collect');
      lua.lua_pcallk(L, 0, 0, 0, 0, null);
      lua.lua_settop(L, 0);
      this.capRam();
    }
    this.writeSensors(sensors);
    this.ops = 0;
    this.capped = false;
    this.counting = true;
    this.pushRef('step');
    const status = lua.lua_pcallk(L, 0, 0, 0, 0, null);
    this.counting = false;
    const error = status === 0 ? null : this.classify(status, this.errorText(-1));
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

  private capRam(): void {
    this.capBase = this.engine.global.getMemoryUsed();
    this.engine.global.setMemoryMax(this.capBase + this.options.ramBytes);
  }

  private result(
    ok: boolean,
    instructions: number,
    queue: readonly number[],
    logs: readonly string[],
    error: TickError | null,
  ): VmTickResult {
    const ramUsedBytes = Math.max(0, this.engine.global.getMemoryUsed() - this.capBase);
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
