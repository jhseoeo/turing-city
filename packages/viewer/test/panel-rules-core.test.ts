import {
  type CommandResult,
  type FacilityView,
  findFacility,
  MICRO,
  NullHost,
  parseScenario,
  Session,
  type Snapshot,
  snapshot,
  wreckFacility,
} from '@turing-city/core';
import { describe, expect, it } from 'vitest';
import townJson from '../../../scenarios/m2-town.json' with { type: 'json' };
import {
  type ButtonState,
  commButton,
  coolButton,
  dispatchAction,
  harvestButton,
  installButton,
  rebuildButton,
  repairButton,
  sendButton,
} from '../src/panel-rules.ts';
import type { DispatchDraft, DispatchTrip } from '../src/store.ts';

// The panel disables a button wherever its snapshot already says that the core would refuse the press (or take it and do nothing), so
// that a player rarely meets a refusal, which is the core's English. These tests hold the rules against the core they read.

const newTown = (): Session => new Session(parseScenario(townJson), 1, new NullHost());
const view = (s: Session, id: string): FacilityView => snapshot(s.ctx).facilities.find((f) => f.id === id)!;
const stepWhile = (s: Session, going: () => boolean): void => {
  for (let i = 0; going() && i < 3_000; i++) s.step();
  if (going()) throw new Error('the town never got there');
};
const wreck = (s: Session, id: string): void => wreckFacility(s.ctx, findFacility(s.world, id)!, s.world.step, 'luddites');
const poor = (s: Session): void => {
  s.world.money = 100 * MICRO;
};

describe('panel rules against the core: the hand', () => {
  it('harvests exactly when the crop is ripe, and not a wrecked farm', () => {
    const s = newTown();
    const press = (): CommandResult => s.hand('F1', { kind: 'harvest' });
    expect(harvestButton(view(s, 'F1')).disabled).toBe(true);
    expect(press().ok).toBe(false);
    stepWhile(s, () => !view(s, 'F1').farm!.ripe);
    expect(harvestButton(view(s, 'F1')).disabled).toBe(false);
    expect(press().ok).toBe(true);
    // The field is replanted at once: the next render finds the button off, and the core would refuse a second press.
    expect(harvestButton(view(s, 'F1')).disabled).toBe(true);
    expect(press().ok).toBe(false);
    wreck(s, 'F1');
    expect(harvestButton(view(s, 'F1')).disabled).toBe(true);
    expect(press().ok).toBe(false);
  });

  it('cools again only once the cycle is over, and a press during the cycle would change nothing', () => {
    const scenario = parseScenario(townJson);
    const cycleSteps = (scenario.tuning.datacenter.coolingCycleMs * scenario.time.stepsPerSecond) / 1000;
    const cycle = (pressAgainAt: number | null): number => {
      const s = newTown();
      // Power for the cycle: the plant at its maximum, and the datacenter first in the supply order.
      s.hand('P', { kind: 'setThermal', output: scenario.tuning.thermal.max });
      s.hand('P', { kind: 'setPriority', order: ['DA'] });
      expect(coolButton(view(s, 'DA')).disabled).toBe(false);
      expect(s.hand('DA', { kind: 'cool' }).ok).toBe(true);
      let steps = 0;
      while (view(s, 'DA').datacenter!.cooling && steps < 1_000) {
        // From the press on, at once, the button is off.
        expect(coolButton(view(s, 'DA')).disabled).toBe(true);
        // The core takes a press during the cycle and does nothing with it: the cycle ends when it would have.
        if (steps === pressAgainAt) expect(s.hand('DA', { kind: 'cool' }).ok).toBe(true);
        s.step();
        steps += 1;
      }
      expect(coolButton(view(s, 'DA')).disabled).toBe(false);
      return steps;
    };
    expect(cycleSteps).toBeGreaterThan(20);
    expect(cycle(null)).toBe(cycleSteps);
    expect(cycle(10)).toBe(cycleSteps);
  });

  it('sends a truck exactly when the core takes the dispatch: an idle truck, and food to deliver', () => {
    const s = newTown();
    const collect = (target: string): DispatchTrip => ({ kind: 'collect', target });
    const deliver = (target: string): DispatchTrip => ({ kind: 'deliver', target });
    /** [보내기] for a complete form: whether the button was usable, after checking that the core answers the same. */
    const press = (truck: number, trip: DispatchTrip, amount: number): boolean => {
      const draft: DispatchDraft = { truck, trip, amount };
      const state = sendButton(snapshot(s.ctx), view(s, 'W'), draft);
      const result = s.hand('W', dispatchAction(draft, 'W')!);
      expect(!state.disabled, `${JSON.stringify(draft)}: the button ${JSON.stringify(state)}, the core ${JSON.stringify(result)}`).toBe(
        result.ok,
      );
      return result.ok;
    };
    const idle = (truck: number): boolean => snapshot(s.ctx).trucks.find((t) => t.id === truck)!.status === 'idle';

    // The start: both trucks idle, and nothing in stock.
    expect(press(1, deliver('H1'), 20)).toBe(false);
    expect(press(1, collect('F1'), 20)).toBe(true);
    expect(press(1, collect('F2'), 20)).toBe(false); // truck 1 is out now
    expect(press(2, collect('F2'), 20)).toBe(true);
    expect(press(1, collect('F1'), 20)).toBe(false); // and so is truck 2: no truck is idle
    expect(press(2, collect('F1'), 20)).toBe(false);

    // Food: the crop of F1 ripens while the trucks come home; harvested and brought in, it is the warehouse's stock.
    stepWhile(s, () => !view(s, 'F1').farm!.ripe);
    expect(s.hand('F1', { kind: 'harvest' }).ok).toBe(true);
    expect(press(1, collect('F1'), 40)).toBe(true);
    stepWhile(s, () => !idle(1));
    expect(view(s, 'W').warehouse!.stock).toBeGreaterThan(0);

    // A delivery that empties the stock goes; the next one finds nothing to load, with a truck idle and the form complete.
    expect(press(1, deliver('H1'), 40)).toBe(true);
    expect(view(s, 'W').warehouse!.stock).toBe(0);
    expect(idle(2)).toBe(true);
    expect(press(2, deliver('H2'), 20)).toBe(false);
    expect(press(2, collect('F3'), 20)).toBe(true); // a collection needs no stock
  });
});

