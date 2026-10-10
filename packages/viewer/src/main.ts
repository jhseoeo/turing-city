import './style.css';
import { type MapScene, mountMap } from './map/map-scene.ts';
import { Connection, gameSocketUrl } from './net.ts';
import { Store } from './store.ts';
import { renderStartScreen } from './ui/start-screen.ts';
import { renderTopBar } from './ui/top-bar.ts';

const store = new Store();
const net = new Connection(
  gameSocketUrl(window.location),
  (m) => store.apply(m),
  (open) => store.setSocketOpen(open),
);
const start = document.querySelector<HTMLElement>('#start')!;
const game = document.querySelector<HTMLElement>('#game')!;
const topbar = document.querySelector<HTMLElement>('#topbar')!;
const mapRoot = document.querySelector<HTMLElement>('#map')!;
let map: MapScene | null = null;

function render(): void {
  const inSeason = store.status !== null && store.status.state !== 'idle';
  start.hidden = inSeason;
  game.hidden = !inSeason;
  if (!inSeason) {
    renderStartScreen(start, store, net);
    return;
  }
  renderTopBar(topbar, store, net);
  if (store.snapshot) {
    map ??= mountMap(mapRoot, store.snapshot, (id) => store.select(id));
    map.show(store.snapshot, store.selected, store.heatmap);
  }
}

store.subscribe(render);
render();
