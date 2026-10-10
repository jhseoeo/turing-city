import './style.css';
import { bindKeys } from './keys.ts';
import { type MapScene, mountMap } from './map/map-scene.ts';
import { Connection, gameSocketUrl } from './net.ts';
import { Store } from './store.ts';
import { renderFeed } from './ui/feed.ts';
import { renderOverlay } from './ui/overlay.ts';
import { renderPanel } from './ui/panel.ts';
import { renderStartScreen } from './ui/start-screen.ts';
import { renderTopBar } from './ui/top-bar.ts';

const store = new Store();
const net = new Connection(
  gameSocketUrl(window.location),
  (m) => store.apply(m),
  (open) => store.setSocketOpen(open),
);
const $ = (id: string): HTMLElement => document.querySelector<HTMLElement>(id)!;
let map: MapScene | null = null;
let pointerDown = false;
let renderOwed = false;

function render(): void {
  renderOwed = false;
  const inSeason = store.status !== null && store.status.state !== 'idle';
  $('#start').hidden = inSeason;
  $('#game').hidden = !inSeason;
  renderOverlay($('#overlay'), store, net);
  if (!inSeason) {
    renderStartScreen($('#start'), store, net);
    return;
  }
  renderTopBar($('#topbar'), store, net);
  renderFeed($('#feed'), store, net);
  renderPanel($('#panel'), store, net);
  if (store.snapshot) {
    map ??= mountMap($('#map'), store.snapshot, (id) => store.select(id));
    map.show(store.snapshot, store.selected, store.heatmap);
  }
}

/**
 * render() replaces the page's buttons, and a snapshot arrives about every 50 ms while the clock runs. A click needs the button
 * the press began on to still be in the page at the release, so while a pointer is down the render waits.
 */
function requestRender(): void {
  if (pointerDown) renderOwed = true;
  else render();
}

function pressPointer(): void {
  pointerDown = true;
}

function releasePointer(): void {
  pointerDown = false;
  // On a timer, not here: the click is dispatched after pointerup, and rendering now would detach the pressed button first.
  setTimeout(() => {
    if (renderOwed && !pointerDown) render();
  }, 0);
}

window.addEventListener('pointerdown', pressPointer, true);
// A press that never gets its pointerup must not freeze the screen: a cancelled pointer, a window that lost focus, and a context
// menu (which takes the release) all end it.
for (const type of ['pointerup', 'pointercancel', 'contextmenu']) window.addEventListener(type, releasePointer, true);
window.addEventListener('blur', releasePointer);

// The panel's live sensors and log: ask again twice a second while a board is selected.
setInterval(() => {
  if (store.selected) net.send({ type: 'inspect', board: store.selected });
}, 500);

bindKeys(store, net);
store.subscribe(requestRender);
render();
