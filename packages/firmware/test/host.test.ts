import { type BootInfo, parseScenario, Session } from '@turing-city/core';
import { describe, expect, it, vi } from 'vitest';
import m1 from '../../../scenarios/m1-power.json' with { type: 'json' };
import { BoardVm } from '../src/board-vm.ts';
import { decodeActions, WasmoonHost } from '../src/host.ts';

describe('decodeActions', () => {
  it('turns the queue into actions, with facility ids', () => {
    expect(decodeActions([1, 2, 3, 3, 250, 4, 2, 3, 2, 5, 20], ['P', 'DA', 'DB'])).toEqual([
      { kind: 'process' },
      { kind: 'cool', level: 3 },
      { kind: 'setThermal', output: 250 },
      { kind: 'setPriority', order: ['DB', 'DA'] },
      { kind: 'sleep', seconds: 20 },
    ]);
  });
  it('stops at an unknown code', () => {
    expect(decodeActions([1, 9, 1], [])).toEqual([{ kind: 'process' }]);
  });
});

describe('WasmoonHost in a session', () => {
  it('runs deployed Lua, applies its actions, and reboots it after a sleep with empty mem', async () => {
    const session = new Session(parseScenario(m1), 7, await WasmoonHost.create());
    session.world.plant.thermalSetting = 300; // plenty of power once Task 9 adds it: DA's job is never shed
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
    expect(dc).toMatchObject({ jobFrom: 4, jobUntil: 7, cooling: 1 });
    for (let i = 0; i < 4; i++) session.step(); // second beat at 7: sleep 1 s
    const da = session.world.boards[1]!;
    expect(da.status).toBe('asleep');
    for (let i = 0; i < 20; i++) session.step(); // wakes at 27; beat at 27 reboots
    const logs = da.log.filter((l) => l.kind === 'log').map((l) => l.text);
    expect(logs).toEqual(['tick\t1', 'tick\t2', 'tick\t1']);
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
