import { describe, expect, it } from 'vitest';
import { boardManual, commonManual, manualIndex } from '../src/manual.ts';
import { SENSOR_KEYS } from '../src/sensors.ts';
import { m2Scenario } from './helpers/scenarios.ts';

const town = m2Scenario();
const BOARDS = ['P', 'DA', 'W', 'DB', 'F1', 'F2', 'F3'];

/** The phrases that are missing from a text, named, so that a failure lists all of them at once. */
const missing = (cases: ReadonlyArray<readonly [string, string]>): string[] =>
  cases.filter(([text, phrase]) => !text.includes(phrase)).map(([, phrase]) => phrase);

describe('the board manual', () => {
  it('has a manual for every facility that takes a board, and none for housing or an unknown id', () => {
    for (const id of BOARDS) expect(boardManual(town, id), id).toMatch(new RegExp(`^# ${id} 보드 매뉴얼: `));
    expect(boardManual(town, 'H1')).toBeNull();
    expect(boardManual(town, 'ZZ')).toBeNull();
  });

  it("starts every board's manual with the common rules, then the board's own sections in order", () => {
    for (const id of BOARDS) {
      const text = boardManual(town, id)!;
      const at = ['## 공통 규칙', '## 이 보드가 하는 일', '## 부품', '## io로 읽는 값', '## io로 하는 행동'].map((h) => text.indexOf(h));
      expect(
        at.every((i) => i > 0),
        id,
      ).toBe(true);
      expect(
        [...at].sort((a, b) => a - b),
        id,
      ).toEqual(at);
      // The common rules sit one level down inside a board's manual, and at the top of the common manual.
      expect(text, id).toContain('### Lua 샌드박스');
    }
    expect(commonManual(town)).toMatch(/^# 공통 규칙\n/);
    expect(commonManual(town)).toContain('\n## Lua 샌드박스\n');
  });

  it("names every io field the board's sensors give, and the actions of its own kind and no other", () => {
    const callsByKind: Record<string, string[]> = {
      power: ['`io.set_thermal(output)`', '`io.set_priority({ids})`'],
      datacenter: ['`io.process()`', '`io.cool()`'],
      farm: ['`io.harvest()`'],
      warehouse: ['`io.dispatch(truck, from, to, amount)`'],
    };
    for (const f of town.facilities) {
      if (f.board === null) continue;
      const text = boardManual(town, f.id)!;
      for (const s of f.board.sensors) expect(text, `${f.id} ${s}`).toContain(`| \`${SENSOR_KEYS[s]}\` |`);
      for (const name of ['day', 'clock']) expect(text, `${f.id} ${name}`).toContain(`| \`${name}\` |`);
      for (const [kind, calls] of Object.entries(callsByKind)) {
        for (const call of calls) {
          if (kind === f.kind) expect(text, `${f.id} ${call}`).toContain(`| ${call} |`);
          else expect(text, `${f.id} ${call}`).not.toContain(call);
        }
      }
      for (const call of ['`io.log(...)`', '`io.sleep(seconds)`']) expect(text, `${f.id} ${call}`).toContain(`| ${call} |`);
    }
  });

  it("writes the town's own numbers", () => {
    const da = boardManual(town, 'DA')!;
    const f1 = boardManual(town, 'F1')!;
    const w = boardManual(town, 'W')!;
    const p = boardManual(town, 'P')!;
    const common = commonManual(town);
    expect(
      missing([
        [da, '데이터센터를 지금부터 1초 동안 돌린다. 한 번 시작한 처리는 끝까지 돌고, 도는 동안 다시 부르면 아무 일도 없다'],
        [da, '처리하는 동안 150의 전력을 더 쓰고 초당 2°C씩 뜨거워지며 초당 50의 전자파를 낸다'],
        [da, '가만히 두면 매초 (온도 − 25°C)의 0.3%씩만 식는다'],
        [da, '5초에 걸쳐 고르게 15°C를 낮추고 그동안 250의 전력을 쓴다'],
        [da, '85°C에 닿으면 과열 알림이 뜬다'],
        [da, '90°C를 넘으면 매초, 넘은 1°C마다 0.5%의 확률로 불이 나서'],
        [da, '| 클럭 | 5 Hz: 1초에 5번 틱 |'],
        [da, '| 틱당 명령어 상한 | 2000 |'],
        [da, '| RAM | 8 KB (8192바이트) |'],
        [da, '| 보드 전력 | 깨어 있을 때 10, 자는 동안 1 |'],
        [da, '| 기본 전자파 | 초당 25, 통신 모듈을 달면 30 |'],
        [da, '| 위치 | (5, 4), 발전소까지 1칸 |'],
        [da, '| 보드 설치 | 600 |'],
        [da, '| 통신 모듈 | 300 |'],
        [da, '| 시설 수리 | 500 |'],
        [da, '25 이상. 90°C 위에서는 불이 날 수 있다'],
        [da, '15~80, 초당 최대 2씩 변한다'],
        [f1, '작물은 심은 지 40초(1일) 뒤에 익는다'],
        [f1, '익은 채로 20초(12시간) 동안 두면 썩어서 사라지고'],
        [f1, '40의 식량을 출고함에 넣고 바로 다시 심는다. 출고함은 80까지이고'],
        [f1, '| `outbox` | 출고함에 쌓인 식량 | 식량 | 0~80 |'],
        [w, '트럭은 2대이고 한 대에 40까지 싣는다. 초당 2칸을 가고 새 칸에 들어설 때마다 연료비로 1씩 든다'],
        [w, '재고는 하루에 2%씩 상한다'],
        [w, '주거지 블록마다 주민 40명이 살고 한 명이 하루 1씩 먹는다'],
        [w, '한 명당 하루 5씩 세금을 낸다'],
        [w, '시즌을 시작할 때 주거지 블록마다 식량이 120만큼 있다'],
        [w, '`io.dispatch(truck, 밭 id, "W", amount)`'],
        [w, '| `F1` | 밭 | (2, 9) | 12칸 |'],
        [w, '| `F3` | 밭 | (4, 9) | 10칸 |'],
        [w, '| `H1` | 주거지 | (2, 1) | 14칸 |'],
        [w, '| `H2` | 주거지 | (17, 1) | 11칸 |'],
        [w, '트럭 2대, id 1~2'],
        [p, '풍력은 날씨를 따라 0~220 사이에서 초당 최대 8씩 변하고 비용이 없다'],
        [p, '화력은 정한 출력 그대로 나온다(0~300)'],
        [p, '`fuel_price`(5~9, 매일 바뀐다)가 든다'],
        [p, '하루는 40초이므로 출력 1단위의 초당 연료비: `fuel_price` / 40.'],
        [p, '공급 순서에 쓸 수 있는 id: `H1`, `H2`, `DA`, `W`, `DB`, `F1`, `F2`, `F3`.'],
        [common, '세계는 1초에 20 스텝씩 흐르고'],
        [common, '하루는 40초, 시즌은 30일이다'],
        [common, '로그는 보드마다 최근 200줄이고'],
        [common, '"power back (steady for 10 s)"'],
        [common, '그 시설의 수요가 2%씩 늘어난다'],
        [common, '시작 자금은 5000이다'],
        [common, '보드 유지비(깨어 있거나 자는 보드마다 하루 10)'],
        [common, '자금이 3일 연속 0보다 적으면'],
        [common, '| 발전소 | 400 | 300 |'],
        [common, '| 데이터센터 | 600 | 500 |'],
        [common, '| 밭 | 200 | 150 |'],
        [common, '| 물류창고 | 400 | 300 |'],
        [common, '통신 모듈: 300. 보드의 기본 전자파가 초당 5 늘어난다.'],
        [common, '시설 수리는 20초(12시간) 걸린다. 보드 재건은 500이고 20초(12시간) 걸린다.'],
        [common, '명령어 100개마다 1'],
        [common, '하나마다 10.'],
        [common, '데이터센터는 처리하는 동안 초당 50의 전자파를 낸다'],
        [common, '이웃 네 칸에 10%씩 나눠 주고 지도 전체가 매초 10%씩 줄어든다'],
        [common, '200000에 닿을 때마다 러다이트 무리가 나타나고'],
        [common, '무리는 3명이고'],
        [common, '초당 1칸씩 걷고'],
        [common, '전자파가 5 이상인 칸만 감지된다'],
        [common, '10초 동안 아무것도 감지되지 않으면'],
        [common, '시설에서 5칸 안으로 들어오면'],
        [common, '보드를 1~40초 동안 재운다'],
        [common, '전력은 1만 쓴다'],
        [common, '데이터센터의 처리(150)와 냉각(250), 주거지 블록마다 70'],
        [common, '마을이 10초 동안 한 번도 끊기지 않아야 다시 울린다'],
        [common, '| `DB` | 데이터센터 | (16, 8) | 16칸 |'],
      ]),
    ).toEqual([]);
  });

  it('follows a retuned scenario, so another town reads differently', () => {
    const t = m2Scenario((j) => {
      j.startMoney = 6000;
      j.time.secondsPerDay = 60;
      j.tuning.transmissionLossPctPerCell = 3;
      j.tuning.shortageQuietSeconds = 6;
      j.tuning.wind = { max: 250, start: 120, maxChangePerSecond: 9 };
      j.tuning.thermal.max = 400;
      j.tuning.fuelPrice = { start: 7, min: 4, max: 11 };
      j.tuning.jobPrice = { start: 40, min: 12, max: 90, maxChangePerSecond: 3 };
      Object.assign(j.tuning.datacenter, {
        processPower: 170,
        heatMilliPerSecond: 3_500,
        passiveCoolingPermillePerSecond: 7,
        jobMs: 750,
        coolingCycleMs: 3_000,
        coolingDropMilli: 12_500,
        coolingPower: 333,
        overheatAlertMilli: 80_000,
        fireThresholdMilli: 95_050,
        firePermillePerDegreePerSecond: 12,
      });
      j.tuning.farm = { ripenSeconds: 90, rotSeconds: 30, yield: 31, outboxCapacity: 77 };
      j.tuning.warehouse = { trucks: 3, truckCapacity: 55, truckCellsPerSecond: 4, fuelPerCell: 3, spoilagePctPerDay: 4 };
      j.tuning.housing = { residents: 35, foodPerPersonPerDay: 2, power: 75, taxPerPersonPerDay: 6, startFood: 90 };
      j.tuning.boardUpkeepPerDay = 12;
      j.tuning.sleepPower = 2;
      j.tuning.maxSleepSeconds = 25;
      Object.assign(j.tuning.emf, {
        instructionsPerUnit: 50,
        perAction: 7,
        processingPerSecond: 44,
        diffusionPctPerSecond: 11,
        decayPctPerSecond: 12,
        detectionThreshold: 9,
        rumourThreshold: 77_777,
      });
      j.tuning.luddites = { groupSize: 4, cellsPerSecond: 2, quietSecondsToLeave: 15, approachCells: 6 };
      j.tuning.install.boardPrice.farm = 210;
      j.tuning.install.commPrice = 350;
      j.tuning.install.commBaseEmfPerSecond = 7;
      j.tuning.repair.cost.datacenter = 555;
      j.tuning.repair.seconds = 30;
      j.tuning.rebuild = { cost: 444, seconds: 30 };
      j.tuning.bankruptcyDays = 4;
    });
    const da = boardManual(t, 'DA')!;
    const f1 = boardManual(t, 'F1')!;
    const w = boardManual(t, 'W')!;
    const p = boardManual(t, 'P')!;
    const common = commonManual(t);
    expect(
      missing([
        [da, '데이터센터를 지금부터 0.75초 동안 돌린다'],
        [da, '처리하는 동안 170의 전력을 더 쓰고 초당 3.5°C씩 뜨거워지며 초당 44의 전자파를 낸다'],
        [da, '가만히 두면 매초 (온도 − 25°C)의 0.7%씩만 식는다'],
        [da, '3초에 걸쳐 고르게 12.5°C를 낮추고 그동안 333의 전력을 쓴다'],
        [da, '80°C에 닿으면 과열 알림이 뜬다'],
        [da, '95.05°C를 넘으면 매초, 넘은 1°C마다 1.2%의 확률로 불이 나서'],
        [da, '| 기본 전자파 | 초당 25, 통신 모듈을 달면 32 |'],
        [da, '| 통신 모듈 | 350 |'],
        [da, '| 시설 수리 | 555 |'],
        [da, '25 이상. 95.05°C 위에서는 불이 날 수 있다'],
        [da, '12~90, 초당 최대 3씩 변한다'],
        [
          da,
          '1~25초 동안 깊이 잠든다(범위 밖의 숫자는 이 범위로 맞춰지고 숫자가 아니면 그 틱을 에러로 끝낸다). 조용하고 전력도 2만 쓰지만',
        ],
        [f1, '작물은 심은 지 90초(36시간) 뒤에 익는다'],
        [f1, '익은 채로 30초(12시간) 동안 두면 썩어서 사라지고'],
        [f1, '31의 식량을 출고함에 넣고 바로 다시 심는다. 출고함은 77까지이고'],
        [f1, '| 보드 설치 | 210 |'],
        [w, '트럭은 3대이고 한 대에 55까지 싣는다. 초당 4칸을 가고 새 칸에 들어설 때마다 연료비로 3씩 든다'],
        [w, '재고는 하루에 4%씩 상한다'],
        [w, '주거지 블록마다 주민 35명이 살고 한 명이 하루 2씩 먹는다'],
        [w, '한 명당 하루 6씩 세금을 낸다'],
        [w, '시즌을 시작할 때 주거지 블록마다 식량이 90만큼 있다'],
        [w, 'amount는 1~55'],
        [w, '트럭 3대, id 1~3'],
        [p, '풍력은 날씨를 따라 0~250 사이에서 초당 최대 9씩 변하고'],
        [p, '화력은 정한 출력 그대로 나온다(0~400)'],
        [p, '`fuel_price`(4~11, 매일 바뀐다)가 든다'],
        [p, '하루는 60초이므로 출력 1단위의 초당 연료비: `fuel_price` / 60.'],
        [common, '하루는 60초, 시즌은 30일이다'],
        [common, '"power back (steady for 6 s)"'],
        [common, '그 시설의 수요가 3%씩 늘어난다'],
        [common, '시작 자금은 6000이다'],
        [common, '보드 유지비(깨어 있거나 자는 보드마다 하루 12)'],
        [common, '자금이 4일 연속 0보다 적으면'],
        [common, '| 밭 | 210 | 150 |'],
        [common, '| 데이터센터 | 600 | 555 |'],
        [common, '통신 모듈: 350. 보드의 기본 전자파가 초당 7 늘어난다.'],
        [common, '시설 수리는 30초(12시간) 걸린다. 보드 재건은 444이고 30초(12시간) 걸린다.'],
        [common, '명령어 50개마다 1'],
        [common, '하나마다 7.'],
        [common, '데이터센터는 처리하는 동안 초당 44의 전자파를 낸다'],
        [common, '이웃 네 칸에 11%씩 나눠 주고 지도 전체가 매초 12%씩 줄어든다'],
        [common, '77777에 닿을 때마다'],
        [common, '무리는 4명이고'],
        [common, '초당 2칸씩 걷고'],
        [common, '전자파가 9 이상인 칸만 감지된다'],
        [common, '15초 동안 아무것도 감지되지 않으면'],
        [common, '시설에서 6칸 안으로 들어오면'],
        [common, '보드를 1~25초 동안 재운다'],
        [common, '전력은 2만 쓴다'],
        [common, '데이터센터의 처리(170)와 냉각(333), 주거지 블록마다 75'],
        [common, '마을이 6초 동안 한 번도 끊기지 않아야 다시 울린다'],
      ]),
    ).toEqual([]);
    // The milestone's own numbers are gone, where they were the only place they appear.
    expect(da).not.toContain('지금부터 0.5초 뒤로');
    expect(common).not.toContain('하루는 40초');
    expect(p).not.toContain('`fuel_price` / 40');
  });

  it('says the hours a span takes when the day does not divide it, and when there is no quiet time to wait', () => {
    const odd = m2Scenario((j) => {
      j.time.secondsPerDay = 70;
      j.tuning.shortageQuietSeconds = 0;
    });
    const common = commonManual(odd);
    expect(common).toContain('시설 수리는 20초(약 6시간) 걸린다'); // 20 s of a 70 s day is 6.86 hours
    expect(common).toContain('다시 들어오면 바로 "power back"이 남는다');
    expect(common).toContain('전력 부족 알림은 시설이 다시 끊길 때마다 울린다');
    expect(common).not.toContain('steady for');
  });

  it("tells, in its own words, what milestone 1's datasheet told about the sandbox, failed ticks, sleep, and RAM", () => {
    const da = boardManual(town, 'DA')!;
    expect(
      missing(
        [
          '배포를 넘어 이어지는 것은 `mem`뿐이다',
          '코드는 RAM에 세지 않는다',
          '`mem`에서 필요 없는 것부터 비워야 한다',
          '약간의 여유가 더 주어진다',
          '`string.format`은 `%p`를 거부한다',
          '주소는 어디에서도 보이지 않는다',
          '`coroutine.close`는 없다',
          '`<close>` 핸들러가 돌지 않는다',
          '스택이 풀린 뒤에 돌고 명령어 상한에 닿은 뒤에는 돌지 않는다',
          '행동이 아니라서 행동 전자파가 없고 틱이 실패해도 남는다',
          '그 틱의 로그 줄과 `mem`에 쓴 값은 남는다',
          '`io.sleep()` 뒤에 부른 행동은 버려지고 앞에 부른 행동은 적용된다',
          '보드가 자는 동안에도 시설은 멈추지 않는다',
          '200바이트(한글 약 66자)',
          '아직 수거되지 않은 쓰레기까지 센다',
          '쓰레기만으로 "out of RAM"이 나지는 않는다',
          '함수 호출의 스택(깊은 재귀)도 RAM을 쓴다',
          '틱이 끝난 뒤에 잰 값이라서',
          '낮게 읽혀도 그 틱은 "out of RAM"으로 실패할 수 있다',
          '20줄을 넘긴 줄은 버려지고 그 틱에 몇 줄이 버려졌는지 알리는 시스템 줄이 하나 남는다',
          '숫자가 아닌 값은 그 틱을 에러로 끝낸다',
          '사람이 손으로 하는 일(수확, 트럭 보내기, 화력과 공급 순서 정하기)은 전자파가 없다',
          '그 시설을 보드째 통째로 부순다',
          '먼저 시설을 수리하고',
          '목록과 표로 된 센서(예: `io.farms`)의 값도 틱마다 다시 쓰이므로',
        ].map((phrase) => [da, phrase] as const),
      ),
    ).toEqual([]);
  });

  it('states the rules as the code settles them: which machines Luddites hunt, when stock spoils, who pays upkeep', () => {
    const da = boardManual(town, 'DA')!;
    const w = boardManual(town, 'W')!;
    const common = commonManual(town);
    expect(
      missing([
        [common, '무리는 기계를 노린다: 보드가 돌거나 자고 있는 시설과 처리하는 중인 데이터센터(보드가 없어도 된다)'],
        [common, '손으로만 돌리는 시설과 보드 없이 쉬는 데이터센터는 표적이 아니다'],
        [da, '보드가 없거나 부서졌으면 처리하는 동안에만 표적이고'],
        [da, '끊긴 동안에도 작업과 냉각 주기의 시간은 흘러가서'],
        [da, '처리와 냉각은 함께 돌지 않는다. 냉각을 시작하면 돌던 처리가 거기서 끝나고'],
        [w, '하루의 마지막 순간에 한 번, 그때의 재고에서 덜어 낸다'],
        [common, '깨어 있거나 자는 보드마다 하루 10'],
      ]),
    ).toEqual([]);
    expect(common).not.toContain('설치된 보드마다');
    expect(da).not.toContain('데이터센터는 그 자체로 기계다');
  });

  it('lists every board slot in the index, then the common rules', () => {
    const index = manualIndex(town);
    expect(index).toMatch(/^# 매뉴얼 목차\n/);
    expect(index).toContain('보드를 달 수 있는 시설은 7곳이다');
    for (const line of ['- `P`: 발전소, (4, 4)', '- `DA`: 데이터센터, (5, 4)', '- `W`: 물류창고, (11, 6)', '- `F3`: 밭, (4, 9)']) {
      expect(index).toContain(line);
    }
    expect(index).not.toContain('- `H1`');
    expect(index.indexOf('## 공통 규칙')).toBeGreaterThan(index.indexOf('- `F3`'));
  });

  it('uses only the markdown that the viewer renders', () => {
    const docs = [commonManual(town), manualIndex(town), ...BOARDS.map((id) => boardManual(town, id)!)];
    for (const doc of docs) {
      const lines = doc.split('\n');
      let fenced = false;
      lines.forEach((line, i) => {
        if (line.startsWith('```')) {
          expect(line, `line ${i}`).toBe(fenced ? '```' : '```lua');
          fenced = !fenced;
          return;
        }
        if (fenced) return;
        // A heading, a list item, a table row, a paragraph that starts with a letter or inline code, or a blank line.
        expect(line, `line ${i}: ${line}`).toMatch(/^$|^#{1,3} \S|^- \S|^\|.*\|$|^[^\s#\-|>*+<\d]/);
        // A table's second row is its separator.
        if (line.startsWith('|') && !lines[i - 1]?.startsWith('|')) expect(lines[i + 1], `line ${i + 1}`).toMatch(/^\|(---\|)+$/);
      });
      expect(fenced).toBe(false);
      // No HTML, which the viewer never renders. Inline code may show a tag, as the sandbox rules show `<close>`.
      expect(doc.replace(/`[^`]*`/g, '')).not.toMatch(/<\/?[a-z]/i);
    }
  });
});
