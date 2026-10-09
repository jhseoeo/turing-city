# Prototype design: the agent firmware loop

Status: agreed with the user section by section on 2026-10-09; this document records those decisions.
Source of the game's design: `docs/design.md` (Korean). Where the two differ on the prototype, this document is the reference, and the design doc points here.

## 1. Goal

The first milestone answers one question from the design doc (첫 프로토타입): is the loop of an AI agent writing and fixing firmware fun?

It succeeds when:
- the user plays full seasons with Claude Code as their agent and finds the loop worth building on, and
- the depth check holds: on the same scenario and seed, a session played with careful requests to the agent scores far above one played with careless requests (`docs/design.md`, 깊이 검증).

## 2. Scope

**In:**
- A fixed scenario. The map, the facilities, and each board's parts come from a scenario file. Only firmware changes during play.
- Every block of the core loop:
  - facilities: farm, logistics warehouse (물류창고, with trucks), housing, power plant (wind and thermal modules), and datacenter;
  - resources: food, power, and money;
  - threats: EMF, Luddites, and fires from overheating.
- Seven firmware boards: three farms, the warehouse, the power plant, and two datacenters. Housing has no board.
- Real-time play with pause, a local MCP server the agent connects to from the start, a browser viewer, a season wrap-up with a score, and a headless runner for tests and measurements.

