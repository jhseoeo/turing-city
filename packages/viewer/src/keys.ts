import type { GameLink } from './net.ts';
import type { Store } from './store.ts';
import { closeEditorWindow } from './ui/editor-window.ts';

/** Whether the key goes to the firmware editor: CodeMirror's content is an editable element, not an input. */
function inEditor(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.cm-editor') !== null;
}

/** Whether the key goes to something the player types in: a form field, or the firmware editor. */
function typing(target: EventTarget | null): boolean {
  // A checkbox or a radio button takes no text: the game's keys still work while one has the focus (the guide card's checkbox).
  if (target instanceof HTMLInputElement) return target.type !== 'checkbox' && target.type !== 'radio';
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || inEditor(target);
}

/**
 * Space pauses or plays, 1-3 set the speed, H toggles the heatmap. Escape closes what is open, nearest first (the editor, keeping its
 * text as a draft; the manual; the guide card), then clears the selection. While the player types code every key but Escape is the
 * code's, and Escape there closes the editor and nothing else.
 */
export function bindKeys(store: Store, net: GameLink): void {
  window.addEventListener('keydown', (event) => {
    if (inEditor(event.target)) {
      // CodeMirror takes some Escapes itself and marks them handled (collapsing a selection to its cursor): the window closes only on an
      // Escape the editor left alone.
      if (event.key === 'Escape' && !event.isComposing && !event.defaultPrevented && store.editorFor !== null) closeEditorWindow(store);
      return;
    }
    if (typing(event.target)) return;
    if (event.code === 'Space') event.preventDefault(); // else the page scrolls
    // A held key repeats keydown, and a held Space would flip pause and play at the repeat rate. With Cmd, Ctrl or Alt down a key is the
    // system's or the browser's shortcut (Cmd+H, Ctrl+1), not a command to the game.
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const state = store.status?.state;
    if (event.code === 'Space') {
      if (state === 'running') net.send({ type: 'pause' });
      else if (state === 'paused') net.send({ type: 'play' });
    } else if (event.key === '1' || event.key === '2' || event.key === '3') {
      net.send({ type: 'speed', speed: Number(event.key) as 1 | 2 | 3 });
    } else if (event.code === 'KeyH') {
      // By position, not by character: with the Korean input source on, Chrome reports this key as 'Process', and only its code is KeyH.
      store.toggleHeatmap();
    } else if (event.key === 'Escape') {
      if (store.editorFor !== null) closeEditorWindow(store);
      else if (store.manualFor !== null) store.closeManual();
      else if (store.guideOpen) store.closeGuide(false);
      else store.select(null);
    }
  });
}
