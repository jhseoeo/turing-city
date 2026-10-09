import { Worker } from 'node:worker_threads';
import type { TickErrorKind } from '@turing-city/core';
import { describe, expect, it } from 'vitest';
import type { TickReport } from './hostile-worker.ts';

/** A tick may take this long at most, on any machine that runs the tests. */
const BUDGET_MS = 250;
/** A worker still busy after this long is stuck in a tick: the case found a hole. */
const HANG_MS = 3000;
const ALIVE = 'function tick(io) io.log("still alive") end';

/**
 * Runs ticks on a fresh board in a worker thread, so a tick that never ends fails its test instead of freezing the run.
 * Node strips the worker's types itself and warns about that once per thread: runtime.test.ts silences it the same way.
 */
function runTicks(sources: ReadonlyArray<string | null>): Promise<TickReport[] | 'hung'> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./hostile-worker.ts', import.meta.url), {
      workerData: sources,
      execArgv: ['--disable-warning=ExperimentalWarning'],
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      resolve('hung');
    }, HANG_MS);
    worker.once('message', (reports: TickReport[]) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(reports);
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

const CASES: ReadonlyArray<readonly [string, string, TickErrorKind]> = [
  ['an infinite loop', 'function tick() while true do end end', 'cpu'],
  ['a tail-call loop', 'local function f() return f() end function tick() f() end', 'cpu'],
  ['loops inside pcall', 'function tick() for i = 1, 1e9 do pcall(function() while true do end end) end end', 'cpu'],
  ['a loop inside a coroutine', 'function tick() coroutine.wrap(function() while true do end end)() end', 'cpu'],
  [
    'a coroutine kept in mem',
    'function tick(io, mem) mem.co = mem.co or coroutine.create(function() while true do coroutine.yield() end end) for i = 1, 1e9 do coroutine.resume(mem.co) end end',
    'cpu',
  ],
  ['runaway recursion', 'local function f(n) return f(n + 1) + 1 end function tick() f(1) end', 'ram'],
  ['a huge string.rep', 'function tick() local s = string.rep("x", 1e9) end', 'cpu'],
  ['a doubling string', 'function tick() local s = "x" while true do s = s .. s end end', 'ram'],
  ['a growing table', 'function tick(io, mem) mem.t = {} for i = 1, 1e9 do mem.t[i] = i end end', 'ram'],
  ['many coroutines', 'function tick(io, mem) mem.c = {} for i = 1, 1e9 do mem.c[i] = coroutine.create(function() end) end end', 'ram'],
  [
    'table.concat in a loop',
    'function tick() local t = {} for i = 1, 50 do t[i] = "xxxxxxxxxx" end for j = 1, 1e9 do table.concat(t) end end',
    'cpu',
  ],
  [
    'table.sort in a loop',
    'function tick() local t = {} for i = 1, 200 do t[i] = 200 - i end for j = 1, 1e9 do table.sort(t) end end',
    'cpu',
  ],
  ['a huge table.unpack', 'function tick() local t = {1} return table.unpack(t, 1, 1e8) end', 'cpu'],
  [
    'string.byte over a whole string, in a loop',
    'function tick() local s = string.rep("a", 100) for i = 1, 1e9 do string.byte(s, 1, -1) end end',
    'cpu',
  ],
  ['a gsub pattern bomb', 'function tick() return string.gsub(string.rep("a", 400), ".-.-.-b", "") end', 'runtime'],
  ['a pattern via the method syntax', 'function tick() return ("aaaa"):match("(a+)+b") end', 'runtime'],
  ['a to-be-closed loop', 'function tick() local x <close> = setmetatable({}, { __close = function() while true do end end }) end', 'cpu'],
  [
    'an __index loop on mem',
    'function tick(io, mem) setmetatable(mem, { __index = function() while true do end end }) return mem.missing end',
    'cpu',
  ],
  // Builtins whose C loop runs long on tiny input, or whose charge could come out negative or NaN
  // (a negative or NaN charge would turn the cap off for the rest of the tick, so each ends in a loop).
  ['string.rep of an empty string', 'function tick() string.rep("", math.maxinteger) end', 'cpu'],
  ['string.rep of an empty string by method', 'function tick() (""):rep(1 << 40, "") end', 'cpu'],
  ['string.rep whose size overflows', 'function tick() pcall(string.rep, "ab", 1 << 62) while true do end end', 'cpu'],
  ['table.concat over a negative range', 'function tick() table.concat({}, "xxxxxxxx", 1, -(1 << 50)) while true do end end', 'cpu'],
  ['table.concat up to NaN', 'function tick() pcall(table.concat, {}, "x", 1, 0/0) while true do end end', 'cpu'],
  [
    'string.upper of a table whose length is NaN',
    'function tick() pcall(string.upper, setmetatable({}, { __len = function() return 0/0 end })) while true do end end',
    'cpu',
  ],
  [
    'string.format of a table with a negative length',
    'function tick() pcall(string.format, setmetatable({}, { __len = function() return -1e18 end })) while true do end end',
    'cpu',
  ],
  [
    'table.insert into a table whose __len is huge',
    'function tick() table.insert(setmetatable({}, { __len = function() return 1 << 40 end }), 1, 0) end',
    'cpu',
  ],
  [
    'table.remove from a table whose __len is huge',
    'function tick() table.remove(setmetatable({}, { __len = function() return 1 << 40 end }), 1) end',
    'cpu',
  ],
  [
    'table.sort whose charge overflows',
    'function tick() pcall(table.sort, setmetatable({}, { __len = function() return 1 << 62 end })) while true do end end',
    'cpu',
  ],
  ['table.unpack whose range overflows', 'function tick() pcall(table.unpack, {}, -(1 << 62), 1 << 62) while true do end end', 'cpu'],
  ['table.move whose range overflows', 'function tick() pcall(table.move, {}, -(1 << 62), 1 << 62, 1) while true do end end', 'cpu'],
  ['a huge table.move', 'function tick() table.move({}, 1, 1 << 40, 2) end', 'cpu'],
  ['string.byte whose range overflows', 'function tick() string.byte("abc", -(1 << 62), 1 << 62) while true do end end', 'cpu'],
];

describe('hostile firmware', () => {
  it.concurrent.each(CASES)('stops %s within budget and keeps the board usable', async (_name, source, kind) => {
    const reports = await runTicks([source, ALIVE]);
    expect(reports).not.toBe('hung');
    if (reports === 'hung') return;
    expect(reports[0]?.kind).toBe(kind);
    expect(reports[0]?.elapsedMs).toBeLessThan(BUDGET_MS);
    expect(reports[1]?.logs).toEqual(['still alive']);
  });

  it('does not run firmware metamethods outside a tick', async () => {
    // The firmware clears a sensor key and traps writes to io. When the host writes the next frame the key is absent, so the
    // trap would run there, outside the instruction count, unless the host writes with rawset.
    const reports = await runTicks([
      'function tick(io) io.temp = nil setmetatable(io, { __newindex = function() while true do end end }) end',
      null,
    ]);
    expect(reports).not.toBe('hung');
    if (reports === 'hung') return;
    expect(reports[1]?.kind).toBeNull();
    expect(reports[1]?.elapsedMs).toBeLessThan(BUDGET_MS);
  });

  it('reads an error object without calling its __tostring', async () => {
    const reports = await runTicks(['function tick() error(setmetatable({}, { __tostring = function() while true do end end })) end']);
    expect(reports).not.toBe('hung');
    if (reports === 'hung') return;
    expect(reports[0]).toMatchObject({ kind: 'runtime', message: '(error object: table)' });
  });
});
