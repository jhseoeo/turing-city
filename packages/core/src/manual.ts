import { LOG_LIMIT } from './boards.ts';
import { idiv, MILLI } from './fixed.ts';
import {
  BOARD_KINDS,
  type BoardKind,
  type BoardSpec,
  type FacilityKind,
  type FacilitySpec,
  type Scenario,
  type SensorName,
  takesBoard,
} from './scenario.ts';
import { SENSOR_KEYS } from './sensors.ts';
import { manhattan } from './world.ts';

/*
 * The board manual (spec 2026-10-10 §9). It is game text the player reads, so it is Korean, with English identifiers. Every number
 * in it is the scenario's own. It uses only the markdown the viewer renders: #, ## and ### headings, paragraphs, "- " lists, pipe
 * tables with a header row, fenced lua blocks, inline code and bold. A Korean particle after a bare number depends on how the number
 * is read, so a number is always followed by a unit or by a particle that fits any word (의, 씩, 까지, 만큼, 만).
 */

/** The facility kinds as the player reads them. */
const KIND_NAMES: Record<FacilityKind, string> = {
  power: '발전소',
  datacenter: '데이터센터',
  farm: '밭',
  warehouse: '물류창고',
  housing: '주거지',
};

/** A milli-unit amount as a short decimal: 2000 is "2", 800 is "0.8", 95050 is "95.05". Milliseconds read as seconds the same way. */
function milli(amount: number): string {
  const fraction = String(amount % MILLI)
    .padStart(3, '0')
    .replace(/0+$/, '');
  return fraction === '' ? String(idiv(amount, MILLI)) : `${idiv(amount, MILLI)}.${fraction}`;
}

/** Per mille as a percentage: 3 is "0.3", 25 is "2.5", 10 is "1". */
function permille(n: number): string {
  return n % 10 === 0 ? String(idiv(n, 10)) : `${idiv(n, 10)}.${n % 10}`;
}

/** Game seconds with the days or hours they make in the scenario: "120초(3일)", "20초(12시간)", "20초(약 6시간)". */
function span(scenario: Scenario, seconds: number): string {
  const day = scenario.time.secondsPerDay;
  if (seconds % day === 0) return `${seconds}초(${seconds / day}일)`;
  const exact = (seconds * 24) % day === 0;
  return `${seconds}초(${exact ? '' : '약 '}${idiv(seconds * 24, day)}시간)`;
}

const code = (text: string): string => `\`${text}\``;

const list = (items: readonly string[]): string => items.map((item) => `- ${item}`).join('\n');

const table = (head: readonly string[], rows: ReadonlyArray<readonly string[]>): string =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');

/** A heading and its blocks (paragraphs, lists, tables, a fenced code block), rendered at whatever level it sits. */
interface Section {
  readonly title: string;
  readonly blocks: readonly string[];
}

function render(sections: readonly Section[], level: number): string {
  const hashes = '#'.repeat(level);
  return sections.map((s) => [`${hashes} ${s.title}`, ...s.blocks].join('\n\n')).join('\n\n');
}

function plantOf(scenario: Scenario): FacilitySpec {
  const plant = scenario.facilities.find((f) => f.kind === 'power');
  if (!plant) throw new Error('the scenario has no power plant');
  return plant;
}

const ofKind = (scenario: Scenario, kind: FacilityKind): FacilitySpec[] => scenario.facilities.filter((f) => f.kind === kind);

interface SensorDoc {
  readonly meaning: string;
  readonly unit: string;
  readonly range: string;
}

