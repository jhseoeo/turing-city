import { clear, el } from '../dom.ts';
import { createLuaEditor, type LuaEditor } from '../editor.ts';
import type { GameLink } from '../net.ts';
import type { Store } from '../store.ts';
import { deployResultText, sourceProblem, starterFirmware } from '../window-rules.ts';

interface Mounted {
  readonly board: string;
  readonly host: HTMLElement;
  readonly result: HTMLElement;
  editor: LuaEditor | null;
  /**
   * The text that needs no draft: what the editor opened on, then the code of a deploy the server took. Only text that differs from
   * it is kept as a draft, which would otherwise hide (and on a deploy, overwrite) firmware the board got later, an agent's at T2.
   */
  baseline: string;
  /** The code of the last deploy sent, which becomes the baseline when the server takes it. */
  sent: string | null;
}

/** The window as it is in the page. The editor lives across renders: a snapshot (20 a second) must never rebuild what the player types. */
let mounted: Mounted | null = null;

/** The editor's text when the player changed it since the baseline; undefined when there is nothing of theirs to keep. */
function edited(m: Mounted | null): string | undefined {
  const text = m?.editor?.getText();
  return text !== undefined && text !== m?.baseline ? text : undefined;
}

/** Closes the editor, keeping what the player typed as the board's draft for when it opens again ([×] and Escape). */
export function closeEditorWindow(store: Store): void {
  store.closeEditor(edited(mounted));
}

/** 10-10 spec §10.4: the board's firmware in CodeMirror, [배포], and the server's answer under it. */
export function renderEditorWindow(root: HTMLElement, store: Store, net: GameLink): void {
  const board = store.editorFor;
  if (board === null) {
    mounted?.editor?.destroy();
    if (mounted !== null) clear(root);
    mounted = null;
    root.hidden = true;
    return;
  }
  root.hidden = false;
  if (mounted?.board !== board) {
    // Another board's editor opened without a close: what the player typed in the old one is kept as that board's draft.
    const typed = edited(mounted);
    if (mounted && typed !== undefined) store.keepDraft(mounted.board, typed);
    mounted?.editor?.destroy();
    clear(root);
    const host = el('div', { class: 'cm-host' }, [el('p', { class: 'dim' }, ['불러오는 중…'])]);
    const result = el('div', { class: 'result' }, []);
    const frame: Mounted = { board, host, result, editor: null, baseline: '', sent: null };
    const deploy = (): void => {
      if (!frame.editor) return;
      const code = frame.editor.getText();
      store.clearDeployResult(); // the last answer is not about the code on screen any more
      // A source over the limit would close the socket without a word: it is refused here, with the reason.
      const problem = sourceProblem(code);
      result.textContent = problem ?? '보내는 중…';
      result.className = problem ? 'result bad' : 'result dim';
      if (problem) return;
      frame.sent = code;
      net.send({ type: 'deploy', board, code });
    };
    root.append(
      el('header', {}, [
        el('b', {}, [`${board} 펌웨어`]),
        el('button', { class: 'primary', onclick: deploy }, ['배포']),
        el('button', { onclick: () => store.openManual(board) }, ['매뉴얼']),
        el('button', { class: 'close', title: '닫기', onclick: () => closeEditorWindow(store) }, ['×']),
      ]),
      host,
      result,
    );
    mounted = frame;
  }
  const m = mounted;
  if (!m) return;
  if (m.editor === null) {
    // The board's code comes with its inspection (asked twice a second for the selected board); a draft needs no wait.
    const draft = store.editorDrafts[board];
    const inspection = store.inspection?.board === board ? store.inspection.inspection : undefined;
    if (draft !== undefined || inspection !== undefined) {
      clear(m.host);
      m.baseline = draft ?? inspection?.pending?.source ?? inspection?.firmware?.source ?? starterFirmware(board);
      m.editor = createLuaEditor(m.host, m.baseline);
      m.editor.focus();
    }
  }
  const answer = store.deployResult?.board === board ? store.deployResult.outcome : null;
  // The server took the code: the board runs it now, so closing on it keeps no draft (the store has dropped the board's draft too).
  if (answer?.ok && m.sent !== null) m.baseline = m.sent;
  if (answer) {
    const { text, ok } = deployResultText(
      answer,
      store.snapshot?.facilities.find((f) => f.id === board),
    );
    if (m.result.textContent !== text) {
      m.result.textContent = text;
      m.result.className = `result ${ok ? 'ok' : 'bad'}`;
    }
  }
}
