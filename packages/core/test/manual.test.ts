import { describe, expect, it } from 'vitest';
import { runDatacenters } from '../src/datacenter.ts';
import { NullHost } from '../src/firmware-host.ts';
import { boardManual, commonManual, manualIndex } from '../src/manual.ts';
import { type BoardKind, takesBoard } from '../src/scenario.ts';
import { SENSOR_KEYS } from '../src/sensors.ts';
import { Session } from '../src/session.ts';
import { dispatch, runWarehouses, warehouseReading } from '../src/warehouse.ts';
import { m1Scenario, m2Scenario } from './helpers/scenarios.ts';

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
      const at = ['## 공통 규칙', '## 이 보드가 하는 일', '## 부품', '## io로 읽는 값', '## io로 하는 행동'].map((h) =>
        text.indexOf(`\n${h}\n`),
      );
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
        [da, '데이터센터가 도는 끝 시각을 지금부터 0.5초 뒤로 잡는다'],
        [da, '이 보드가 박자마다 부르면 쉬지 않고 돈다'],
        [da, '처리하는 동안 150의 전력을 더 쓰고, 초당 2°C씩 뜨거워지고, 초당 50의 전자파를 낸다'],
        [da, '가만히 두면 매초 (온도 − 25°C)의 0.3%씩만 식는다'],
        [da, '한 스텝마다 0.001°C 아래는 버리므로, 온도가 25°C보다 6.667°C 이상 높지 않으면 식지 않는다'],
        [da, '시작해 둔 작업과 냉각의 시간은 그동안에도 흘러서, 놓친 만큼은 채워지지 않는다'],
        [da, '4초에 걸쳐 고르게 15°C를 낮추고, 그동안 250의 전력을 쓴다'],
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
        [f1, '익은 채로 20초(12시간)이 지나면 썩어서 사라지고'],
        [f1, '40의 식량을 출고함에 넣고 바로 다시 심는다. 출고함은 80까지이고'],
        [f1, '보드가 있으면 로그에 "crop rotted"가 남는다'],
        [f1, '부서진 밭은 거둘 수 없고, 수리가 끝나면 그때 새로 심는다'],
        [f1, '출고함의 식량은 부서져도 그대로 남는다'],
        [f1, '| `outbox` | 출고함에 쌓인 식량 | 식량 | 0~80 |'],
        [w, '트럭은 2대이고 한 대에 40까지 싣는다. 초당 2칸을 가고, 새 칸에 들어설 때마다 연료비로 1씩 든다'],
        [w, '재고는 하루에 2%씩 상한다'],
        [w, '재고와 대기 중인 트럭은 부서져도 그대로 남고, 재고는 그동안에도 계속 상한다'],
        [w, '주거지 블록마다 주민 40명이 살고, 한 명이 하루 1씩 먹는다'],
        [w, '한 명당 하루 5씩 세금을 낸다'],
        [w, '시즌을 시작할 때 주거지 블록마다 식량이 120만큼 있다'],
        [w, '`io.dispatch(truck, 밭 id, "W", amount)`'],
        [w, '| `F1` | 밭 | (2, 9) | 12칸 |'],
        [w, '| `F3` | 밭 | (4, 9) | 10칸 |'],
        [w, '| `H1` | 주거지 | (2, 1) | 14칸 |'],
        [w, '| `H2` | 주거지 | (17, 1) | 11칸 |'],
        [w, '트럭 2대, id 1~2'],
        [p, '풍력은 날씨를 따라 0~220 사이에서 초당 최대 8씩 변하고, 비용이 없다'],
        [p, '화력은 정한 출력 그대로 나온다(0~300)'],
        [p, '`io.set_thermal(output)`과 손의 [화력], `io.set_priority({ids})`와 손의 [공급 순서]'],
        [p, '`fuel_price`(5~9, 매일 바뀐다)가 든다'],
        [p, '하루는 40초이므로 출력 1단위의 초당 연료비: `fuel_price` / 40.'],
        [p, '공급 순서에 쓸 수 있는 id: `H1`, `H2`, `DA`, `W`, `DB`, `F1`, `F2`, `F3`.'],
        [common, '세계는 1초에 20 스텝씩 흐르고'],
        [common, '자고 있거나, 전력이 끊겼거나, 부서졌거나, 재건 중인 보드는 돌지 않는다'],
        [common, '그 효과는 다음 스텝부터 난다(손으로 하는 일은 누른 스텝부터)'],
        [common, '하루는 40초, 시즌은 30일이다'],
        [common, '로그는 보드마다 최근 200줄이고'],
        [common, '"power back (steady for 10 s)"'],
        [common, '그 시설의 수요가 2%씩 늘어난다'],
        [common, '시작 자금은 5000이다'],
        [common, '보드 유지비(돌거나 자는 보드마다 하루 10. 부서졌거나 재건 중인 보드는 내지 않는다)'],
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
        [common, '이웃 네 칸에 10%씩 나눠 주고, 지도 전체가 매초 10%씩 줄어든다'],
        [common, '200000에 닿을 때마다 러다이트 무리가 나타나고'],
        [common, '무리는 3명이고'],
        [common, '초당 1칸씩 걷고'],
        [common, '전자파가 5 이상인 칸이고'],
        [common, '감지되는 것이 10초 동안 없으면'],
        [common, '시설에서 5칸 안으로 들어오면'],
        [common, '보드를 1~40초 동안 재운다'],
        [common, '전력은 1만 쓴다'],
        [common, '데이터센터의 처리(150)와 냉각(250), 주거지 블록마다 70'],
        [common, '마을이 10초 동안 한 번도 끊기지 않아야 다시 울린다'],
        [common, '| `DB` | 데이터센터 | (16, 8) | 16칸 |'],
        // the rows of the tables, where each number is written again
        [p, '| `wind` | 풍력 모듈이 지금 내는 전력. 비용이 없다 | 전력 | 0~220, 초당 최대 8씩 변한다 |'],
        [p, '| `fuel_price` | 화력 출력 1단위를 하루 돌리는 연료비. 매일 새로 정해진다 | 돈/단위·일 | 5~9 |'],
        [p, '| `io.set_thermal(output)` | 화력 출력을 정한다(0~300). 다시 정할 때까지 그대로다 |'],
        [
          da,
          '| `io.process()` | 지금부터 0.5초 동안 데이터센터를 돌린다. 이미 돌고 있으면 끝나는 시각을 지금부터 0.5초 뒤로 다시 잡는다(쌓이지 않는다) |',
        ],
        [da, '| `io.cool()` | 냉각을 한 번 돌린다: 4초에 걸쳐 15°C를 낮춘다. 냉각 중이면 아무 일도 없지만 행동 전자파는 낸다 |'],
        [da, '| `price` | 지금의 작업 단가. 처리하는 1초마다 이만큼 번다 | 돈/처리 1초 | 15~80, 초당 최대 2씩 변한다 |'],
        [da, '| `day` | 시즌의 날 | 일 | 1~30 |'],
        [da, '| `clock` | 시즌이 시작된 뒤 흐른 게임 시간 | 초, 소수 | 0~1200 |'],
        [
          f1,
          '| `io.harvest()` | 익은 작물을 거둬 40의 식량을 출고함에 넣고 바로 다시 심는다. 익지 않았으면 아무 일도 없지만 행동 전자파는 낸다 |',
        ],
        [w, '| `farms` | 밭마다 `{ id, outbox, distance }`: 출고함의 식량, 이 창고에서의 거리(칸) | 목록 | 밭 3곳, 지도 순서 |'],
        [
          w,
          '| `housing` | 주거지마다 `{ id, food, residents, distance }`: 남은 식량, 주민 수, 이 창고에서의 거리(칸) | 목록 | 주거지 2곳, 지도 순서 |',
        ],
        [
          w,
          '| `io.dispatch(truck, from, to, amount)` | 트럭 하나를 보낸다. 회수는 from이 밭, to가 이 창고. 배달은 from이 이 창고, to가 주거지. amount는 1~40. 대기 중인 트럭만 떠나고,',
        ],
        [w, '트럭이 밭에 닿을 때 min(amount, 출고함, 40)만큼 싣고 돌아와 재고에 넣는다'],
        [w, 'target은 가는 곳의 id(돌아오는 중이면 다녀온 곳, 대기 중이면 nil)'],
        [w, '맞지 않는 요청은 아무 일도 없지만 행동 전자파는 낸다'],
        [w, '`io.dispatch(truck, "W", 주거지 id, amount)`. 떠날 때 min(amount, 재고, 40)만큼 싣고'],
        // the headings, the introduction, and the headings of the tables
        [da, '# DA 보드 매뉴얼: 데이터센터'],
        [da, '이 문서는 `DA` 보드(데이터센터, 지도의 (5, 4))의 펌웨어를'],
        [p, '## 발전소의 규칙'],
        [da, '## 데이터센터의 규칙'],
        [f1, '## 밭의 규칙'],
        [w, '## 물류창고의 규칙'],
        [da, '| 항목 | 값 |'],
        [da, '| 이름 | 뜻 | 단위 | 범위 |'],
        [da, '| 호출 | 하는 일 |'],
        [w, '| 대상 | 시설 | 위치 | 이 창고에서 |'],
        [common, '| id | 시설 | 위치 | 발전소까지 |'],
        [common, '| 시설 | 보드 설치 | 시설 수리 |'],
        // the numbers that a section repeats from another
        [da, '상온(25°C)에서 다시 시작한다'],
        [common, '지도는 20 × 12칸이다'],
        [common, '끊긴 뒤 10초 동안 한 번도 끊기지 않으면'],
        [common, '보드(깨어 있으면 부품 표의 전력, 자면 1)'],
        [common, '통신 모듈이 있으면 5 더 낸다'],
        [common, '데이터센터가 90°C를 넘으면 매초, 넘은 1°C마다 0.5%의 확률로 불이 난다'],
        // the rules of the firmware's calls, which the runtime enforces
        [common, '`io.day`는 시즌의 날(1부터), `io.clock`은 시즌이 시작된 뒤 흐른 게임 초다'],
        [common, '`process`, `cool`, `harvest`는 1, `set_thermal`과 `sleep`은 2, `dispatch`는 5, `set_priority`는 2에 id 수를 더한 만큼'],
        [common, '펌웨어가 시킨 기계의 행동(`harvest`, `dispatch`, `set_thermal`, `set_priority`, `cool`) 하나마다 10'],
        [common, '`process`, `sleep`, `log`는 행동으로 세지 않는다'],
        [common, '"noTick: the last deploy failed to install"과 원래 에러를 남긴다'],
        [common, '"noTick: firmware defines no tick(io, mem) function"을 남긴다'],
        [common, '"CPU limit exceeded"로 중단되고'],
        [common, '"out of RAM"으로 실패한다'],
        [common, '`mem`은 틱과 틱, 배포와 배포 사이에 남는다'],
        [common, '`pcall`도 코루틴도 이 상한을 피하지 못한다'],
        [common, '(`string.rep`, `table.concat`, `table.sort` 등)는 그 일의 양만큼 명령어를 쓴다'],
        [common, '쓸 수 있는 것: 기본 라이브러리(`pairs`, `ipairs`, `pcall`, `setmetatable` 등), `string`, `table`, `math`, `coroutine`.'],
        [
          common,
          '없는 것: `os`, `io` 라이브러리, `load`, `require`, `debug`, `collectgarbage`, `utf8`, `string.dump`, `string.pack`, `string.unpack`.',
        ],
        [common, '`string.find`는 패턴 없이 글자 그대로만 찾는다. `string.match`, `string.gmatch`, `string.gsub`는 없다.'],
        [common, '`math.randomseed`는 없고, `math.random`은 보드마다 정해진 씨앗으로 시작한다'],
        [common, '`__tostring`이 없는 표나 함수를 `tostring`하면 종류만 나온다'],
        [common, '`setmetatable`은 `__gc`와 `__mode`를 거부한다'],
        [common, '`xpcall`의 핸들러는'],
        [common, '`pairs`나 `next`로 도는 중에 표에 키를 더하면 순서가 정해지지 않는다'],
        [common, '`io.sleep(seconds)`는 보드를 1~40초 동안 재운다'],
        [common, '보드는 CPU의 클럭 박자마다 `tick(io, mem)`을 한 번 부른다'],
        [common, '센서 값은 틱마다 `io`에 새로 쓰인다'],
        [common, '배포할 때마다 새 `io`를 받는다. 배포를 넘어 이어지는 것은 `mem`뿐이다'],
        [common, '이어서 `tick`이 돈다. 메인 청크가 에러로 끝나면 그 틱이 실패하고, `tick`을 정의하기 전에 실패했다면'],
        [common, '`tick`을 정의하지 않은 펌웨어는 매 틱'],
        [common, '`io.log`가 남긴 줄, 에러, 시스템 사건'],
        [common, 'RAM은 고정된 기준선 위의 펌웨어 데이터다: `mem`, 전역 변수, 틱이 할당한 것'],
        [common, '"out of RAM" 뒤에도 `mem`은 데이터를 그대로 들고 있다'],
        [common, '깨어나면 `mem`과 전역 변수가 비어 있고'],
        [common, '(발전소 보드의 `set_priority`, 또는 손으로)'],
        [common, '전력이 끊긴 보드는 틱을 돌리지 않고 `mem`은 그대로 둔다'],
        [common, '그대로 가지고 돌아오고 `mem`은 비어 있다'],
        [da, '`io.process()`와 손의 [처리]는 같은 일을 한다'],
        [da, '그때의 단가(`price`)만큼 번다'],
        [da, '`io.cool()`과 손의 [냉각]은 같은 일을 한다'],
        [f1, '`ripeness`는 그동안 0에서 100으로 오른다'],
        [f1, '`io.harvest()`와 손의 [수확]은 같은 일을 한다'],
      ]),
    ).toEqual([]);
  });

  it("tells each board what its own kind of facility is for, and no other kind's", () => {
    const roles = {
      power: '발전소는 마을 전체에 전력을 댄다.',
      datacenter: '데이터센터는 마을의 돈줄이다.',
      farm: '밭은 작물을 기른다.',
      warehouse: '물류창고는 식량을 옮긴다.',
    } as const;
    for (const f of town.facilities) {
      if (!takesBoard(f.kind)) continue;
      const text = boardManual(town, f.id)!;
      for (const [kind, sentence] of Object.entries(roles)) {
        if (kind === f.kind) expect(text, `${f.id} has its role`).toContain(`## 이 보드가 하는 일\n\n${sentence}`);
        else expect(text, `${f.id} has no ${kind} role`).not.toContain(sentence);
      }
    }
  });

  it("gives every board its own parts, place, and prices, from the scenario's board", () => {
    const plant = town.facilities.find((f) => f.kind === 'power')!;
    const t = town.tuning;
    for (const f of town.facilities) {
      if (!takesBoard(f.kind) || f.board === null) continue;
      const b = f.board;
      const kind: BoardKind = f.kind;
      const rows = [
        `| 클럭 | ${b.clockHz} Hz: 1초에 ${b.clockHz}번 틱 |`,
        `| 틱당 명령어 상한 | ${b.instructionCap} |`,
        `| RAM | ${b.ramKb} KB (${b.ramKb * 1024}바이트) |`,
        `| 센서 | ${b.sensors.map((sensor) => `\`${SENSOR_KEYS[sensor]}\``).join(', ')} |`,
        `| 보드 전력 | 깨어 있을 때 ${b.power}, 자는 동안 ${t.sleepPower} |`,
        `| 기본 전자파 | 초당 ${b.baseEmfPerSecond}, 통신 모듈을 달면 ${b.baseEmfPerSecond + t.install.commBaseEmfPerSecond} |`,
        `| 위치 | (${f.x}, ${f.y}), 발전소까지 ${Math.abs(f.x - plant.x) + Math.abs(f.y - plant.y)}칸 |`,
        `| 보드 설치 | ${t.install.boardPrice[kind]} |`,
        `| 통신 모듈 | ${t.install.commPrice} |`,
        `| 시설 수리 | ${t.repair.cost[kind]} |`,
      ];
      const text = boardManual(town, f.id)!;
      expect(
        rows.filter((row) => !text.includes(row)),
        f.id,
      ).toEqual([]);
    }
  });

  it('lists the fields and the statuses that a warehouse board reads, as the simulation writes them', () => {
    const s = new Session(town, 1, new NullHost());
    const w = boardManual(town, 'W')!;
    const readings = (sensor: 'farms' | 'housing' | 'trucks') => warehouseReading(s.ctx, 'W', sensor) as Array<Record<string, string>>;
    for (const sensor of ['farms', 'housing', 'trucks'] as const) {
      expect(w, sensor).toContain(`\`{ ${Object.keys(readings(sensor)[0]!).join(', ')} }\``);
    }
    // A collection trip, from the warehouse to F1 and back, shows every status a truck has.
    const seen = new Set<string>([readings('trucks')[0]!.status!]);
    dispatch(s.ctx, 'W', { kind: 'dispatch', truck: 1, from: 'F1', to: 'W', amount: 10 }, 0);
    for (let step = 0; step <= 300; step++) {
      runWarehouses(s.ctx, step);
      seen.add(readings('trucks')[0]!.status!);
    }
    expect([...seen].sort()).toEqual(['idle', 'outbound', 'returning']);
    for (const status of seen) expect(w, status).toContain(`"${status}"`);
  });

  it('follows a retuned scenario, so another town reads differently', () => {
    const t = m2Scenario((j) => {
      j.startMoney = 6000;
      j.grid = { width: 24, height: 10 };
      j.time.secondsPerDay = 60;
      j.time.seasonDays = 25;
      j.tuning.transmissionLossPctPerCell = 3;
      j.tuning.shortageQuietSeconds = 6;
      j.tuning.wind = { max: 250, start: 120, maxChangePerSecond: 9 };
      j.tuning.thermal.max = 400;
      j.tuning.fuelPrice = { start: 7, min: 4, max: 11 };
      j.tuning.jobPrice = { start: 40, min: 12, max: 90, maxChangePerSecond: 3 };
      Object.assign(j.tuning.datacenter, {
        processPower: 170,
        ambientMilli: 22_000,
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
      j.time.stepsPerSecond = 40;
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
        [da, '데이터센터가 도는 끝 시각을 지금부터 0.75초 뒤로 잡는다'],
        [da, '처리하는 동안 170의 전력을 더 쓰고, 초당 3.5°C씩 뜨거워지고, 초당 44의 전자파를 낸다'],
        [da, '가만히 두면 매초 (온도 − 22°C)의 0.7%씩만 식는다'],
        [da, '온도가 22°C보다 5.715°C 이상 높지 않으면 식지 않는다'],
        [da, '상온(22°C)에서 다시 시작한다'],
        [da, '3초에 걸쳐 고르게 12.5°C를 낮추고, 그동안 333의 전력을 쓴다'],
        [da, '80°C에 닿으면 과열 알림이 뜬다'],
        [da, '95.05°C를 넘으면 매초, 넘은 1°C마다 1.2%의 확률로 불이 나서'],
        [da, '| 기본 전자파 | 초당 25, 통신 모듈을 달면 32 |'],
        [da, '| 통신 모듈 | 350 |'],
        [da, '| 시설 수리 | 555 |'],
        [da, '22 이상. 95.05°C 위에서는 불이 날 수 있다'],
        [da, '12~90, 초당 최대 3씩 변한다'],
        [da, '1~25초 동안 깊이 잠든다. 조용하고 전력도 2만 쓰지만'],
        [f1, '작물은 심은 지 90초(36시간) 뒤에 익는다'],
        [f1, '익은 채로 30초(12시간)이 지나면 썩어서 사라지고'],
        [f1, '31의 식량을 출고함에 넣고 바로 다시 심는다. 출고함은 77까지이고'],
        [f1, '| 보드 설치 | 210 |'],
        [w, '트럭은 3대이고 한 대에 55까지 싣는다. 초당 4칸을 가고, 새 칸에 들어설 때마다 연료비로 3씩 든다'],
        [w, '재고는 하루에 4%씩 상한다'],
        [w, '주거지 블록마다 주민 35명이 살고, 한 명이 하루 2씩 먹는다'],
        [w, '한 명당 하루 6씩 세금을 낸다'],
        [w, '시즌을 시작할 때 주거지 블록마다 식량이 90만큼 있다'],
        [w, 'amount는 1~55'],
        [w, '트럭 3대, id 1~3'],
        [p, '풍력은 날씨를 따라 0~250 사이에서 초당 최대 9씩 변하고'],
        [p, '화력은 정한 출력 그대로 나온다(0~400)'],
        [p, '`fuel_price`(4~11, 매일 바뀐다)가 든다'],
        [p, '하루는 60초이므로 출력 1단위의 초당 연료비: `fuel_price` / 60.'],
        [common, '하루는 60초, 시즌은 25일이다'],
        [common, '"power back (steady for 6 s)"'],
        [common, '그 시설의 수요가 3%씩 늘어난다'],
        [common, '시작 자금은 6000이다'],
        [common, '보드 유지비(돌거나 자는 보드마다 하루 12.'],
        [common, '세계는 1초에 40 스텝씩 흐르고'],
        [common, '자금이 4일 연속 0보다 적으면'],
        [common, '| 밭 | 210 | 150 |'],
        [common, '| 데이터센터 | 600 | 555 |'],
        [common, '통신 모듈: 350. 보드의 기본 전자파가 초당 7 늘어난다.'],
        [common, '시설 수리는 30초(12시간) 걸린다. 보드 재건은 444이고 30초(12시간) 걸린다.'],
        [common, '명령어 50개마다 1'],
        [common, '하나마다 7.'],
        [common, '데이터센터는 처리하는 동안 초당 44의 전자파를 낸다'],
        [common, '이웃 네 칸에 11%씩 나눠 주고, 지도 전체가 매초 12%씩 줄어든다'],
        [common, '77777에 닿을 때마다'],
        [common, '무리는 4명이고'],
        [common, '초당 2칸씩 걷고'],
        [common, '전자파가 9 이상인 칸이고'],
        [common, '감지되는 것이 15초 동안 없으면'],
        [common, '시설에서 6칸 안으로 들어오면'],
        [common, '보드를 1~25초 동안 재운다'],
        [common, '전력은 2만 쓴다'],
        [common, '데이터센터의 처리(170)와 냉각(333), 주거지 블록마다 75'],
        [common, '마을이 6초 동안 한 번도 끊기지 않아야 다시 울린다'],
        [p, '| `wind` | 풍력 모듈이 지금 내는 전력. 비용이 없다 | 전력 | 0~250, 초당 최대 9씩 변한다 |'],
        [p, '| `fuel_price` | 화력 출력 1단위를 하루 돌리는 연료비. 매일 새로 정해진다 | 돈/단위·일 | 4~11 |'],
        [p, '| `io.set_thermal(output)` | 화력 출력을 정한다(0~400). 다시 정할 때까지 그대로다 |'],
        [
          da,
          '| `io.process()` | 지금부터 0.75초 동안 데이터센터를 돌린다. 이미 돌고 있으면 끝나는 시각을 지금부터 0.75초 뒤로 다시 잡는다(쌓이지 않는다) |',
        ],
        [da, '| `io.cool()` | 냉각을 한 번 돌린다: 3초에 걸쳐 12.5°C를 낮춘다. 냉각 중이면 아무 일도 없지만 행동 전자파는 낸다 |'],
        [da, '| `price` | 지금의 작업 단가. 처리하는 1초마다 이만큼 번다 | 돈/처리 1초 | 12~90, 초당 최대 3씩 변한다 |'],
        [da, '| `day` | 시즌의 날 | 일 | 1~25 |'],
        [da, '| `clock` | 시즌이 시작된 뒤 흐른 게임 시간 | 초, 소수 | 0~1500 |'],
        [
          f1,
          '| `io.harvest()` | 익은 작물을 거둬 31의 식량을 출고함에 넣고 바로 다시 심는다. 익지 않았으면 아무 일도 없지만 행동 전자파는 낸다 |',
        ],
        [f1, '| `outbox` | 출고함에 쌓인 식량 | 식량 | 0~77 |'],
        [w, '트럭이 밭에 닿을 때 min(amount, 출고함, 55)만큼 싣고 돌아와 재고에 넣는다'],
        [w, '`io.dispatch(truck, "W", 주거지 id, amount)`. 떠날 때 min(amount, 재고, 55)만큼 싣고'],
        [common, '지도는 24 × 10칸이다'],
        [common, '끊긴 뒤 6초 동안 한 번도 끊기지 않으면'],
        [common, '보드(깨어 있으면 부품 표의 전력, 자면 2)'],
        [common, '통신 모듈이 있으면 7 더 낸다'],
        [common, '데이터센터가 95.05°C를 넘으면 매초, 넘은 1°C마다 1.2%의 확률로 불이 난다'],
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
          '스택이 풀린 뒤에 돌고, 명령어 상한에 닿은 뒤에는 돌지 않는다',
          '아무 일도 하지 않은 행동도 전자파로 센다',
          '행동이 아니라서 행동 전자파가 없고, 틱이 실패해도 남는다',
          '그 틱의 로그 줄과 `mem`에 쓴 값은 남는다',
          '`io.sleep()` 뒤에 부른 행동은 버려지고, 앞에 부른 행동은 적용된다',
          '보드가 자는 동안에도 시설은 멈추지 않는다',
          '200바이트(한글 약 66자)',
          '아직 수거되지 않은 쓰레기까지 센다',
          '쓰레기만으로 "out of RAM"이 나지는 않는다',
          '사람이 손으로 하는 일(수확, 트럭 보내기, 화력과 공급 순서 정하기)은 전자파가 없다',
          '그 시설을 보드째 통째로 부순다',
          '먼저 시설을 수리하고',
          '목록과 표로 된 센서(예: `io.farms`)의 값도 틱마다 다시 쓰이므로',
          '펌웨어가 그 값을 바꾸거나 지워도 다음 틱에는 센서가 읽은 값으로 돌아온다',
          '펌웨어가 `io`나 그 목록과 표에 스스로 더한 키는 다음 배포 때까지 그대로 남는다',
        ].map((phrase) => [da, phrase] as const),
      ),
    ).toEqual([]);
  });

  it('says whether a board that calls process() on every beat keeps the datacenter running, by the length of its beat', () => {
    const rests = '이 보드의 박자는 그보다 길어서, 박자마다 불러도 사이사이 쉰다';
    const runs = '이 보드가 박자마다 부르면 쉬지 않고 돈다';
    // DA beats at 5 Hz, every 0.2 s: a 0.1 s job ends before the next beat, a 0.2 s job lasts exactly to it.
    for (const [jobMs, says] of [
      [100, rests],
      [200, runs],
      [500, runs],
    ] as const) {
      const scenario = m2Scenario((j) => {
        j.tuning.datacenter.jobMs = jobMs;
      });
      const da = boardManual(scenario, 'DA')!;
      expect(da, `${jobMs} ms`).toContain(says);
      expect(da, `${jobMs} ms`).not.toContain(says === rests ? runs : rests);
    }
  });

  it('writes no placeholder in any manual of the milestone-1 or the milestone-2 town', () => {
    for (const scenario of [m1Scenario(), town]) {
      for (const f of scenario.facilities) {
        const text = boardManual(scenario, f.id);
        if (text === null) continue;
        expect(text, `${scenario.id} ${f.id}`).not.toMatch(/undefined|NaN|Infinity|\[object|\$\{/);
      }
      expect(commonManual(scenario), scenario.id).not.toMatch(/undefined|NaN|Infinity|\[object|\$\{/);
      expect(manualIndex(scenario), scenario.id).not.toMatch(/undefined|NaN|Infinity|\[object|\$\{/);
    }
  });

  it('says the excess under which passive cooling takes off nothing, where the simulation stops it', () => {
    const tuned = m2Scenario((j) => {
      j.time.stepsPerSecond = 40;
      j.tuning.datacenter.passiveCoolingPermillePerSecond = 7;
    });
    for (const [scenario, label] of [
      [town, 'the town'],
      [tuned, 'a town with 40 steps a second and a 0.7% leak'],
    ] as const) {
      const s = new Session(scenario, 1, new NullHost());
      const dc = s.world.datacenters.DA!;
      const ambient = scenario.tuning.datacenter.ambientMilli;
      const leak = (excess: number): number => {
        dc.tempMilli = ambient + excess;
        runDatacenters(s.ctx, 0);
        return ambient + excess - dc.tempMilli;
      };
      let stuckBelow = 0;
      while (stuckBelow < 100_000 && leak(stuckBelow) === 0) stuckBelow += 1;
      expect(stuckBelow, label).toBeLessThan(100_000);
      expect(boardManual(scenario, 'DA'), label).toContain(
        `온도가 ${ambient / 1000}°C보다 ${stuckBelow / 1000}°C 이상 높지 않으면 식지 않는다`,
      );
    }
  });

  it('says nothing of the leak stopping when the scenario has no passive cooling', () => {
    const none = m2Scenario((j) => {
      j.tuning.datacenter.passiveCoolingPermillePerSecond = 0;
    });
    const da = boardManual(none, 'DA')!;
    expect(da).toContain('가만히 두면 매초 (온도 − 25°C)의 0%씩만 식는다');
    expect(da).not.toContain('이상 높지 않으면 식지 않는다');
    expect(da).not.toMatch(/Infinity|NaN/);
  });

  it('lists every board slot in the index, then the common rules', () => {
    const index = manualIndex(town);
    expect(index).toMatch(/^# 매뉴얼 목차\n/);
    expect(index).toContain('보드를 달 수 있는 시설은 7곳이다');
    for (const line of ['- `P`: 발전소, (4, 4)', '- `DA`: 데이터센터, (5, 4)', '- `W`: 물류창고, (11, 6)', '- `F3`: 밭, (4, 9)']) {
      expect(index).toContain(line);
    }
    expect(index).not.toContain('- `H1`');
    expect(index.indexOf('\n## 공통 규칙\n')).toBeGreaterThan(index.indexOf('- `F3`'));
    // The common rules sit one level down under their own heading, as in a board's manual.
    expect(index).toContain('\n## 공통 규칙\n\n### 마을\n');
  });

  it('uses only the markdown that the viewer renders', () => {
    const docs = [commonManual(town), manualIndex(town), ...BOARDS.map((id) => boardManual(town, id)!)];
    for (const doc of docs) {
      const lines = doc.split('\n');
      let fenced = false;
      let columns = 0;
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
        // Every row has as many cells as the header: a pipe inside a cell would add one.
        if (line.startsWith('|')) {
          if (!lines[i - 1]?.startsWith('|')) columns = line.split('|').length;
          expect(line.split('|').length, `line ${i}: ${line}`).toBe(columns);
        }
      });
      expect(fenced).toBe(false);
      // No HTML, which the viewer never renders. Inline code may show a tag, as the sandbox rules show `<close>`.
      expect(doc.replace(/`[^`]*`/g, '')).not.toMatch(/<\/?[a-z]/i);
    }
  });
});