/** What each sensor reads. */
function sensorDocs(scenario: Scenario): Record<SensorName, SensorDoc> {
  const t = scenario.tuning;
  const dc = t.datacenter;
  return {
    wind: {
      meaning: '풍력 모듈이 지금 내는 전력. 비용이 없다',
      unit: '전력',
      range: `0~${t.wind.max}, 초당 최대 ${t.wind.maxChangePerSecond}씩 변한다`,
    },
    demand: { meaning: '이번 스텝에 마을 전체가 요청한 전력. 송전 손실까지 넣은 값', unit: '전력', range: '0 이상' },
    fuelPrice: {
      meaning: '화력 출력 1단위를 하루 돌리는 연료비. 매일 새로 정해진다',
      unit: '돈/단위·일',
      range: `${t.fuelPrice.min}~${t.fuelPrice.max}`,
    },
    temp: {
      meaning: '이 데이터센터의 온도',
      unit: '°C, 소수',
      range: `${milli(dc.ambientMilli)} 이상. ${milli(dc.fireThresholdMilli)}°C 위에서는 불이 날 수 있다`,
    },
    powerHeadroom: { meaning: '발전량에서 수요를 뺀 값. 음수면 발전소가 시설을 끊고 있다', unit: '전력', range: '음수일 수 있다' },
    price: {
      meaning: '지금의 작업 단가. 처리하는 1초마다 이만큼 번다',
      unit: '돈/처리 1초',
      range: `${t.jobPrice.min}~${t.jobPrice.max}, 초당 최대 ${t.jobPrice.maxChangePerSecond}씩 변한다`,
    },
    emf: { meaning: '이 보드가 있는 칸의 전자파', unit: '전자파, 소수', range: '0 이상' },
    ludditeDist: { meaning: '가장 가까운 러다이트 무리까지의 거리', unit: '칸', range: '0 이상. 지도에 무리가 없으면 nil' },
    ripeness: { meaning: '작물이 익은 정도. 100이면 익어서 거둘 수 있다', unit: '%', range: '0~100' },
    outbox: { meaning: '출고함에 쌓인 식량', unit: '식량', range: `0~${t.farm.outboxCapacity}` },
    stock: { meaning: '이 창고에 보관된 식량', unit: '식량', range: '0 이상' },
    farms: {
      meaning: `밭마다 ${code('{ id, outbox, distance }')}: 출고함의 식량, 이 창고에서의 거리(칸)`,
      unit: '목록',
      range: `밭 ${ofKind(scenario, 'farm').length}곳, 지도 순서`,
    },
    housing: {
      meaning: `주거지마다 ${code('{ id, food, residents, distance }')}: 남은 식량, 주민 수, 이 창고에서의 거리(칸)`,
      unit: '목록',
      range: `주거지 ${ofKind(scenario, 'housing').length}곳, 지도 순서`,
    },
    trucks: {
      meaning: `트럭마다 ${code('{ id, status, x, y, load, target }')}: status는 "idle"(창고에서 대기), "outbound"(가는 중), "returning"(돌아오는 중). x와 y는 지금 칸, load는 실은 식량, target은 가는 곳의 id(대기 중이면 nil)`,
      unit: '목록',
      range: `트럭 ${t.warehouse.trucks}대, id 1~${t.warehouse.trucks}`,
    },
  };
}

interface ActionDoc {
  readonly call: string;
  readonly meaning: string;
}

/** The calls of each kind of board, and the two every board has. */
function actionDocs(scenario: Scenario): Record<BoardKind | 'any', readonly ActionDoc[]> {
  const t = scenario.tuning;
  const dc = t.datacenter;
  return {
    datacenter: [
      {
        call: 'io.process()',
        meaning: `지금부터 ${milli(dc.jobMs)}초 동안 데이터센터를 돌린다. 이미 돌고 있으면 끝나는 시각을 지금부터 ${milli(dc.jobMs)}초 뒤로 다시 잡는다(쌓이지 않는다)`,
      },
      {
        call: 'io.cool()',
        meaning: `냉각을 한 번 돌린다: ${milli(dc.coolingCycleMs)}초에 걸쳐 ${milli(dc.coolingDropMilli)}°C를 낮춘다. 냉각 중이면 아무 일도 없다`,
      },
    ],
    power: [
      { call: 'io.set_thermal(output)', meaning: `화력 출력을 정한다(0~${t.thermal.max}). 다시 정할 때까지 그대로다` },
      {
        call: 'io.set_priority({ids})',
        meaning:
          '전력이 모자랄 때 지킬 순서를 높은 쪽부터 정한다. 예: {"H1", "DA"}. 빠진 시설은 지도 순서로 뒤에 온다. 모르는 id는 그 틱을 에러로 끝낸다',
      },
    ],
    farm: [
      {
        call: 'io.harvest()',
        meaning: `익은 작물을 거둬 ${t.farm.yield}의 식량을 출고함에 넣고 바로 다시 심는다. 익지 않았으면 아무 일도 없다`,
      },
    ],
    warehouse: [
      {
        call: 'io.dispatch(truck, from, to, amount)',
        meaning: `트럭 하나를 보낸다. 회수는 from이 밭, to가 이 창고. 배달은 from이 이 창고, to가 주거지. amount는 1~${t.warehouse.truckCapacity}. 대기 중인 트럭만 떠나고, 맞지 않는 요청은 아무 일도 없다. 모르는 id는 그 틱을 에러로 끝낸다`,
      },
    ],
    any: [
      {
        call: 'io.log(...)',
        meaning:
          '로그에 한 줄을 남긴다(print도 같다). 틱마다 20줄, 줄마다 200바이트(한글 약 66자)까지. 행동이 아니라서 행동 전자파가 없고, 틱이 실패해도 남는다',
      },
      {
        call: 'io.sleep(seconds)',
        meaning: `1~${t.maxSleepSeconds}초 동안 깊이 잠든다. 조용하고 전력도 ${t.sleepPower}만 쓰지만, RAM(mem과 전역 변수)이 지워진다`,
      },
    ],
  };
}

