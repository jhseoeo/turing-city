import { boardManual, manualIndex, type Scenario } from '@turing-city/core';
import { clear, el } from '../dom.ts';
import { KIND_LABELS } from '../format.ts';
import { renderMarkdown } from '../markdown.ts';
import type { Store } from '../store.ts';
import { manualFileName } from '../window-rules.ts';

/** What the window shows: built once per subject, since a manual is the scenario's and does not change with the snapshots. */
let mounted: string | null = null;

/** The markdown of the index, or of a board slot's manual (null for an unknown id or housing). */
export function manualText(scenario: Scenario, target: string | 'index'): string | null {
  return target === 'index' ? manualIndex(scenario) : boardManual(scenario, target);
}

/** Saves the text as a file, through a link the browser downloads and that is gone again at once. */
function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = el('a', { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 10-10 spec §9: the manual of a board, or the index of every board slot with the common rules. Nominally the player's guide to
 * writing the firmware themselves; copy and download hand it to an AI.
 */
export function renderManualWindow(root: HTMLElement, store: Store): void {
  const target = store.manualFor;
  const scenario = store.scenario;
  if (target === null || scenario === null) {
    if (mounted !== null) clear(root);
    mounted = null;
    root.hidden = true;
    return;
  }
  root.hidden = false;
  if (mounted === target) return;
  mounted = target;
  clear(root);
  const text = manualText(scenario, target) ?? '';
  const said = el('span', { class: 'dim' }, []);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      said.textContent = '복사했어요';
    } catch {
      said.textContent = store.webDemo ? '복사하지 못했어요. 본문을 선택해서 복사하세요.' : '복사하지 못했어요. 다운로드를 써 보세요.';
    }
  };
  const slots = scenario.facilities.filter((f) => f.board !== null);
  root.append(
    el('header', {}, [
      el('b', {}, [target === 'index' ? '매뉴얼' : `${target} 보드 매뉴얼`]),
      el('button', { onclick: () => void copy() }, ['마크다운 복사']),
      // The web demo's frame blocks downloads a page starts.
      ...(store.webDemo ? [] : [el('button', { onclick: () => download(manualFileName(target), text) }, ['.md 다운로드'])]),
      said,
      el('button', { class: 'close', title: '닫기 (Esc)', onclick: () => store.closeManual() }, ['×']),
    ]),
    el('nav', {}, [
      el('button', { class: target === 'index' ? 'on' : '', onclick: () => store.openManual('index') }, ['목차']),
      ...slots.map((f) =>
        el('button', { class: target === f.id ? 'on' : '', onclick: () => store.openManual(f.id) }, [`${f.id} ${KIND_LABELS[f.kind]}`]),
      ),
    ]),
    el('div', { class: 'body md' }, [renderMarkdown(text)]),
  );
}
