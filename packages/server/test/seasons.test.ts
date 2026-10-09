import { readFileSync } from 'node:fs';
import { parseScenario, runSeason, type SeasonResult } from '@turing-city/core';
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
    },
    120_000,
  );

  it('gives the same result when run twice', async () => {
    const first = await season(careful, 7);
    const second = await season(careful, 7);
    expect(second.hash).toBe(first.hash);
    expect(second.money).toBe(first.money);
  }, 120_000);
});
