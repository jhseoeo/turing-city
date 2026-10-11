import { clear, el } from '../dom.ts';
import { createLuaEditor, type LuaEditor } from '../editor.ts';
import type { Connection } from '../net.ts';
import type { Store } from '../store.ts';
import { deployButton, deployResultText, starterFirmware } from '../window-rules.ts';

interface Mounted {
  readonly board: string;
  readonly host: HTMLElement;
  readonly result: HTMLElement;
  readonly deployButton: HTMLButtonElement;
  readonly deployReason: HTMLElement;
  editor: LuaEditor | null;
}

/** The window as it is in the page. The editor lives across renders: a snapshot (20 a second) must never rebuild what the player types. */
let mounted: Mounted | null = null;

/** Closes the editor, keeping its text as the board's draft for when it opens again ([×] and Escape). */
export function closeEditorWindow(store: Store): void {
  store.closeEditor(mounted?.editor?.getText());
}

/** 10-10 spec §10.4: the board's firmware in CodeMirror, [배포], and the server's answer under it. */
export function renderEditorWindow(root: HTMLElement, store: Store, net: Connection): void {
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
    mounted?.editor?.destroy();
    clear(root);
    const host = el('div', { class: 'cm-host' }, [el('p', { class: 'dim' }, ['불러오는 중…'])]);
    const result = el('div', { class: 'result' }, []);
    const deployReason = el('span', { class: 'dim reason' }, []);
    const deployBtn = el('button', { class: 'primary', onclick: () => deploy() }, ['배포']);
    const frame: Mounted = { board, host, result, deployButton: deployBtn, deployReason, editor: null };
    const deploy = (): void => {
      if (!frame.editor || !store.socketOpen) return;
      store.startDeploy(board); // the last answer is not about the code on screen any more; the next word is about this
      result.textContent = '보내는 중…';
      result.className = 'result dim';
      net.send({ type: 'deploy', board, code: frame.editor.getText() });
    };
    root.append(
      el('header', {}, [
        el('b', {}, [`${board} 펌웨어`]),
        deployReason,
        deployBtn,
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
      m.editor = createLuaEditor(m.host, draft ?? inspection?.pending?.source ?? inspection?.firmware?.source ?? starterFirmware(board));
      m.editor.focus();
    }
  }
  const button = deployButton(store.socketOpen);
  m.deployButton.disabled = button.disabled;
  m.deployButton.title = button.reason ?? '';
  m.deployReason.textContent = button.reason ?? '';
  const answer = store.deployResult?.board === board ? store.deployResult.outcome : null;
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
