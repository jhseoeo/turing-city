# Prototype milestone 2: the early stage

Agreed with the user on 2026-10-10, after they played milestone 1.

This spec changes the prototype spec of 2026-10-09 (`2026-10-09-prototype-design.md`, "the 10-09 spec" below). The 10-09 spec stays the reference for everything this one leaves alone:
- the step order;
- the power, datacenter, farm, warehouse, and housing rules;
- the EMF field;
- Luddite movement;
- the firmware runtime and its sandbox;
- MCP transport and security;
- the viewer's basics.

Where the two differ, this one wins.

## 1. Why the change

The user opened milestone 1 and couldn't tell what to do. They also found no way to change firmware in the game: firmware came only from an agent over MCP, and the screen never said so.

Their direction:
- The agent-driven loop over MCP is the late game.
- The prototype should first check the early stage: running the town by hand, automating it with firmware written in the game, and only then handing boards to an agent.

## 2. Goal

Answer one question: **is the early stage fun?**

The early stage runs in three steps:
- the player runs the town by hand;
- the player tires of it and buys boards, whose firmware they write in the game's editor, most likely by pasting the board's manual into an AI chat and pasting back what it answers;
- the player hands boards to an agent over MCP.

Two forces push against each other:
- **Relief.** Each automated facility takes a chore off the player's hands.
- **Threat.** Every board, and a busy datacenter, leaks EMF that draws Luddites.

The manual is part of the joke. It reads as a guide to writing firmware yourself, and it is dense enough that the player hands it to an AI.

It succeeds when the user plays full seasons and finds this progression worth building on. The 10-09 depth check (careful against careless firmware, §11 there) stays as a QA measure.

## 3. Scope

**In:**
- The full small town of the 10-09 spec (§9 there):
  - three farms;
  - the warehouse with two trucks;
  - two housing blocks;
  - the power plant;
  - two datacenters.
- The food chain with its rules (10-09 §5.4 to §5.6).
- Tiers per facility: T0 by hand (no board), T1 a board and the game's editor, T2 a comm module and MCP (§4).
- Manual controls for every facility that can take a board (§4.3).
- The board manual (§9) and the firmware editor (§10.4).
- The agent connection, as what T2 opens (§8).
- A first-season guide card (§10.2).
- The 10-09 spec's remaining viewer work for the new facilities: their panels, the trucks on the map, and the selection rules of 10-09 §8.2.

