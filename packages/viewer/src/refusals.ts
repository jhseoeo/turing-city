import type { Refusal } from '@turing-city/core';

/** What the player reads when the server refuses something with no code of its own, or with one this viewer has no text for. */
const unknown = (message: string): string => `서버가 명령을 받아들이지 않았어요: ${message}`;

/**
 * A refusal of the server, in Korean (the server's own words are English, for agents and logs). Every code of core's Refusal has its
 * text here: a new code is a type error at the end of the switch until it gets one. A refusal with no code, or a code of a newer
 * server, is a Korean sentence that carries the server's English text.
 */
export function refusalText(message: string, refusal: Refusal | undefined): string {
  if (!refusal) return unknown(message);
  switch (refusal.code) {
    case 'noAgent':
      return '에이전트가 연결돼 있지 않아요. 에이전트를 연결한 뒤에 다시 해보세요.';
    case 'noSeason':
      return '시즌이 아직 시작되지 않았어요.';
    case 'crashed':
      return `시즌이 멈췄어요 (${refusal.reason}). 새 시즌을 시작할 수 있어요.`;
    case 'seasonEnded':
      return '시즌이 이미 끝나서 할 수 없어요.';
    case 'unknownBoard':
      return `'${refusal.board}' 보드는 없어요.`;
    case 'notDestroyed':
      return `'${refusal.board}' 보드는 부서진 상태가 아니라서 재건할 수 없어요.`;
    case 'tooPoor':
      return '자금이 모자라서 재건할 수 없어요.';
    case 'badCommand':
      return `서버가 알아듣지 못하는 명령이에요 (${refusal.detail}).`;
    default:
      return exhausted(refusal, message);
  }
}

/** Reached only with a code this viewer does not know; the parameter's type is `never` so that a handled code is not missing above. */
function exhausted(_refusal: never, message: string): string {
  return unknown(message);
}
