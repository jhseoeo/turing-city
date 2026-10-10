import { readFileSync } from 'node:fs';
import {
  MICRO,
  parseScenario,
  replay,
  runSeason,
  type SeasonResult,
  Session,
  standInForThePlayer,
  stateHash,
  stepsPerDay,
} from '@turing-city/core';
import { WasmoonHost } from '@turing-city/firmware';
import { describe, expect, it } from 'vitest';
import { loadFirmwareDir } from '../src/firmware-files.ts';

const town = parseScenario(JSON.parse(readFileSync('scenarios/m2-town.json', 'utf8')));
const careless = loadFirmwareDir('scenarios/firmware/m2/careless');
const careful = loadFirmwareDir('scenarios/firmware/m2/careful');
const BOARDS = ['DA', 'DB', 'F1', 'F2', 'F3', 'P', 'W'];

/** A season the way `pnpm sim --rebuild` plays it: the firmware's boards installed at step 0, and repairs and rebuilds as the money allows. */
async function season(firmware: Record<string, string>, seed: number): Promise<SeasonResult> {
  return runSeason(town, seed, await WasmoonHost.create(), firmware, { install: Object.keys(firmware), autoRebuild: true });
}

describe('season checks', () => {
  it('has a firmware for every board of the town, in both sets', () => {
    expect(Object.keys(careless)).toEqual(BOARDS);
    expect(Object.keys(careful)).toEqual(BOARDS);
  });

  it.each([1, 2, 3])(
    'careful firmware completes its season and clearly beats careless firmware (seed %i)',
    async (seed) => {
      const a = await season(careless, seed);
      const b = await season(careful, seed);
      expect(b.ended).toMatchObject({ kind: 'completed' }); // the careful town is still standing when the season's last day is over
      expect(b.money).toBeGreaterThan(a.money + 1000);
    },
    120_000,
  );

  // Careless goes bankrupt on each of seeds 1 to 10, so "richer than careless" says nothing of the food chain. Seed 2 has wind for long
  // stretches, which leaves the farms, the warehouse, and the homes powered part of the season, and the careful firmware must feed the
  // town in them: its trucks drive, and the homes pay more tax than the food they began with could have earned.
  it('careful firmware runs the food chain: its trucks drive and its homes are fed beyond their first stock (seed 2)', async () => {
    const result = await season(careful, 2);
    const { startFood, foodPerPersonPerDay, taxPerPersonPerDay } = town.tuning.housing;
    const homes = town.facilities.filter((f) => f.kind === 'housing').length;
    // Each unit of food is a person's day, and each person's day pays its tax.
    const firstFoodTax = (homes * startFood * taxPerPersonPerDay) / foodPerPersonPerDay;
    expect(result.ledger.truckFuel).toBeGreaterThan(0);
    expect(result.ledger.tax).toBeGreaterThan(firstFoodTax * MICRO);
  }, 120_000);

  // Seed 1 has no raid; seeds 3 and 8 have raids, smashed facilities, repairs, and rebuilds, which a rerun must repeat step for step as well.
  it.each([
    { seed: 1, rebuilds: false },
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

  it('replays a recorded session with installs, hand work, deploys, repairs, and rebuilds into the same state on a fresh Lua runtime', async () => {
    // A town raided often, with the money to repair it: every kind of input turns up within a few days.
    const raw = JSON.parse(readFileSync('scenarios/m2-town.json', 'utf8'));
    raw.startMoney = 100_000;
    raw.tuning.emf.rumourThreshold = 20_000;
    const scenario = parseScenario(raw);
    const seed = 3;
    const day = stepsPerDay(scenario.time);
    const live = new Session(scenario, seed, await WasmoonHost.create());
    // The player installs four boards and gives DA a comm module; DA's firmware is the agent's.
    for (const id of ['P', 'DA', 'W', 'F1']) expect(live.install(id, 'board')).toEqual({ ok: true });
    expect(live.install('DA', 'comm')).toEqual({ ok: true });
    for (const id of ['P', 'DA', 'W', 'F1']) live.deploy(id, careful[id]!, id === 'DA' ? 'agent' : 'player');
    while (live.world.step < 8 * day && !live.world.ended) {
      const step = live.world.step;
      // The player's hands: DB is worked twice a second, F2 and F3 are harvested when ripe (an unripe harvest is refused and not
      // recorded), and the plant's thermal output is set once.
      if (step % 10 === 0) live.hand('DB', { kind: 'process' });
      if (step % 20 === 0) for (const id of ['F2', 'F3']) live.hand(id, { kind: 'harvest' });
      if (step === day) live.hand('P', { kind: 'setThermal', output: 100 });
      // Repairs, then rebuilds, as the money allows.
      for (const f of live.world.facilities) if (f.condition === 'wrecked') live.repair(f.id);
      for (const b of live.world.boards) if (b.status === 'destroyed') live.rebuild(b.id);
      // The agent swaps DA's firmware in mid-season, with the game paused.
      if (step === 4 * day) {
        live.mark('pause');
        live.deploy('DA', careless.DA!, 'agent');
        live.mark('resume');
      }
      live.step();
    }
    const kinds = [...new Set(live.record.inputs.map((i) => i.kind))].sort();
    expect(kinds).toEqual(['deploy', 'hand', 'install', 'pause', 'rebuild', 'repair', 'resume']);
    expect(live.record.inputs.some((i) => i.kind === 'deploy' && i.step === 4 * day)).toBe(true);

    const replayed = replay(scenario, seed, live.record, await WasmoonHost.create(), live.world.step);
    expect(replayed.world.step).toBe(live.world.step);
    expect(replayed.world.ended).toEqual(live.world.ended);
    expect(stateHash(replayed.world)).toBe(stateHash(live.world));
    expect(replayed.record.inputs).toEqual(live.record.inputs); // every input went in again, at its step, by whom it came from
    live.close();
    replayed.close();
  }, 120_000);

  it('replays a whole season, with a deploy in mid-season, repairs, and rebuilds, into the same state on a fresh Lua runtime', async () => {
    const seed = 8; // two facilities are smashed: repairs and rebuilds more than once
    const live = new Session(town, seed, await WasmoonHost.create());
    for (const id of BOARDS) expect(live.install(id, 'board')).toEqual({ ok: true });
    for (const id of BOARDS) live.deploy(id, careful[id]!);
    const swapAt = 10 * stepsPerDay(town.time);
    while (!live.world.ended) {
      // The player: repairs what is wrecked and rebuilds its board as soon as the money allows, and after ten days swaps one
      // board's firmware.
      standInForThePlayer(live);
      if (live.world.step === swapAt) {
        live.mark('pause');
        live.deploy('DA', careless.DA!);
        live.mark('resume');
      }
      live.step();
    }
    expect(live.world.ended).toMatchObject({ kind: 'completed' });
    const inputs = live.record.inputs;
    expect(inputs.filter((i) => i.kind === 'install').length).toBe(BOARDS.length);
    expect(inputs.some((i) => i.kind === 'deploy' && i.step === 0)).toBe(true);
    expect(inputs.some((i) => i.kind === 'deploy' && i.step === swapAt)).toBe(true);
    expect(inputs.filter((i) => i.kind === 'repair').length).toBeGreaterThan(1);
    expect(inputs.filter((i) => i.kind === 'rebuild').length).toBeGreaterThan(1);
    expect(inputs.map((i) => i.kind)).toEqual(expect.arrayContaining(['pause', 'resume']));

    const replayed = replay(town, seed, live.record, await WasmoonHost.create(), live.world.step);
    expect(replayed.world.step).toBe(live.world.step);
    expect(replayed.world.ended).toEqual(live.world.ended);
    expect(stateHash(replayed.world)).toBe(stateHash(live.world));
    expect(replayed.record.inputs).toEqual(live.record.inputs); // every input went in again, at its step, by whom it came from
    live.close();
    replayed.close();
  }, 120_000);
});
