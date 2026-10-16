import { describe, expect, it } from 'vitest';
import { startSleep, wreckFacility } from '../src/boards.ts';
import { MICRO } from '../src/fixed.ts';
import { stateHash } from '../src/hash.ts';
import { facilityDemand } from '../src/power.ts';
import { standInForThePlayer } from '../src/season.ts';
import { Session } from '../src/session.ts';
import { cellIndex, findBoard, findFacility } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario, m2Scenario } from './helpers/scenarios.ts';

/** Plenty of steady power and no raids of their own: a test brings the Luddites or the fire it wants. */
function quiet(change?: Parameters<typeof m1Scenario>[0]): Session {
  return new Session(
    m1Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.emf.rumourThreshold = 1_000_000_000;
      change?.(j);
    }),
    1,
    new FakeHost(),
  );
}

function steps(s: Session, n: number): void {
  for (let i = 0; i < n; i++) s.step();
}

/** Puts a group of Luddites next to a facility whose cell is the loudest in town, on a step that is a Luddite beat. */
function ludditesNextTo(s: Session, id: string): void {
  const f = findFacility(s.world, id)!;
  s.world.luddites.push({
    id: s.world.nextLudditeId++,
    x: f.x - 1,
    y: f.y,
    size: 3,
    targetId: null,
    quietSince: null,
    leaving: false,
    warned: [],
  });
  s.world.emf[cellIndex(s.scenario, f.x, f.y)] = 100_000;
}