**Out:**
- **Firmware at T0** (the design doc's sensing-only T0 board): the user ruled that T0 has no firmware.
- **`io.notify`**, which belonged to that board.
- **Tiers past T2:** the wireless module's range, the control center, research, and part assembly.
- **Fuel as a stock:** the design doc keeps fuel out of the goods. Thermal fuel is paid per unit as now.
- **The season wrap-up's breakdown and past seasons** (10-09 §8.3): after this playtest. The end overlay keeps showing the final money.
- Everything the 10-09 spec left out (§2 there).

## 4. Tiers: the board is only automation

### 4.1 The rule

A facility always works by hand. A board automates it.

| Tier | The facility has | What changes |
|---|---|---|
| T0 | no board | The player works it with its manual controls (§4.3). |
| T1 | a board | The player bought and installed it from the facility's panel. The board's firmware can do the facility's work. The editor opens for it. |
| T2 | a board with a comm module | The player bought the module from the panel. An agent connected over MCP can reach the board (§8). |

- **Per facility.** Each facility moves up on its own, so where to automate first is the player's choice.
- **Money.** The player pays for a board and a comm module from the panel (prices in §12). Installing is instant.
- **A new board is empty.** The facility keeps working by hand until the player deploys firmware.
- **The board kit.** It holds the 10-09 parts for that facility: clock, instruction cap, RAM, and sensors (§9 there). It also holds the facility's actions (10-09 §6.2), so every installed board can act; there is no separate actuator part.
- **A tier never goes down.** A wrecked facility's board is rebuilt with its parts, comm module included, and with its last firmware (§6). That is the 10-09 rule, extended to the module.

### 4.2 Hand and firmware on one facility

- **Manual controls stay at every tier.** A manual action is the same facility method a firmware action calls.
  - It applies at once, between steps, so a paused game shows its effect. A job or a cooling cycle started by hand covers the coming step; one that firmware starts in phase 5 of a step covers the step after.
  - It is recorded with the step it came before, like a deploy, so replays stay deterministic.
  - A wrecked or repairing facility refuses it, and so does a facility of the wrong kind.
- **Settings belong to the facility.** These are the thermal output and the priority list. Whoever set one last wins, in real order: firmware that acts in the coming step wins over a hand action made before it.
- **The board can stop; the facility doesn't.** When a board sleeps or is shed, only its firmware stops, and the facility goes on by hand. Only a wrecked facility stops entirely: Luddites and fire wreck the facility they hit, board and all (§6). This changes the 10-09 rules in three ways:
  - `io.sleep` no longer stops the facility.
  - The plant's thermal module keeps the town's setting whatever its board is doing (10-09 §5.8 stopped it).
  - A shed board stops ticking, as before, but its facility can still be worked by hand.
- **Power:**
  - Boards draw their parts' power while awake, as now.
  - A datacenter's processing draws power, whether a hand or firmware started it.
  - Housing draws power, as now.
  - A farm or the warehouse without a board needs no power to be worked by hand.

### 4.3 What the player does by hand

| Facility | Manual controls |
|---|---|
| Farm | **[수확] (harvest):** harvests a ripe crop into the outbox and replants (`harvest()`). Disabled while nothing is ripe. |
| Warehouse | **[트럭 보내기] (send a truck):** pick an idle truck, a trip, and an amount. A trip collects from a farm's outbox or delivers to a housing block, as `dispatch(truck, from, to, amount)` allows (10-09 §5.5). |
| Power plant | **Thermal:** a slider for the thermal output from 0 to the module's maximum (`set_thermal`). **Supply order:** up and down buttons on the priority list (`set_priority`). |
| Datacenter | **[처리] (process):** each press runs the datacenter for `datacenter.jobMs` from that moment. Presses don't stack: a press while it runs moves the end to `jobMs` after the press, so keeping it running means pressing again and again. Mashing it keeps the money coming, at the risk of power shortage, heat, fire, and EMF. **[냉각] (cool):** starts a cooling cycle. It lasts `datacenter.coolingCycleMs` and takes exactly `datacenter.coolingDropMilli` off the temperature, in even steps across the cycle (the rounding is spread over the steps, so the whole cycle takes off the full amount), about as much heat as 15 presses add. It draws `datacenter.coolingPower` while it runs, more than processing. A press during a cycle does nothing (the button is disabled). Left alone, a datacenter cools very slowly (`datacenter.passiveCoolingPermillePerSecond`). |
| Housing | None. Housing has no board; it eats, uses power, and pays tax (10-09 §5.6). |

**Hand and firmware share the datacenter's methods.** The buttons and the firmware call the same two:
- `process()` runs the datacenter for `datacenter.jobMs` from now, without stacking. A firmware that calls it on every beat of a 5 Hz clock keeps the datacenter running.
- `cool()` starts a cooling cycle, or does nothing while one runs. It replaces the 10-09 `cool(level)` and its levels.
- Power, pay, heat, and processing EMF follow the time the datacenter runs, whoever pressed or called.
- Processing and a cooling cycle can run at the same time.

## 5. EMF

These rules change 10-09 §5.7.

**The sources:**
- **Boards:**
  - base EMF while running (not asleep) and powered;
  - `a × instructions`;
  - `b × actions`, for the actions their firmware asks for in a tick: harvest, dispatch, `set_thermal`, `set_priority`, `cool`. Those actions are machine labor. An action the facility refuses (a harvest of a crop that isn't ripe) still counts: the count is of what the firmware did, not of what it achieved. A cooling cycle emits nothing beyond that: its cost is power.
- **A datacenter at work:** `emf.processingPerSecond` while it processes, whoever started the job. Its servers are a machine. `process()` is not counted as an action, so firmware and hand pay the same for the same running time.
- **A comm module:** adds `install.commBaseEmfPerSecond` to its board's base EMF.
- **The player's hands:** nothing. A harvest, a truck sent, or a thermal setting changed by hand emits no EMF.

**A town at T0 with idle datacenters is silent.** Pressing [처리] makes noise.

The field, the rumour gauge, and the raids are as in the 10-09 spec.

## 6. Luddites, fire, and rebuilding

These rules change 10-09 §5.8.

**What Luddites target.** They walk toward the strongest EMF they detect, as now, but only at a machine: a standing facility whose board runs or sleeps, or a datacenter at work, whoever started the job. A facility worked only by hand, an idle datacenter with no live board, one whose board is destroyed or being rebuilt, and anything wrecked or under repair are no machines, whatever EMF lies in their cells. At their target they wreck the whole facility, its board with it if it has one.

**What a wreck costs.** A wrecked facility stops entirely, by hand too. Getting it back takes two separate payments:
1. **[시설 복구] (repair the facility)** costs `repair.cost` for its kind and takes `repair.seconds`. Then it works by hand again. A repaired datacenter comes back at ambient temperature, and a repaired farm replants its field.
2. **[보드 재건] (rebuild the board)** costs `rebuild.cost` and takes `rebuild.seconds`: the 10-09 rebuild. It is offered once the facility stands again, and brings the board back with its parts, comm module included, and its last firmware.

**Fire.** A datacenter above 90 °C can catch fire, as now. A fire wrecks it the same way, board and all.

**At T0 the only target is a datacenter at work.** A town with no boards and idle datacenters draws no raid. Housing has no board and makes no EMF, so it is never a target, and a wreck never reaches it.

## 7. Endings and score

These rules change 10-09 §5.9.

- **Endings:**
  - **Bankruptcy:** money below zero for 3 days.
  - **Completion:** the season's last step.
  - **No fall.** The 10-09 fall ending ("every firmware board destroyed at once") is removed. A wrecked town can be repaired as long as the money lasts; running out of money is how a failing season ends.
- **The score** is the season-end money, as before. Boards and comm modules are spending that must pay back within the season (tuning, §12).
- **Nothing changes after the end.** Once the season has ended, a deploy (the player's or the agent's), an install, a repair, a rebuild, and a hand action are all refused (`seasonEnded`): the money is the score, and a replay stops there.

## 8. The agent connection (T2)

These rules change 10-09 §7.2 and §7.3.

- **Connecting stays in the game,** because the game's late loop is agentic.
  - The start screen keeps the connect command, with copy and token reissue.
  - The game screen shows the agent's state.
  - Connecting is optional: "시즌 시작" (start season) and "새 시즌" (new season) are always enabled.
- **No connection rule.** The game neither waits for an agent nor blocks play without one.
  - A connected agent that drops while a season is in play raises an `agentLost` alert ("에이전트 연결이 끊겼어요"). The server raises it, since the core knows nothing of the connection.
  - Like any alert kind it has an auto-pause toggle, on by default.
  - The disconnect overlay goes away.
  - What "connected" means, and the pings, are as in 10-09 §7.2.
- **Town tools** answer any connected agent: `list_boards`, `get_map`, `get_status`, `get_alerts`.
  - `list_boards` lists every facility that can take a board, with its tier, and for a board its state, power, firmware version, latest error, and the instruction count and RAM use of its last tick (`lastInstructions`, `ramUsedBytes`).
  - `get_alerts` tells of the agent's own lost connection too.
- **Board tools** reach T2 boards only: `get_datasheet` (now the board's manual, §9), `get_firmware`, `deploy_firmware`, `read_logs`.
  - On a T0 or T1 facility they answer a tool error that says the player can install a comm module from the facility's panel.
- **Time is the player's,** as in 10-09 §3.
- **Repairs and rebuilds are the player's,** as rebuilds are in 10-09 §5.8.
- **Dev-only tools (10-09 §7.4) gain the player's hand,** so QA agents can play the human's part:
  - the manual actions: `dev_hand {facility, action}`;
  - installing a board or a comm module: `dev_install {facility, part}`;
  - repairing a wrecked facility: `dev_repair {facility}`, beside `dev_rebuild`.
- **The MCP server runs under plain `pnpm start`,** not only in dev mode.

## 9. The board manual

**What it is.**
- One document per board slot.
- Nominally a guide that tells the player to write the board's firmware.
- In practice, dense enough that the player hands it to an AI.
- Complete and exact: every rule and number the firmware runs under. No hand-holding and no recipes.

**Language.** Korean prose with English identifiers, because it is game text the player reads.

**Where its numbers come from.** It is generated from the scenario, so its numbers are the scenario's (Global Constraint 6). It is the datasheet of 10-09 §6.7, grown into a manual.

**Contents.**
- **Common rules**, at the head of every document:
  - the clock, beats, and steps;
  - `tick(io, mem)`, `mem`, and deep sleep;
  - `log`;
  - the CPU and RAM caps and the sandbox (what is missing, and what is charged by work);
  - errors and logs;
  - deploying and hot reload;
  - power and shedding;
  - upkeep;
  - EMF: the sources, the field, and the rumour gauge;
  - the Luddites: the detection threshold, their speed, what they target, and when they leave. Agents never got these in milestone 1.
- **The board:**
  - its role, a paragraph on what the facility does and what its firmware is for;
  - its parts: clock, instruction cap, RAM, and sensors;
  - its `io` fields, with meaning, unit, and range;
  - its actions;
  - the facility's rules: for example heat and fire, ripening and rot, outboxes, truck routes and fuel, spoilage, and what housing needs;
  - its power draw and base EMF;
  - its position and distances.

**Where the player reads it.**
- In the manual window (§10.4), at every tier, so the player can read what a board would do before buying it.
- **[마크다운 복사]** (copy the markdown) copies the open document, common rules included.
- **[.md 다운로드]** (download) saves it as a file.

**What an agent reads.** `get_datasheet` returns the same markdown for T2 boards.

## 10. The viewer

These rules change 10-09 §8.

### 10.1 Start screen
- The scenario's name and "시즌 시작", always enabled.
- An optional agent section:
  - the connect command with a copy button and token reissue;
  - the agent's state;
  - one line on what it is for: handing T2 boards to an agent.

### 10.2 The guide card
- Shown when a season starts, until the player ticks "다시 보지 않기" (don't show again). That choice is kept in the browser's local storage.
- It can be opened again from the top bar's [도움말] (help).
- It says:
  - the goal, which is the money at the season's end;
  - that every facility works by hand from its panel;
  - that a board takes a facility's work over, with firmware written in the editor from the manual;
  - that a comm module lets an agent take a board over by MCP;
  - that boards and busy datacenters leak EMF, which Luddites follow.

### 10.3 Main screen
- **Top bar:**
  - the 10-09 fields, now with food and population;
  - [매뉴얼] (manual), which opens the manual's index;
  - [도움말] (help);
  - the agent's state.
- **Map:**
  - every facility of the scenario;
  - status lights only on facilities with a board, so that a T0 facility reads as a plain building;
  - a mark for the tier;
  - the trucks at their cells, moving along their row-then-column paths;
  - under each cell a caption of at most two short lines (a datacenter's temperature and its work marks, a farm's ripeness and outbox, the warehouse's stock, a housing block's food), so that neighbouring cells don't overlap;
  - the 10-09 selection rules for every facility.
- **Panel:** for the selected facility:
  - its state and tier;
  - its manual controls (§4.3), right under the title: nothing above them changes height from one snapshot to the next, so the button a player keeps pressing stays under the pointer;
  - its live readings;
  - [보드 설치 (price)] (install a board) at T0, or [통신 모듈 (price)] (comm module) at T1, each disabled with a reason while the money can't pay;
  - [매뉴얼] (manual);
  - at T1 and T2: [편집] (edit), [로그 복사] (copy the log), the live log, and the firmware (read-only, with a pending deploy above it);
  - after a wreck, [시설 복구] (repair the facility), then [보드 재건] (rebuild the board) for a facility that had one. Each shows its price, and is disabled with a reason while the money can't pay.
- **Feed:**
  - Deploys say who made them, the player or the agent.
  - The `agentLost` alert has its auto-pause toggle.
- **End overlay:** completed or bankrupt, the final money, and "새 시즌" (always enabled).

### 10.4 The manual window and the editor
- **Two large windows** open over the map, side by side when both are open: the manual on the left and the editor on the right. The game keeps its pause state.
- **The manual window** renders the markdown of §9. It is opened:
  - from a panel's [매뉴얼], which opens that board's document;
  - from the top bar's [매뉴얼], which opens the index: the common rules, then each board.
- **The editor:**
  - CodeMirror with Lua highlighting (the design doc's tech stack).
  - It loads, in this order: the text it held when it was closed without an accepted deploy (kept until a deploy is accepted or a new season starts, and only when it differs from what the editor opened on), the pending deploy, the board's firmware, or a starting `tick(io, mem)` for a board with none.
  - [배포] (deploy) sends it. A source over 65,536 characters, or with a NUL character, is refused in the editor, in Korean, before anything is sent: a message over the socket's limit would close the connection with no reason.
  - A syntax error shows at once, with its line.
  - An accepted deploy says when it installs, in the 10-09 terms.
- **Keys.** Space, 1, 2, 3, and H type into the code while the editor has focus; they don't pause the game, change the speed, or toggle the heatmap. Escape there closes the editor, keeping its text, and does nothing else. CodeMirror's own uses of Escape (collapsing a selection to its cursor) come first, and the window closes only on an Escape it left alone.
- **Closing.** [×] closes a window. Escape does too, except while a text field or a dropdown has the focus. It closes the nearest first: the editor (keeping its text), then the manual, then the guide card, and then it clears the selection.
- **Refusals.** Every new refusal gets a code with Korean text, under the 10-09 §8.2 rule.

## 11. Server and session

- **New viewer commands on `/ws`:**
  - `deploy {board, code}`, answered to the viewer that sent it with `deployResult {board, outcome}`: the version and when it installs, or the syntax error with its line;
  - `hand {facility, action}`, where the action is the facility action as firmware asks for it, arguments included (`{kind: 'process'}`, `{kind: 'cool'}`, `{kind: 'setThermal', output}`, `{kind: 'setPriority', order}`, `{kind: 'harvest'}`, `{kind: 'dispatch', truck, from, to, amount}`);
  - `install {facility, part: board | comm}`;
  - `repair {facility}`.

  They are checked with exact schemas like the others. A deploy goes through the same checks as an MCP deploy (64 KB counted in characters, NUL, syntax) and the same queue, and it is always the player's: the viewer cannot say it came from the agent. A message may weigh up to 512 KiB, since 64 KB of source can take 6 bytes a character in JSON. A refused command comes back to its viewer as an error with its refusal code.
- **`hello`** carries the scenario, from which the viewer renders the manuals.
- **The session record** keeps every input with its step: hand actions, installs, deploys (with who made them), repairs, and rebuilds. Replays reproduce them.
- **Snapshots.** The worker answers each new command with a snapshot of its own, as it does for deploys and rebuilds.
- **Trust.** It is unchanged from 10-09 §7.1. `/ws` can now deploy firmware and spend money, but any local program that can reach 127.0.0.1 could already do as much with the token it hands out. Firmware stays inside the sandbox.

## 12. Scenario and tuning

- **The start.** Every facility starts at T0, with no board. The plant's thermal output is 0, with the default priority list. The scenario is `scenarios/m2-town.json`.
- **New tuning values** (starting values, to be tuned; they live in the scenario, under `tuning`):

| Value | Start |
|---|---|
| Board price (T1), `install.boardPrice` | farm 200, warehouse 400, power plant 400, datacenter 600 |
| Comm module price (T2), `install.commPrice` | 300 |
| Comm module base EMF, `install.commBaseEmfPerSecond` | +5 per second |
| Datacenter job per press or `process()`, `datacenter.jobMs` | 500 ms from that moment, no stacking |
| Cooling cycle, `datacenter.coolingCycleMs` / `coolingDropMilli` / `coolingPower` | 4 s / 15 °C over the cycle, about 15 presses of heat at +2 °C per second / 250 while it runs |
| Passive cooling, `datacenter.passiveCoolingPermillePerSecond` | 0.3% of (temperature − 25 °C) per second (10-09: 2%), so a datacenter left alone cools very slowly |
| Facility repair, `repair.cost` / `repair.seconds` | farm 150, warehouse 300, power plant 300, datacenter 500 / half a day (20 s); the board's rebuild after it is the 10-09 rebuild (500, half a day) |
| Datacenter processing EMF, `emf.processingPerSecond` | 50 per second of processing (what 10 per action at 5 Hz gave in milestone 1) |
| Food in a housing block at the start, `housing.startFood` | 120, three days of eating |

- **Changed from the 10-09 spec, so that the town can feed itself.** The 10-09 numbers grew 24 food a day against the 80 the homes eat.
  - Farms: `ripenSeconds` 40, a day (10-09: 120); `rotSeconds` 20 (40); `yield` 40 (24); `outboxCapacity` 80 (50).
  - `emf.rumourThreshold`: 200,000 (100,000).
  - The cooling cycle's power: 250 (this spec's first value was 400, more than the plant could give a datacenter beside the homes).
- **Changed in how a rule rounds.**
  - A warehouse's stock spoils once a day, on the day's last step, by `spoilagePctPerDay` of what it holds then, rounded down. A per-step rule rounded to nothing on a small stock.
  - A cooling cycle takes off exactly `coolingDropMilli` over its steps.
- **Unchanged.** Every other 10-09 tuning value stays as it is. Board upkeep is charged only for boards that are running or asleep: a destroyed or rebuilding board costs none, and a facility with no board never did.

## 13. Verification

- **`core` tests:**
  - installs and their prices;
  - manual actions on each facility, and a hand and firmware changing the same setting;
  - EMF: nothing from hands, and processing EMF whoever started the job;
  - the datacenter's methods: a press or `process()` runs it 0.5 s without stacking, and a cooling cycle takes its drop over its seconds, draws its power, and ignores a second press;
  - Luddites and fire wreck the facility they hit, board and all; a wrecked facility can't be worked by hand; repair, then the board's rebuild, bring each back;
  - a sleeping or shed board leaves its facility working;
  - no fall ending;
  - a datacenter with no live board is a target only while it processes, however loud its cell is;
  - upkeep for running and sleeping boards only, a warehouse's stock spoiling once a day, and every player command refused after the season ends;
  - the food chain (10-09 §11's list).
- **Determinism:** a recorded session with hand actions, installs, and deploys replays to the same state hash.
- **MCP tests:**
  - board tools refuse a facility below T2;
  - town tools work for any connected agent;
  - nothing blocks play without an agent;
  - a dropped agent raises `agentLost`.
- **`pnpm sim`** gains `--install <ids|all>`, which installs boards at the start, so firmware sets run headless.
- **Season checks:** reference firmware for all seven boards, one careless set and one careful. The careful set completes its season and beats the careless one. A replay test covers hand actions and installs.
- **`pnpm shots`:**
  - the start screen with no agent, and the guide card: shown, ticked away, opened again;
  - each manual control:
    - the thermal slider and the supply order;
    - mashing [처리], and a cooling cycle from [냉각];
    - [수확];
    - the truck form, collecting and then delivering, with the warehouse's routes on the map;
  - installing a board and a comm module, and the agent reaching the board only at T2;
  - the manual window's copy and download, and the index;
  - the editor: typing, a syntax error, a deploy, and a draft kept across close and open;
  - the game's keys staying quiet while the editor has focus, and Escape closing only the editor;
  - sources the editor refuses (too long, or with a NUL);
  - a raid, the facility wrecked, its repair, then its board's rebuild;
  - a board too dear, money below zero, bankruptcy, and a new season with no agent;
  - a lost agent's alert, and its auto-pause.
- **QA:** `qa-tester` plays the human's part through the dev tools and T2 through MCP. It judges the early-stage arc against the fun checklist.
- **The user's playtest:** `docs/playtests/2026-10-16-m2-checklist.md`.

## 14. Build order

1. **Tiers and the rules they change:** installs, the board as automation (sleep and shedding leave the facility working), the plant's thermal setting, the datacenter's `process()` and cooling cycle, the EMF sources, wrecks with repair and rebuild, and the endings.
2. **Manual actions** in `core`, recorded as inputs.
3. **The food chain:** farms, the warehouse and its trucks, and housing, each worked by hand and by firmware.
4. **The manual generator.**
5. **Server:**
   - the new viewer commands;
   - MCP board tools gated at T2, and town tools for any agent;
   - `agentLost` in place of the connection rule;
   - the dev tools for the hand and installs.
6. **Viewer:**
   - the start screen, the guide card, and the top bar;
   - the map with every facility, the trucks, and the selection rules;
   - the panels with their controls and installs;
   - the manual window and the editor.
7. **Reference firmware, season checks, and `pnpm sim --install`.**
8. **Docs and the playtest checklist.**

**→ Milestone 2:** the user plays the early stage.

## 15. Open questions

- **The pace of the hand stage:**
  - whether T0 is tedious enough to make automation a relief, and short enough not to bore;
  - whether the prices let a season pay a board back.

  These are tuning questions, for the playtest.
  - **What the first runs show (2026-10-16, `pnpm sim --rebuild`, seeds 1 to 3, no tuning changed).** The reference firmware installs all seven boards at step 0.
    - The careful set completes its season on every seed, ending on 1,948, 7,226, and 2,689. The careless set goes bankrupt on days 5, 7, and 6.
    - A town with no boards, left alone, ends on 5,585, 5,965, and 5,600. So a careful season with every board bought up front ended below that on seeds 1 and 3, and above it on seed 2. The boards cost 2,600 together (comm modules apart) beside their upkeep, and whether they pay back depends on the seed.
    - These runs buy every board at once and don't play the hand stage, so they bound nothing about a player who buys one board at a time. Whether boards pay back within a season, and whether the food chain is worth running, are for the playtest to say.
- **Rebuilding:** instant or delayed (10-09 §13).
- **Determinism beyond one machine** (10-09 §13).
- **The wrap-up's breakdown and past seasons,** after this playtest.
- **The design doc's sensing-only T0 board and `io.notify`,** not in this milestone.
