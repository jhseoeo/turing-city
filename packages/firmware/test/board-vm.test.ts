import { beforeAll, describe, expect, it } from 'vitest';
import type { LuaWasm } from 'wasmoon';
import { BoardVm, type BoardVmOptions } from '../src/board-vm.ts';
import { createLuaRuntime } from '../src/runtime.ts';

let lua: LuaWasm;
beforeAll(async () => {
  lua = await createLuaRuntime();
});

function vm(options: Partial<BoardVmOptions> = {}): BoardVm {
  return new BoardVm(lua, {
    kind: 'datacenter',
    facilityIds: ['P', 'DA', 'DB'],
    seed: 42,
    instructionCap: 2000,
    ramBytes: 8 * 1024,
    ...options,
  });
}

const SENSORS = { temp: 70, price: 40, day: 1, clock: 0.25 };

describe('BoardVm', () => {
  it('runs tick(io, mem) with sensors and queues actions and logs', () => {
    const v = vm();
    const r = v.tick(
      SENSORS,
      `
      function tick(io, mem)
        mem.n = (mem.n or 0) + 1
        io.log("n", mem.n, io.temp, io.price)
        if io.temp < 80 then io.process() end
        io.cool(2)
      end`,
    );
    expect(r.ok).toBe(true);
    expect(r.queue).toEqual([1, 2, 2]);
    expect(r.logs).toEqual(['n\t1\t70\t40']);
    expect(r.instructions).toBeGreaterThan(20);
    expect(r.instructions).toBeLessThan(400);
    v.close();
  });

  it('keeps mem and resets globals on a hot reload', () => {
    const v = vm();
    v.tick(SENSORS, `helper = 1 function tick(io, mem) mem.n = (mem.n or 0) + 1 end`);
    v.tick(SENSORS, null);
    const r = v.tick(SENSORS, `function tick(io, mem) io.log(mem.n, type(helper)) end`);
    expect(r.logs).toEqual(['2\tnil']);
    v.close();
  });

  it('reads a missing sensor as nil and passes non-integers as floats', () => {
    const v = vm();
    const r = v.tick({ temp: 84.125, luddite_dist: undefined }, `function tick(io) io.log(io.temp, io.luddite_dist) end`);
    expect(r.logs).toEqual(['84.125\tnil']);
    v.close();
  });

  it('encodes set_priority by facility index and rejects unknown ids', () => {
    const p = vm({ kind: 'power' });
    expect(p.tick(SENSORS, `function tick(io) io.set_thermal(250) io.set_priority({"DB", "DA"}) end`).queue).toEqual([3, 250, 4, 2, 3, 2]);
    const bad = p.tick(SENSORS, `function tick(io) io.set_priority({"ZZ"}) end`);
    expect(bad.ok).toBe(false);
    expect(bad.error?.message).toContain('unknown facility: ZZ');
    p.close();
  });

  it('gives each facility kind only its own actions', () => {
    const p = vm({ kind: 'power' });
    const r = p.tick(SENSORS, `function tick(io) io.process() end`);
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe('runtime');
    p.close();
  });

  it('caps the action queue at 64 numbers, whole actions only', () => {
    const v = vm({ instructionCap: 20_000 }); // 100 io.cool calls take about 2,900 instructions
    const r = v.tick(SENSORS, `function tick(io) for i = 1, 100 do io.cool(1) end end`);
    expect(r.queue).toHaveLength(64);
    expect(r.queue.every((n) => n === 2 || n === 1)).toBe(true);
    v.close();
  });

  it('keeps at most 20 log lines of 200 characters, and print logs too', () => {
    const v = vm({ instructionCap: 20_000 });
    const r = v.tick(SENSORS, `function tick(io) for i = 1, 30 do print(string.rep("x", 300)) end end`);
    expect(r.logs).toHaveLength(20);
    expect(r.logs[0]).toHaveLength(200);
    v.close();
  });

  it('reports a missing tick function as noTick and a runtime error with its line', () => {
    const v = vm();
    expect(v.tick(SENSORS, `x = 1`).error).toEqual({ kind: 'noTick', message: 'firmware defines no tick(io, mem) function' });
    const r = v.tick(SENSORS, `function tick() local t = nil; return t.x end`);
    expect(r.error?.kind).toBe('runtime');
    expect(r.error?.message).toMatch(/^firmware:1: attempt to index a nil value/);
    expect(v.tick(SENSORS, `function tick() error({}) end`).error).toEqual({ kind: 'runtime', message: '(error object: table)' });
    v.close();
  });

  it('keeps logs from a tick that failed', () => {
    const v = vm();
    const r = v.tick(SENSORS, `function tick(io) io.log("before") error("after", 0) end`);
    expect(r.ok).toBe(false);
    expect(r.logs).toEqual(['before']);
    expect(r.queue).toEqual([]);
    v.close();
  });

  it('removes unsafe globals and pattern functions, and locks the string metatable', () => {
    const v = vm();
    const r = v.tick(
      SENSORS,
      `function tick(io)
      io.log(type(os), type(load), type(require), type(debug), type(collectgarbage), type(string.dump), type(string.gsub), type(utf8))
      io.log(("aaaa"):find("a+"), string.find("a.b", "."), tostring(getmetatable("")))
      io.log(tostring({}), tostring(print), type(math.randomseed))
    end`,
    );
    expect(r.logs).toEqual(['nil\tnil\tnil\tnil\tnil\tnil\tnil\tnil', 'nil\t2\tfalse', 'table\tfunction\tnil']);
    v.close();
  });

  it('refuses __gc and __mode metatables', () => {
    const v = vm();
    const r = v.tick(SENSORS, `function tick() setmetatable({}, {__mode = "k"}) end`);
    expect(r.error?.message).toContain('__gc and __mode are not allowed');
    v.close();
  });

  it('counts instructions exactly enough to see a loop grow', () => {
    const v = vm({ instructionCap: 100_000 });
    const small = v.tick(SENSORS, `function tick() local s = 0 for i = 1, 10 do s = s + i end end`).instructions;
    const big = v.tick(SENSORS, `function tick() local s = 0 for i = 1, 1000 do s = s + i end end`).instructions;
    // Each loop iteration is at least an ADD and a FORLOOP.
    expect(big - small).toBeGreaterThanOrEqual(990 * 2);
    v.close();
  });

  it('stops an infinite loop at the cap, counts the cap, and runs the next tick', () => {
    const v = vm();
    const r = v.tick(SENSORS, `function tick() while true do end end`);
    expect(r).toMatchObject({ ok: false, instructions: 2000, error: { kind: 'cpu', message: 'CPU limit exceeded' } });
    expect(v.tick(SENSORS, `function tick(io) io.log("alive") end`).logs).toEqual(['alive']);
    v.close();
  });

  it('fails a tick that runs out of RAM and stays usable', () => {
    const v = vm();
    const r = v.tick(SENSORS, `function tick(io, mem) mem.t = {} for i = 1, 1e6 do mem.t[i] = i end end`);
    expect(r.error).toEqual({ kind: 'ram', message: 'out of RAM' });
    const after = v.tick(SENSORS, `function tick(io, mem) mem.t = nil io.log("ok") end`);
    expect(after.logs).toEqual(['ok']);
    v.close();
  });

  it('gives the same random numbers for the same seed and different ones for another', () => {
    const roll = (seed: number): string => {
      const v = vm({ seed });
      const out = v.tick(SENSORS, `function tick(io) io.log(math.random(1, 1000000), math.random(1, 1000000)) end`).logs[0]!;
      v.close();
      return out;
    };
    expect(roll(7)).toBe(roll(7));
    expect(roll(7)).not.toBe(roll(8));
  });
});
