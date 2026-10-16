import { describe, expect, it } from 'vitest';
import { FACILITY_ACTION, FIRMWARE_SOURCE, INSTALL_PART } from '../src/commands.ts';
import type { FacilityAction } from '../src/firmware-host.ts';

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

  it('hands back a fresh object, so that a caller keeps nothing of what a client sent', () => {
    const sent = { kind: 'setPriority', order: ['H1'] };
    const parsed = FACILITY_ACTION.parse(sent);
    expect(parsed).toEqual(sent);
    expect(parsed).not.toBe(sent);
    expect((parsed as { order: unknown }).order).not.toBe(sent.order);
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
