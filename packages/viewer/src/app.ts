import './style.css';
import { bindKeys } from './keys.ts';
import { type MapScene, mountMap } from './map/map-scene.ts';
import { overheatCelsius } from './map-rules.ts';
import type { GameLink } from './net.ts';
import { PayFlashes } from './pay-flash.ts';
import { Store } from './store.ts';
import { renderEditorWindow } from './ui/editor-window.ts';
import { renderFeed } from './ui/feed.ts';
import { renderGuide } from './ui/guide.ts';
import { renderManualWindow } from './ui/manual-window.ts';
import { renderNotice } from './ui/notice.ts';
import { renderOverlay } from './ui/overlay.ts';
import { renderPanel } from './ui/panel.ts';
import { renderStartScreen } from './ui/start-screen.ts';
import { renderTopBar } from './ui/top-bar.ts';

/**
 * Starts the game screen on a link to the game. `connect` gets the store's two inlets (a message from the game, and whether the
 * link is open) and gives back where the screen sends the player's commands.
 */
export function startViewer(connect: (onMessage: Store['apply'], onOpenChange: Store['setSocketOpen']) => GameLink): void {
  const store = new Store();
  const net = connect(
    (m) => store.apply(m),
    (open) => store.setSocketOpen(open),
  );
  const $ = (id: string): HTMLElement => document.querySelector<HTMLElement>(id)!;
  let map: MapScene | null = null;
  let pointerDown = false;
  let renderOwed = false;
  const pays = new PayFlashes();

  function render(): void {
    renderOwed = false;
    if (store.takeStartPlay()) net.send({ type: 'play' });
    const inSeason = store.status !== null && store.status.state !== 'idle';
    $('#start').hidden = inSeason;
    $('#game').hidden = !inSeason;
    renderOverlay($('#overlay'), store, net);
    renderNotice($('#notice'), store, inSeason);
    if (!inSeason) {
      $('#guide').hidden = true;
      renderStartScreen($('#start'), store, net);
      return;
    }
    renderGuide($('#guide'), store);
    const now = performance.now();
    const freshPays = store.snapshot ? pays.take(store.snapshot, now) : [];
    renderTopBar($('#topbar'), store, net);
    renderFeed($('#feed'), store, net);
    const pay = store.selected ? pays.flash(store.selected, now) : null;
    renderPanel($('#panel'), store, net, pay ? { amount: pay.amount, elapsed: now - pay.since } : null);
    renderManualWindow($('#manual-window'), store);
    renderEditorWindow($('#editor-window'), store, net);
    if (store.snapshot) {
      map ??= mountMap($('#map'), store.snapshot, (id) => store.select(id));
      map.show(store.snapshot, store.selected, store.heatmap, overheatCelsius(store.scenario));
      map.float(freshPays);
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

  // The panel's live sensors and log: ask again twice a second while a facility is selected (one without a board gets null).
  setInterval(() => {
    if (store.selected) net.send({ type: 'inspect', board: store.selected });
  }, 500);

  bindKeys(store, net);
  store.subscribe(requestRender);
  render();
}
