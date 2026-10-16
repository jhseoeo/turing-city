import { type FacilityView, FIRMWARE_SOURCE, MAX_FIRMWARE_CHARS } from '@turing-city/core';
import { describe, expect, it } from 'vitest';
import { deployResultText, installsAtLabel, manualFileName, sourceProblem, starterFirmware } from '../src/window-rules.ts';

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

  it('stops a source over the limit before it is sent, with a reason in Korean, and lets one at the limit go', () => {
    expect(sourceProblem('x'.repeat(65_536))).toBeNull();
    expect(sourceProblem('한'.repeat(65_536))).toBeNull(); // counted in characters, not bytes: the server counts them so
    expect(sourceProblem('x'.repeat(65_537))).toBe('펌웨어가 너무 길어요 (65,537자). 최대 65,536자까지 보낼 수 있어요.');
  });

  it('stops a source with a NUL character before it is sent, as the server would refuse it', () => {
    expect(sourceProblem('function tick(io)\u0000 end')).toBe(
      '코드에 NUL 문자(\\u0000)가 있어요. 보드가 그 자리에서 코드를 잘라 버리니 지우고 다시 보내세요.',
    );
    expect(FIRMWARE_SOURCE.safeParse('function tick(io)\u0000 end').success).toBe(false);
  });

  it("keeps the editor's limit the same as the server's", () => {
    expect(FIRMWARE_SOURCE.safeParse('x'.repeat(65_536)).success).toBe(true);
    expect(FIRMWARE_SOURCE.safeParse('x'.repeat(65_537)).success).toBe(false);
    expect(MAX_FIRMWARE_CHARS).toBe(65_536);
  });
});
