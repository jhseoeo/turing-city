import type { BoardKind, SensorValue, TickError } from '@turing-city/core';
import { LuaEngine, LuaLibraries, type LuaWasm } from 'wasmoon';
import { PRELUDE } from './prelude.ts';

const REGISTRY = -1_001_000;
const MASK_COUNT = 8;
const T_NIL = 0;
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

export const ACTION_CODES = { process: 1, cool: 2, setThermal: 3, setPriority: 4, sleep: 5, harvest: 6, dispatch: 7 } as const;

export interface BoardVmOptions {
  readonly kind: BoardKind;
  readonly facilityIds: readonly string[];
  readonly seed: number;
  readonly instructionCap: number;
  readonly ramBytes: number;
}

/**
 * Takes one action as the numbers firmware called it with (its code first), at the moment of the call: the game applies it and
 * answers null, or why it did not take it, which the call returns to the firmware.
 */
export type ActCall = (numbers: readonly number[]) => string | null;

export interface VmTickResult {
  readonly ok: boolean;
  readonly instructions: number;
  /** Every action the tick called, as numbers one after another, a failed tick's too: each was handed to the game as it came. */
  readonly queue: readonly number[];
  readonly logs: readonly string[];
  /** How many log lines the tick asked for past the limit of 20. */
  readonly droppedLogs: number;
  readonly error: TickError | null;
  /** Memory in use above the runtime and the installed code: mem, globals, and what a tick allocated and has not freed yet. */
  readonly ramUsedBytes: number;
}

type RefName = 'boot' | 'compile' | 'release' | 'collect' | 'step' | 'io' | 'logs';

/** One board's Lua state. Everything it runs goes through tick(), at a deterministic point. */
export class BoardVm {
  private readonly engine: LuaEngine;
  private readonly L: number;
  private readonly hook: number;
  private readonly refs: Record<RefName, number>;
  private ops = 0;
  private capped = false;
  private counting = false;
  /** Where this tick's actions go, and what it called so far: set for the step only. */
  private act: ActCall | null = null;
  private calls: number[] = [];
  /**
   * What the game threw while taking an action this tick. wasmoon would raise it into Lua, where firmware's pcall could catch it and
   * read it; so the VM refuses the rest of the tick's actions and throws it again once the step is over.
   */
  private hostFailure: { error: unknown } | null = null;
  /**
   * Memory in use by the board as it comes up, with no firmware: the runtime, the prelude with its log at
   * their limits, and io with the readings of the first frame, their tables too. None of it is the firmware's to pay for. It is
   * measured on the first tick, after that frame, and fixed for the board's life.
   */
  private bootBytes = 0;
  private baselined = false;
  /** What compiling the installed firmware added: its chunk and its environment. Code doesn't count as RAM. */
  private codeBytes = 0;
  /** The last tick ran out of RAM, so the next deploy gets room to start (see STARTUP_BYTES). */
  private starved = false;
  /**
   * What the last tick that installed a firmware ended in (its error, or null). A main chunk that fails leaves the board with no
   * tick(), and every tick after it would say only that, so the cause is kept here for the ticks that follow to name.
   */
  private installError: string | null = null;
  /** The VM's own tables for the lists and records among the readings, by path, as registry references (see writeSensors). */
  private readonly tables = new Map<string, number>();
  /** How many items the host last wrote into each list table, by path: all it ever clears from that list. */
  private readonly listLengths = new Map<string, number>();

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
    this.engine.global.set('__act', (...numbers: unknown[]) => this.onAct(numbers));
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

  /**
   * Installs newSource (if given), writes the sensors into io, and runs one tick under the caps. Each action the tick calls goes to
   * `act` at once; without one, every action is taken.
   */
  tick(sensors: Readonly<Record<string, SensorValue>>, newSource: string | null, act: ActCall = () => null): VmTickResult {
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
    this.act = act;
    this.calls = [];
    this.hostFailure = null;
    this.pushRef('step');
    let status: number;
    try {
      status = lua.lua_pcallk(L, 0, 0, 0, 0, null);
    } finally {
      this.counting = false;
      this.act = null;
      this.engine.global.setMemoryMax(undefined);
    }
    // Set by onAct during the step, which TypeScript can't see from here.
    const failure = this.hostFailure as { error: unknown } | null;
    if (failure) {
      lua.lua_settop(L, 0);
      throw failure.error;
    }
    const error = status === 0 ? null : this.classify(status, this.errorText(-1));
    if (newSource !== null) this.installError = error?.message ?? null;
    this.starved = error?.kind === 'ram';
    lua.lua_settop(L, 0);
    const logs = this.drain('logs', () => lua.lua_tolstring(L, -1, null));
    const droppedLogs = this.takeDroppedLogs();
    return this.result(status === 0, this.capped ? this.options.instructionCap : this.ops, this.calls, logs, error, droppedLogs);
  }

