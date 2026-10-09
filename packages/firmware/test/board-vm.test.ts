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

  it('refuses a __gc metatable as well as a __mode one', () => {
    const v = vm();
    const r = v.tick(SENSORS, `function tick() setmetatable({}, {__gc = function() end}) end`);
    expect(r.ok).toBe(false);
    expect(r.error?.message).toContain('__gc and __mode are not allowed');
    v.close();
  });

  it('keeps power actions off a datacenter, as it keeps datacenter actions off a power board', () => {
    const d = vm({ kind: 'datacenter' });
    for (const call of ['io.set_thermal(1)', 'io.set_priority({"P"})']) {
      const r = d.tick(SENSORS, `function tick(io) ${call} end`);
      expect(r.ok).toBe(false);
      expect(r.error?.kind).toBe('runtime');
    }
    d.close();
  });

  it('drops an action that does not fit whole at the 64-number limit, and still takes a later one that fits', () => {
    const v = vm({ instructionCap: 20_000 });
    // 31 cool(1) calls are 62 numbers and process() makes 63. The next cool(1) would reach 65 and is dropped whole;
    // the last process() fits at 64.
    const r = v.tick(SENSORS, `function tick(io) for i = 1, 31 do io.cool(1) end io.process() io.cool(1) io.process() end`);
    expect(r.queue).toEqual([...Array.from({ length: 31 }, () => [2, 1]).flat(), 1, 1]);
    v.close();
  });

  it('returns no actions from a tick that failed after queueing some', () => {
    const v = vm();
    const r = v.tick(SENSORS, `function tick(io) io.process() io.cool(2) error("after", 0) end`);
    expect(r.ok).toBe(false);
    expect(r.queue).toEqual([]);
    v.close();
  });

  // Spec 6.5 lists the builtins that are charged by the work they do. Each row runs one on a large input in a tick of its
  // own, next to a control tick that loads the same arguments and calls nothing charged. The call has to cost the
  // difference: without its charge a call costs a handful of instructions.
  const CHARGED: ReadonlyArray<readonly [string, string, string]> = [
    ['string.rep', 'string.rep("x", 8000)', 'nil'],
    ['string.upper', 'string.upper(big)', 'nil'],
    ['string.lower', 'string.lower(big)', 'nil'],
    ['string.reverse', 'string.reverse(big)', 'nil'],
    ['string.byte', 'string.byte(big, 1, -1)', 'nil'],
    ['string.char', 'string.char(table.unpack(list))', 'select("#", table.unpack(list))'],
    ['string.format', 'string.format("%s", big)', 'nil'],
    ['string.find', 'string.find(big, "y")', 'nil'],
    ['table.concat', 'table.concat(parts)', 'nil'],
    ['table.sort', 'table.sort(list)', 'nil'],
    ['table.unpack', 'select("#", table.unpack(list))', 'nil'],
  ];
  it.each(CHARGED)('charges %s by the work it does', (_name, call, control) => {
    const instructions = (statement: string): number => {
      const v = vm({ instructionCap: 100_000, ramBytes: 256 * 1024 });
      const r = v.tick(
        SENSORS,
        `function tick()
        local big = string.rep("x", 8000)
        local list = {} for i = 1, 600 do list[i] = 65 end
        local parts = {big, big, big, big}
        local _ = ${statement}
      end`,
      );
      v.close();
      expect(r.error).toBeNull();
      return r.instructions;
    };
    expect(instructions(call) - instructions(control)).toBeGreaterThanOrEqual(400);
  });

  it('counts a charge in whole instructions', () => {
    const v = vm();
    // 20 bytes at one instruction per 16 bytes is 1.25, which counts as 2.
    const r = v.tick(SENSORS, `function tick() local s = string.rep("x", 20) end`);
    expect(Number.isInteger(r.instructions)).toBe(true);
    v.close();
  });

  it('counts the tick after a capped one by what it ran', () => {
    const v = vm();
    v.tick(SENSORS, `function tick() while true do end end`);
    const next = v.tick(SENSORS, `function tick() local s = 0 for i = 1, 10 do s = s + i end error("late", 0) end`);
    expect(next.instructions).toBeLessThan(100);
    expect(next.error).toEqual({ kind: 'runtime', message: 'late' });
    v.close();
  });

  it('starts each tick with an empty queue and an empty log', () => {
    const v = vm();
    const once = `function tick(io, mem) if not mem.done then mem.done = true io.log("once") io.process() end end`;
    const first = v.tick(SENSORS, once);
    expect([first.queue, first.logs]).toEqual([[1], ['once']]);
    const second = v.tick(SENSORS, null);
    expect([second.queue, second.logs]).toEqual([[], []]);
    v.close();
  });

  it('sorts a table that has a metatable through a copy, asking for its length once', () => {
    const v = vm();
    const r = v.tick(
      SENSORS,
      `function tick(io)
        local asked = 0
        local t = setmetatable({3, 1, 2}, { __len = function() asked = asked + 1 return 3 end })
        table.sort(t)
        io.log(asked, t[1], t[2], t[3])
      end`,
    );
    expect(r.logs).toEqual(['1\t1\t2\t3']);
    v.close();
  });

  describe('RAM across deploys', () => {
    // A table of 200 integers takes 4,096 bytes for its array part: with 6 KB of RAM one of them fits and two do not.
    const holdInMem = (key: string): string => `function tick(io, mem) local t = {} mem.${key} = t for i = 1, 200 do t[i] = i end end`;
    const GROW = `function tick(io, mem) mem.t = mem.t or {} for i = 1, 200 do mem.t[#mem.t + 1] = i end end`;
    // About 30 KB of code (one string constant in a branch that never runs), against RAM of 6 to 8 KB. A constant
    // rather than many small ones, because a long table constructor would also grow the call frame, which is RAM.
    const BIG_CODE = `function tick(io, mem) if mem.never then local s = "${'x'.repeat(30_000)}" end end`;

    it('keeps mem inside the RAM cap across a deploy', () => {
      const v = vm({ ramBytes: 6 * 1024 });
      expect(v.tick(SENSORS, holdInMem('a')).ok).toBe(true);
      // The hot reload keeps mem.a, so a second 4 KB table does not fit in the 6 KB of RAM.
      expect(v.tick(SENSORS, holdInMem('b')).error).toEqual({ kind: 'ram', message: 'out of RAM' });
      v.close();
    });

    it('reports the data mem holds in ramUsedBytes, also right after a deploy', () => {
      const v = vm({ ramBytes: 6 * 1024 });
      const first = v.tick(SENSORS, holdInMem('a'));
      const redeployed = v.tick(SENSORS, `function tick() end`);
      for (const r of [first, redeployed]) {
        expect(r.ramUsedBytes).toBeGreaterThan(4000);
        expect(r.ramUsedBytes).toBeLessThan(6 * 1024);
      }
      v.close();
    });

    // The data a tick of this firmware leaves, with only the firmware's own code different. The RAM is generous, so
    // that no allocation fails and sets off Lua's emergency collection, which would free a replaced firmware anyway.
    const dataOf = (source: string, deployedBefore?: string): number => {
      const v = vm({ ramBytes: 256 * 1024 });
      if (deployedBefore !== undefined) expect(v.tick(SENSORS, deployedBefore).ok).toBe(true);
      const r = v.tick(SENSORS, source);
      v.close();
      expect(r.ok).toBe(true);
      return r.ramUsedBytes;
    };
    const TINY = `function tick(io, mem) end`;

    it("does not count the firmware's code as RAM", () => {
      // 30 KB more code than TINY, and no more data.
      expect(Math.abs(dataOf(BIG_CODE) - dataOf(TINY))).toBeLessThan(256);
    });

    it('counts nothing of a replaced firmware as data, even when the new one allocates nothing', () => {
      expect(Math.abs(dataOf(TINY, BIG_CODE) - dataOf(TINY))).toBeLessThan(256);
    });

    it("gives a new firmware the room that the replaced one's globals held", () => {
      const v = vm({ ramBytes: 6 * 1024 });
      // The first firmware's main chunk builds a 4 KB global, which goes when the firmware is replaced.
      expect(v.tick(SENSORS, `big = {} for i = 1, 200 do big[i] = i end function tick() end`).ok).toBe(true);
      expect(v.tick(SENSORS, holdInMem('b')).error).toBeNull();
      v.close();
    });

    it("counts only the installed firmware's code, not the code of earlier deploys", () => {
      const v = vm({ ramBytes: 6 * 1024, instructionCap: 20_000 });
      expect(v.tick(SENSORS, BIG_CODE).ok).toBe(true);
      const replaced = v.tick(SENSORS, GROW);
      expect(replaced.error).toBeNull();
      // The 30 KB of the first firmware are gone, not left in the count as data ...
      expect(replaced.ramUsedBytes).toBeLessThan(6 * 1024);
      // ... and not left in the cap: 400 integers need 8 KB, more than the 6 KB above the new code.
      expect(v.tick(SENSORS, null).error?.kind).toBe('ram');
      v.close();
    });

    // Each pass links in a new table of about 48 bytes, so the board ends up within one table of its cap.
    const fillToTheBrim = (key: string): string => `function tick(io, mem) while true do mem.${key} = {mem.${key}} end end`;
    const FILL_TO_THE_BRIM = fillToTheBrim('head');
    // 160 such tables leave a few hundred of the 8,192 bytes free, without running out.
    const FILL_NEARLY = `function tick(io, mem) for i = 1, 160 do mem.head = {mem.head} end end`;
    // 32 integers are 568 bytes: more than the board has free after either fill.
    const ALLOCATE_568 = `function tick() local t = {${Array.from({ length: 32 }, (_, i) => i + 1).join(',')}} end`;

    it('starts a firmware on a board whose mem filled its RAM, so that it can free it', () => {
      const v = vm();
      expect(v.tick(SENSORS, FILL_TO_THE_BRIM).error?.kind).toBe('ram');
      // Eleven globals are eleven closures to build before the first tick() runs, and the ninth makes the globals
      // table grow, which takes more than 2 KB while the old node array is still there.
      const helpers = Array.from({ length: 10 }, (_, i) => `function h${i}() end`).join(' ');
      const r = v.tick(SENSORS, `${helpers} function tick(io, mem) mem.head = nil io.log("freed") end`);
      expect(r.error).toBeNull();
      expect(r.logs).toEqual(['freed']);
      v.close();
    });

    it('lets the first tick of a new firmware allocate on a board that ran out of RAM', () => {
      const v = vm();
      expect(v.tick(SENSORS, FILL_TO_THE_BRIM).error?.kind).toBe('ram');
      // This firmware does not free mem. It only logs, which takes a few hundred bytes that the board does not have.
      expect(v.tick(SENSORS, `function tick(io) io.log("still alive") end`).logs).toEqual(['still alive']);
      // The room was for that tick only: the next one is held to the cap again, and the board is still full.
      expect(v.tick(SENSORS, null).error?.kind).toBe('ram');
      v.close();
    });

    it('does not let a board that keeps running out of RAM go further over the cap each time', () => {
      const v = vm();
      expect(v.tick(SENSORS, FILL_TO_THE_BRIM).error?.kind).toBe('ram');
      // The room runs out too: this firmware keeps linking tables until even the extra 4 KB is gone ...
      expect(v.tick(SENSORS, fillToTheBrim('more')).error?.kind).toBe('ram');
      // ... and the next deploy does not get a second helping.
      expect(v.tick(SENSORS, ALLOCATE_568).error?.kind).toBe('ram');
      v.close();
    });

    it('holds a board that did not run out of RAM to the cap on the tick after a deploy', () => {
      const v = vm();
      const filled = v.tick(SENSORS, FILL_NEARLY);
      expect(filled.error).toBeNull();
      expect(filled.ramUsedBytes).toBeGreaterThan(7000);
      // A tick that failed for another reason does not earn room either.
      expect(v.tick(SENSORS, `function tick() while true do end end`).error?.kind).toBe('cpu');
      expect(v.tick(SENSORS, ALLOCATE_568).error?.kind).toBe('ram');
      v.close();
    });

    it('forgets that a board ran out of RAM once a tick succeeds', () => {
      const v = vm();
      expect(v.tick(SENSORS, FILL_TO_THE_BRIM).error?.kind).toBe('ram');
      expect(v.tick(SENSORS, `function tick(io, mem) mem.head = nil end`).error).toBeNull();
      expect(v.tick(SENSORS, FILL_NEARLY).error).toBeNull();
      // The board is nearly full again, but it did not run out this time: no room for the deploy.
      expect(v.tick(SENSORS, ALLOCATE_568).error?.kind).toBe('ram');
      v.close();
    });

    it('gives a board that ran out of RAM only the room it is short of', () => {
      const v = vm({ ramBytes: 6 * 1024, instructionCap: 20_000 });
      // The local table is garbage once the tick fails, so the board has nearly all its RAM free again ...
      expect(v.tick(SENSORS, `function tick() local t = {} for i = 1, 1000 do t[i] = i end end`).error?.kind).toBe('ram');
      // ... and a main chunk that wants 8 KB gets no more than the 6 KB of RAM.
      const r = v.tick(SENSORS, `big = {} for i = 1, 500 do big[i] = i end function tick() end`);
      expect(r.error).toEqual({ kind: 'ram', message: 'out of RAM' });
      v.close();
    });

    it('keeps the old firmware and the RAM cap when a deploy does not compile', () => {
      const v = vm({ ramBytes: 6 * 1024, instructionCap: 20_000 });
      expect(v.tick(SENSORS, GROW).ok).toBe(true);
      const bad = v.tick(SENSORS, `function tick( end`);
      expect(bad.ok).toBe(false);
      expect(bad.error?.message).toMatch(/^syntax error: firmware:1: /);
      // The old firmware runs on, still under the cap: 400 integers need 8 KB.
      expect(v.tick(SENSORS, null).error?.kind).toBe('ram');
      v.close();
    });

    // What compiling added is code, and code does not count as RAM. Anything the firmware can free and then spend as
    // data would turn into RAM, so the installed firmware keeps all of it: the main chunk and the environment.
    it("keeps the main chunk's code installed, so that freeing it does not become data", () => {
      const v = vm({ ramBytes: 6 * 1024, instructionCap: 20_000 });
      // 30 KB of constants in the main chunk, which would be garbage once it has run.
      expect(v.tick(SENSORS, `local pad = "${'x'.repeat(30_000)}" ${GROW}`).error).toBeNull();
      // 400 integers need 8 KB, more than the 6 KB above the code.
      expect(v.tick(SENSORS, null).error?.kind).toBe('ram');
      v.close();
    });

    it('keeps the copies of the standard libraries installed, so that dropping them does not become data', () => {
      const v = vm({ ramBytes: 6 * 1024 });
      expect(v.tick(SENSORS, holdInMem('a')).error).toBeNull();
      // Dropping the four copies frees about 2.6 KB of code. It must not buy room: 150 integers (2.4 KB) still do not fit.
      const ints = Array.from({ length: 150 }, (_, i) => i + 1).join(',');
      const r = v.tick(SENSORS, `string = nil table = nil math = nil coroutine = nil function tick() local t = {${ints}} end`);
      expect(r.error?.kind).toBe('ram');
      v.close();
    });

    // The host's own structures are part of the board, not of the firmware's data.
    it("does not count the host's queue and log arrays as firmware data", () => {
      // The same firmware and sensors on two boards, so that only the history differs: one of them once queued 64
      // numbers and logged 20 lines, which grows the two arrays for good. Each redeploy collects before it reads.
      const noisy = `function tick(io) if io.noisy == 1 then for i = 1, 20 do io.log("x") end for i = 1, 32 do io.cool(1) end end end`;
      const a = vm({ instructionCap: 20_000 });
      a.tick({ ...SENSORS, noisy: 1 }, noisy);
      const after = a.tick({ ...SENSORS, noisy: 0 }, noisy).ramUsedBytes;
      const b = vm({ instructionCap: 20_000 });
      b.tick({ ...SENSORS, noisy: 0 }, noisy);
      const never = b.tick({ ...SENSORS, noisy: 0 }, noisy).ramUsedBytes;
      expect(Math.abs(after - never)).toBeLessThan(64);
      a.close();
      b.close();
    });

    it('counts the first sensor frame as part of the board, not as firmware data', () => {
      const tiny = `function tick() end`;
      const frame = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`sensor_${i}`, i]));
      const withSensors = vm();
      const a = withSensors.tick(frame, tiny).ramUsedBytes;
      const without = vm();
      const b = without.tick({}, tiny).ramUsedBytes;
      expect(Math.abs(a - b)).toBeLessThan(64);
      withSensors.close();
      without.close();
    });

    // The host allocates outside any protected call: the keys it writes into io, the text of an error value it reads.
    // A refused allocation there aborts the whole Lua runtime, so the RAM cap may hold only while firmware runs.
    it('reads a number error value on a board that is over its cap, instead of throwing', () => {
      const v = vm();
      expect(v.tick(SENSORS, FILL_TO_THE_BRIM).error?.kind).toBe('ram');
      // The room for this deploy lets 40 tables in, so the board ends the tick over its cap, with the error text still to read.
      const r = v.tick(SENSORS, `function tick(io, mem) for i = 1, 40 do mem[i] = {} end error(918273645) end`);
      expect(r.error).toEqual({ kind: 'runtime', message: '918273645' });
      v.close();
    });

    it('writes a sensor the board has not seen before while it is over its cap, instead of throwing', () => {
      const v = vm();
      expect(v.tick(SENSORS, FILL_TO_THE_BRIM).error?.kind).toBe('ram');
      // A recovery tick that keeps 40 more tables than the cap allows: the room is for starting, and the board is over its cap.
      const recover = `function tick(io, mem) if not mem.done then mem.done = true for i = 1, 40 do mem[i] = {} end end end`;
      expect(v.tick(SENSORS, recover).error).toBeNull();
      // The new key's name and its slot in io are allocated by the host.
      expect(() => v.tick({ ...SENSORS, never_seen_before: 7 }, null)).not.toThrow();
      v.close();
    });
  });

  describe('io across deploys', () => {
    it('gives each firmware a fresh io, so that only mem carries over', () => {
      const v = vm();
      const spoil = `function tick(io, mem)
        io.cool = 2 io.log = nil io.foo = 1 mem.kept = true
        setmetatable(io, { __index = function() return 0 end })
      end`;
      expect(v.tick(SENSORS, spoil).error).toBeNull();
      const r = v.tick(
        SENSORS,
        `function tick(io, mem) io.log(type(io.cool), io.foo, io.nothing, getmetatable(io), mem.kept, io.temp) io.cool(1) end`,
      );
      expect(r.error).toBeNull();
      expect(r.logs).toEqual(['function\tnil\tnil\tnil\ttrue\t70']);
      expect(r.queue).toEqual([2, 1]);
      v.close();
    });

    it('drops a protected metatable on io too', () => {
      const v = vm();
      expect(v.tick(SENSORS, `function tick(io) setmetatable(io, { __metatable = false }) end`).error).toBeNull();
      expect(v.tick(SENSORS, `function tick(io) io.log(getmetatable(io), io.temp) end`).logs).toEqual(['nil\t70']);
      v.close();
    });

    it("keeps the old firmware's io when a deploy does not compile", () => {
      const v = vm();
      expect(v.tick(SENSORS, `function tick(io) io.mark = (io.mark or 0) + 1 io.log(io.mark) end`).logs).toEqual(['1']);
      expect(v.tick(SENSORS, `function tick( end`).ok).toBe(false);
      // Still the same firmware, with the io it already had; a new one starts with a fresh io.
      expect(v.tick(SENSORS, null).logs).toEqual(['2']);
      expect(v.tick(SENSORS, `function tick(io) io.log(io.mark) end`).logs).toEqual(['nil']);
      v.close();
    });

    it('reads the same data after each deploy of the same firmware', () => {
      const v = vm();
      const readings = [0, 1, 2, 3].map(() => v.tick(SENSORS, `function tick() end`).ramUsedBytes);
      expect(Math.max(...readings) - Math.min(...readings)).toBeLessThan(64);
      v.close();
    });
  });

  describe('tostring', () => {
    // getmetatable shows a __metatable field in place of the real metatable, so a table can show one that has a
    // __tostring while its real metatable has none. No string that firmware can see may carry an address.
    const run = (body: string, kind: 'datacenter' | 'power' = 'datacenter') => {
      const v = vm({ kind });
      const r = v.tick(SENSORS, `function tick(io) ${body} end`);
      v.close();
      return r;
    };
    const DECOY = `local d = setmetatable({}, { __metatable = { __tostring = true } })`;

    it('prints no address for a table whose __metatable hides its real metatable', () => {
      const r = run(`${DECOY} io.log(tostring(d), string.format("%s", d), d) print(d)`);
      expect(r.logs).toEqual(['table\ttable\ttable', 'table']);
    });

    it('prints no address through any path', () => {
      const r = run(`${DECOY} local t = {}
        io.log(t, d, print, coroutine.create(print), io, tostring(t), tostring(d), string.format("%s|%s|%s", t, d, print))
        print(t, d, io)`);
      expect(r.logs).toHaveLength(2);
      for (const line of r.logs) expect(line).not.toMatch(/0x[0-9a-f]+/i);
    });

    it('calls the __tostring that getmetatable shows', () => {
      const r = run(
        `local d = setmetatable({}, { __metatable = { __tostring = function() return "decoy" end } }) io.log(tostring(d), string.format("%s", d), d)`,
      );
      expect(r.logs).toEqual(['decoy\tdecoy\tdecoy']);
    });

    it("prints no address in set_priority's error either", () => {
      const r = run(`${DECOY} io.set_priority({ d })`, 'power');
      expect(r.error?.message).toContain('unknown facility: table');
      expect(r.error?.message).not.toMatch(/0x[0-9a-f]+/i);
    });

    it('requires __tostring to return a string, as tostring does, and takes a number', () => {
      expect(run(`io.log(tostring(setmetatable({}, { __tostring = function() return {} end })))`).error?.message).toContain(
        "'__tostring' must return a string",
      );
      expect(run(`io.log(tostring(setmetatable({}, { __tostring = function() return 5 end })))`).logs).toEqual(['5']);
    });
  });

  describe('string.format', () => {
    // Runs the body as a tick on a fresh board.
    const run = (body: string) => {
      const v = vm();
      const r = v.tick(SENSORS, `function tick(io) ${body} end`);
      v.close();
      return r;
    };

    it('prints a table, a function and a coroutine as tostring does, with no address', () => {
      const r = run(`io.log(string.format("%s", {})) io.log(string.format("%s|%s|%s", {}, print, coroutine.create(print)))`);
      expect(r.logs).toEqual(['table', 'table|function|thread']);
    });

    it('prints a table through its __tostring, as tostring does', () => {
      const r = run(`io.log(string.format("[%s]", setmetatable({}, { __tostring = function() return "custom" end })))`);
      expect(r.logs).toEqual(['[custom]']);
    });

    it('does the same through the method syntax', () => {
      expect(run(`io.log(("%s"):format({}))`).logs).toEqual(['table']);
    });

    it.each([
      ['%p', '{}'],
      ['%5p', 'print'],
      ['%-5p', '{}'],
      ['%+p', '{}'],
      ['%.2p', '{}'],
      ['x %d %p', '1, {}'],
    ])('refuses the address conversion in %j', (fmt, args) => {
      const r = run(`io.log(string.format("${fmt}", ${args}))`);
      expect(r.ok).toBe(false);
      expect(r.error?.kind).toBe('runtime');
      expect(r.error?.message).toContain("bad argument #1 to 'format' (the %p conversion prints an address and is not available)");
    });

    it('refuses it through the method syntax too', () => {
      expect(run(`io.log(("%p"):format({}))`).error?.message ?? '(no error)').toContain('the %p conversion');
    });

    it('keeps %% working, also in front of a p', () => {
      const r = run(`io.log(string.format("100%%"), string.format("%%p"), string.format("%%%%p"), string.format("%dp", 5))`);
      expect(r.logs).toEqual(['100%\t%p\t%%p\t5p']);
    });

    it('takes a %p in an argument as text', () => {
      expect(run(`io.log(string.format("%s", "%p"))`).logs).toEqual(['%p']);
    });

    it('formats numbers, strings, nil and booleans as before, and keeps their places around a nil', () => {
      expect(run(`io.log(string.format("%5.1f|%d|%s|%q|%s|%s", 3.14159, 42, "x", "a", nil, true))`).logs).toEqual([
        '  3.1|42|x|"a"|nil|true',
      ]);
      expect(run(`io.log(string.format("%s|%s|%s", 1, nil, 3))`).logs).toEqual(['1|nil|3']);
      expect(run(`io.log(string.format("%s|%s", 1, nil))`).logs).toEqual(['1|nil']);
    });

    it('still names format when its first argument is not a string', () => {
      expect(run(`io.log(string.format(nil))`).error?.message).toContain("bad argument #1 to 'format'");
    });
  });

  describe('xpcall and coroutine.wrap', () => {
    // Lua keeps its hooks off while a hook runs, and switches them on again when a protected call catches the error the
    // hook raised. Firmware that runs before that is not counted by the cap. The real xpcall calls its message handler
    // inside lua_error. The real coroutine.wrap, like coroutine.close, runs the <close> handlers of a coroutine that
    // failed on that coroutine, and one that the cap killed died with its hooks off. So the prelude has its own xpcall
    // and wrap, and no close.
    const run = (body: string) => {
      const v = vm();
      const r = v.tick(SENSORS, `function tick(io) ${body} end`);
      v.close();
      return r;
    };

    it('does not call a message handler once the cap is hit', () => {
      const r = run(`xpcall(function() while true do end end, function() io.log("handler ran") return "x" end)`);
      expect(r.error?.kind).toBe('cpu');
      expect(r.logs).toEqual([]);
    });

    it('calls the message handler with the error after an ordinary error, and returns one value from it', () => {
      const r = run(
        `io.log(xpcall(function() error("boom", 0) end, function(...) io.log(select("#", ...), ...) return "handled", "dropped" end))`,
      );
      expect(r.logs).toEqual(['1\tboom', 'false\thandled']);
    });

    it('passes the arguments and the results of a call that succeeds through xpcall', () => {
      const r = run(`io.log(xpcall(function(a, b) return a + b, "x", nil end, function() end, 1, 2))`);
      expect(r.logs).toEqual(['true\t3\tx\tnil']);
    });

    it('refuses a message handler that is not a function, before it calls anything', () => {
      const r = run(`xpcall(function() io.log("ran") end)`);
      expect(r.error?.message ?? '(no error)').toMatch(/^firmware:1: bad argument #2 to 'xpcall' \(function expected/);
      expect(r.logs).toEqual([]);
    });

    it('does not close a coroutine that the cap killed, so its <close> handler does not run uncounted', () => {
      const r = run(
        `coroutine.wrap(function() local x <close> = setmetatable({}, { __close = function() io.log("closed") end }) while true do end end)()`,
      );
      expect(r.error?.kind).toBe('cpu');
      expect(r.logs).toEqual([]);
    });

    it('has no coroutine.close, and keeps the rest of the coroutine library', () => {
      const r = run(
        `io.log(type(coroutine.close), type(coroutine.wrap), type(coroutine.create), type(coroutine.resume), type(coroutine.yield))`,
      );
      expect(r.logs).toEqual(['nil\tfunction\tfunction\tfunction\tfunction']);
    });

    it('passes values both ways through coroutine.wrap, and ends a generic for', () => {
      const r = run(`
        local f = coroutine.wrap(function(a) local b = coroutine.yield(a * a) return b + 1 end)
        io.log(f(3), f(10))
        local seen = {}
        for v in coroutine.wrap(function() for i = 1, 3 do coroutine.yield(i * 10) end end) do seen[#seen + 1] = v end
        io.log(table.concat(seen, ","))
        io.log(coroutine.wrap(function() coroutine.yield(1, nil, 3) end)())`);
      expect(r.logs).toEqual(['9\t11', '10,20,30', '1\tnil\t3']);
    });

    it('raises the error object of a wrapped coroutine as it was, and refuses to resume a dead one', () => {
      const r = run(`
        local ok, e = pcall(coroutine.wrap(function() error({ code = 7 }) end))
        io.log(ok, type(e), e.code)
        local g = coroutine.wrap(function() error("boom", 0) end)
        io.log(select(2, pcall(g)))
        io.log(select(2, pcall(g)))`);
      expect(r.logs).toEqual(['false\ttable\t7', 'boom', 'cannot resume dead coroutine']);
    });
  });
});