/** What each kind of facility is for, in a paragraph. */
const ROLES: Record<BoardKind, string> = {
  power:
    '발전소는 마을 전체에 전력을 댄다. 풍력은 날씨를 따라 공짜로 나오고, 화력은 정한 만큼 나오지만 연료비가 든다. 이 보드의 펌웨어는 화력 출력과, 전력이 모자랄 때 누구부터 끊을지를 정한다.',
  datacenter:
    '데이터센터는 마을의 돈줄이다. 처리하는 동안 작업 단가만큼 벌지만, 전력을 많이 먹고, 뜨거워지고, 전자파를 낸다. 이 보드의 펌웨어는 언제 처리하고 언제 식힐지를 정한다. 데이터센터는 그 자체가 기계라서, 보드가 없어도 일하는 동안에는 러다이트의 표적이 된다.',
  farm: '밭은 작물을 기른다. 익은 작물을 거두면 출고함에 식량이 쌓이고, 물류창고의 트럭이 그것을 가져간다. 이 보드의 펌웨어는 언제 거둘지를 정한다. 거두지 않고 두면 작물이 썩는다.',
  warehouse:
    '물류창고는 식량을 옮긴다. 트럭으로 밭의 출고함에서 식량을 걷어 와 보관하고, 주거지로 배달한다. 이 보드의 펌웨어는 어느 트럭을 어디로 얼마나 보낼지를 정한다. 주민은 먹을 것이 있어야 세금을 낸다.',
};

/** The rules of one kind of facility, as blocks: a list, and for the warehouse the distances it works with. */
function facilityRules(scenario: Scenario, f: FacilitySpec, kind: BoardKind, board: BoardSpec): string[] {
  const t = scenario.tuning;
  const day = scenario.time.secondsPerDay;
  switch (kind) {
    case 'power': {
      const consumers = scenario.facilities.filter((x) => x.kind !== 'power').map((x) => code(x.id));
      return [
        list([
          `발전량은 풍력과 화력의 합이다. 풍력은 날씨를 따라 0~${t.wind.max} 사이에서 초당 최대 ${t.wind.maxChangePerSecond}씩 변하고, 비용이 없다.`,
          `화력은 정한 출력 그대로 나온다(0~${t.thermal.max}). 출력 1단위에 하루 ${code('fuel_price')}(${t.fuelPrice.min}~${t.fuelPrice.max}, 매일 바뀐다)가 든다. 하루는 ${day}초이므로 출력 1단위의 초당 연료비: ${code('fuel_price')} / ${day}.`,
          `${code('io.set_thermal(output)')}와 손의 [화력], ${code('io.set_priority({ids})')}와 손의 [공급 순서]는 같은 설정을 바꾼다. 나중에 바꾼 쪽이 이긴다.`,
          '화력 설정과 공급 순서는 마을의 것이다. 보드가 자거나 부서져도 남는다. 발전소가 부서져 있는 동안 화력은 0이고 풍력만 나온다.',
          `공급 순서에 쓸 수 있는 id: ${consumers.join(', ')}. 기본 순서는 이 지도 순서다.`,
          '발전소 자신의 보드는 끊기지 않는다.',
        ]),
      ];
    }
    case 'datacenter': {
      const dc = t.datacenter;
      // Firmware that calls process() on every beat keeps the datacenter running when a job outlasts the beat.
      const continuous = board.clockHz * dc.jobMs >= 1000;
      return [
        list([
          `${code('io.process()')}와 손의 [처리]는 같은 일을 한다: 데이터센터가 도는 끝 시각을 지금부터 ${milli(dc.jobMs)}초 뒤로 잡는다. ${continuous ? '이 보드가 박자마다 부르면 쉬지 않고 돈다' : '이 보드의 박자는 그보다 길어서, 박자마다 불러도 사이사이 쉰다'}.`,
          `처리하는 1초마다 그때의 단가(${code('price')})만큼 번다.`,
          `처리하는 동안 ${dc.processPower}의 전력을 더 쓰고, 초당 ${milli(dc.heatMilliPerSecond)}°C씩 뜨거워지고, 초당 ${t.emf.processingPerSecond}의 전자파를 낸다.`,
          `가만히 두면 매초 (온도 − ${milli(dc.ambientMilli)}°C)의 ${permille(dc.passiveCoolingPermillePerSecond)}%씩만 식는다. 아주 느리다.`,
          `${code('io.cool()')}과 손의 [냉각]은 같은 일을 한다: ${milli(dc.coolingCycleMs)}초에 걸쳐 고르게 ${milli(dc.coolingDropMilli)}°C를 낮추고, 그동안 ${dc.coolingPower}의 전력을 쓴다. 냉각 중에 다시 부르면 아무 일도 없다. 처리와 냉각은 함께 돌 수 있다.`,
          '전력이 끊기면 처리도 냉각도 멈춘다. 끊긴 동안에도 작업과 냉각 주기의 시간은 흘러가서, 그 사이의 몫은 사라진다.',
          `${milli(dc.overheatAlertMilli)}°C에 닿으면 과열 알림이 뜬다. ${milli(dc.fireThresholdMilli)}°C를 넘으면 매초, 넘은 1°C마다 ${permille(dc.firePermillePerDegreePerSecond)}%의 확률로 불이 나서 데이터센터가 보드째 부서진다.`,
          '보드가 돌거나 자고 있는 데이터센터는 늘 러다이트의 표적이다. 보드가 없거나 부서졌으면 처리하는 동안에만 표적이고, 그때 칸의 전자파가 감지되면 러다이트가 찾아와 시설째 부순다.',
          `수리된 데이터센터는 상온(${milli(dc.ambientMilli)}°C)에서 다시 시작한다.`,
        ]),
      ];
    }
    case 'farm':
      return [
        list([
          `작물은 심은 지 ${span(scenario, t.farm.ripenSeconds)} 뒤에 익는다. ${code('ripeness')}는 그동안 0에서 100으로 오른다.`,
          `익은 채로 ${span(scenario, t.farm.rotSeconds)}이 지나면 썩어서 사라지고, 그 자리에 바로 다시 심는다.`,
          `${code('io.harvest()')}와 손의 [수확]은 같은 일을 한다: ${t.farm.yield}의 식량을 출고함에 넣고 바로 다시 심는다. 출고함은 ${t.farm.outboxCapacity}까지이고, 넘치는 만큼은 버려진다.`,
          '출고함의 식량은 물류창고의 트럭이 가져간다.',
          '밭은 보드가 없어도 자란다. 보드는 수확을 대신할 뿐이다.',
          '수리된 밭은 그때 새로 심는다.',
        ]),
      ];
    case 'warehouse': {
      const w = t.warehouse;
      const h = t.housing;
      const served = scenario.facilities.filter((x) => x.kind === 'farm' || x.kind === 'housing');
      return [
        list([
          `트럭은 ${w.trucks}대이고 한 대에 ${w.truckCapacity}까지 싣는다. 초당 ${w.truckCellsPerSecond}칸을 가고, 새 칸에 들어설 때마다 연료비로 ${w.fuelPerCell}씩 든다.`,
          '길은 격자선을 따라 가로 먼저, 그다음 세로로 간다.',
          `회수: ${code(`io.dispatch(truck, 밭 id, "${f.id}", amount)`)}. 트럭이 밭에 닿을 때 min(amount, 출고함, ${w.truckCapacity})만큼 싣고 돌아와 재고에 넣는다.`,
          `배달: ${code(`io.dispatch(truck, "${f.id}", 주거지 id, amount)`)}. 떠날 때 min(amount, 재고, ${w.truckCapacity})만큼 싣고 주거지에 내려 준 뒤 빈 차로 돌아온다. 재고가 1보다 적으면 떠나지 않는다.`,
          '손의 [트럭 보내기]도 같은 일을 한다. 대기 중인 트럭만 떠난다.',
          `재고는 하루에 ${w.spoilagePctPerDay}%씩 상한다(하루의 마지막 순간에 한 번, 그때의 재고에서 덜어 낸다).`,
          `주거지 블록마다 주민 ${h.residents}명이 살고, 한 명이 하루 ${h.foodPerPersonPerDay}씩 먹는다. 먹을 것이 떨어지면 굶고 세금을 내지 않는다. 먹고 전기가 들어오는 주민은 한 명당 하루 ${h.taxPerPersonPerDay}씩 세금을 낸다.`,
          `시즌을 시작할 때 주거지 블록마다 식량이 ${h.startFood}만큼 있다.`,
          '창고가 부서지면 새 트럭을 보낼 수 없다. 이미 길에 있는 트럭은 하던 일을 마친다.',
        ]),
        table(
          ['대상', '시설', '위치', '이 창고에서'],
          served.map((x) => [code(x.id), KIND_NAMES[x.kind], `(${x.x}, ${x.y})`, `${manhattan(f.x, f.y, x.x, x.y)}칸`]),
        ),
      ];
    }
  }
}

