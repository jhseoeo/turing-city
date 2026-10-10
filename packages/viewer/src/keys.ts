import type { Connection } from './net.ts';
import type { Store } from './store.ts';

/** Space pauses or plays, 1-3 set the speed, H toggles the heatmap, Escape clears the selection. */
export function bindKeys(store: Store, net: Connection): void {
  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
    const state = store.status?.state;
    if (event.code === 'Space') {
      event.preventDefault();
      if (state === 'running') net.send({ type: 'pause' });
      else if (state === 'paused') net.send({ type: 'play' });
    } else if (event.key === '1' || event.key === '2' || event.key === '3') {
      net.send({ type: 'speed', speed: Number(event.key) as 1 | 2 | 3 });
    } else if (event.key === 'h' || event.key === 'H') {
      store.toggleHeatmap();
    } else if (event.key === 'Escape') {
      store.select(null);
    }
  });
}
