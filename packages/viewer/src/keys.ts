import type { Connection } from './net.ts';
import type { Store } from './store.ts';
import { closeEditorWindow } from './ui/editor-window.ts';
import { escapeTarget } from './window-rules.ts';

/** Whether the key goes to something the player types in: a form field, or the firmware editor (CodeMirror's content is editable). */
function typing(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof Element && target.closest('.cm-editor') !== null;
}

/** Escape closes what is open, nearest first (the editor, keeping its text; the manual; the guide card), then clears the selection. */
function closeNearest(store: Store): void {
  switch (escapeTarget({ editor: store.editorFor !== null, manual: store.manualFor !== null, guide: store.guideOpen })) {
    case 'editor':
      closeEditorWindow(store);
      break;
    case 'manual':
      store.closeManual();
      break;
    case 'guide':
      store.closeGuide(false);
      break;
    case 'selection':
      store.select(null);
      break;
  }
}

/**
 * Space pauses or plays, 1-3 set the speed, H toggles the heatmap; none of them reach the game while the player types. Escape works
 * from anywhere, the editor and a focused checkbox included, except where something already took it: CodeMirror's own keys (closing
 * a completion list or its search panel) prevent the default, and an input method's Escape ends its composition.
 */
export function bindKeys(store: Store, net: Connection): void {
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!event.defaultPrevented && !event.isComposing && !event.repeat) closeNearest(store);
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
    }
  });
}