/** The board's own sections: its role, parts, io fields, actions, and its facility's rules. */
function boardSections(scenario: Scenario, f: FacilitySpec, kind: BoardKind, board: BoardSpec): Section[] {
  const t = scenario.tuning;
  const plant = plantOf(scenario);
  const sensors = sensorDocs(scenario);
  const actions = actionDocs(scenario);
  const time = scenario.time;
  return [
    { title: '이 보드가 하는 일', blocks: [ROLES[kind]] },
    {
      title: '부품',
      blocks: [
        table(
          ['항목', '값'],
          [
            ['클럭', `${board.clockHz} Hz: 1초에 ${board.clockHz}번 틱`],
            ['틱당 명령어 상한', String(board.instructionCap)],
            ['RAM', `${board.ramKb} KB (${board.ramKb * 1024}바이트)`],
            ['센서', board.sensors.map((s) => code(SENSOR_KEYS[s])).join(', ')],
            ['보드 전력', `깨어 있을 때 ${board.power}, 자는 동안 ${t.sleepPower}`],
            ['기본 전자파', `초당 ${board.baseEmfPerSecond}, 통신 모듈을 달면 ${board.baseEmfPerSecond + t.install.commBaseEmfPerSecond}`],
            ['위치', `(${f.x}, ${f.y}), 발전소까지 ${manhattan(f.x, f.y, plant.x, plant.y)}칸`],
            ['보드 설치', String(t.install.boardPrice[kind])],
            ['통신 모듈', String(t.install.commPrice)],
            ['시설 수리', String(t.repair.cost[kind])],
          ],
        ),
      ],
    },
    {
      title: 'io로 읽는 값',
      blocks: [
        table(
          ['이름', '뜻', '단위', '범위'],
          [
            ...board.sensors.map((s): string[] => [code(SENSOR_KEYS[s]), sensors[s].meaning, sensors[s].unit, sensors[s].range]),
            [code('day'), '시즌의 날', '일', `1~${time.seasonDays}`],
            [code('clock'), '시즌이 시작된 뒤 흐른 게임 시간', '초, 소수', `0~${time.seasonDays * time.secondsPerDay}`],
          ],
        ),
      ],
    },
    {
      title: 'io로 하는 행동',
      blocks: [
        table(
          ['호출', '하는 일'],
          [...actions[kind], ...actions.any].map((a) => [code(a.call), a.meaning]),
        ),
      ],
    },
    { title: `${KIND_NAMES[kind]}의 규칙`, blocks: facilityRules(scenario, f, kind, board) },
  ];
}

