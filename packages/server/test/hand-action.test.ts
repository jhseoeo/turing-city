import type { FacilityAction } from '@turing-city/core';
import { describe, expect, it } from 'vitest';
import { exactAction } from '../src/hand-action.ts';

describe('exactAction', () => {
  const good: FacilityAction[] = [
    { kind: 'process' },
    { kind: 'cool' },
    { kind: 'harvest' },
    { kind: 'setThermal', output: 12 },
    { kind: 'setPriority', order: ['P', 'DA'] },
    { kind: 'setPriority', order: [] },
    { kind: 'dispatch', truck: 0, from: 'F1', to: 'W', amount: 40 },
  ];

  it('gives back every action of the core, equal to what it was given', () => {
    for (const action of good) expect(exactAction(action), JSON.stringify(action)).toEqual(action);
  });

  it('gives a fresh object, so the session never keeps the caller by reference', () => {
    const order = ['P', 'DA'];
    const given: FacilityAction = { kind: 'setPriority', order };
    const made = exactAction(given);
    expect(made).not.toBe(given);
    order.push('DB'); // what the caller does afterwards does not reach the copy
    expect(made).toEqual({ kind: 'setPriority', order: ['P', 'DA'] });
  });

  it('refuses anything of another shape: other kinds, extra or missing fields, and values of the wrong type', () => {
    const bad: unknown[] = [
      undefined,
      null,
      7,
      'process',
      [],
      {},
      { kind: 'nothing' },
      { kind: 'process', extra: 1 },
      { kind: 'cool', output: 1 },
      { kind: 'setThermal' },
      { kind: 'setThermal', output: '12' },
      { kind: 'setThermal', output: Number.NaN },
      { kind: 'setThermal', output: Number.POSITIVE_INFINITY },
      { kind: 'setPriority' },
      { kind: 'setPriority', order: 'P,DA' },
      { kind: 'setPriority', order: [1] },
      { kind: 'setPriority', order: ['x'.repeat(65)] },
      { kind: 'setPriority', order: Array.from({ length: 65 }, () => 'P') },
      { kind: 'setPriority', order: ['P'], extra: true },
      { kind: 'dispatch', truck: 0, from: 'F1', to: 'W' },
      { kind: 'dispatch', truck: 0.5, from: 'F1', to: 'W', amount: 40 },
      { kind: 'dispatch', truck: 0, from: 'F1', to: 'W', amount: 4.5 },
      { kind: 'dispatch', truck: 0, from: 1, to: 'W', amount: 40 },
    ];
    for (const raw of bad) expect(exactAction(raw), JSON.stringify(raw)).toBeNull();
  });
});
