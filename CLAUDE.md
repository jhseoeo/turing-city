# turing-city (working title)

An automation and town-management game. The player builds small boards into the town's facilities, the player's own AI agent (Claude Code or any other) writes their Lua firmware through the game's local MCP server, and the electromagnetic noise the working machines leak draws Luddites who smash them. Planned stack: TypeScript, Phaser, and Electron for a desktop game; a web build is parked (see "Design"). Solo side project, developed on a Mac; the repository started 2026-10-09. The prototype in `docs/design.md` (첫 프로토타입) checks whether the loop of an agent writing and fixing firmware is fun. Milestone 1 is built: the power plant and two datacenters, with the player's agent writing their firmware over MCP and a browser viewer for the player (the user's playtest checklist is in `docs/playtests/`). The food chain (farms, the warehouse, trucks, housing) and the season wrap-up are milestone 2.

Read `docs/design.md` first. It's the game design document, in Korean: the vision, the systems, the decision log (결정 기록), and a hand-off section for implementation (구현 핸드오프).

## Working with the user

- Talk to the user in Korean. Write docs in English, except `docs/design.md`, which stays in Korean (the user, 2026-10-09).
- The user is a backend developer whose main language is Go. Skip programming basics; explain what is particular to TypeScript, Phaser, Electron, and game development directly.
- Prefer the implementation that is simplest right now and refactor later.
- In design talks, ask one decision at a time with the recommendation first, and propose the smallest version. Give each option a concrete picture of what changes: what the player and their agent do or see under it, what gets built, and what it costs. Abstract labels with one-line trade-offs don't let the user judge (the user, 2026-10-09). Secondary numbers (coefficients, prices, rates, tick counts, default values) become tuning values rather than questions. A topic the user calls "not now" gets parked under "Design" and isn't proposed again until they raise it. Let the user lead the framing.
- Prototype content (facilities, parts, events, and their numbers) is a placeholder for trying systems. What matters is whether a mechanic exists and works, not how a placeholder carries it or how it's balanced. Note such observations as tuning values; don't ask the user about them.
- Attach rules to capabilities, not to concrete facilities: a behavior belongs to "a board with a comm module" or "a facility that stores food", not to "the datacenter" or "the warehouse", so new content combines freely.
- Talk about game time in seconds, hours, and days, never in ticks: the world advances in steps, and a tick is only a board's beat (the user, 2026-10-09: tick counts made the game sound turn-based).

## Design

- `docs/design.md` is the source of truth for the game's design (the user, 2026-10-09). It was exported from the user's draft of 2026-10-07 and is edited here from now on. When the user decides something that changes it, update it in the same change (in Korean) and add a row to its decision log (결정 기록): the choice, and the rejected alternatives with why. Items marked 초안 (draft) are proposals that implementation may change; once a spec settles one, the spec is the reference and the design doc points to it.
- Specs and plans go in `docs/superpowers/specs/` and `docs/superpowers/plans/`, in English.
- Platform (the user, 2026-10-09): a desktop game, Electron with the local MCP server. A web build is parked, with its door kept open (see "Code and checks"). A web demo of the copy-paste stage needs no WebMCP and can come any time. A full web build waits until a browser ships WebMCP: in October 2026 only Chrome and Edge ran origin trials, and Claude Code reached a page's tools only through a browser-automation bridge, which also handed the agent the whole page. The decision log in `docs/design.md` has the reasons.
- The prototype: `docs/superpowers/specs/2026-10-09-prototype-design.md`, agreed with the user section by section on 2026-10-09. On the prototype, it's the reference where it and the design doc differ.

### Open questions

- The design doc's 미결 사항 (open items), including whether a destroyed board should be rebuilt at once or after a delay.
- From the prototype spec (§13): Lua determinism on x64 and in browsers. The Lua spike of 2026-10-09 settled instruction counting and determinism on one machine (spec §4.4 and §6.4 to §6.6). The other question, whether Claude Code answers server-sent MCP pings, is settled: it does (checked 2026-10-10 with Claude Code 2.1.296, spec §7.2).

## Agents

Four project agents live in `.claude/agents/` (set up 2026-10-09, adapted from the user's roguelike-fps project). Every agent reads this file when it starts, so a rule that more than one role needs belongs here, and a definition holds only what is particular to its role.

| Agent | Does |
|---|---|
| `game-designer` | Game design only: options with a recommendation, checks against the decided design, reference research |
| `implementer` | One task end to end: code, tests, checks, docs, verification, commit |
| `reviewer` | Read-only, one-pass review of a diff |
| `qa-tester` | QA for bugs and for fun: plays the game through its MCP tools the way a player's agent does, and judges it against a fun checklist |

- Work designed in chat, the main session implements itself. Work with a spec and a plan goes through subagent-driven development (SDD), with `implementer` as the implementer and `reviewer` as the reviewer. SDD keeps its working files in `.superpowers/sdd/` (git-ignored).
- Outside SDD, a review is one pass. Several reviewers over several rounds cost tokens for every agent and every round, while what they find shrinks fast after the first round.
- Reviews gate one diff: `reviewer` and `qa-tester` judge one change before it merges, and the reviewer proposes no refactors. What builds up over many changes that each looked fine (repeated logic, growing files, ticks that slow down as boards multiply, slower checks) belongs to an `optimizer` agent, added when one of those shows up. As in roguelike-fps, it would never run on its own: the main session proposes a pass, it surveys, the user picks the items, and they go on a branch of their own.
- `game-designer` can also be the main session, for talking with the user directly: `claude --agent game-designer`. As a subagent it can't ask the user anything, so its reports end with the questions only the user can answer.
- The game is made to be played by agents, so it is also the agents' test bench. An implementer checks behavior by running seasons headless (`pnpm sim`) and the viewer headlessly (`pnpm shots`). `qa-tester` connects to the game's MCP server as a player's agent would: start `pnpm start:dev`, add the server to the QA session with the `claude mcp add` command it prints, then use the agent tools plus the dev tools (`dev_run_until` and the others, which exist only in dev mode). The commands are listed under "Code and checks".
- Agent memory (`.claude/agent-memory/<agent>/`) stays on this machine; git ignores it.
- Not yet: an `optimizer` (see above), a `playtest` skill (once the game writes a play log), and 2D art roles (in the art phase; roguelike-fps's 3D art agents don't carry over).

Finishing a branch (in place of superpowers' finishing-a-development-branch, after SDD too):
1. Verify: the project's checks (see "Code and checks"). Fix what fails before going on.
2. Check that this file, `docs/design.md`, and the spec describe what the code now does.
3. Review and QA, in parallel. `reviewer`, on the most capable model, reviews work designed in chat (SDD work has had its final review); give it the diff as a file. `qa-tester` runs when gameplay changed (simulation rules, the firmware API, MCP tools, tuning). Fix Critical and Important findings and QA's bugs, then verify again. Only a fix that changes behavior beyond a few lines gets a second look, on a cheaper model, at the fix alone.
4. Ask the user before merging, with what changed, the verification, the review and QA results, and QA's fun findings. Fun findings never block a merge; the user decides what to do with them.
5. Merge (after `git rebase main` if main has moved): `git merge-base --is-ancestor main <branch> && git fetch -q . <branch>:main && git checkout -q main`; verify again on main; then `git branch -d <branch>`; then `git push origin main`, and `git push origin --delete <branch>` if the branch was pushed.

A docs-only change that records what the user just decided skips steps 3 and 4: the user's call is the approval.

## Code and checks

- The design's implementation principles (구현 원칙) hold. The simulation core is pure logic, fully separate from rendering, so ticks run without a screen. It computes with integers, so the same inputs always give the same results, which replays and scoring rely on.
- The simulation core and the agent tool definitions use no Node or Electron API, so a web build can run them unchanged (the user, 2026-10-09). Node and Electron stay in the desktop shell and the MCP transport.
- A new test or check must fail without the change it covers: show that (rerun with the change switched off) or say why it would.
- Measure before optimizing. Pooling, caching, workers, and the like wait for a measurement that asks for them, and each such change shows its gain with before-and-after numbers from the same scenario.
- A refactor changes no behavior: the checks pass before and after, with no check weakened. It leaves the code simpler, not more general, and goes on a branch of its own between features, never inside a feature branch.
- Commands (run from the repository root; Node 24 runs the TypeScript sources directly, no build step):
  - `pnpm check`: typecheck every package, lint with Biome, and run every test. This is the project's check before any commit.
  - `pnpm fix`: Biome's formatting and safe fixes. Run it before committing.
  - `pnpm vitest run <path>`: one package's or one file's tests.
  - `pnpm sim [scenario.json] [--firmware dir] [--seed n] [--until day] [--rebuild]`: plays a season headless and prints the result as JSON (`money` in whole units, the `ledger` in micro-units; `--rebuild` rebuilds every smashed board as soon as the money allows, standing in for the player). The reference firmware sets are in `scenarios/firmware/m1/careless` and `careful`.
  - `pnpm start`: builds the viewer and serves the game at http://127.0.0.1:7840 (MCP at `/mcp`, the viewer's socket at `/ws`); it prints the agent's connect command, and logs a timestamped line whenever the agent connects or disconnects. `pnpm start:dev` adds the dev tools (`dev_play`, `dev_run_until`, ...) for QA agents.
  - `pnpm viewer` runs Vite's dev server on 5173, for developers as well as QA. It works only with a server started by `pnpm start:dev` on port 7840: the page's socket goes to `ws://127.0.0.1:7840/ws`, and the server accepts Vite's origin only in dev mode, because 5173 is shared by every Vite project on the machine.
  - `pnpm shots`: drives the real viewer in headless Chrome against a real server and a scripted agent, runs about 50 checks and exits 1 on a failure, takes about 40 s, needs Google Chrome installed, and writes its screenshots to `scratch/shots/`.
  - The token lives in `~/.config/turing-city/config.json`, outside the repository (it's public).
- Imports inside the workspace carry the `.ts` suffix, and the code uses only erasable TypeScript syntax (no `enum`, `namespace`, or constructor parameter properties): Node runs the server's worker thread with its own type stripping, which needs both.
- `core` uses no Node or DOM API, and `firmware`'s `src` no Node API; their tsconfigs and Biome's `noNodejsModules` enforce it.

## Git

- Branch `main`; the remote `origin` is the public GitHub repo `jhseoeo/turing-city` (the user, 2026-10-09). Push to `origin` as a backup: main whenever it moves, and a branch waiting for the user's review whenever it gets commits.
- The repository is public: never commit secrets, tokens, `.env` files, or personal data, and keep logs and scratch output out of git.
- One branch per change, merged by fast-forward (see "Finishing a branch").
- Worktrees live in `.claude/worktrees/` (git-ignored). Start one from main explicitly, `git worktree add .claude/worktrees/<name> -b <name> main`, then `EnterWorktree` with its `path`; the base of a worktree created by name hasn't been checked. Each worktree needs its own dependency install. Land it by fast-forwarding main to its branch as in "Finishing a branch", then remove the worktree and its branch (locally and on `origin`).
- Commit messages claim only what was verified: no guessed causes, and no before-and-after claims without the runs that show them.

## Hooks

`.claude/hooks/guard.sh`, a PreToolUse hook registered in `.claude/settings.json` (it runs for subagents too):
- refuses hand edits to package-manager lockfiles, which change only through the package manager;
- asks the user before a shell command runs macOS `open`, which brings an app or a browser to the front and takes the user's focus. Agents check the viewer headlessly instead. When the desktop shell exists, its launch command joins this rule.

It fails closed: if `jq` is missing or the hook can't read the tool call, it blocks the call with a message instead of letting it through unchecked.
