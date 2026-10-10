import './style.css';
import { Connection, gameSocketUrl } from './net.ts';
import { Store } from './store.ts';
import { renderStartScreen } from './ui/start-screen.ts';

const store = new Store();
const net = new Connection(
  gameSocketUrl(window.location),
  (m) => store.apply(m),
  (open) => store.setSocketOpen(open),
);
const start = document.querySelector<HTMLElement>('#start')!;
const game = document.querySelector<HTMLElement>('#game')!;

function render(): void {
  const inSeason = store.status !== null && store.status.state !== 'idle';
  start.hidden = inSeason;
  game.hidden = !inSeason;
  if (!inSeason) renderStartScreen(start, store, net);
}

store.subscribe(render);
render();
