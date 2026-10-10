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
};

const hangul = /[가-힣]/;

describe('refusalText', () => {
  it.each(Object.entries(SAMPLES))('says the %s refusal in Korean, with no sentence of the server in it', (_code, refusal) => {
    const text = refusalText('the server says this in English, for agents and logs', refusal);
    expect(text).toMatch(hangul);
    expect(text).not.toContain('the server says this');
    expect(text.trim()).not.toBe('');
  });

  it('names the board, the reason, or what was wrong, where the refusal has one', () => {
    expect(refusalText('x', SAMPLES.unknownBoard)).toContain('ZZ');
    expect(refusalText('x', SAMPLES.notDestroyed)).toContain('DA');
    expect(refusalText('x', SAMPLES.crashed)).toContain('the simulator stopped responding; the session stopped');
    expect(refusalText('x', SAMPLES.badCommand)).toContain('speed: Invalid input');
  });

  it('says what each of the five that the player meets says: no agent, not destroyed, too little money, the season over, a bad message', () => {
    expect(refusalText('x', SAMPLES.noAgent)).toBe('에이전트가 연결돼 있지 않아요. 에이전트를 연결한 뒤에 다시 해보세요.');
    expect(refusalText('x', SAMPLES.notDestroyed)).toBe("'DA' 보드는 부서진 상태가 아니라서 재건할 수 없어요.");
    expect(refusalText('x', SAMPLES.tooPoor)).toBe('자금이 모자라서 재건할 수 없어요.');
    expect(refusalText('x', SAMPLES.seasonEnded)).toBe('시즌이 이미 끝나서 할 수 없어요.');
    expect(refusalText('x', SAMPLES.badCommand)).toBe('서버가 알아듣지 못하는 명령이에요 (speed: Invalid input).');
  });

  it('falls back to a Korean sentence that carries the original text, for a refusal with no code or one it does not know', () => {
    const original = 'a new season started';
    expect(refusalText(original, undefined)).toBe(`서버가 명령을 받아들이지 않았어요: ${original}`);
    // A code that a newer server sends and this viewer has no text for.
    const newer = { code: 'somethingNew' } as unknown as Refusal;
    expect(refusalText(original, newer)).toBe(`서버가 명령을 받아들이지 않았어요: ${original}`);
  });
});
