import { type DeployOutcome, type FacilityView, MAX_FIRMWARE_CHARS } from '@turing-city/core';

/**
 * When a deploy installs, in Korean, from the board as the snapshot shows it. The server's own answer (installsAt) is English, for
 * agents; the same rule (a board ticks only when it stands, is awake, and has power) decides both.
 */
export function installsAtLabel(f: FacilityView | undefined): string {
  const b = f?.board;
  if (!f || !b) return '보드가 없어요';
  if (f.condition !== 'ok') return '시설을 복구하고 보드를 재건하면 설치돼요';
  switch (b.status) {
    case 'destroyed':
      return '보드를 재건하면 설치돼요';
    case 'rebuilding':
      return '재건이 끝나면 설치돼요';
    case 'asleep':
      return b.powered ? '보드가 깨어나면 설치돼요' : '보드가 깨어나고 전력이 돌아오면 설치돼요';
    case 'running':
      return b.powered ? '보드의 다음 틱에 설치돼요' : '전력이 돌아오면 설치돼요';
  }
}

/** The editor's line after a deploy: the version and when it installs, or Lua's syntax error with its line ("firmware:2: ..."). */
export function deployResultText(outcome: DeployOutcome, f: FacilityView | undefined): { text: string; ok: boolean } {
  if (outcome.ok) return { text: `v${outcome.version} 배포됨 · ${installsAtLabel(f)}`, ok: true };
  const syntax = /^firmware:(\d+):\s*([\s\S]*)$/.exec(outcome.error);
  return { text: syntax ? `${syntax[1]}번째 줄: ${syntax[2]}` : outcome.error, ok: false };
}

/** The file [.md 다운로드] saves. */
export function manualFileName(target: string | 'index'): string {
  return target === 'index' ? 'turing-city-manual.md' : `turing-city-manual-${target}.md`;
}

/** The firmware the editor starts from on a board that has none: a tick that does nothing, and where to read what it may do. */
export function starterFirmware(board: string): string {
  return `-- ${board} 보드의 펌웨어. 쓸 수 있는 io와 행동은 [매뉴얼]에 있어요.\nfunction tick(io, mem)\nend\n`;
}

/**
 * Why the editor will not send this code, in Korean, or null when it may. A frame over the socket's size limit closes the connection
 * with no reason, so a source over the game's limit (counted in characters, as the server counts it) is stopped here.
 */
export function sourceProblem(code: string): string | null {
  if (code.length <= MAX_FIRMWARE_CHARS) return null;
  return `펌웨어가 너무 길어요 (${code.length.toLocaleString('en-US')}자). 최대 ${MAX_FIRMWARE_CHARS.toLocaleString('en-US')}자까지 보낼 수 있어요.`;
}