**Out:**
- Facilities: school and tech research, and waste and sewage treatment.
- Morale, reputation, and surveillance, with the events that hang on them (AI regulation, auditor, hacker, market swings, rule changes), and the news feed.
- Parts: the shield case, the comm module, part tiers and upgrades.
- Play features: assembling parts and placing facilities (the design's options B and C, which come next), the unlock progression (copy-paste, serial cable, wireless, control center), and the in-game code editor.
- Presentation: replay viewing (the records are kept), art and sprites, achievement and ending videos.
- The Electron shell.

The datacenter is a core mechanic from mid-game on (the user, 2026-10-09); the prototype includes it from the start.

## 3. Time

- **Real time with pause, no rewind.** Play runs continuously, like RimWorld or Oxygen Not Included, at 1×, 2×, or 3×, with pause on the space bar. Nothing in the game restarts a session from its beginning or rewinds it. A rerun from the start exists only as a headless tool for tests and measurement.
- **Only the human controls time.** Play, pause, and speed belong to the player; no agent tool touches them in the game. Agent-driven time is a candidate late unlock, on the way to the design's retirement ending. QA agents get time controls through dev-only tools (§7.4).
- **World steps and board ticks are separate.**
  - The world advances in fixed internal steps: 20 per second at 1×. Everything physical moves on steps: trucks, heat, crops, EMF, Luddites.
  - A board runs its firmware only on the beats of its own clock, which its CPU part sets (for example 1 Hz on a farm, 5 Hz on a datacenter). Beats fall on fixed steps, so a seed always gives the same schedule. The world keeps moving between beats.
  - Reaction speed is therefore a hardware property: a 1 Hz board notices a threat up to a second late.
  - Terms: "step" is the world's unit and "tick" is a board's beat. Talk to the user in seconds, hours, and days.
- **Calendar.** A day lasts 40 seconds at 1×. A session is one season of 30 days, about 20 minutes at 1×.
- **Deploys during play.** The agent may deploy while the game runs or while it's paused. A deploy takes effect at the board's next tick, and the session record keeps the step it landed on.

## 4. Architecture

### 4.1 Processes and packages

One local Node process, the game server, hosts the simulation and the MCP server. The viewer is a Phaser page in a browser tab. Electron later wraps the same server module and loads the same viewer.

```
player's agent (Claude Code, ...)
   │  MCP over HTTP · 127.0.0.1 · bearer token
   ▼
server: main thread ── clock, MCP adapter, WebSocket to the viewer, watchdog
   │  messages
   ▼
server: worker thread ── core (deterministic simulation) + firmware (wasmoon Lua, one state per board)
```

A pnpm workspace with four packages:

| Package | Holds | Restriction |
|---|---|---|
| `core` | the simulation rules, the scenario loader, the agent tool definitions (§7.3), the session record | no Node, DOM, or browser API; integers only; randomness only from seeded generators |
| `firmware` | the Lua sandbox on wasmoon: counting, caps, determinism, the `io` bridge | runs in Node and in browsers (no Node-only API) |
| `server` | the clock, the MCP adapter, the WebSocket, the worker and its watchdog, the local config with the token, the `pnpm sim` runner | Node |
| `viewer` | the Phaser screens | browser |

`core` calls firmware through an interface, so `core`'s unit tests run with firmware written as TypeScript functions, and real Lua runs in `firmware`'s tests and in the simulation checks.

Tooling: TypeScript in strict mode, pnpm, Vite for the viewer, and Vitest.

### 4.2 Data flow

- **Each step:**
  1. The main thread's clock asks the worker to advance.
  2. The worker computes the step (§5.1), running the firmware of every board whose beat falls on it.
  3. The worker returns the events and a snapshot.
  4. The main thread forwards the snapshot to the viewer and raises alerts, pausing when an alert is set to auto-pause.
- **Agent tools** reach the worker through the main thread. A deploy is queued for the board's next tick.
- **Viewer commands** (play, pause, speed, rebuild, auto-pause settings) go over the WebSocket to the main thread, which forwards the ones that change the world to the worker as recorded inputs.
- **The session record** is the scenario, the seed, and every input with the step it took effect on: deploys, rebuilds, and the steps at which play paused or resumed. A deterministic simulation turns it back into the same session; the prototype keeps records but has no replay screen.

### 4.3 Headless runner

`pnpm sim <scenario> --firmware <dir> [--seed n] [--until day]` runs a session from its start to its end, or to the given day, with no viewer and no MCP. It prints the result and the score breakdown. Tests, QA, and the depth check use it; the game itself never offers it.

### 4.4 Where WebAssembly is used

Only in `firmware`: wasmoon is the reference Lua 5.4 interpreter compiled to WebAssembly. A spike on 2026-10-09 measured it (M2 Pro, Node 24, wasmoon 1.16.0):
- **Cheap boundary:**
  - Entering Lua from JS costs about 0.4 µs.
  - A Lua-to-JS call costs about 1.5 µs, against 0.03 µs for a Lua-to-Lua call.
  - The expensive part is wasmoon's generic value conversion, not the WebAssembly boundary. Ten sensor values in and five actions out take 27.6 µs per tick through it, and 6.8 µs through the raw C API into a reused table.
- **The core stays in TypeScript.** At the prototype's scale (7 boards at up to 5 Hz, 3× speed), firmware costs a few milliseconds per second of play.

## 5. Simulation rules

All numbers here and in §10 are starting values to tune, not decisions.

Units: power is an amount drawn or produced at each step; when generation falls short in a step, shedding (§5.2) settles that step. Money, food, and EMF are integers. Temperature and the EMF field use fixed-point integers. Rates "per second" mean seconds of game time at any speed.

### 5.1 Step order

1. Inputs that take effect this step: rebuilds finishing, and deploys becoming current at a board's next tick.
2. Weather and market: wind, job prices, and fuel price from seeded series.
3. Power: generation, transmission loss, and shedding by priority (§5.2).
4. Board ticks due this step: run firmware, count instructions, collect actions (§6).
5. Apply actions: the facilities' core methods and settings.
6. Physical processes: heat, crops, trucks, spoilage, housing consumption, and taxes.
7. EMF: emission, diffusion, and decay; the rumour gauge; raid spawns.
8. Luddites: movement, smashing, leaving.
9. Fires.
10. Money, game over, alerts, snapshot.

This refines the design doc's 틱 처리 순서, now called 스텝 처리 순서. The plan may reorder within it when a test shows a reason.

### 5.2 Power

- **Generation:**
  - The plant's wind module follows the seeded weather and costs nothing.
  - The thermal module's output is set by the plant's firmware (`set_thermal`) up to its maximum. Every unit costs fuel money at the current fuel price.
- **Consumption:**
  - Every awake board draws power according to its parts.
  - Core methods draw more when used. The datacenter's `process()` and its cooling draw the most.
  - Housing draws power by default, with no board: people live there.
- **Transmission loss:** a consumer N cells from the plant draws 2% more for each cell.
- **Shedding:** nothing stores power. When generation falls short in a step, whole facilities switch off, lowest priority first.
  - The plant's firmware sets the priority (`set_priority`); without it, a default order applies.
  - An unpowered board doesn't tick and keeps its `mem`.
  - An unpowered facility doesn't work.
  - The plant's own board is never shed while the plant generates anything.

### 5.3 Datacenter

- **`process()`:** callable at most once per tick. Each call runs a job for the board's tick period, until its next tick (0.2 s at 5 Hz). Through those steps the datacenter draws its processing power and heats up. It earns the job price pro rata.
  - Calling `process()` on every tick keeps the datacenter running.
  - Every call is an action for EMF (§5.7).
- **Job price:** money per second of processing, following a seeded market series.
- **Temperature:**
  - It falls slowly toward the ambient temperature (thermal inertia).
  - Cooling (`cool(level)`, levels 0 to 3) speeds the fall and draws power by level.
  - Above 90 °C, each step carries a fire chance that grows with the temperature (§5.8).
- **Sensors:** temperature, power headroom, job price, local EMF, and the distance to the nearest Luddite.

### 5.4 Farm

- **Growing:** crops ripen over 3 days.
- **Harvest:** `harvest()` moves a ripe crop into the outbox and replants at once.
  - A ripe crop left for a day rots: it's lost, and the field replants.
  - Harvesting into a full outbox wastes the crop.
- **Sensors:** ripeness and outbox.

### 5.5 Logistics warehouse (물류창고, code `warehouse`)

- **Trucks:** it owns 2. The firmware sends one with `dispatch(truck, from, to, amount)`: collect from a farm's outbox, or deliver to a housing block.
- **Movement:** trucks follow the roads, which are the grid lines between cells.
  - The route is fixed by rule: along the row first, then along the column.
  - Speed is fixed, and every cell travelled costs fuel money.
- **Storage:** stored food spoils at 2% a day.
- **Sensors:** stock, each farm's outbox and distance, each housing block's food and distance, and each truck's state, position, and load.
- **Name:** the user renamed the design doc's 식량창고 (food warehouse) to 물류창고 (logistics warehouse) on 2026-10-09: food is the only moving good today, but the name leaves room for more.

### 5.6 Housing

- No board.
- Each block houses 40 people (fixed in the prototype). Each person eats 1 food a day and uses power by default.
- Only residents who are fed and powered pay tax.
- Hunger and blackouts cost the tax they cancel. Set this high enough that starving the town to feed the datacenters' power doesn't pay.

### 5.7 EMF

- **Per board per tick:** `a × instructions + b × actions`.
  - Instructions are the count from §6.3.
  - Actions are the core methods and dispatches applied.
  - Shielding is out of scope.
- **Base EMF:** an awake board also emits its base EMF (기본 전자파) on every step. The datasheet shows it per board. It is zero only while the board sleeps, has no power, or is destroyed. Because of it, an idle awake board is never silent; only deep sleep, which wipes RAM, is.
- **The field:** emissions add to the board's grid cell. Each step, every cell shares part of its value with its four neighbours, and the whole field decays. The arithmetic is fixed-point on integers.
- **Who sees it:** the viewer draws a heatmap with a toggle. The design wants a meter to be built before it can be seen; that comes later. Datacenters sense their local EMF.

### 5.8 Luddites, sleep, fire, and rebuilding

- **Raids:**
  - A town-wide rumour gauge fills with total EMF. When it's full, a group of 3 Luddites appears at a seeded point on the map's edge, and the gauge empties. A noisier town is raided more often.
  - They walk cell by cell, 1 cell a second, toward the strongest EMF they detect, re-aiming at every cell.
  - They target boards, not people. Arriving at a board, they smash it, then head for the next strongest EMF.
  - With nothing above the detection threshold for 10 seconds, they walk to the nearest map edge and leave.
- **Sleep:** `io.sleep(seconds)` stops the board and its facility. A truck already on the road finishes its trip. A sleeping board emits no EMF and draws minimal power, but sleep wipes its RAM: `mem` restarts empty. There is no storage part, so hiding costs memory.
- **Fire:** a datacenter above 90 °C rolls a seeded fire chance each step, which grows with the temperature. A fire destroys the board.
- **Destroyed boards:**
  - A smashed or burned board stops, and its `mem` is lost.
  - The human rebuilds it from the viewer: it costs 500 and takes half a day. The board then comes back with its last deployed firmware and an empty `mem`.
  - A deploy to a destroyed board is accepted, and the board comes back with that firmware.
  - Agents can't rebuild: hardware is the human's. Only the dev-only tools can.
  - Whether rebuilding should be instant or delayed stays open; half a day is the placeholder.

### 5.9 Money, score, and game over

- **Money:**
  - The town starts with 5,000.
  - Income: datacenter jobs and taxes.
  - Costs: thermal fuel, truck fuel, each board's daily upkeep, and rebuilds.
- **Score:** the money left when the season ends.
  - The wrap-up shows a breakdown: each income and cost line, tax lost to hunger and blackouts, boards lost, raids, total instructions, and deploys.
  - Past seasons are listed beside it for comparison.
- **Game over** ends the session at once, and the wrap-up names the ending:
  - bankruptcy: money stays below zero for 3 days;
  - fall: all seven firmware boards are destroyed at the same time.

### 5.10 Alerts

These events raise alerts:
- a raid appears, or Luddites approach a board;
- a board is destroyed, or a fire starts;
- overheating;
- a power shortage, or hunger;
- a firmware error or a CPU cap hit;
- money below zero;
- the agent disconnecting.

The player chooses which alert types pause the game. A disconnect always pauses it (§7.2).

## 6. Firmware runtime

### 6.1 Shape

```lua
function tick(io, mem)
  if io.luddite_dist and io.luddite_dist < 5 then
    io.log("Luddites close, sleeping")
    io.sleep(20)               -- 20 s of deep sleep; mem is wiped
    return
  end
  mem.peak = math.max(mem.peak or 0, io.price)
  if io.temp < 80 and io.price >= mem.peak * 0.7 then io.process() end
  io.cool(io.temp > 70 and 2 or 0)
end
```

- **When it runs:** each board has one Lua state. While the board is powered, awake, and intact, `tick(io, mem)` runs once on each beat of its clock.
- **`io`:** at the start of each tick, the host writes the mounted sensors' values into `io` through the raw C API. A sensor the board lacks reads as `nil`.
- **Actions** (`io.process()` and the like) are queued inside Lua and read by the host after `tick` returns. The step applies them in phase 5. A tick that fails applies none of them.
- **`mem`:** a table that persists across ticks. Deep sleep and destruction wipe it.

### 6.2 `io` per facility

| Facility | Reads | Actions |
|---|---|---|
| Power plant | wind output, total demand, fuel price | `set_thermal(output)`, `set_priority(list)` |
| Datacenter | temperature, power headroom, job price, local EMF, nearest Luddite distance | `process()`, `cool(level)` |
| Farm | ripeness, outbox | `harvest()` |
| Warehouse | stock, farms (outbox, distance), housing (food, population, distance), trucks (state, position, load) | `dispatch(truck, from, to, amount)` |
| Every board | game time (day, hour, second) | `log(msg)`, `sleep(seconds)` |

### 6.3 Parts

| Part | What it sets |
|---|---|
| CPU | the clock (ticks per second) and the instruction cap per tick |
| RAM | the board's Lua memory limit, beyond a fixed baseline for the runtime; going past it fails the tick with "out of RAM" |
| Sensors | which readings appear in `io` |

The scenario fixes every board's parts (§9).

### 6.4 Counting and caps

- **Counting:** a C-level count hook installed with wasmoon's `lua_sethook` and a function from `lua.module.addFunction`.
  - Start with the exact counter that fires on every instruction (about 3.2× the cost of uncounted Lua in the spike, and clean).
  - Switch to the "budget" mode, which reads `lua_State.hookcount` from memory at a build-specific offset (about 1.4×), only if a measurement asks for it.
- **The cap:** reaching the CPU's cap aborts the tick.
  - The hook keeps raising on every instruction until the tick unwinds, so a `pcall` can't swallow the abort.
  - The C hook also follows into coroutines.
  - After an abort, the state is healthy and `mem` keeps the writes made before it.
  - A capped tick is logged as "CPU limit exceeded", and its instruction count for EMF is the cap: a board stuck in a loop is the noisiest in town.

### 6.5 Sandbox

Firmware is untrusted. The prelude:
- **Removes** `os`, the standard `io` library, `load`, `loadstring`, `dofile`, `require`, `debug`, `collectgarbage`, `string.dump`, `utf8`, `string.pack`, and `string.unpack`.
- **Removes the pattern functions** `string.find`, `string.match`, `string.gmatch`, and `string.gsub`. At most a plain substring find is kept. Why: one `string.find` with a backtracking pattern on 400 characters ran for 7.1 seconds while counting 15 instructions, so the cap can't stop it.
- **Charges builtins that work in proportion to their input or output** in instructions, by the work done: `string.rep`, `table.concat`, `string.format` output, `table.sort`, `table.unpack`, `string.byte`, `string.char`, `string.upper`, `string.lower`, `string.reverse`, and the plain find.
  - A charge is never negative or NaN, either of which would turn the cap off for the rest of the tick. Costs come only from real string lengths and integer arguments, computed in floating point, and the host ignores any amount that isn't positive.
  - `table.insert`, `table.remove`, and `table.move` run in Lua, so every element they shift counts, whatever a `__len` metamethod claims.
  - What stays uncharged is bounded per instruction by one string: at most RAM, or a constant in the 64 KB source.
- **Caps memory** per board (§6.3), through wasmoon's allocation tracking.
- **Blocks hidden code paths:** `setmetatable` refuses a metatable with `__gc` or `__mode`. That rules out finalizers, which could run firmware outside a tick: Lua marks an object for finalizing only when its metatable is set. A `__mode` added to a metatable afterward still makes a weak table, which is harmless.
- **Pins `tostring`** for tables and functions to a stable string with no address.
- **Seeds `math.random` per board** from the scenario seed and the board's id.
- **Keeps coroutines.** Counting follows them, and they suit state machines that span ticks.

Lua leaves `next` and `pairs` undefined when keys are added during the traversal; the datasheet says so.

### 6.6 Determinism

Every board's Lua must behave the same in every run. The spike verified this across separate processes on one machine:
- **The clock:** before wasmoon instantiates, the wasm import `env.emscripten_date_now` is replaced with a constant. That pins Lua's string-hash seed (so `pairs` order) and anything that reads the clock.
- **Random numbers:** `math.randomseed(seed)` per board (§6.5).
- **Not yet verified** on x64 or in a browser. Check before relying on replays across machines.

### 6.7 Deploying, errors, and logs

- **Deploy:** `deploy_firmware` compiles the source first.
  - A syntax error rejects the deploy and returns the message; the old firmware keeps running.
  - Otherwise the new code runs from the board's next tick, with a new version number.
  - **Hot reload:** `mem` survives a deploy, and the firmware's globals start fresh.
- **Errors:** a runtime error, a CPU cap hit, or running out of RAM fails that tick only. The tick is logged, and the next tick runs normally. Repeats of one error fold into one line ("same error ×N").
- **Logs:** 200 lines per board, stamped with game time. They hold `io.log` output, errors, and system events: deploys, power lost and back, sleep, destruction, and rebuilds.
- **The datasheet** describes a board fully enough to write its firmware without the game's code:
  - the facility, and its parts (clock, cap, RAM, sensors);
  - its `io` fields and actions, with their meanings and units;
  - its power draw and base EMF;
  - the state of its firmware.

### 6.8 Defense against hanging firmware

Three layers keep a firmware bug from freezing the game:
1. **The instruction cap** (§6.4). Covers plain loops, loops inside `pcall` or coroutines, and runaway recursion, all verified in the spike.
2. **The sandbox** (§6.5). Covers the single builtins that work long while counting as one instruction: no pattern matching, builtins charged by work, memory caps.
3. **The watchdog.**
   - The simulation runs in the worker thread, so the main thread (MCP, WebSocket) always answers.
   - When one step takes longer than 5 seconds of wall time, the main thread terminates the worker, stops the session, and tells the player which board and which firmware version were running.
   - Wall time depends on the machine, so it is never a game rule; it's a crash guard. Recovering by replaying the record with that firmware disabled comes later.
   - If the watchdog ever fires, layer 2 has a hole: close it.

A hostile-firmware test suite (§11) exercises all three layers.

## 7. Agent connection (MCP)

### 7.1 Transport and security

- **Transport:** MCP over Streamable HTTP at `http://127.0.0.1:7840/mcp`, bound to loopback only. The port is configurable.
- **Every request is checked:**
  - a bearer token must be present;
  - the `Origin` header is checked, and requests from browser origins are refused;
  - inputs are size-limited (firmware source to 64 KB).
- **Nothing a client sends may crash the server**, on any of its routes (MCP, the viewer's WebSocket, the built viewer): any web page the player visits can make the browser send requests to 127.0.0.1. A malformed request gets an error response.
- **The token** is generated once and stored in the server's local config, which lives in the user's config directory outside the repository. The start screen can reissue it. This differs from the design doc's token-per-launch: with a new token on every launch, the player would re-add the server to their agent every time they open the game. Loopback binding plus the token still keep out other programs and browser-based attacks such as DNS rebinding.
- **Connecting:** the start screen shows the connect command with a copy button, for example `claude mcp add --transport http turing-city http://127.0.0.1:7840/mcp --header "Authorization: Bearer <token>"`.
- **Development:** for agents working on this repository, a `.mcp.json` can read the token from an environment variable: `"Authorization": "Bearer ${TURING_CITY_TOKEN}"`. The repository is public, so no token is committed.

### 7.2 Connection is a game rule

- In the prototype, the agent connects over MCP from the very start. Gating MCP behind parts and unlocks comes later.
- **"Start season" stays disabled until an agent is connected.**
- **Connected** means an initialized MCP session whose server-to-client stream is open. Claude Code holds that stream open (code.claude.com/docs/en/mcp: it receives `list_changed` over a stream it keeps open, and reopens it). On top of the stream, the server sends MCP `ping` requests every 5 seconds.
- **Disconnects:** when the stream closes, or 2 pings in a row go unanswered, the game pauses and play stays blocked until an agent connects again. The player can't turn this pause off. Claude Code retries a dropped server on its own (5 attempts with backoff); `/mcp` retries by hand.
- **Unverified:** whether Claude Code answers server-sent pings isn't documented. Check it at milestone 1; if it doesn't answer, the open stream alone decides.

### 7.3 Tools

The prototype offers every tool from the start.

| Tool | Returns or does |
|---|---|
| `list_boards()` | each board's id, facility, position, state (running, asleep, unpowered, destroyed), firmware version, and latest error |
| `get_datasheet(board)` | §6.7's datasheet |
| `get_firmware(board)` | the deployed source. Not in the design doc's list, added because an agent needs the source to edit it |
| `deploy_firmware(board, code)` | compiles; queues for the board's next tick, or returns the syntax error |
| `read_logs(board, since)` | log lines after a game time |
| `get_map()` | the facilities, their positions, distances, and states |
| `get_status()` | game time, paused or speed, money, food, power supply and demand, the fed, hungry, and unpowered population, season progress |
| `get_alerts(since)` | alerts after a game time |

- **The agent learns of threats only through board sensors, logs, and alerts.** `get_map` carries no EMF field and no Luddite positions, and the heatmap is the human's.
- **The news feed** (`read_news`) is out of scope.
- **`subscribe_alerts`** becomes `get_alerts` polling. Claude Code doesn't show server-sent notifications in the conversation.
- **The definitions** (names, input schemas, handlers written against a game interface) live in `core`, with no Node API. `server` exposes them over MCP; a WebMCP adapter for a later web build can reuse them unchanged.

### 7.4 Dev-only tools

These exist only when the server starts with a dev flag. QA agents use them, and they are never part of the game:
- play, pause, and set the speed;
- run until a game time or an alert;
- start a new session with a given seed;
- rebuild a board.

## 8. Viewer

The approved mockups (v1 to v5, in the brainstorming session) shaped this section.

### 8.1 Start screen

- The connect command with a copy button, and a token reissue button.
- The agent's state: "waiting for an agent…" or "connected (client name)".
- "Start season", enabled only while an agent is connected, and the scenario's name. A seed field appears only in dev.

### 8.2 Main screen

- **Top bar:** day and time, pause and speed, money, warehouse food, power supply and demand, the fed, hungry, and unpowered population, and the agent's connection with its last response.
- **Map:** the grid, drawn with placeholder shapes until the art phase.
  - Every facility with a board shows a status light: green running, yellow asleep, grey unpowered, blinking red error, black destroyed.
  - Datacenters show their temperature.
  - Trucks move smoothly along the grid lines, and Luddites step from cell to cell.
  - Fires show where they burn.
  - H toggles the EMF heatmap.
- **What the map draws, by selection:**

  | Selected | Shown |
  |---|---|
  | nothing | only threat paths: the Luddites' route, always visible, blinking |
  | warehouse | every route of its trucks |
  | farm | only the routes between the warehouse and that farm |
  | housing | only the deliveries coming to it |
  | power plant | every block it powers, highlighted, each labelled with its draw (transmission loss included) and priority; blocks without power are dimmed |
  | datacenter | no routes; its draw shows in the panel |

  Threat paths show whatever is selected; routine paths show only with a related block.
- **Right panel**, for the selected facility:
  - its board's state and parts, live sensor values, the live log, and the deployed firmware (read-only);
  - the rebuild button with its cost, when the board is destroyed;
  - facility details. The warehouse lists stock, spoilage, trucks with load and arrival time, farm outboxes, and housing food. The power plant lists wind and thermal output, the fuel cost, demand, and the priority list with each consumer on or off.
- **Alert feed:** events, including the agent's deploys ("firmware v3 deployed to datacenter A").
  - Clicking an alert jumps to its facility.
  - Each alert type has its own auto-pause toggle. Disconnect is always on.
- **Disconnect overlay:** the game is paused and play is blocked until an agent connects; it shows how to reconnect.
- **Keys:** space pauses, 1, 2, and 3 set the speed, H toggles the heatmap. Clicking a facility opens its panel.

### 8.3 Season wrap-up

- **Result:** completed, bankrupt, or fallen.
- **Numbers:** the final money with the breakdown of §5.9, boards lost, raids, total instructions, and deploys.
- **Past seasons:** listed with their scores, so a careless session and a careful one sit side by side. They're stored locally by the server.

## 9. Scenario: small town

- **Map:** 20 × 12 cells.
- **Positions** (column, row from the top-left):

  | Facility | Position |
  |---|---|
  | Housing H1 | (2, 1) |
  | Housing H2 | (17, 1) |
  | Power plant P | (4, 4) |
  | Datacenter A | (5, 4), next to the plant: little loss, an EMF hotspot |
  | Warehouse W | (11, 6) |
  | Datacenter B | (16, 8), far away: more loss, a quiet spot |
  | Farms F1, F2, F3 | (2, 9), (3, 9), (4, 9) |

- **The start:**
  - The session starts paused, and every board is empty: no firmware.
  - Without firmware, a facility does nothing of its own. Farms grow but aren't harvested, and datacenters idle. The plant runs wind only, with thermal at 0 and the default priority. The warehouse waits. Housing still eats and uses power.
  - So the first move is to ask the agent for the town's first firmware, then press play.
- **Board parts:**

  | Board | Clock | Instructions per tick | RAM | Sensors |
  |---|---|---|---|---|
  | Power plant | 4 Hz | 1,500 | 4 KB | wind output, demand, fuel price |
  | Datacenter A, B | 5 Hz | 2,000 | 8 KB | temperature, power headroom, job price, local EMF, Luddite distance |
  | Warehouse | 2 Hz | 3,000 | 16 KB | stock, farm outboxes, housing food, truck states |
  | Farm 1-3 | 1 Hz | 500 | 2 KB | ripeness, outbox |

- **The seed** sets the wind, the job prices, the fuel price, the fire rolls, and the raid spawn points. How often raids come is up to the player's EMF.

## 10. Tuning values

All of these are starting values to tune, in one place so that code reads them from the scenario file rather than hard-coding them:

| Value | Start |
|---|---|
| World steps per second at 1× | 20 |
| Day length at 1× / season length | 40 s / 30 days |
| Starting money | 5,000 |
| Transmission loss | 2% per cell from the plant |
| Thermal module maximum / fuel price | 300 / a seeded series around 7 per unit per day |
| Crop ripening / rot after ripe | 3 days / 1 day |
| Farm outbox capacity / harvest yield | 50 / 24 |
| Trucks / capacity / speed / fuel | 2 / 40 / 2 cells per s / 1 per cell |
| Warehouse spoilage | 2% of stock per day |
| Housing: residents / food / power / tax | 40 / 1 per person per day / 70 per block / 5 per fed and powered person per day |
| Datacenter: process power / job price | 150 / a seeded series around 40 per second of processing |
| Datacenter heat | +2 °C per second while processing; passive cooling 2% of (temperature − 25 °C) per second; cooling level L takes off 0.8 × L °C per second and draws 20 × L power |
| Fire | above 90 °C, a chance of (temperature − 90) × 0.5% per second |
| Board upkeep | 10 per board per day |
| EMF a, b | 1 per 100 instructions; 10 per action |
| Base EMF (per second, awake) | farm 10, warehouse 15, power plant 20, datacenter 25 |
| EMF field | each second, a cell passes 10% of its value to each of its four neighbours and the field decays 10% |
| Rumour gauge / Luddite detection threshold | a raid each time the gauge collects 100,000 (the field's total, added every second) / 5 in a cell |
| Raid group / Luddite speed / give-up quiet time | 3 / 1 cell per s / 10 s |
| Rebuild cost / time | 500 / half a day |
| Bankruptcy | 3 days below zero |
| Log length / firmware size | 200 lines / 64 KB |
| Watchdog | 5 s per step |
| MCP port / ping interval / misses to disconnect | 7840 / 5 s / 2 |

## 11. Verification

- **`core` unit tests:**
  - power: loss and shedding by priority;
  - heat and fire;
  - crops: growth, harvest, rot, and full outboxes;
  - the warehouse: spoilage, truck routes on grid lines, fuel;
  - housing: consumption and taxes, hunger, blackouts;
  - EMF: emission, base EMF, diffusion, decay;
  - Luddites: spawning, movement, smashing, leaving;
  - money and game over.
- **Determinism:** the same scenario, seed, and inputs give the same state hash at every step.
- **`firmware` tests:**
  - counting and caps: exact counts, aborts that survive `pcall`, counting inside coroutines, recursion;
  - the sandbox's removed globals and charged builtins;
  - memory caps;
  - determinism across processes;
  - deploys: hot reload keeps `mem` and resets globals, and a syntax error is rejected.
- **The hostile-firmware suite.** Each of these must end its tick within budget, and the session must go on:
  - an infinite loop, one inside `pcall`, one inside a coroutine;
  - runaway recursion;
  - string, table, and memory bombs;
  - a pattern-function call (gone from the sandbox, so it errors);
  - builtins fed empty strings, negative or NaN ranges, overflowing counts, or a lying `__len`.
- **Season checks** with `pnpm sim`: reference firmware sets we write, one careless and one careful, each run a full season. The season must finish, the careful set must score clearly higher, and a second run must give the same result.
- **MCP tests:**
  - a missing or wrong token is refused, and so is a browser origin;
  - size limits hold;
  - the tool round trips work;
  - a disconnect pauses the game and blocks play until an agent reconnects.
- **Viewer:** headless Playwright screenshots of the key states. Logic that can be separated from the screen, such as the selection rules of §8.2, gets unit tests.
- **Depth check:** `qa-tester` plays two seasons through MCP, one with careless requests and one with careful ones, and reports the score gap and its fun checklist. The user's own playtest has the final say.

## 12. Build order

1. **Skeleton:** the workspace and its four packages; the deterministic clock and step loop; the scenario loader; `pnpm sim` running an empty season; `pnpm check` (typecheck, lint, tests, season checks). Record the commands in CLAUDE.md.
2. **Firmware runtime:** the sandbox, counting and caps, pinned determinism, the hostile-firmware suite, hot reload, logs, datasheets.
3. **Power, datacenters, and threats:** power, the datacenter, EMF, Luddites, sleep, fires, and rebuilds, with headless checks.
4. **Server and a first viewer:** the worker and its watchdog, MCP with the tools and connection rule, the WebSocket, and the map, top bar, panel, and alerts. Check here whether Claude Code answers server pings.
   **→ Milestone 1:** the user plays with only the power plant and the datacenters, with an agent connected.
5. **The food chain:** farms, the warehouse and its trucks on the grid, and housing with consumption and taxes.
6. **Finishing the viewer:** the selection rules, the heatmap, the auto-pause settings, rebuilding, and the season wrap-up with past seasons.
   **→ Milestone 2:** the full prototype is played; QA runs the depth check.

## 13. Open questions and risks

- **Rebuilding:** instant or delayed? Half a day is the placeholder (the user).
- **Determinism beyond one machine:** wasmoon's has been verified only on one Mac. Check x64 and browsers before relying on replays across machines.
- **Pings:** whether Claude Code answers server-sent pings is unverified (§7.2).
- **Budget-mode counting** reads a memory offset tied to the pinned wasmoon build. Only a concern if we switch to it.
- **The design doc's 코드 블럭 예시 table** (a distributor feeding ore to smelters) predates the food-only logistics decision. The prototype doesn't use it.
- **The game around the prototype** waits for it to prove the loop: the copy-paste stage and the unlock progression, part assembly (B), free placement (C), the other facilities and events, and sprites.