/** The rules every board runs under. */
function commonSections(scenario: Scenario): Section[] {
  const t = scenario.tuning;
  const time = scenario.time;
  const day = time.secondsPerDay;
  const dc = t.datacenter;
  const e = t.emf;
  const l = t.luddites;
  const quiet = t.shortageQuietSeconds;
  const plant = plantOf(scenario);
  return [
    {
      title: '마을',
      blocks: [
        `지도는 ${scenario.grid.width} × ${scenario.grid.height}칸이다. 위치는 (열, 행)이고 왼쪽 위가 (0, 0)이다. 거리는 가로와 세로 칸 수의 합이다.`,
        table(
          ['id', '시설', '위치', '발전소까지'],
          scenario.facilities.map((f) => [
            code(f.id),
            KIND_NAMES[f.kind],
            `(${f.x}, ${f.y})`,
            `${manhattan(f.x, f.y, plant.x, plant.y)}칸`,
          ]),
        ),
      ],
    },
    {
      title: '실행 모델',
      blocks: [
        list([
          `보드는 CPU의 클럭 박자마다 ${code('tick(io, mem)')}을 한 번 부른다. 보드가 깨어 있고, 전력을 받고, 그 시설이 부서지지 않았을 때만 돈다.`,
          `세계는 1초에 ${time.stepsPerSecond} 스텝씩 흐르고, 보드는 자기 박자가 온 스텝에서만 펌웨어를 실행한다. 박자 사이에도 세계는 움직이므로 클럭이 느린 보드는 그만큼 늦게 알아챈다.`,
          `하루는 ${day}초, 시즌은 ${time.seasonDays}일이다. ${code('io.day')}는 시즌의 날(1부터), ${code('io.clock')}은 시즌이 시작된 뒤 흐른 게임 초다.`,
          `센서 값은 틱마다 ${code('io')}에 새로 쓰인다. 목록과 표로 된 센서(예: ${code('io.farms')})의 값도 틱마다 다시 쓰이므로, 펌웨어가 그 값을 바꿔도 다음 틱에는 센서가 읽은 값으로 돌아온다.`,
          `행동은 틱 동안 쌓였다가 틱이 끝나면 차례로 적용된다. 한 틱에 쌓을 수 있는 행동은 숫자 64개 분량이다: ${code('process')}, ${code('cool')}, ${code('harvest')}는 1, ${code('set_thermal')}과 ${code('sleep')}은 2, ${code('dispatch')}는 5, ${code('set_priority')}는 2에 id 수를 더한 만큼. 다 들어가지 않는 행동은 통째로 버려진다.`,
          `${code('mem')}은 틱과 틱, 배포와 배포 사이에 남는다. 전역 변수는 배포할 때마다 사라진다. 깊은 휴면과 시설 파괴는 둘 다 지운다.`,
          `배포할 때마다 새 ${code('io')}를 받는다. 배포를 넘어 이어지는 것은 ${code('mem')}뿐이다.`,
        ]),
        [
          '```lua',
          'function tick(io, mem)',
          '  -- io: 이번 틱의 센서 값과 이 보드의 행동',
          '  -- mem: 틱과 배포 사이에 남는 기억',
          'end',
          '```',
        ].join('\n'),
      ],
    },
    {
      title: '배포',
      blocks: [
        list([
          '배포하면 먼저 문법을 검사한다. 문법 오류는 줄 번호와 함께 거부되고, 원래 펌웨어가 계속 돈다.',
          '받아들여진 펌웨어는 그 보드의 다음 틱에 설치되고, 버전 번호가 하나 오른다. 보드가 자고 있거나, 전력이 끊겼거나, 부서졌으면 그것이 풀린 뒤의 첫 틱에 설치된다.',
          `설치하는 틱에는 펌웨어의 맨 바깥 코드(메인 청크)가 먼저 돌고, 이어서 ${code('tick')}이 돈다. 메인 청크가 에러로 끝나면 그 틱이 실패하고, ${code('tick')}을 정의하기 전에 실패했다면 다음 배포가 설치될 때까지 매 틱 "noTick: the last deploy failed to install"과 원래 에러를 남긴다.`,
          `${code('tick')}을 정의하지 않은 펌웨어는 매 틱 "noTick: firmware defines no tick(io, mem) function"을 남긴다.`,
        ]),
      ],
    },
    {
      title: '오류와 로그',
      blocks: [
        list([
          '런타임 에러, 명령어 상한 초과, RAM 부족은 그 틱 하나만 실패시킨다. 실패한 틱은 로그에 남고 펌웨어 에러 알림이 뜨며, 다음 틱은 평소대로 돈다.',
          `실패한 틱의 행동은 모두 버려지지만, 그 틱의 로그 줄과 ${code('mem')}에 쓴 값은 남는다.`,
          `로그는 보드마다 최근 ${LOG_LIMIT}줄이고, 줄마다 게임 시각이 붙는다. ${code('io.log')}가 남긴 줄, 에러, 시스템 사건(설치, 휴면, 깨어남, 파괴, 재건, 정전과 복구)이 들어간다.`,
          '같은 줄이 연달아 오면 한 줄로 접히고 ×N이 붙는다. 사이에 다른 줄이 끼면 새 줄이 된다.',
          quiet > 0
            ? `보드의 시설이 전력망에서 끊기면 "power lost"가, 끊긴 뒤 ${quiet}초 동안 한 번도 끊기지 않으면 "power back (steady for ${quiet} s)"가 남는다. 깜빡이는 동안에는 "power lost"만 접혀서 쌓인다.`
            : '보드의 시설이 전력망에서 끊기면 "power lost"가, 다시 들어오면 바로 "power back"이 남는다.',
        ]),
      ],
    },
    {
      title: 'CPU와 RAM',
      blocks: [
        list([
          '한 틱에 실행할 수 있는 명령어 수는 보드마다 정해진 상한까지다(각 보드의 부품 표). 상한에 닿으면 그 틱은 "CPU limit exceeded"로 중단되고, 전자파 계산에서는 상한을 다 쓴 것으로 센다. 무한 루프에 빠진 보드는 마을에서 가장 시끄러운 보드가 된다.',
          `${code('pcall')}도 코루틴도 이 상한을 피하지 못한다.`,
          `일을 많이 하는 내장 함수(${code('string.rep')}, ${code('table.concat')}, ${code('table.sort')} 등)는 그 일의 양만큼 명령어를 쓴다.`,
          `RAM은 고정된 기준선 위의 펌웨어 데이터다: ${code('mem')}, 전역 변수, 틱이 할당한 것. 코드는 RAM에 세지 않는다. 넘으면 그 틱은 "out of RAM"으로 실패한다.`,
          `"out of RAM" 뒤에도 ${code('mem')}은 데이터를 그대로 들고 있다. 그러니 새 펌웨어는 첫 틱에 ${code('mem')}에서 필요 없는 것부터 비워야 한다. 그 첫 틱에는 약간의 여유가 더 주어진다.`,
          '보고되는 RAM 사용량은 아직 수거되지 않은 쓰레기까지 센다. 그래서 무언가를 비운 직후에도 높게 나올 수 있다. 쓰레기만으로 "out of RAM"이 나지는 않는다: 할당을 거부하기 전에 먼저 수거한다.',
        ]),
      ],
    },
    {
      title: 'Lua 샌드박스',
      blocks: [
        list([
          `쓸 수 있는 것: 기본 라이브러리(${code('pairs')}, ${code('ipairs')}, ${code('pcall')}, ${code('setmetatable')} 등), ${code('string')}, ${code('table')}, ${code('math')}, ${code('coroutine')}.`,
          `없는 것: ${code('os')}, ${code('io')} 라이브러리, ${code('load')}, ${code('require')}, ${code('debug')}, ${code('collectgarbage')}, ${code('utf8')}, ${code('string.dump')}, ${code('string.pack')}, ${code('string.unpack')}.`,
          `${code('string.find')}는 패턴 없이 글자 그대로만 찾는다. ${code('string.match')}, ${code('string.gmatch')}, ${code('string.gsub')}는 없다.`,
          `${code('math.randomseed')}는 없고, ${code('math.random')}은 보드마다 정해진 씨앗으로 시작한다.`,
          `${code('__tostring')}이 없는 표나 함수를 ${code('tostring')}하면 종류만 나온다. 주소는 어디에서도 보이지 않는다. ${code('string.format')}은 ${code('%p')}를 거부한다.`,
          `${code('setmetatable')}은 ${code('__gc')}와 ${code('__mode')}를 거부한다.`,
          `${code('coroutine.close')}는 없다. 에러로 끝난 코루틴은 닫히지 않아서 그 ${code('<close>')} 핸들러가 돌지 않는다.`,
          `${code('xpcall')}의 핸들러는 스택이 풀린 뒤에 돌고, 명령어 상한에 닿은 뒤에는 돌지 않는다.`,
          `${code('pairs')}나 ${code('next')}로 도는 중에 표에 키를 더하면 순서가 정해지지 않는다.`,
        ]),
      ],
    },
    {
      title: '깊은 휴면',
      blocks: [
        list([
          `${code('io.sleep(seconds)')}는 보드를 1~${t.maxSleepSeconds}초 동안 재운다. 틱이 끝나면 잠든다. 잠든 보드는 전자파를 내지 않고 전력은 ${t.sleepPower}만 쓴다.`,
          `휴면은 RAM을 지운다: 깨어나면 ${code('mem')}과 전역 변수가 비어 있고, 펌웨어가 처음부터 다시 설치된다.`,
          `같은 틱에서 ${code('io.sleep()')} 뒤에 부른 행동은 버려지고, 앞에 부른 행동은 적용된다.`,
          '보드가 자는 동안에도 시설은 멈추지 않는다. 손으로 돌릴 수 있고, 시설의 설정(화력 출력, 공급 순서)과 이미 시작된 데이터센터의 작업과 냉각은 그대로 간다.',
        ]),
      ],
    },
    {
      title: '전력',
      blocks: [
        list([
          '발전소의 발전량(풍력과 화력)이 모든 시설에 나뉜다. 전력은 저장되지 않는다.',
          `시설의 수요는 이것들의 합이다: 보드(깨어 있으면 부품 표의 전력, 자면 ${t.sleepPower}), 데이터센터의 처리(${dc.processPower})와 냉각(${dc.coolingPower}), 주거지 블록마다 ${t.housing.power}. 부서졌거나 수리 중인 시설은 아무것도 쓰지 않는다.`,
          `송전 손실: 발전소에서 한 칸 멀어질 때마다 그 시설의 수요가 ${t.transmissionLossPctPerCell}%씩 늘어난다.`,
          `한 스텝의 발전량이 모자라면 공급 순서가 낮은 시설부터 통째로 끊긴다. 공급 순서는 발전소가 정한다(발전소 보드의 ${code('set_priority')}, 또는 손으로). 정하지 않은 시설은 지도 순서로 뒤에 온다. 발전소 자신의 보드는 끊기지 않는다.`,
          `전력이 끊긴 보드는 틱을 돌리지 않고 ${code('mem')}은 그대로 둔다. 시설은 손으로 돌릴 수 있지만, 데이터센터의 처리와 냉각처럼 전력이 드는 일은 멈춘다. 주거지가 끊기면 그 주민은 세금을 내지 않는다.`,
          quiet > 0
            ? `전력 부족 알림은 한 번 울리면, 마을이 ${quiet}초 동안 한 번도 끊기지 않아야 다시 울린다.`
            : '전력 부족 알림은 시설이 다시 끊길 때마다 울린다.',
        ]),
      ],
    },
    {
      title: '돈',
      blocks: [
        list([
          `시작 자금은 ${scenario.startMoney}이다. 점수는 시즌이 끝났을 때의 자금이다.`,
          '들어오는 돈: 데이터센터의 처리, 주거지의 세금.',
          `나가는 돈: 화력 연료, 트럭 연료, 보드 유지비(깨어 있거나 자는 보드마다 하루 ${t.boardUpkeepPerDay}), 보드와 통신 모듈 설치, 시설 수리, 보드 재건.`,
          `자금이 ${t.bankruptcyDays}일 연속 0보다 적으면 파산으로 시즌이 끝난다.`,
        ]),
        table(
          ['시설', '보드 설치', '시설 수리'],
          BOARD_KINDS.map((k) => [KIND_NAMES[k], String(t.install.boardPrice[k]), String(t.repair.cost[k])]),
        ),
        list([
          `통신 모듈: ${t.install.commPrice}. 보드의 기본 전자파가 초당 ${t.install.commBaseEmfPerSecond} 늘어난다.`,
          `시설 수리는 ${span(scenario, t.repair.seconds)} 걸린다. 보드 재건은 ${t.rebuild.cost}이고 ${span(scenario, t.rebuild.seconds)} 걸린다.`,
        ]),
      ],
    },
    {
      title: '전자파',
      blocks: [
        list([
          `깨어 있고 전력을 받는 보드는 아무 일을 안 해도 초당 기본 전자파(부품 표)를 낸다. 통신 모듈이 있으면 ${t.install.commBaseEmfPerSecond} 더 낸다.`,
          `틱마다: 명령어 ${e.instructionsPerUnit}개마다 1, 그리고 펌웨어가 시킨 기계의 행동(${code('harvest')}, ${code('dispatch')}, ${code('set_thermal')}, ${code('set_priority')}, ${code('cool')}) 하나마다 ${e.perAction}. ${code('process')}, ${code('sleep')}, ${code('log')}는 행동으로 세지 않는다.`,
          `데이터센터는 처리하는 동안 초당 ${e.processingPerSecond}의 전자파를 낸다. 손으로 [처리]를 눌렀든 펌웨어가 시켰든 같다.`,
          '사람이 손으로 하는 일(수확, 트럭 보내기, 화력과 공급 순서 정하기)은 전자파가 없다.',
          `전자파는 그 시설의 칸에 쌓인다. 매초 각 칸이 이웃 네 칸에 ${e.diffusionPctPerSecond}%씩 나눠 주고, 지도 전체가 매초 ${e.decayPctPerSecond}%씩 줄어든다.`,
          `소문 게이지가 매초 지도 전체의 전자파를 모은다. ${e.rumourThreshold}에 닿을 때마다 러다이트 무리가 나타나고 게이지는 비워진다. 시끄러운 마을일수록 자주 습격받는다.`,
        ]),
      ],
    },
    {
      title: '러다이트와 화재',
      blocks: [
        list([
          `무리는 ${l.groupSize}명이고, 지도 가장자리의 한 점에서 나타난다.`,
          `초당 ${l.cellsPerSecond}칸씩 걷고, 칸마다 감지되는 가장 강한 전자파로 다시 겨눈다. 감지되는 것은 전자파가 ${e.detectionThreshold} 이상인 칸이고, 노리는 것은 기계다: 보드가 돌거나 자고 있는 시설, 그리고 처리하는 중인 데이터센터(보드가 없어도 된다). 손으로만 돌리는 시설과 쉬는 데이터센터는 표적이 아니다.`,
          '표적에 닿으면 그 시설을 보드째 통째로 부순다. 부서진 시설은 손으로도 돌릴 수 없다.',
          `감지되는 것이 ${l.quietSecondsToLeave}초 동안 없으면 가장 가까운 가장자리로 떠난다.`,
          `무리가 시설에서 ${l.approachCells}칸 안으로 들어오면 접근 알림이 뜬다.`,
          `데이터센터가 ${milli(dc.fireThresholdMilli)}°C를 넘으면 매초, 넘은 1°C마다 ${permille(dc.firePermillePerDegreePerSecond)}%의 확률로 불이 난다. 불도 데이터센터를 보드째 부순다.`,
          `복구는 두 단계다. 먼저 시설을 수리하고(위의 표), 그다음 보드를 재건한다. 재건된 보드는 부품, 통신 모듈, 마지막 펌웨어를 그대로 가지고 돌아오고 ${code('mem')}은 비어 있다. 수리와 재건은 플레이어만 할 수 있다.`,
        ]),
      ],
    },
  ];
}

