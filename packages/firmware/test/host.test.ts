import { parseScenario, Session } from '@turing-city/core';
import { describe, expect, it } from 'vitest';
import m1 from '../../../scenarios/m1-power.json' with { type: 'json' };
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
});
