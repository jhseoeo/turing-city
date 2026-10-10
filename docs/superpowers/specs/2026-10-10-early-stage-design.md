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
- **A tier never goes down.** A smashed board is rebuilt with its parts, comm module included, and with its last firmware. That is the 10-09 rule, extended to the module.

### 4.2 Hand and firmware on one facility

- **Manual controls stay at every tier.** A manual action is the same facility method a firmware action calls.
  - It applies in the next step's phase 5.
  - It is recorded with its step, like a deploy, so replays stay deterministic.
- **Settings belong to the facility.** These are the thermal output, the priority list, and a datacenter's cooling level. Whoever set one last wins.
- **The board can stop; the facility doesn't.** When a board sleeps, is shed, is smashed, or is being rebuilt, only its firmware stops, and the facility goes on by hand. The one exception is a smashed datacenter, which is a target in its own right (§6). This changes the 10-09 rules in three ways:
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
| Datacenter | **[처리] (process):** each press runs a job for `manualJobSeconds`. A press while a job runs adds that much time, up to `manualJobQueueSeconds` in all. Mashing the button keeps it running, at the risk of power shortage, heat, fire, and EMF. The player has no hand control for cooling: only firmware sets it (`cool(level)`). |
| Housing | None. Housing has no board; it eats, uses power, and pays tax (10-09 §5.6). |

**Firmware's `process()`.** It keeps its 10-09 meaning: a job until the board's next tick.

**Jobs started by hand and by firmware.** A datacenter runs until a "busy until" time.
- A press moves it `manualJobSeconds` later, counted from now if the datacenter is idle, but never more than `manualJobQueueSeconds` ahead of now.
- Firmware's `process()` moves it to at least the board's next tick.
- Power, pay, heat, and processing EMF follow the time the datacenter runs, whoever set it.

## 5. EMF

These rules change 10-09 §5.7.

**The sources:**
- **Boards:**
  - base EMF while awake and powered;
  - `a × instructions`;
  - `b × actions`, for the actions their firmware applies: harvest, dispatch, `set_thermal`, `set_priority`, `cool`. Those actions are machine labor.
- **A datacenter at work:** `processingEmfPerSecond` while it processes, whoever started the job. Its servers are a machine. `process()` is not counted as an action, so firmware and hand pay the same for the same running time.
- **A comm module:** adds `commBaseEmf` to its board's base EMF.
- **The player's hands:** nothing. A harvest, a truck sent, or a thermal setting changed by hand emits no EMF.

**A town at T0 with idle datacenters is silent.** Pressing [처리] makes noise.

The field, the rumour gauge, and the raids are as in the 10-09 spec.

## 6. Luddites, fire, and rebuilding

These rules change 10-09 §5.8.

**What Luddites target.** They walk toward the strongest EMF they detect, as now. At their target they smash:
- the board there, if there is one;
- the facility itself, if it is a datacenter. A facility that emits EMF by working is a target in its own right.

**What a smash costs:**
- **A smashed board** stops its firmware, and the facility goes on by hand.
- **A smashed datacenter** stops entirely, by hand too, until it is rebuilt. Its board, if it has one, is smashed with it.

**Fire.** A datacenter above 90 °C can catch fire, as now. A fire wrecks the datacenter and its board.

**Rebuilding.** The player's [재건] (rebuild) restores what was smashed, at the 10-09 cost and time:
- a board comes back with its parts and last firmware;
- a datacenter comes back at ambient temperature with no cooling.

**At T0 the only target is a datacenter at work.** A town with no boards and idle datacenters draws no raid.

## 7. Endings and score

These rules change 10-09 §5.9.

- **Endings:**
  - **Bankruptcy:** money below zero for 3 days.
  - **Completion:** the season's last step.
  - **No fall.** The 10-09 fall ending ("every firmware board destroyed at once") is removed. A town whose boards are all smashed still works by hand.
- **The score** is the season-end money, as before. Boards and comm modules are spending that must pay back within the season (tuning, §12).

## 8. The agent connection (T2)

These rules change 10-09 §7.2 and §7.3.

- **Connecting stays in the game,** because the game's late loop is agentic.
  - The start screen keeps the connect command, with copy and token reissue.
  - The game screen shows the agent's state.
  - Connecting is optional: "시즌 시작" (start season) and "새 시즌" (new season) are always enabled.
- **No connection rule.** The game neither waits for an agent nor blocks play without one.
  - A connected agent that drops raises an `agentLost` alert ("에이전트 연결이 끊겼어요").
  - Like any alert kind it has an auto-pause toggle, on by default.
  - The disconnect overlay goes away.
  - What "connected" means, and the pings, are as in 10-09 §7.2.
