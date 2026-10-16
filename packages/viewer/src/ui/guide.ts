import { clear, el } from '../dom.ts';
import type { Store } from '../store.ts';

/**
 * 10-10 spec §10.2: what to do, shown when a season starts until the player ticks "다시 보지 않기". [도움말] in the top bar opens it
 * again. The season's length comes from the snapshot, like every number the player reads.
 */
export function renderGuide(root: HTMLElement, store: Store): void {
  if (!store.guideOpen) {
    clear(root);
    root.hidden = true;
    return;
  }
  root.hidden = false;
  // The card is built once when it opens: a render of the page must not undo a tick the player just made.
  if (root.firstChild !== null) return;
  const days = store.snapshot?.seasonDays ?? 30;
  const dontShowAgain = el('input', { type: 'checkbox' });
  root.append(
    el('div', { class: 'card' }, [
      el('h2', {}, ['이렇게 해요']),
      el('ul', {}, [
        el('li', {}, [`목표: ${days}일 동안 마을을 돌려서, 시즌이 끝날 때 자금을 최대한 남기세요.`]),
        el('li', {}, [
          '모든 시설은 손으로 돌릴 수 있어요. 시설을 클릭하면 오른쪽 패널에 버튼이 나와요: 밭 수확, 트럭 보내기, 발전소 화력, 데이터센터 처리와 냉각.',
        ]),
        el('li', {}, [
          '손이 바빠지면 시설에 보드를 설치하세요. 보드의 펌웨어(Lua)가 그 일을 대신해요. [편집]에서 짜고 [매뉴얼]을 보세요. 매뉴얼을 AI 채팅에 붙여넣어도 돼요.',
        ]),
        el('li', {}, ['보드에 통신 모듈을 달면 MCP로 연결한 에이전트(Claude Code 등)가 그 보드를 맡을 수 있어요.']),
        el('li', {}, ['보드와 일하는 데이터센터는 전자파를 내요. 러다이트가 전자파를 따라와 시설을 부숴요.']),
        el('li', {}, ['스페이스로 멈추고 재생해요. 시즌은 멈춘 채로 시작해요.']),
      ]),
      el('div', { class: 'row' }, [
        el('label', { class: 'dismiss' }, [dontShowAgain, ' 다시 보지 않기']),
        el('button', { class: 'primary', onclick: () => store.closeGuide(dontShowAgain.checked) }, ['알겠어요']),
      ]),
    ]),
  );
}