  close(): void {
    this.lua.lua_sethook(this.L, null, 0, 0);
    this.engine.global.close();
    this.lua.module.removeFunction(this.hook);
  }

  /** Takes the baseline: the first sensor frame goes into io, then everything the board holds is measured, collected. */
  private baseline(sensors: Readonly<Record<string, SensorValue>>): void {
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
    // The firmware that goes starts with nothing it left in io: the new one gets an io of its own, and tables of its own for
    // the readings, which the next frame makes.
    lua.luaL_unref(L, REGISTRY, this.refs.io);
    this.refs.io = lua.luaL_ref(L, REGISTRY);
    lua.lua_settop(L, 0);
    this.dropSensorTables();
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

  /**
   * One action from the prelude: its numbers go to the game, and its answer back to the call. Only a running step takes any.
   * Taken is undefined, which reaches Lua as nil (wasmoon would hand JS null to Lua as a userdata).
   */
  private onAct(args: readonly unknown[]): string | undefined {
    if (!this.counting || this.act === null || this.hostFailure) return 'no tick is running';
    const numbers = args.map((a) => Number(a));
    this.calls.push(...numbers);
    try {
      return this.act(numbers) ?? undefined;
    } catch (error) {
      this.hostFailure = { error };
      return 'no tick is running';
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
    if (message === '__INSTALLFAILED__') {
      return { kind: 'noTick', message: `the last deploy failed to install: ${this.installError ?? 'unknown error'}` };
    }
    if (message.startsWith('__NOTICK__ ')) return { kind: 'noTick', message: message.slice('__NOTICK__ '.length) };
    return { kind: 'runtime', message };
  }

  /** The error value at idx as text, without running any firmware metamethod. */
  private errorText(idx: number): string {
    const type = this.lua.lua_type(this.L, idx);
    if (type === T_STRING || type === T_NUMBER) return this.lua.lua_tolstring(this.L, idx, null);
    return `(error object: ${this.lua.lua_typename(this.L, type)})`;
  }

  /**
   * Writes a frame of readings into io, with raw access only, so that no firmware metamethod runs outside a tick. A list or a
   * record goes into a table the VM keeps for its path (`farms`, `farms/1`, ...) and fills again every tick. After the first
   * frame, writing the readings allocates nothing, so a tick leaves no garbage for the RAM reading to count: the host writes
   * outside the RAM cap. A list that comes shorter loses the last items the host wrote; what firmware adds to a table is its own.
   * A deploy drops the tables, so each firmware gets its own.
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
      // Clears the items the host wrote last frame past the new length, then the run of items firmware appended after them. Not
      // down from the table's length: firmware can make a few sparse items report a length near 2^30, and this runs outside the
      // cap. The run upward ends at the first nil, so it is no longer than what firmware could store in its RAM.
      const wrote = this.listLengths.get(path) ?? 0;
      for (let i = list.length + 1; i <= wrote; i++) {
        lua.lua_pushnil(L);
        lua.lua_rawseti(L, -2, BigInt(i));
      }
      for (let i = Math.max(wrote, list.length) + 1; lua.lua_rawgeti(L, -1, BigInt(i)) !== T_NIL; i++) {
        lua.lua_settop(L, -2);
        lua.lua_pushnil(L);
        lua.lua_rawseti(L, -2, BigInt(i));
      }
      lua.lua_settop(L, -2);
      this.listLengths.set(path, list.length);
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
    this.listLengths.clear();
  }

  /** Reads and empties the prelude's log, with raw access only. */
  private drain<T>(name: 'logs', read: () => T): T[] {
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

  /** Reads and zeroes how many log lines the tick dropped past its limit (a field of the prelude's log table). */
  private takeDroppedLogs(): number {
    const { lua, L } = this;
    this.pushRef('logs');
    lua.lua_pushstring(L, 'dropped');
    lua.lua_rawget(L, -2);
    const n = Number(lua.lua_tonumberx(L, -1, null));
    lua.lua_settop(L, -2);
    lua.lua_pushstring(L, 'dropped');
    lua.lua_pushinteger(L, 0n);
    lua.lua_rawset(L, -3);
    lua.lua_settop(L, 0);
    return n;
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
    droppedLogs = 0,
  ): VmTickResult {
    const ramUsedBytes = Math.max(0, this.engine.global.getMemoryUsed() - this.bootBytes - this.codeBytes);
    return { ok, instructions, queue, logs, droppedLogs, error, ramUsedBytes };
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
