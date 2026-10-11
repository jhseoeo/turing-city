import type { FacilityView } from '@turing-city/core';
import { describe, expect, it } from 'vitest';
import { deployButton, deployResultText, escapeTarget, installsAtLabel, manualFileName, starterFirmware } from '../src/window-rules.ts';

const facility = (board: FacilityView['board'], condition: FacilityView['condition'] = 'ok'): FacilityView => ({
  id: 'DA',
  kind: 'datacenter',
  x: 5,
  y: 4,
  tier: 1,
  condition,
  repairHoursLeft: null,
  powered: true,
  demand: 0,
  board,
  datacenter: { tempC: 30, processing: false, cooling: false },
  farm: null,
  warehouse: null,
  housing: null,
});
const board = (status: NonNullable<FacilityView['board']>['status'], powered = true): FacilityView['board'] => ({
  status,
  powered,
  hasFirmware: true,
  erroring: false,
});

describe('window rules', () => {
  it('says in Korean when a deploy installs, from what the board is doing', () => {
    expect(installsAtLabel(facility(board('running')))).toBe('보드의 다음 틱에 설치돼요');
    expect(installsAtLabel(facility(board('running', false)))).toBe('전력이 돌아오면 설치돼요');
    expect(installsAtLabel(facility(board('asleep')))).toBe('보드가 깨어나면 설치돼요');
    expect(installsAtLabel(facility(board('asleep', false)))).toBe('보드가 깨어나고 전력이 돌아오면 설치돼요');
    expect(installsAtLabel(facility(board('destroyed')))).toBe('보드를 재건하면 설치돼요');
    expect(installsAtLabel(facility(board('rebuilding')))).toBe('재건이 끝나면 설치돼요');
    expect(installsAtLabel(facility(board('destroyed'), 'wrecked'))).toBe('시설을 복구하고 보드를 재건하면 설치돼요');
    expect(installsAtLabel(facility(null))).toBe('보드가 없어요');
    expect(installsAtLabel(undefined)).toBe('보드가 없어요');
  });

  it("shows an accepted deploy's version with when it installs, and a syntax error with its line", () => {
    const f = facility(board('running'));
    expect(deployResultText({ ok: true, version: 3, installsAt: "the board's next tick" }, f)).toEqual({
      text: 'v3 배포됨 · 보드의 다음 틱에 설치돼요',
      ok: true,
    });
    expect(deployResultText({ ok: false, error: "firmware:2: '(' expected near 'end'" }, f)).toEqual({
      text: "2번째 줄: '(' expected near 'end'",
      ok: false,
    });
    expect(deployResultText({ ok: false, error: 'something else' }, f)).toEqual({ text: 'something else', ok: false });
  });

  it("names the downloaded manual after its board, or the index's after the game", () => {
    expect(manualFileName('DA')).toBe('turing-city-manual-DA.md');
    expect(manualFileName('index')).toBe('turing-city-manual.md');
  });

  it('starts a board with no firmware from a tick function that does nothing, and points to the manual', () => {
    const text = starterFirmware('F1');
    expect(text).toContain('function tick(io, mem)');
    expect(text).toContain('F1');
    expect(text).toContain('[매뉴얼]');
  });
});

describe('window rules: Escape', () => {
  const open = (editor: boolean, manual: boolean, guide: boolean) => ({ editor, manual, guide });

  it('closes the editor first, then the manual, then the guide card, and clears the selection when none is open', () => {
    expect(escapeTarget(open(true, true, true))).toBe('editor');
    expect(escapeTarget(open(false, true, true))).toBe('manual');
    expect(escapeTarget(open(false, false, true))).toBe('guide');
    expect(escapeTarget(open(false, false, false))).toBe('selection');
  });

  it('skips a window that is closed, whatever is open behind it', () => {
    expect(escapeTarget(open(true, false, false))).toBe('editor');
    expect(escapeTarget(open(true, false, true))).toBe('editor');
    expect(escapeTarget(open(false, true, false))).toBe('manual');
  });
});

describe('window rules: the deploy button', () => {
  it('is on while the socket is open', () => {
    expect(deployButton(true)).toEqual({ disabled: false, reason: null });
  });

  it('is off with a reason while the socket is closed, because a send then goes nowhere', () => {
    const state = deployButton(false);
    expect(state.disabled).toBe(true);
    expect(state.reason).toMatch(/연결/);
  });
});
