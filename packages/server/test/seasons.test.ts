import { readFileSync } from 'node:fs';
import { MICRO, parseScenario, replay, runSeason, type SeasonResult, Session, stateHash, stepsPerDay } from '@turing-city/core';
import { WasmoonHost } from '@turing-city/firmware';
import { describe, expect, it } from 'vitest';
import { loadFirmwareDir } from '../src/firmware-files.ts';

const scenario = parseScenario(JSON.parse(readFileSync('scenarios/m1-power.json', 'utf8')));
const careless = loadFirmwareDir('scenarios/firmware/m1/careless');
const careful = loadFirmwareDir('scenarios/firmware/m1/careful');

async function season(firmware: Record<string, string>, seed: number): Promise<SeasonResult> {
  return runSeason(scenario, seed, await WasmoonHost.create(), firmware, { autoRebuild: true });
}

describe('season checks', () => {
  it('loads every BOARD.lua file of a directory', () => {
    expect(Object.keys(careful)).toEqual(['DA', 'DB', 'P']);
  });

  it.each([1, 2, 3])(
    'careful firmware clearly beats careless firmware (seed %i)',
    async (seed) => {
      const a = await season(careless, seed);
      const b = await season(careful, seed);
      expect(b.money).toBeGreaterThan(a.money + 1000);
      expect(b.ended).toMatchObject({ kind: 'completed' }); // the careful town is still standing when the season's last day is over
    },
    120_000,
  );

  // Seed 7 has no raid; seeds 3 and 8 have raids, boards smashed, and rebuilds, which a rerun must repeat step for step as well.
  it.each([
    { seed: 7, rebuilds: false },
    { seed: 3, rebuilds: true },
    { seed: 8, rebuilds: true },
  ])(
    'gives the same result when run twice (seed $seed)',
    async ({ seed, rebuilds }) => {
      const first = await season(careful, seed);
      const second = await season(careful, seed);
      expect(second.hash).toBe(first.hash);
      expect(second.money).toBe(first.money);
      expect(first.ledger.rebuild > 0, 'the season has rebuilds').toBe(rebuilds);
    },
    120_000,
  );

  it('replays a recorded session, with a deploy in mid-season and rebuilds, into the same state on a fresh Lua runtime', async () => {
    const seed = 3;
    const live = new Session(scenario, seed, await WasmoonHost.create());
    for (const id of Object.keys(careful).sort()) live.deploy(id, careful[id]!);
    const rebuildCost = scenario.tuning.rebuild.cost * MICRO;
    const swapAt = 10 * stepsPerDay(scenario.time);
    while (!live.world.ended) {
      // The player: rebuilds what is smashed as soon as the money allows, and after ten days swaps one board's firmware.
      for (const b of live.world.boards) if (b.status === 'destroyed' && live.world.money >= rebuildCost) live.rebuild(b.id);
      if (live.world.step === swapAt) {
        live.mark('pause');
        live.deploy('DA', careless.DA!);
        live.mark('resume');
      }
      live.step();
    }
    const inputs = live.record.inputs;
    expect(inputs.some((i) => i.kind === 'deploy' && i.step === 0)).toBe(true);
    expect(inputs.some((i) => i.kind === 'deploy' && i.step === swapAt)).toBe(true);
    expect(inputs.filter((i) => i.kind === 'rebuild').length).toBeGreaterThan(1);
    expect(inputs.map((i) => i.kind)).toEqual(expect.arrayContaining(['pause', 'resume']));

    const replayed = replay(scenario, seed, live.record, await WasmoonHost.create(), live.world.step);
    expect(replayed.world.step).toBe(live.world.step);
    expect(replayed.world.ended).toEqual(live.world.ended);
    expect(stateHash(replayed.world)).toBe(stateHash(live.world));
    live.close();
    replayed.close();
  }, 120_000);
});