/** The common rules on their own: what every board's firmware runs under. */
export function commonManual(scenario: Scenario): string {
  return [
    '# 공통 규칙',
    '모든 보드의 펌웨어가 따르는 규칙이다. 모든 숫자는 이 마을의 설정 그대로다.',
    render(commonSections(scenario), 2),
  ].join('\n\n');
}

/** One board slot's manual: the common rules first, then the board's own sections. Null for an unknown id or a facility that takes no board. */
export function boardManual(scenario: Scenario, facilityId: string): string | null {
  const f = scenario.facilities.find((x) => x.id === facilityId);
  if (!f) return null;
  const kind = f.kind;
  const board = f.board;
  if (!takesBoard(kind) || board === null) return null;
  const name = KIND_NAMES[kind];
  return [
    `# ${f.id} 보드 매뉴얼: ${name}`,
    `이 문서는 ${code(f.id)} 보드(${name}, 지도의 (${f.x}, ${f.y}))의 펌웨어를 직접 작성하는 데 필요한 것을 모두 담고 있다. 펌웨어는 Lua 5.4로 쓰고, 게임 안 편집기에서 배포한다. 모든 숫자는 이 마을의 설정 그대로다. 먼저 모든 보드에 공통인 규칙이 오고, 그다음 이 보드만의 규칙이 온다.`,
    '## 공통 규칙',
    render(commonSections(scenario), 3),
    render(boardSections(scenario, f, kind, board), 2),
  ].join('\n\n');
}

/** The index: every board slot, then the common rules. */
export function manualIndex(scenario: Scenario): string {
  const slots = scenario.facilities.filter((f) => takesBoard(f.kind) && f.board !== null);
  return [
    '# 매뉴얼 목차',
    `이 마을에서 보드를 달 수 있는 시설은 ${slots.length}곳이다. 보드마다 매뉴얼이 있고, 모든 매뉴얼은 아래의 공통 규칙으로 시작한다.`,
    list(slots.map((f) => `${code(f.id)}: ${KIND_NAMES[f.kind]}, (${f.x}, ${f.y})`)),
    '## 공통 규칙',
    render(commonSections(scenario), 3),
  ].join('\n\n');
}