describe('panel rules against the core: the hardware', () => {
  type Command = 'install' | 'comm' | 'repair' | 'rebuild';
  const COMMANDS: Record<
    Command,
    { button: (s: Snapshot, f: FacilityView) => ButtonState | null; press: (s: Session, id: string) => CommandResult }
  > = {
    install: { button: installButton, press: (s, id) => s.install(id, 'board') },
    comm: { button: commButton, press: (s, id) => s.install(id, 'comm') },
    repair: { button: repairButton, press: (s, id) => s.repair(id) },
    rebuild: { button: rebuildButton, press: (s, id) => s.rebuild(id) },
  };

  /**
   * Which of the four commands the panel lets the player press for a facility in the state `setup` leaves it in. Each is tried in a
   * town of its own (a press that the core takes changes the town), and the button must agree with the core's answer.
   */
  function usable(id: string, setup: (s: Session) => void): Record<Command, boolean> {
    const out = {} as Record<Command, boolean>;
    for (const [name, command] of Object.entries(COMMANDS) as Array<[Command, (typeof COMMANDS)[Command]]>) {
      const s = newTown();
      setup(s);
      const snap = snapshot(s.ctx);
      const state = command.button(snap, snap.facilities.find((f) => f.id === id)!);
      const result = command.press(s, id);
      const pressable = state !== null && !state.disabled;
      expect(pressable, `${name} of ${id}: the button ${JSON.stringify(state)}, the core ${JSON.stringify(result)}`).toBe(result.ok);
      out[name] = pressable;
    }
    return out;
  }
  const NONE = { install: false, comm: false, repair: false, rebuild: false };
  const withBoard = (s: Session): CommandResult => s.install('DA', 'board');
  const repaired = (s: Session): void => {
    s.repair('DA');
    stepWhile(s, () => view(s, 'DA').condition !== 'ok');
  };

  it('offers a board, then a comm module, then nothing, for the money they cost', () => {
    expect(usable('DA', () => {})).toEqual({ ...NONE, install: true });
    expect(usable('DA', poor)).toEqual(NONE);
    expect(usable('DA', withBoard)).toEqual({ ...NONE, comm: true });
    expect(
      usable('DA', (s) => {
        withBoard(s);
        poor(s);
      }),
    ).toEqual(NONE);
    expect(
      usable('DA', (s) => {
        withBoard(s);
        s.install('DA', 'comm');
      }),
    ).toEqual(NONE);
  });

  it('offers a housing block nothing', () => {
    expect(usable('H1', () => {})).toEqual(NONE);
  });

  it('offers the repair of a wreck, and nothing else but the repair, while it is wrecked', () => {
    expect(usable('DA', (s) => wreck(s, 'DA'))).toEqual({ ...NONE, repair: true });
    expect(
      usable('DA', (s) => {
        wreck(s, 'DA');
        poor(s);
      }),
    ).toEqual(NONE);
    expect(
      usable('DA', (s) => {
        withBoard(s);
        wreck(s, 'DA');
      }),
    ).toEqual({ ...NONE, repair: true });
  });

  it('offers nothing while a repair is under way, the board rebuild included', () => {
    expect(
      usable('DA', (s) => {
        withBoard(s);
        wreck(s, 'DA');
        s.repair('DA');
      }),
    ).toEqual(NONE);
    expect(
      usable('DA', (s) => {
        wreck(s, 'DA');
        s.repair('DA');
      }),
    ).toEqual(NONE);
  });

  it('offers the board rebuild once the facility stands again, for the money, and nothing while it is rebuilt', () => {
    const wreckedBoard = (s: Session): void => {
      withBoard(s);
      wreck(s, 'DA');
    };
    expect(
      usable('DA', (s) => {
        wreckedBoard(s);
        repaired(s);
      }),
    ).toEqual({ ...NONE, rebuild: true });
    expect(
      usable('DA', (s) => {
        wreckedBoard(s);
        repaired(s);
        poor(s);
      }),
    ).toEqual(NONE);
    expect(
      usable('DA', (s) => {
        wreckedBoard(s);
        repaired(s);
        s.rebuild('DA');
      }),
    ).toEqual(NONE);
    // Rebuilt, the board stands again and takes a comm module.
    expect(
      usable('DA', (s) => {
        wreckedBoard(s);
        repaired(s);
        s.rebuild('DA');
        stepWhile(s, () => view(s, 'DA').board!.status !== 'running');
      }),
    ).toEqual({ ...NONE, comm: true });
  });
});
