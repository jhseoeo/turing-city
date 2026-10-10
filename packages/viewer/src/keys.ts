import type { Connection } from './net.ts';
import type { Store } from './store.ts';

/** Space pauses or plays, 1-3 set the speed, H toggles the heatmap, Escape clears the selection. */
export function bindKeys(store: Store, net: Connection): void {
  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
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
      store.select(null);
    }
  });
}
