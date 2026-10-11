import type { Refusal } from '@turing-city/core';
import { describe, expect, it } from 'vitest';
import { refusalText } from '../src/refusals.ts';

/** One refusal of every code. A Record, so that a code that core gets is a type error here until it is listed. */
const SAMPLES: Record<Refusal['code'], Refusal> = {
  noAgent: { code: 'noAgent' },
  noSeason: { code: 'noSeason' },
  crashed: { code: 'crashed', reason: 'the simulator stopped responding; the session stopped' },
  seasonEnded: { code: 'seasonEnded' },
  unknownBoard: { code: 'unknownBoard', board: 'ZZ' },
  notDestroyed: { code: 'notDestroyed', board: 'DA' },
  tooPoor: { code: 'tooPoor' },
  badCommand: { code: 'badCommand', detail: 'speed: Invalid input' },
  unknownFacility: { code: 'unknownFacility', facility: 'QQ' },
  noBoard: { code: 'noBoard', facility: 'F1' },
  takesNoBoard: { code: 'takesNoBoard', facility: 'H1' },
  alreadyInstalled: { code: 'alreadyInstalled', facility: 'DA', part: 'comm' },
  boardDown: { code: 'boardDown', facility: 'DB' },
  wrecked: { code: 'wrecked', facility: 'W' },
  notWrecked: { code: 'notWrecked', facility: 'P' },
  repairFirst: { code: 'repairFirst', facility: 'DA' },
  noComm: { code: 'noComm', board: 'F2' },
  cannotAct: { code: 'cannotAct', facility: 'F3', detail: 'nothing is ripe' },
};

const hangul = /[가-힣]/;

describe('refusalText', () => {
  it.each(Object.entries(SAMPLES))('says the %s refusal in Korean, with no sentence of the server in it', (_code, refusal) => {
    const text = refusalText('the server says this in English, for agents and logs', refusal);
    expect(text).toMatch(hangul);
    expect(text).not.toContain('the server says this');
    expect(text.trim()).not.toBe('');
  });

  it('names the facility, the board, the reason, or what was wrong, where the refusal has one', () => {
    expect(refusalText('x', SAMPLES.unknownBoard)).toContain('ZZ');
    expect(refusalText('x', SAMPLES.notDestroyed)).toContain('DA');
    expect(refusalText('x', SAMPLES.crashed)).toContain('the simulator stopped responding; the session stopped');
    expect(refusalText('x', SAMPLES.badCommand)).toContain('speed: Invalid input');
    expect(refusalText('x', SAMPLES.unknownFacility)).toContain('QQ');
    expect(refusalText('x', SAMPLES.noBoard)).toContain('F1');
    expect(refusalText('x', SAMPLES.takesNoBoard)).toContain('H1');
    expect(refusalText('x', SAMPLES.boardDown)).toContain('DB');
    expect(refusalText('x', SAMPLES.wrecked)).toContain('W');
    expect(refusalText('x', SAMPLES.notWrecked)).toContain('P');
    expect(refusalText('x', SAMPLES.repairFirst)).toContain('DA');
    expect(refusalText('x', SAMPLES.noComm)).toContain('F2');
    expect(refusalText('x', SAMPLES.cannotAct)).toContain('nothing is ripe');
    expect(refusalText('x', SAMPLES.cannotAct)).toContain('F3');
  });

  it('tells a second board from a second comm module', () => {
    expect(refusalText('x', { code: 'alreadyInstalled', facility: 'DA', part: 'board' })).toBe("'DA'에는 이미 보드가 있어요.");
    expect(refusalText('x', { code: 'alreadyInstalled', facility: 'DA', part: 'comm' })).toBe("'DA' 보드에는 이미 통신 모듈이 있어요.");
  });

  it('says what the refusals the player meets most say: too little money, a wrecked facility, the season over, a bad message', () => {
    expect(refusalText('x', SAMPLES.tooPoor)).toBe('자금이 모자라요.');
    expect(refusalText('x', SAMPLES.wrecked)).toBe("'W' 시설이 부서졌거나 복구 중이에요. 복구가 끝난 뒤에 해보세요.");
    expect(refusalText('x', SAMPLES.repairFirst)).toBe("'DA' 시설을 먼저 복구해야 보드를 재건할 수 있어요.");
    expect(refusalText('x', SAMPLES.seasonEnded)).toBe('시즌이 이미 끝나서 할 수 없어요.');
    expect(refusalText('x', SAMPLES.badCommand)).toBe('서버가 알아듣지 못하는 명령이에요 (speed: Invalid input).');
  });

  // No command of the viewer asks for an agent any more, but core still has the code and a newer server could send it.
  it('keeps the words for a refusal that needs an agent', () => {
    expect(refusalText('x', SAMPLES.noAgent)).toBe('에이전트가 연결돼 있지 않아요. 에이전트를 연결한 뒤에 다시 해보세요.');
  });

  it('falls back to a Korean sentence that carries the original text, for a refusal with no code or one it does not know', () => {
    const original = 'a new season started';
    expect(refusalText(original, undefined)).toBe(`서버가 명령을 받아들이지 않았어요: ${original}`);
    // A code that a newer server sends and this viewer has no text for.
    const newer = { code: 'somethingNew' } as unknown as Refusal;
    expect(refusalText(original, newer)).toBe(`서버가 명령을 받아들이지 않았어요: ${original}`);
  });
});
