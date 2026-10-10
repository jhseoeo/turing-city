import type { Snapshot } from '@turing-city/core';
import { describe, expect, it } from 'vitest';
import { consumersOf, firmwareLabel, heatAlpha, ledOf, moneyLabel, timeLabel } from '../src/format.ts';

type Board = Snapshot['boards'][number];
const board = (over: Partial<Board>): Board => ({
  id: 'DA',
  kind: 'datacenter',
  x: 5,
  y: 4,
  status: 'running',
  powered: true,
  hasFirmware: true,
  erroring: false,
  tempC: 40,
  processing: false,
  cooling: 0,
  demand: 10,
  ...over,
});

describe('format', () => {
  it('labels money and time', () => {
    expect(moneyLabel(12400)).toBe('12,400');
    expect(moneyLabel(-30)).toBe('-30');
    expect(timeLabel({ day: 7, clock: '14:20', seconds: 0 }, 30)).toBe('7일차 14:20 / 30일');
  });

  it('picks a status light: destroyed, asleep, unpowered, error, no firmware, running', () => {
    expect(ledOf(board({ status: 'destroyed' }))).toBe('destroyed');
    expect(ledOf(board({ status: 'rebuilding' }))).toBe('destroyed');
    expect(ledOf(board({ status: 'asleep' }))).toBe('asleep');
    expect(ledOf(board({ powered: false }))).toBe('unpowered');
    expect(ledOf(board({ erroring: true }))).toBe('error');
    expect(ledOf(board({ hasFirmware: false }))).toBe('off');
    expect(ledOf(board({}))).toBe('running');
  });

  // A board's last tick keeps its error after the board is smashed, put to sleep, or shed, so the states really do overlap.
  it('keeps that order when states overlap: each light wins over the ones after it', () => {
    const everythingWrong = { powered: false, erroring: true, hasFirmware: false };
    expect(ledOf(board({ ...everythingWrong, status: 'destroyed' }))).toBe('destroyed');
    expect(ledOf(board({ ...everythingWrong, status: 'rebuilding' }))).toBe('destroyed');
    expect(ledOf(board({ ...everythingWrong, status: 'asleep' }))).toBe('asleep');
    expect(ledOf(board(everythingWrong))).toBe('unpowered');
    expect(ledOf(board({ erroring: true, hasFirmware: false }))).toBe('error');
  });

  it('names the firmware a board runs and the deploy waiting to install on it', () => {
    expect(firmwareLabel(null, null)).toBe('펌웨어 없음');
    expect(firmwareLabel(2, null)).toBe('펌웨어 v2');
    expect(firmwareLabel(null, 1)).toBe('설치 대기 v1');
    expect(firmwareLabel(2, 3)).toBe('펌웨어 v2 · 설치 대기 v3');
  });

  it('shades the heatmap from 1 EMF up, capped', () => {
    expect(heatAlpha(0)).toBe(0);
    expect(heatAlpha(50)).toBeCloseTo(0.3);
    expect(heatAlpha(10_000)).toBe(0.6);
  });

  it('starts the heat at exactly 1 EMF', () => {
    expect(heatAlpha(1)).toBeCloseTo(1 / 166, 5);
  });

  it("lists the plant's consumers with draw, priority, and shedding, only when the plant is selected", () => {
    const snapshot = {
      boards: [board({ id: 'P', kind: 'power' }), board({ id: 'DA', demand: 163 }), board({ id: 'DB', demand: 211 })],
      plant: { priority: ['DA', 'DB'], shed: ['DB'] },
    } as unknown as Snapshot;
    expect(consumersOf(snapshot, 'P')).toEqual([
      { id: 'DA', demand: 163, rank: 1, shed: false },
      { id: 'DB', demand: 211, rank: 2, shed: true },
    ]);
    expect(consumersOf(snapshot, 'DA')).toBeNull();
    expect(consumersOf(snapshot, null)).toBeNull();
  });
});