describe('wrecks, repairs, and rebuilds', () => {
  it('lets Luddites wreck the facility they reach, board and all, and says so', () => {
    const s = quiet();
    ludditesNextTo(s, 'DB');
    s.step();
    const db = findFacility(s.world, 'DB')!;
    expect(db.condition).toBe('wrecked');
    expect(findBoard(s.world, 'DB')!.status).toBe('destroyed');
    expect(findBoard(s.world, 'DB')!.log.at(-1)).toMatchObject({ kind: 'system', text: 'smashed by Luddites' });
    expect(s.world.alerts.filter((a) => a.kind === 'wrecked')).toMatchObject([
      { step: 0, facilityId: 'DB', message: 'DB 시설이 부서졌어요 (러다이트)' },
    ]);
    expect(s.world.stats.wrecks).toBe(1);
    expect(facilityDemand(s.ctx, db, 1)).toBe(0); // a wrecked facility draws nothing
  });

  it('lets a fire wreck a datacenter, board and all', () => {
    const s = quiet((j) => {
      j.tuning.datacenter.firePermillePerDegreePerSecond = 1_000_000; // any step above 90 °C burns
    });
    s.world.datacenters.DA!.tempMilli = 120_000;
    s.step();
    expect(findFacility(s.world, 'DA')!.condition).toBe('wrecked');
    expect(findBoard(s.world, 'DA')!.status).toBe('destroyed');
    expect(s.world.alerts.filter((a) => a.kind === 'wrecked').map((a) => a.message)).toEqual(['DA 시설이 부서졌어요 (화재)']);
  });

  it("ends a wrecked datacenter's job and cooling cycle, and counts a wreck once however often it is hit", () => {
    const s = quiet();
    const dc = s.world.datacenters.DA!;
    Object.assign(dc, { busyFrom: 0, busyUntil: 1000, coolFrom: 0, coolUntil: 80 });
    const da = findFacility(s.world, 'DA')!;
    wreckFacility(s.ctx, da, 0, 'luddites');
    wreckFacility(s.ctx, da, 0, 'fire');
    expect(dc).toMatchObject({ busyFrom: -1, busyUntil: -1, coolFrom: -1, coolUntil: -1 });
    expect(s.world.stats.wrecks).toBe(1);
    expect(s.world.alerts.filter((a) => a.kind === 'wrecked')).toHaveLength(1);
  });

  it("repairs a wrecked facility for its kind's price over the repair time; its board stays destroyed until it is rebuilt", () => {
    const s = quiet();
    wreckFacility(s.ctx, findFacility(s.world, 'DB')!, 0, 'luddites');
    const before = s.world.money;
    expect(s.repair('DB')).toEqual({ ok: true });
    const db = findFacility(s.world, 'DB')!;
    expect(s.world.money).toBe(before - 500 * MICRO);
    expect(s.world.ledger.repairs).toBe(500 * MICRO);
    expect(db).toMatchObject({ condition: 'repairing', repairReadyAt: 400 });
    steps(s, 400);
    expect(db.condition).toBe('repairing');
    expect(findBoard(s.world, 'DB')!.log.at(-1)).toMatchObject({ text: 'smashed by Luddites' });
    steps(s, 1);
    expect(db).toMatchObject({ condition: 'ok', repairReadyAt: null });
    expect(findBoard(s.world, 'DB')!.status).toBe('destroyed');
    expect(findBoard(s.world, 'DB')!.log.at(-1)).toMatchObject({ kind: 'system', text: 'facility repaired' });
    expect(s.record.inputs).toEqual([{ step: 0, kind: 'repair', facilityId: 'DB' }]);
  });

  it('replants a repaired farm: the crop it had before the wreck is lost', () => {
    const s = new Session(
      m2Scenario((j) => (j.tuning.emf.rumourThreshold = 1_000_000_000)),
      1,
      new FakeHost(),
    );
    steps(s, 100);
    expect(s.world.farms.F1!.plantedAt).toBe(0);
    wreckFacility(s.ctx, findFacility(s.world, 'F1')!, 100, 'luddites');
    expect(s.repair('F1')).toEqual({ ok: true });
    expect(s.world.ledger.repairs).toBe(150 * MICRO);
    steps(s, 401); // the repair takes 20 s, 400 steps, and is done at step 500
    expect(findFacility(s.world, 'F1')!.condition).toBe('ok');
    expect(s.world.farms.F1!.plantedAt).toBe(500);
    expect(s.world.farms.F2!.plantedAt).toBe(0);
  });

  it("lets a datacenter's job and cooling cycle run their course while its board sleeps: a sleep stops only the board", () => {
    const s = quiet((j) => (j.tuning.thermal.max = 2000));
    s.world.plant.thermalSetting = 1000; // enough for the job and the cycle: a shed datacenter would not work either
    const dc = s.world.datacenters.DA!;
    Object.assign(dc, { busyFrom: 0, busyUntil: 1000, coolFrom: 0, coolUntil: 80 });
    startSleep(s.ctx, findBoard(s.world, 'DA')!, 0, 5);
    expect(dc).toMatchObject({ busyFrom: 0, busyUntil: 1000, coolFrom: 0, coolUntil: 80 });
    expect(findBoard(s.world, 'DA')!.status).toBe('asleep');
    dc.tempMilli = 60_000;
    steps(s, 1);
    expect(s.world.ledger.datacenterIncome).toBeGreaterThan(0);
    expect(dc.tempMilli).toBeLessThan(60_000); // the cycle's drop outweighs the job's heat
  });

  it("charges the repair of the facility's own kind, from the scenario", () => {
    const s = quiet((j) => {
      j.tuning.repair = { cost: { farm: 1, warehouse: 2, power: 300, datacenter: 4 }, seconds: 5 };
    });
    wreckFacility(s.ctx, findFacility(s.world, 'P')!, 0, 'luddites');
    wreckFacility(s.ctx, findFacility(s.world, 'DA')!, 0, 'luddites');
    s.repair('P');
    s.repair('DA');
    expect(s.world.ledger.repairs).toBe(304 * MICRO);
    expect(findFacility(s.world, 'P')!.repairReadyAt).toBe(100);
  });

  it('refuses a repair it cannot make, and charges and records nothing', () => {
    const s = quiet();
    wreckFacility(s.ctx, findFacility(s.world, 'DA')!, 0, 'luddites');
    expect(s.repair('ZZ')).toEqual({ ok: false, reason: 'unknown facility ZZ', refusal: { code: 'unknownFacility', facility: 'ZZ' } });
    expect(s.repair('DB')).toEqual({ ok: false, reason: 'DB is not wrecked', refusal: { code: 'notWrecked', facility: 'DB' } });
    s.world.money = 499 * MICRO;
    const hash = stateHash(s.world);
    expect(s.repair('DA')).toEqual({ ok: false, reason: 'not enough money', refusal: { code: 'tooPoor' } });
    expect(stateHash(s.world)).toBe(hash);
    s.world.money = 5000 * MICRO;
    expect(s.repair('DA')).toEqual({ ok: true });
    expect(s.repair('DA')).toEqual({
      ok: false,
      reason: 'DA is already being repaired',
      refusal: { code: 'alreadyRepairing', facility: 'DA' },
    });
    expect(s.record.inputs).toEqual([{ step: 0, kind: 'repair', facilityId: 'DA' }]);
  });

  it('refuses a repair once the season has ended', () => {
    const s = quiet((j) => {
      j.time.secondsPerDay = 1;
      j.time.seasonDays = 1;
    });
    wreckFacility(s.ctx, findFacility(s.world, 'DA')!, 0, 'luddites');
    steps(s, 20);
    expect(s.repair('DA')).toEqual({ ok: false, reason: 'the season has ended', refusal: { code: 'seasonEnded' } });
  });

  it('rebuilds a board only once its facility stands again', () => {
    const s = quiet();
    wreckFacility(s.ctx, findFacility(s.world, 'DA')!, 0, 'fire');
    const refused = {
      ok: false,
      reason: 'DA must be repaired before its board is rebuilt',
      refusal: { code: 'repairFirst', facility: 'DA' },
    };
    expect(s.rebuild('DA')).toEqual(refused);
    s.repair('DA');
    expect(s.rebuild('DA')).toEqual(refused); // still being repaired
    steps(s, 401);
    expect(s.rebuild('DA')).toEqual({ ok: true });
    expect(findBoard(s.world, 'DA')!.status).toBe('rebuilding');
  });

  it('loses a rebuild under way when its facility is wrecked again', () => {
    const s = quiet();
    const da = findBoard(s.world, 'DA')!;
    da.status = 'destroyed';
    s.rebuild('DA');
    expect(da.status).toBe('rebuilding');
    wreckFacility(s.ctx, findFacility(s.world, 'DA')!, 0, 'luddites');
    expect(da).toMatchObject({ status: 'destroyed', readyAt: null });
  });

  it('stands in for the player of a headless season: repairs what is wrecked, then rebuilds its board, as the money allows', () => {
    const s = quiet();
    wreckFacility(s.ctx, findFacility(s.world, 'DA')!, 0, 'luddites');
    s.world.money = 499 * MICRO;
    standInForThePlayer(s);
    expect(findFacility(s.world, 'DA')!.condition).toBe('wrecked'); // a repair costs 500
    s.world.money = 5000 * MICRO;
    standInForThePlayer(s);
    expect(findFacility(s.world, 'DA')!.condition).toBe('repairing');
    expect(findBoard(s.world, 'DA')!.status).toBe('destroyed'); // not before the facility stands
    steps(s, 401);
    standInForThePlayer(s);
    expect(findBoard(s.world, 'DA')!.status).toBe('rebuilding');
    expect(s.record.inputs.map((i) => i.kind)).toEqual(['repair', 'rebuild']);
  });
});
