import { describe, expect, it } from 'vitest';
import { FACILITY_ACTION, FIRMWARE_SOURCE, INSTALL_PART } from '../src/commands.ts';
import type { FacilityAction } from '../src/firmware-host.ts';

const takes = (action: unknown): boolean => FACILITY_ACTION.safeParse(action).success;
const label = (action: unknown): string => JSON.stringify(action).slice(0, 100);
/** A dispatch, good unless a field is changed. */
const dispatch = (fields: Record<string, unknown> = {}): unknown => ({
  kind: 'dispatch',
  truck: 1,
  from: 'F1',
  to: 'W',
  amount: 24,
  ...fields,
});

describe('command shapes', () => {
  it('takes every facility action, exactly', () => {
    const good: FacilityAction[] = [
      { kind: 'process' },
      { kind: 'cool' },
      { kind: 'setThermal', output: 120 },
      { kind: 'setPriority', order: ['H1', 'DA'] },
      { kind: 'harvest' },
      { kind: 'dispatch', truck: 1, from: 'F1', to: 'W', amount: 24 },
    ];
    for (const action of good) expect(FACILITY_ACTION.safeParse(action).success, JSON.stringify(action)).toBe(true);
  });

  it('refuses any other shape: an unknown kind, a field too many or missing, and numbers out of their range', () => {
    const bad: unknown[] = [
      {},
      { kind: 'fly' },
      { kind: 'process', seconds: 5 },
      { kind: 'cool', level: 2 }, // cooling is a cycle now, with no level
      { kind: 'setThermal' },
      { kind: 'setThermal', output: -1 },
      { kind: 'setThermal', output: 1.5 },
      { kind: 'setPriority', order: 'DA' },
      { kind: 'setPriority', order: [''] },
      { kind: 'dispatch', truck: 0, from: 'F1', to: 'W', amount: 24 },
      { kind: 'dispatch', truck: 1, from: 'F1', to: 'W' },
      { kind: 'dispatch', truck: 1, from: 'F1', to: 'W', amount: 0 },
      { kind: 'dispatch', truck: 1, from: 'X'.repeat(33), to: 'W', amount: 24 },
    ];
    for (const action of bad) expect(FACILITY_ACTION.safeParse(action).success, JSON.stringify(action)).toBe(false);
  });

  it('takes each number, id, and list up to its bound and no further', () => {
    const ids = (count: number): string[] => Array.from({ length: count }, () => 'H1');
    const edges: Array<[unknown, boolean]> = [
      [{ kind: 'setThermal', output: 0 }, true],
      [{ kind: 'setThermal', output: 1_000_000 }, true],
      [{ kind: 'setThermal', output: 1_000_001 }, false],
      [{ kind: 'setPriority', order: ids(64) }, true],
      [{ kind: 'setPriority', order: ids(65) }, false],
      [{ kind: 'setPriority', order: ['X'.repeat(32)] }, true],
      [{ kind: 'setPriority', order: ['X'.repeat(33)] }, false],
      [dispatch({ truck: 1 }), true],
      [dispatch({ truck: 64 }), true],
      [dispatch({ truck: 65 }), false],
      [dispatch({ amount: 1 }), true],
      [dispatch({ amount: 1_000_000 }), true],
      [dispatch({ amount: 1_000_001 }), false],
      [dispatch({ from: 'X'.repeat(32), to: 'X'.repeat(32) }), true],
      [dispatch({ from: '' }), false],
      [dispatch({ to: '' }), false],
      [dispatch({ to: 'X'.repeat(33) }), false],
    ];
    for (const [action, ok] of edges) expect(takes(action), label(action)).toBe(ok);
  });

  it('refuses a field too many on every kind, and a number or an id of the wrong type', () => {
    const bad: unknown[] = [
      { kind: 'setThermal', output: 1, level: 1 },
      { kind: 'setPriority', order: [], extra: 1 },
      { kind: 'harvest', truck: 1 },
      dispatch({ extra: 1 }),
      { kind: 'setThermal', output: '120' },
      { kind: 'setPriority', order: [1] },
      dispatch({ truck: 1.5 }),
      dispatch({ amount: 1.5 }),
      dispatch({ truck: '1' }),
      dispatch({ from: 5 }),
    ];
    for (const action of bad) expect(takes(action), label(action)).toBe(false);
  });

  it('takes a source of up to 64 KB with no NUL byte, and a board or a comm module to install', () => {
    expect(FIRMWARE_SOURCE.safeParse('x'.repeat(65_536)).success).toBe(true);
    expect(FIRMWARE_SOURCE.safeParse('x'.repeat(65_537)).success).toBe(false);
    expect(FIRMWARE_SOURCE.safeParse('function tick() end\u0000os.exit()').success).toBe(false);
    expect(FIRMWARE_SOURCE.safeParse(42).success).toBe(false);
    expect(INSTALL_PART.safeParse('board').success).toBe(true);
    expect(INSTALL_PART.safeParse('comm').success).toBe(true);
    expect(INSTALL_PART.safeParse('shield').success).toBe(false);
  });
});
