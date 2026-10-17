import { el } from '../dom.ts';
import type { Store } from '../store.ts';

/**
 * The stack on the right: each alert and refusal for a few seconds, the newest at the bottom, pushing the older ones up. The page is
 * redrawn on every snapshot, so a line keeps its element while it stays: its slide-in and fade-out run once, not on every redraw.
 */
export function renderToasts(root: HTMLElement, store: Store): void {
  const kept = new Map<string, HTMLElement>();
  for (const child of [...root.children] as HTMLElement[]) kept.set(child.dataset.id ?? '', child);
  const ids = new Set(store.toasts.map((t) => String(t.id)));
  for (const [id, node] of kept) if (!ids.has(id)) node.remove();
  for (const toast of store.toasts) {
    if (kept.has(String(toast.id))) continue;
    const facility = toast.facility;
    const node = el('div', { class: `toast ${toast.severe ? 'bad' : 'warn'}`, onclick: () => facility && store.select(facility) }, [
      toast.text,
    ]);
    node.dataset.id = String(toast.id);
    root.append(node);
  }
}