- **Town tools** answer any connected agent: `list_boards`, `get_map`, `get_status`, `get_alerts`. `list_boards` lists every facility that can take a board, with its tier.
- **Board tools** reach T2 boards only: `get_datasheet` (now the board's manual, §9), `get_firmware`, `deploy_firmware`, `read_logs`.
  - On a T0 or T1 facility they answer a tool error that says the player can install a comm module from the facility's panel.
- **Time is the player's,** as in 10-09 §3.
- **Rebuilds are the player's,** as in 10-09 §5.8.
- **Dev-only tools (10-09 §7.4) gain the player's hand,** so QA agents can play the human's part:
  - the manual actions;
  - installing a board or a comm module.
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
  - trucks moving along the roads;
  - the 10-09 selection rules for every facility.
- **Panel:** for the selected facility:
  - its state and tier;
  - its live readings;
  - its manual controls (§4.3);
  - [보드 설치 (price)] (install a board) at T0, or [통신 모듈 (price)] (comm module) at T1, each disabled with a reason while the money can't pay;
  - [매뉴얼] (manual);
  - at T1 and T2: [편집] (edit), [로그 복사] (copy the log), the live log, the firmware (read-only, with a pending deploy above it), and the rebuild button when something is smashed.
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
  - It loads the board's firmware, or the pending one.
  - [배포] (deploy) sends it.
  - A syntax error shows at once, with its line.
  - An accepted deploy says when it installs, in the 10-09 terms.
- **Keys.** The game's keys (space, 1, 2, 3, H, Escape) do nothing while the editor has focus.
- **Refusals.** Every new refusal gets a code with Korean text, under the 10-09 §8.2 rule.

## 11. Server and session

- **New viewer commands on `/ws`:**
  - `deploy {board, code}`;
  - `hand {facility, action, args}`;
  - `install {facility, part: board | comm}`.

  They are checked with exact schemas like the others. A deploy goes through the same checks as an MCP deploy (64 KB, NUL, syntax) and the same queue.
- **The session record** keeps every input with its step: hand actions, installs, deploys (with who made them), and rebuilds. Replays reproduce them.
- **Snapshots.** The worker answers each new command with a snapshot of its own, as it does for deploys and rebuilds.
- **Trust.** It is unchanged from 10-09 §7.1. `/ws` can now deploy firmware and spend money, but any local program that can reach 127.0.0.1 could already do as much with the token it hands out. Firmware stays inside the sandbox.

## 12. Scenario and tuning

- **The start.** Every facility starts at T0, with no board. The plant's thermal output is 0, with the default priority list.
- **New tuning values** (starting values, to be tuned; they live in the scenario):

| Value | Start |
|---|---|
| Board price (T1) | farm 200, warehouse 400, power plant 400, datacenter 600 |
| Comm module price (T2) | 300 |
| Comm module base EMF | +5 per second |
| Manual job length / queue cap | 2 s per press / 20 s |
| Datacenter processing EMF | 50 per second of processing (what 10 per action at 5 Hz gave in milestone 1) |

- **Unchanged.** Every 10-09 tuning value stays as it is. Board upkeep applies to installed boards only.

## 13. Verification

- **`core` tests:**
  - installs and their prices;
  - manual actions on each facility, and a hand and firmware changing the same setting;
  - EMF: nothing from hands, and processing EMF whoever started the job;
  - Luddite targets: a board, and a datacenter itself;
  - a smashed board leaves the facility working by hand, and a smashed datacenter stops it;
  - a sleeping or shed board leaves its facility working;
  - no fall ending;
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
  - the guide card;
  - each manual control;
  - mashing [처리];
  - installing a board and a comm module;
  - the manual window's copy and download;
  - the editor: typing, a syntax error, and a deploy;
  - the game's keys staying quiet while the editor has focus.
- **QA:** `qa-tester` plays the human's part through the dev tools and T2 through MCP. It judges the early-stage arc against the fun checklist.
- **The user's playtest:** a new checklist for this milestone.

## 14. Build order

1. **Tiers and the rules they change:** installs, the board as automation (sleep, shedding, and smashing leave the facility working), the plant's thermal setting, the EMF sources, the Luddite targets, and the endings.
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
- **Rebuilding:** instant or delayed (10-09 §13).
- **Determinism beyond one machine** (10-09 §13).
- **The wrap-up's breakdown and past seasons,** after this playtest.
- **The design doc's sensing-only T0 board and `io.notify`,** not in this milestone.
