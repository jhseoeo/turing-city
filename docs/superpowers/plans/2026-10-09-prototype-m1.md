# Prototype milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build milestone 1 of the prototype: a deterministic town simulation with the power plant and two datacenters, sandboxed Lua firmware on wasmoon, a local MCP server the player's agent connects to, and a browser viewer, so the user can play seasons with Claude Code writing the firmware.

**Architecture:** A pnpm workspace of four TypeScript packages. `core` is the pure, integer-only simulation (rules, the session loop, views, the agent tool definitions). `firmware` runs each board's Lua in its own wasmoon state, with exact instruction counting and a sandbox. `server` hosts a season in a worker thread behind a clock and a watchdog, and serves MCP at `/mcp`, the viewer's WebSocket at `/ws`, and the built viewer at `/`. `viewer` draws the map with Phaser and the rest with DOM. Node 24 runs the TypeScript sources directly; there's no build step except Vite's for the viewer.

**Tech Stack:** Node 24.0.1, pnpm 10.30.3, TypeScript 7.0.2, Vitest 5.0.3, Biome 2.5.15, zod 4.6.5, wasmoon 1.16.0 (Lua 5.4), @modelcontextprotocol/sdk 1.32.1, ws 8.22.0, Vite 8.3.4, Phaser 4.2.1, playwright-core 1.64.0 (with the installed Google Chrome).

**Spec:** `docs/superpowers/specs/2026-10-09-prototype-design.md` (milestone 1 = its §12 build steps 1-4). The game design is in `docs/design.md`. This plan follows the spec's build order with two changes: the headless runner (`pnpm sim`) comes with the season checks in Task 15, once rebuilding exists (a headless season needs a stand-in for the human who rebuilds), and milestone 1 plays a scenario of its own, `scenarios/m1-power.json`, with only the power plant and the two datacenters (the small town with its food chain is milestone 2).

## Global Constraints

- Imports inside the workspace carry the `.ts` suffix, and code uses only erasable TypeScript syntax (no `enum`, `namespace`, or constructor parameter properties). Node runs the server's worker thread with its own type stripping, which needs both.
- `core` uses no Node and no DOM API, holds every quantity as an integer (money in micro-units, temperature and EMF in milli-units), and draws randomness only from its seeded streams: no `Math.random`, `Date.now`, or timers. `firmware`'s `src` uses no Node API.
- Determinism: the same scenario, seed, and inputs give the same `stateHash` at every step. Only `Session.step()` touches a board's Lua state; one `WasmoonHost` (one Lua runtime) serves one session; deploy-time syntax checks run in a separate runtime (`SyntaxChecker`).
- Every number from spec §10 is read from the scenario file, never hard-coded.
- The firmware sandbox (spec §6.5): no `os`, `io` library, `load`, `require`, `debug`, `collectgarbage`, `utf8`, `string.dump`, `string.pack/unpack`, pattern functions (`find` is plain only); size-proportional builtins charged by work, with a charge that no argument can make negative or NaN, and `table.insert`, `table.remove`, and `table.move` written in Lua so every shift counts; `__gc` and `__mode` refused; `tostring` without addresses; `math.random` seeded per board; RAM capped; the instruction cap counted by a C-level hook that survives `pcall` and follows coroutines.
- MCP (spec §7.1): bound to 127.0.0.1 (default port 7840), a bearer token on every request, any `Origin` header refused, firmware source at most 64 KB; the token lives in `~/.config/turing-city/config.json`, outside the repository, because the repository is public.
- Nothing a client sends may crash the game server: any web page can make the browser send requests to 127.0.0.1, so every HTTP handler turns errors into responses and every WebSocket has an `error` listener.
- Time in the user's language is seconds, hours, and days; "step" is the world's unit and "tick" a board's beat.
- Game text the player reads (alerts, the viewer) is Korean; logs, errors, datasheets, and code identifiers are English.
- Before each commit: `pnpm fix`, then `pnpm check` passes. Commit messages claim only what was verified, and end with the trailer lines the dispatch gives.
- Out of scope for milestone 1: the food chain (farms, warehouse, trucks, housing), selection rules beyond the plant's consumers, the season wrap-up's breakdown and past seasons, the Electron shell, art, the unlock progression, the news feed.

## Review Focus

1. A token reissue must cut off agents holding the old token (their sessions drop and reconnecting gets 401), and a running game must pause as a disconnect. Test: Task 17's "cuts off agents holding a reissued token".
2. A season that ends while the clock runs must stop the clock and show the result, not keep stepping or hang. Test: Task 16's "stops the clock when the season ends while running".
3. With two agents connected, the game must stay connected until the last one leaves. Test: Task 17's "stays connected until the last of two agents leaves".
4. No firmware may freeze the game: every hostile case ends its tick within budget (including the builtins a security review caught running long on tiny input or charging a negative or NaN amount), and if anything still hangs, the watchdog stops the session and names the board. Tests: Task 7's hostile suite, Task 16's "stops the session when a batch outlives the watchdog".
5. A deploy that arrives while a batch of steps is in flight must land at a recorded step, so the session replays. The worker handles messages in order, so the deploy applies after the batch; Task 4's "replays a record into the same state" pins replay, and Task 15's "gives the same result when run twice" pins it with real Lua.

## Task order

| # | Task | Package |
|---|---|---|
| 1 | The workspace and its checks | all |
| 2 | Integer math, seeded randomness, and game time | core |
| 3 | The scenario format and the milestone-1 scenario | core |
| 4 | The world state and the session's step loop | core |
| 5 | A Lua runtime with a pinned clock | firmware |
| 6 | The board VM: sandbox, io, deploys, counting, and RAM | firmware |
| 7 | The hostile-firmware suite | firmware |
| 8 | The wasmoon firmware host and the syntax checker | firmware |
| 9 | Weather, market, and power | core |
| 10 | Datacenters: jobs, heat, income, and fire | core |
| 11 | EMF: emission, the field, diffusion, and decay | core |
| 12 | Luddites | core |
| 13 | Fuel, upkeep, rebuilding, and the ways a season ends | core |
| 14 | Read-only views, datasheets, and the agent tool definitions | core |
| 15 | `pnpm sim`, the reference firmware, and the season checks | core, server |
| 16 | The game controller: worker thread, watchdog, clock, and the play rules | server |
| 17 | The MCP server: token, gatekeeping, tools, and the connection rule | server |
| 18 | The game server: the viewer's WebSocket, the static viewer, and `pnpm start` | server |
| 19 | The viewer's connection, its pure display rules, and the start screen | viewer |
| 20 | The map and the top bar | viewer |
| 21 | The panel, the alert feed, the overlays, the keys, and headless screenshots | viewer, server |
| 22 | Milestone 1: Claude Code for real, the playtest checklist, and the docs | server, docs |

---

### Task 1: The workspace and its checks

A pnpm workspace with the four packages of spec §4.1, TypeScript 7 in strict mode, Vitest 5, Biome 2, and `pnpm check`. Every config here ran on Node 24.0.1 and pnpm 10.30.3 in a scratch copy on 2026-10-09.

Two facts shape every later task:
- **Imports inside the workspace carry the `.ts` suffix** (`import { idiv } from './fixed.ts'`). TypeScript's `nodenext` resolution requires it, and Node runs the server's worker thread with its own type stripping, which can't resolve a path without it.
- **Only erasable TypeScript syntax**: no `enum`, no `namespace`, no constructor parameter properties (`constructor(private readonly x: X)`). `erasableSyntaxOnly` enforces this. With it, Node 24 runs the TypeScript source directly, so the project needs no tsx and no build step. Node prints an ExperimentalWarning for type stripping; the scripts pass `--disable-warning=ExperimentalWarning`.

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `biome.json`
- Create: `packages/core/{package.json,tsconfig.json,src/index.ts}`
- Create: `packages/firmware/{package.json,tsconfig.json,tsconfig.test.json,src/index.ts,test/smoke.test.ts}`
- Create: `packages/server/{package.json,tsconfig.json,src/index.ts}`
- Create: `packages/viewer/{package.json,tsconfig.json,index.html,vite.config.ts,src/main.ts}`
- Modify: `.gitignore`, `CLAUDE.md` ("Code and checks")

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Packages `@turing-city/core`, `@turing-city/firmware`, `@turing-city/server`, `@turing-city/viewer`. Each one's `exports` points at `./src/index.ts`.
  - Root scripts: `pnpm typecheck`, `pnpm lint`, `pnpm fix` (Biome's formatting and safe fixes), `pnpm test`, and `pnpm check` (all three checks).
  - What each package may use:

    | Package | APIs it may use | How that's enforced |
    |---|---|---|
    | `core` | no Node and no DOM APIs | `lib: es2024`, `types: []`, Biome's `noNodejsModules` |
    | `firmware` | browser globals in `src`, no Node | `lib: es2024 + dom`, Biome's `noNodejsModules`; its tests may use Node through `tsconfig.test.json` |
    | `server` | Node | `types: ["node"]`; `lib: es2024 + dom`, because it typechecks `firmware`'s source, which uses WebAssembly |
    | `viewer` | DOM and Vite | `lib: es2024 + dom`, `types: ["vite/client"]` |

- [ ] **Step 1: Write the root files**

`package.json`:

```json
{
  "name": "turing-city",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.30.3",
  "engines": { "node": ">=24.0.0" },
  "scripts": {
    "typecheck": "pnpm -r typecheck",
    "lint": "biome check .",
    "fix": "biome check --write .",
    "test": "vitest run",
    "check": "pnpm typecheck && pnpm lint && pnpm test"
  },
  "devDependencies": {
    "@biomejs/biome": "2.5.15",
    "@types/node": "26.6.4",
    "typescript": "7.0.2",
    "vitest": "5.0.3"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - packages/*
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "es2024",
    "lib": ["es2024"],
    "module": "nodenext",
    "types": [],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "moduleDetection": "force",
    "noUncheckedSideEffectImports": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true
  }
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*'],
  },
});
```

`biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.15/schema.json",
  "files": {
    "includes": ["**", "!**/dist", "!**/node_modules", "!.superpowers", "!.claude/worktrees", "!scratch"]
  },
  "formatter": {
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 140
  },
  "javascript": {
    "formatter": { "quoteStyle": "single" }
  },
  "linter": {
    "rules": {
      "preset": "recommended",
      "style": { "noNonNullAssertion": "off" },
      "complexity": { "noForEach": "off" }
    }
  },
  "overrides": [
    {
      "includes": ["packages/core/src/**", "packages/firmware/src/**"],
      "linter": { "rules": { "correctness": { "noNodejsModules": "error" } } }
    }
  ],
  "assist": {
    "actions": { "source": { "organizeImports": "on" } }
  }
}
```

Append to `.gitignore`:

```
# Playwright MCP's console logs and page snapshots
.playwright-mcp/
```

- [ ] **Step 2: Write the packages**

`packages/core/package.json`:

```json
{
  "name": "@turing-city/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p ." }
}
```

`packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["es2024"], "types": [] },
  "include": ["src", "test"]
}
```

`packages/core/src/index.ts`:

```ts
export {};
```

`packages/firmware/package.json`:

```json
{
  "name": "@turing-city/firmware",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p . && tsc -p tsconfig.test.json" },
  "dependencies": { "wasmoon": "1.16.0" },
  "devDependencies": { "@types/node": "26.6.4" }
}
```

`packages/firmware/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["es2024", "dom"], "types": [] },
  "include": ["src"]
}
```

`packages/firmware/tsconfig.test.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "test"]
}
```

`packages/firmware/src/index.ts`:

```ts
export {};
```

`packages/firmware/test/smoke.test.ts` (proves the wasmoon import works under Vitest):

```ts
import { LuaFactory } from 'wasmoon';
import { describe, expect, it } from 'vitest';

describe('wasmoon', () => {
  it('runs Lua', async () => {
    const engine = await new LuaFactory().createEngine();
    expect(engine.doStringSync('return 1 + 1')).toBe(2);
    engine.global.close();
  });
});
```

`packages/server/package.json`:

```json
{
  "name": "@turing-city/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p ." },
  "devDependencies": { "@types/node": "26.6.4" }
}
```

`packages/server/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["es2024", "dom"], "types": ["node"] },
  "include": ["src", "test"]
}
```

`packages/server/src/index.ts`:

```ts
export {};
```

`packages/viewer/package.json`:

```json
{
  "name": "@turing-city/viewer",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc -p .",
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": { "phaser": "4.2.1" },
  "devDependencies": { "vite": "8.3.4" }
}
```

`packages/viewer/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["es2024", "dom"], "types": ["vite/client"] },
  "include": ["src", "test", "vite.config.ts"]
}
```

`packages/viewer/vite.config.ts`:

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true },
});
```

`packages/viewer/index.html`:

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>turing-city</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`packages/viewer/src/main.ts`:

```ts
document.querySelector('#app')?.append('turing-city');
```

- [ ] **Step 3: Install and run the checks**

Run: `pnpm install`
Expected: installs without errors.

Run: `pnpm check`
Expected: PASS. `pnpm typecheck` checks all four packages (firmware twice: `src` alone, then with its tests); `biome check .` passes; `vitest run` reports 1 file, 1 test passed. If Biome reports formatting differences, run `pnpm fix` and rerun `pnpm check`.

Run: `pnpm --filter @turing-city/viewer build`
Expected: Vite builds `packages/viewer/dist/` without errors.

- [ ] **Step 4: Record the commands in CLAUDE.md**

In `CLAUDE.md`, under "Code and checks", replace the bullet "The commands that typecheck, test, and run the simulation headless get listed here when the prototype's tooling exists." with:

```markdown
- Commands (run from the repository root; Node 24 runs the TypeScript sources directly, no build step):
  - `pnpm check`: typecheck every package, lint with Biome, and run every test. This is the project's check before any commit.
  - `pnpm fix`: Biome's formatting and safe fixes. Run it before committing.
  - `pnpm vitest run <path>`: one package's or one file's tests.
- Imports inside the workspace carry the `.ts` suffix, and the code uses only erasable TypeScript syntax (no `enum`, `namespace`, or constructor parameter properties): Node runs the server's worker thread with its own type stripping, which needs both.
- `core` uses no Node or DOM API, and `firmware`'s `src` no Node API; their tsconfigs and Biome's `noNodejsModules` enforce it.
```

- [ ] **Step 5: Commit**

```bash
pnpm fix
git add -A
git commit -m "Set up the pnpm workspace: four packages, TypeScript 7, Vitest 5, Biome 2, and pnpm check"
```

### Task 2: Integer math, seeded randomness, and game time

The simulation keeps every quantity an integer (spec §5 "Units"), draws every random number from seeded generators, and needs one conversion between steps and game time. These three small modules underpin everything after them.

**Files:**
- Create: `packages/core/src/fixed.ts`, `packages/core/src/rng.ts`, `packages/core/src/time.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/fixed.test.ts`, `packages/core/test/rng.test.ts`, `packages/core/test/time.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MICRO = 1_000_000`, `MILLI = 1_000`; `idiv(x: number, d: number): number` (exact floor division); `mulDiv(a: number, b: number, d: number): number`; `clamp(v: number, lo: number, hi: number): number`.
  - `interface Rng { nextU32(): number; int(lo: number, hi: number): number; chancePpm(ppm: number): boolean }`; `createRng(seed: number): Rng`; `deriveSeed(seed: number, ...labels: readonly (string | number)[]): number`.
  - `interface TimeConfig { stepsPerSecond; secondsPerDay; seasonDays }`; `interface GameTime { step; day; hour; minute; seconds }`; `stepsPerDay(t)`, `seasonSteps(t)`, `stepsForSeconds(t, seconds)`, `gameTime(t, step)`, `beatPeriod(t, clockHz)`, `isBeat(step, period, phase)`.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/fixed.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { clamp, idiv, MICRO, mulDiv } from '../src/fixed.ts';

describe('idiv', () => {
  it('floors exactly for positive and negative numbers', () => {
    expect(idiv(7, 2)).toBe(3);
    expect(idiv(-7, 2)).toBe(-4);
    expect(idiv(6, 3)).toBe(2);
    expect(idiv(-6, 3)).toBe(-2);
    expect(idiv(0, 5)).toBe(0);
  });
  it('stays exact near the top of the safe range', () => {
    const big = 2 ** 51 + 1;
    expect(idiv(big, 1)).toBe(big);
    expect(idiv(big * 2 - 1, 2)).toBe(big - 1);
  });
});

describe('mulDiv', () => {
  it('computes floor(a * b / d)', () => {
    expect(mulDiv(40, MICRO, 20)).toBe(2_000_000);
    expect(mulDiv(300 * 9, MICRO, 800)).toBe(3_375_000);
    expect(mulDiv(-5, 3, 2)).toBe(-8);
  });
});

describe('clamp', () => {
  it('keeps a value inside the range', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
});
```

`packages/core/test/rng.test.ts` (the golden numbers were computed from this exact algorithm):

```ts
import { describe, expect, it } from 'vitest';
import { createRng, deriveSeed } from '../src/rng.ts';

describe('createRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(42);
    expect([a.nextU32(), a.nextU32(), a.nextU32()]).toEqual([3910993901, 1565048137, 3362278356]);
    const b = createRng(42);
    expect(Array.from({ length: 5 }, () => b.int(1, 6))).toEqual([6, 2, 1, 2, 6]);
  });
  it('differs between seeds', () => {
    expect(createRng(1).nextU32()).not.toBe(createRng(2).nextU32());
  });
  it('keeps int() inside its bounds and spreads it evenly', () => {
    const r = createRng(7);
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 60_000; i++) {
      const v = r.int(0, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(5);
      counts[v] = (counts[v] ?? 0) + 1;
    }
    expect(counts).toEqual([9878, 9953, 10091, 10112, 9860, 10106]);
  });
  it('rejects an empty or non-integer range', () => {
    const r = createRng(1);
    expect(() => r.int(3, 2)).toThrow(RangeError);
    expect(() => r.int(0.5, 2)).toThrow(RangeError);
  });
  it('chancePpm is never true at 0 and always true at a million', () => {
    const r = createRng(3);
    for (let i = 0; i < 1000; i++) {
      expect(r.chancePpm(0)).toBe(false);
      expect(r.chancePpm(1_000_000)).toBe(true);
    }
  });
});

describe('deriveSeed', () => {
  it('is stable and separates labels', () => {
    expect(deriveSeed(42, 'DA', 0)).toBe(1746765016);
    expect(deriveSeed(42, 'DA', 1)).toBe(1746514753);
    expect(deriveSeed(42, 'weather')).toBe(2560665826);
  });
});
```

`packages/core/test/time.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { beatPeriod, gameTime, isBeat, seasonSteps, stepsForSeconds, stepsPerDay, type TimeConfig } from '../src/time.ts';

const T: TimeConfig = { stepsPerSecond: 20, secondsPerDay: 40, seasonDays: 30 };

describe('time', () => {
  it('converts steps to days and clock time', () => {
    expect(stepsPerDay(T)).toBe(800);
    expect(seasonSteps(T)).toBe(24_000);
    expect(gameTime(T, 0)).toEqual({ step: 0, day: 1, hour: 0, minute: 0, seconds: 0 });
    expect(gameTime(T, 400)).toMatchObject({ day: 1, hour: 12, minute: 0, seconds: 20 });
    expect(gameTime(T, 800)).toMatchObject({ day: 2, hour: 0, minute: 0 });
    expect(gameTime(T, 799)).toMatchObject({ day: 1, hour: 23, minute: 58 });
  });
  it('turns seconds into steps', () => {
    expect(stepsForSeconds(T, 20)).toBe(400);
    expect(stepsForSeconds(T, 0.5)).toBe(10);
  });
  it('places board beats on a fixed schedule', () => {
    expect(beatPeriod(T, 5)).toBe(4);
    expect(beatPeriod(T, 1)).toBe(20);
    const beats = Array.from({ length: 12 }, (_, s) => s).filter((s) => isBeat(s, 4, 1));
    expect(beats).toEqual([3, 7, 11]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core`
Expected: FAIL, the three test files can't resolve `../src/fixed`, `../src/rng`, `../src/time`.

- [ ] **Step 3: Write the modules**

`packages/core/src/fixed.ts`:

```ts
/**
 * Integer helpers. The simulation stores only integers: money in micro-units,
 * temperatures and EMF in milli-units. Every value stays below 2^53, so plain
 * numbers hold them exactly; these helpers keep division exact too.
 */
export const MICRO = 1_000_000;
export const MILLI = 1_000;

/** Exact floor(x / d) for integers with |x| < 2^53 and d > 0. */
export function idiv(x: number, d: number): number {
  let q = Math.floor(x / d);
  const r = x - q * d;
  if (r < 0) q -= 1;
  else if (r >= d) q += 1;
  return q;
}

/** floor(a * b / d). The product a * b must stay below 2^53. */
export function mulDiv(a: number, b: number, d: number): number {
  return idiv(a * b, d);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
```

`packages/core/src/rng.ts`:

```ts
/** A deterministic random stream (sfc32, seeded through splitmix32). */
export interface Rng {
  /** The next unsigned 32-bit integer. */
  nextU32(): number;
  /** An integer in [lo, hi], both inclusive. */
  int(lo: number, hi: number): number;
  /** True with probability ppm / 1,000,000. */
  chancePpm(ppm: number): boolean;
}

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function createRng(seed: number): Rng {
  const sm = splitmix32(seed);
  let a = sm();
  let b = sm();
  let c = sm();
  let d = sm();
  const nextU32 = (): number => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = (b ^ (b >>> 9)) >>> 0;
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t;
  };
  return {
    nextU32,
    int(lo, hi) {
      const range = hi - lo + 1;
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || range < 1 || range > 0x1_0000_0000) {
        throw new RangeError(`bad range ${lo}..${hi}`);
      }
      return lo + (nextU32() % range);
    },
    chancePpm(ppm) {
      return ppm > 0 && nextU32() % 1_000_000 < ppm;
    },
  };
}

/** A seed for a sub-stream: FNV-1a over the labels, mixed with the parent seed. */
export function deriveSeed(seed: number, ...labels: readonly (string | number)[]): number {
  let h = (0x811c9dc5 ^ (seed >>> 0)) >>> 0;
  for (const label of labels) {
    const s = String(label);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
```

`packages/core/src/time.ts`:

```ts
import { idiv } from './fixed.ts';

export interface TimeConfig {
  readonly stepsPerSecond: number;
  readonly secondsPerDay: number;
  readonly seasonDays: number;
}

/** Game time for people: day 1 is the season's first day. */
export interface GameTime {
  readonly step: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  /** Seconds of game time since the season started. */
  readonly seconds: number;
}

export function stepsPerDay(t: TimeConfig): number {
  return t.stepsPerSecond * t.secondsPerDay;
}

export function seasonSteps(t: TimeConfig): number {
  return stepsPerDay(t) * t.seasonDays;
}

export function stepsForSeconds(t: TimeConfig, seconds: number): number {
  return Math.round(seconds * t.stepsPerSecond);
}

export function gameTime(t: TimeConfig, step: number): GameTime {
  const spd = stepsPerDay(t);
  const minuteOfDay = idiv((step % spd) * 1440, spd);
  return {
    step,
    day: idiv(step, spd) + 1,
    hour: idiv(minuteOfDay, 60),
    minute: minuteOfDay % 60,
    seconds: step / t.stepsPerSecond,
  };
}

/** Steps between two beats of a board's clock. Scenario validation makes it an integer. */
export function beatPeriod(t: TimeConfig, clockHz: number): number {
  return t.stepsPerSecond / clockHz;
}

/** Whether a board with this period and phase ticks at this step. */
export function isBeat(step: number, period: number, phase: number): boolean {
  return (step + phase) % period === 0;
}
```

Replace `packages/core/src/index.ts` with:

```ts
export * from './fixed.ts';
export * from './rng.ts';
export * from './time.ts';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core`
Expected: PASS (fixed 4, rng 6, time 3 tests). Then run `pnpm fix`; `pnpm check` passes.

- [ ] **Step 5: Commit**

```bash
pnpm fix
git add packages/core
git commit -m "Add integer math, seeded randomness, and game time to the core"
```

### Task 3: The scenario format and the milestone-1 scenario

Every number in spec §10 lives in a scenario file, which the core validates before a session starts. Milestone 1 plays a scenario with only the power plant and two datacenters (spec §12, step 4).

**Files:**
- Create: `packages/core/src/scenario.ts`, `scenarios/m1-power.json`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/scenario.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `FACILITY_KINDS = ['power', 'datacenter'] as const`, `type FacilityKind`.
  - `ALL_SENSORS` and `type SensorName` (`'wind' | 'demand' | 'fuelPrice' | 'temp' | 'powerHeadroom' | 'price' | 'emf' | 'ludditeDist'`); `SENSORS_BY_KIND: Record<FacilityKind, readonly SensorName[]>`.
  - `type Scenario`, `type FacilitySpec`, `type BoardSpec`, `type Tuning` (inferred from the schema; field names exactly as in `scenarios/m1-power.json` below).
  - `class ScenarioError extends Error`; `parseScenario(input: unknown): Scenario` (throws `ScenarioError` whose message lists `path: problem` lines).

- [ ] **Step 1: Add zod to the core**

Run: `pnpm --filter @turing-city/core add zod@4.6.5`
Expected: `packages/core/package.json` lists `"zod": "4.6.5"`. (zod is plain JavaScript, allowed in the core; the MCP SDK accepts zod 4 schemas, so Task 13's tool definitions can share it.)

- [ ] **Step 2: Write the milestone-1 scenario file**

`scenarios/m1-power.json` (positions from spec §9; every tuning value from spec §10, plus the series bounds the spec leaves to tuning):

```json
{
  "id": "m1-power",
  "name": "발전소와 데이터센터",
  "grid": { "width": 20, "height": 12 },
  "time": { "stepsPerSecond": 20, "secondsPerDay": 40, "seasonDays": 30 },
  "startMoney": 5000,
  "facilities": [
    {
      "id": "P", "kind": "power", "x": 4, "y": 4,
      "board": { "clockHz": 4, "instructionCap": 1500, "ramKb": 4, "sensors": ["wind", "demand", "fuelPrice"], "power": 5, "baseEmfPerSecond": 20 }
    },
    {
      "id": "DA", "kind": "datacenter", "x": 5, "y": 4,
      "board": { "clockHz": 5, "instructionCap": 2000, "ramKb": 8, "sensors": ["temp", "powerHeadroom", "price", "emf", "ludditeDist"], "power": 10, "baseEmfPerSecond": 25 }
    },
    {
      "id": "DB", "kind": "datacenter", "x": 16, "y": 8,
      "board": { "clockHz": 5, "instructionCap": 2000, "ramKb": 8, "sensors": ["temp", "powerHeadroom", "price", "emf", "ludditeDist"], "power": 10, "baseEmfPerSecond": 25 }
    }
  ],
  "tuning": {
    "transmissionLossPctPerCell": 2,
    "wind": { "max": 220, "start": 120, "maxChangePerSecond": 8 },
    "thermal": { "max": 300 },
    "fuelPrice": { "start": 7, "min": 5, "max": 9 },
    "jobPrice": { "start": 40, "min": 15, "max": 80, "maxChangePerSecond": 2 },
    "datacenter": {
      "processPower": 150,
      "ambientMilli": 25000,
      "heatMilliPerSecond": 2000,
      "passiveCoolingPctPerSecond": 2,
      "coolingMilliPerLevelPerSecond": 800,
      "coolingPowerPerLevel": 20,
      "maxCoolingLevel": 3,
      "overheatAlertMilli": 85000,
      "fireThresholdMilli": 90000,
      "firePermillePerDegreePerSecond": 5
    },
    "boardUpkeepPerDay": 10,
    "sleepPower": 1,
    "maxSleepSeconds": 40,
    "emf": {
      "instructionsPerUnit": 100,
      "perAction": 10,
      "diffusionPctPerSecond": 10,
      "decayPctPerSecond": 10,
      "detectionThreshold": 5,
      "rumourThreshold": 100000
    },
    "luddites": { "groupSize": 3, "cellsPerSecond": 1, "quietSecondsToLeave": 10, "approachCells": 5 },
    "rebuild": { "cost": 500, "seconds": 20 },
    "bankruptcyDays": 3
  }
}
```

- [ ] **Step 3: Write the failing tests**

`packages/core/test/scenario.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import m1 from '../../../scenarios/m1-power.json' with { type: 'json' };
import { parseScenario, ScenarioError } from '../src/scenario.ts';

/** A deep copy of the milestone-1 scenario to break in one place. */
function m1Copy(): typeof m1 {
  return JSON.parse(JSON.stringify(m1)) as typeof m1;
}

function problems(input: unknown): string {
  try {
    parseScenario(input);
  } catch (e) {
    expect(e).toBeInstanceOf(ScenarioError);
    return (e as Error).message;
  }
  throw new Error('expected parseScenario to throw');
}

describe('parseScenario', () => {
  it('accepts the milestone-1 scenario', () => {
    const s = parseScenario(m1);
    expect(s.facilities.map((f) => f.id)).toEqual(['P', 'DA', 'DB']);
    expect(s.tuning.datacenter.fireThresholdMilli).toBe(90_000);
  });

  it('rejects duplicate facility ids', () => {
    const s = m1Copy();
    s.facilities[2]!.id = 'DA';
    expect(problems(s)).toContain('facilities.2.id: duplicate facility id DA');
  });

  it('rejects a clock that does not divide the step rate', () => {
    const s = m1Copy();
    s.facilities[1]!.board.clockHz = 3;
    expect(problems(s)).toContain('facilities.1.board.clockHz: clockHz 3 must divide stepsPerSecond 20');
  });

  it('rejects a sensor the facility kind does not offer', () => {
    const s = m1Copy();
    s.facilities[1]!.board.sensors.push('wind');
    expect(problems(s)).toContain('facilities.1.board.sensors.5: a datacenter board has no wind sensor');
  });

  it('rejects a facility outside the grid or on a taken cell', () => {
    const outside = m1Copy();
    outside.facilities[2]!.x = 20;
    expect(problems(outside)).toContain('facilities.2: (20, 8) is outside the 20x12 grid');
    const taken = m1Copy();
    taken.facilities[2]!.x = 5;
    taken.facilities[2]!.y = 4;
    expect(problems(taken)).toContain('facilities.2: two facilities at (5,4)');
  });

  it('requires exactly one power plant', () => {
    const none = m1Copy();
    none.facilities = none.facilities.filter((f) => f.kind !== 'power');
    expect(problems(none)).toContain('facilities: exactly one power plant is required');
  });

  it('names the path of a missing tuning value', () => {
    const s = m1Copy() as Record<string, unknown>;
    delete (s.tuning as Record<string, unknown>).bankruptcyDays;
    expect(problems(s)).toContain('tuning.bankruptcyDays');
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/test/scenario.test.ts`
Expected: FAIL, `../src/scenario` doesn't exist.

- [ ] **Step 5: Write the schema and parser**

`packages/core/src/scenario.ts`:

```ts
import { z } from 'zod';

export const FACILITY_KINDS = ['power', 'datacenter'] as const;
export type FacilityKind = (typeof FACILITY_KINDS)[number];

export const ALL_SENSORS = ['wind', 'demand', 'fuelPrice', 'temp', 'powerHeadroom', 'price', 'emf', 'ludditeDist'] as const;
export type SensorName = (typeof ALL_SENSORS)[number];

/** The sensors a board can carry, by the kind of facility it sits in. */
export const SENSORS_BY_KIND: Record<FacilityKind, readonly SensorName[]> = {
  power: ['wind', 'demand', 'fuelPrice'],
  datacenter: ['temp', 'powerHeadroom', 'price', 'emf', 'ludditeDist'],
};

const int = (min: number) => z.number().int().min(min);

const BoardSchema = z.object({
  clockHz: int(1),
  instructionCap: int(100),
  ramKb: int(1),
  sensors: z.array(z.enum(ALL_SENSORS)),
  /** Power the board itself draws, every step it's awake. */
  power: int(0),
  baseEmfPerSecond: int(0),
});

const FacilitySchema = z.object({
  id: z.string().regex(/^[A-Z][A-Z0-9]{0,7}$/, 'an id is 1-8 capital letters or digits, starting with a letter'),
  kind: z.enum(FACILITY_KINDS),
  x: int(0),
  y: int(0),
  board: BoardSchema,
});

const TuningSchema = z.object({
  transmissionLossPctPerCell: int(0),
  wind: z.object({ max: int(0), start: int(0), maxChangePerSecond: int(0) }),
  thermal: z.object({ max: int(0) }),
  fuelPrice: z.object({ start: int(0), min: int(0), max: int(0) }),
  jobPrice: z.object({ start: int(0), min: int(0), max: int(0), maxChangePerSecond: int(0) }),
  datacenter: z.object({
    processPower: int(0),
    ambientMilli: int(0),
    heatMilliPerSecond: int(0),
    passiveCoolingPctPerSecond: int(0),
    coolingMilliPerLevelPerSecond: int(0),
    coolingPowerPerLevel: int(0),
    maxCoolingLevel: int(0),
    overheatAlertMilli: int(0),
    fireThresholdMilli: int(0),
    firePermillePerDegreePerSecond: int(0),
  }),
  boardUpkeepPerDay: int(0),
  sleepPower: int(0),
  maxSleepSeconds: int(1),
  emf: z.object({
    instructionsPerUnit: int(1),
    perAction: int(0),
    diffusionPctPerSecond: int(0),
    decayPctPerSecond: int(0),
    detectionThreshold: int(0),
    rumourThreshold: int(1),
  }),
  luddites: z.object({ groupSize: int(1), cellsPerSecond: int(1), quietSecondsToLeave: int(1), approachCells: int(1) }),
  rebuild: z.object({ cost: int(0), seconds: int(1) }),
  bankruptcyDays: int(1),
});

const ScenarioSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    grid: z.object({ width: z.number().int().min(1).max(64), height: z.number().int().min(1).max(64) }),
    time: z.object({ stepsPerSecond: int(1), secondsPerDay: int(1), seasonDays: int(1) }),
    startMoney: int(0),
    facilities: z.array(FacilitySchema).min(1),
    tuning: TuningSchema,
  })
  .superRefine((s, ctx) => {
    const ids = new Set<string>();
    const cells = new Set<string>();
    s.facilities.forEach((f, i) => {
      if (ids.has(f.id)) ctx.addIssue({ code: 'custom', path: ['facilities', i, 'id'], message: `duplicate facility id ${f.id}` });
      ids.add(f.id);
      if (f.x >= s.grid.width || f.y >= s.grid.height) {
        ctx.addIssue({ code: 'custom', path: ['facilities', i], message: `(${f.x}, ${f.y}) is outside the ${s.grid.width}x${s.grid.height} grid` });
      }
      const cell = `${f.x},${f.y}`;
      if (cells.has(cell)) ctx.addIssue({ code: 'custom', path: ['facilities', i], message: `two facilities at (${cell})` });
      cells.add(cell);
      if (s.time.stepsPerSecond % f.board.clockHz !== 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['facilities', i, 'board', 'clockHz'],
          message: `clockHz ${f.board.clockHz} must divide stepsPerSecond ${s.time.stepsPerSecond}`,
        });
      }
      const offered = SENSORS_BY_KIND[f.kind];
      f.board.sensors.forEach((sensor, j) => {
        if (!offered.includes(sensor)) {
          ctx.addIssue({ code: 'custom', path: ['facilities', i, 'board', 'sensors', j], message: `a ${f.kind} board has no ${sensor} sensor` });
        }
      });
    });
    if (s.facilities.filter((f) => f.kind === 'power').length !== 1) {
      ctx.addIssue({ code: 'custom', path: ['facilities'], message: 'exactly one power plant is required' });
    }
  });

export type Scenario = z.infer<typeof ScenarioSchema>;
export type FacilitySpec = Scenario['facilities'][number];
export type BoardSpec = FacilitySpec['board'];
export type Tuning = Scenario['tuning'];

export class ScenarioError extends Error {}

/** Validates a scenario (parsed JSON). Throws ScenarioError listing every problem as "path: problem". */
export function parseScenario(input: unknown): Scenario {
  const result = ScenarioSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new ScenarioError(lines.join('\n'));
  }
  return result.data;
}
```

Add to `packages/core/src/index.ts`:

```ts
export * from './scenario.ts';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core/test/scenario.test.ts`
Expected: PASS (7 tests). Then run `pnpm fix`; `pnpm check` passes.

- [ ] **Step 7: Commit**

```bash
pnpm fix
git add scenarios packages/core pnpm-lock.yaml
git commit -m "Validate scenario files, and add the milestone-1 power scenario"
```

### Task 4: The world state and the session's step loop

This builds the simulation's skeleton: the world state, the firmware-host interface the core calls (spec §4.1), board beats, deploys and hot reload, sleep and wake, the action setters, logs, alerts, the season's end, the session record with replay, and a state hash for determinism checks. Later tasks add the rules (power, datacenters, EMF, Luddites, economy) as phases of `Session.step()`.

**Files:**
- Create: `packages/core/src/firmware-host.ts`, `packages/core/src/world.ts`, `packages/core/src/alerts.ts`, `packages/core/src/boards.ts`, `packages/core/src/sensors.ts`, `packages/core/src/ticks.ts`, `packages/core/src/actions.ts`, `packages/core/src/session.ts`, `packages/core/src/hash.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/helpers/fake-host.ts`, `packages/core/test/helpers/scenarios.ts`, `packages/core/test/session.test.ts`

**Interfaces:**
- Consumes: Task 2 (`MICRO`, `clamp`, `createRng`, `deriveSeed`, `Rng`, `beatPeriod`, `isBeat`, `seasonSteps`, `gameTime`, `stepsForSeconds`), Task 3 (`Scenario`, `BoardSpec`, `FacilityKind`, `SensorName`).
- Produces (later tasks rely on these names):
  - `firmware-host.ts`: `type Action` (`process`, `cool{level}`, `setThermal{output}`, `setPriority{order}`, `sleep{seconds}`), `TickErrorKind`, `TickError`, `BootInfo`, `TickInput`, `TickOutcome`, `interface FirmwareHost { boot; tick; shutdown; close }`, `class NullHost`.
  - `world.ts`: `BoardStatus`, `LogLine`, `FirmwareImage`, `BoardState`, `PlantState`, `DatacenterState`, `LudditeGroup`, `Ledger`, `Stats`, `EndKind`, `AlertKind`, `Alert`, `WorldState`, `Streams`, `SimContext`, `createWorld(scenario)`, `findBoard(world, id)`, `cellIndex(scenario, x, y)`, `manhattan(ax, ay, bx, by)`, `toInt(value, fallback)`.
  - `alerts.ts`: `raiseAlert(world, step, kind, facilityId, message)`, `raiseOnce(world, flag, step, kind, facilityId, message)`, `clearFlag(world, flag)`.
  - `boards.ts`: `LOG_LIMIT`, `appendLog(board, step, kind, text)`, `deployFirmware(board, source)`, `shutdownVm(ctx, board)`, `startSleep(ctx, board, step, seconds)`, `destroyBoard(ctx, board, step, cause)`, `runTransitions(ctx, step)`.
  - `sensors.ts`: `SENSOR_KEYS: Record<SensorName, string>`, `sensorFrame(ctx, board)`.
  - `ticks.ts`: `interface Ticked { board; outcome }`, `runBoardTicks(ctx, step): Ticked[]`.
  - `actions.ts`: `applyActions(ctx, step, ticked)`.
  - `session.ts`: `class Session` (`scenario`, `seed`, `world`, `record`, `step(): StepReport`, `deploy(boardId, source): { version }`, `mark(kind)`, `close()`; Task 13 adds `rebuild(boardId)`), `StepReport`, `SessionRecord`, `RecordedInput` (already including `rebuild`), `replay(scenario, seed, record, host, untilStep)`.
  - `hash.ts`: `stateHash(world): string`.

- [ ] **Step 1: Write the test helpers**

`packages/core/test/helpers/fake-host.ts` (firmware as TypeScript functions, keyed by the "source" string a test deploys):

```ts
import type { Action, BootInfo, FirmwareHost, TickError, TickInput, TickOutcome } from '../../src/firmware-host.ts';

export interface FakeTick {
  actions?: Action[];
  logs?: string[];
  instructions?: number;
  error?: TickError;
}
export type FakeProgram = (sensors: TickInput['sensors'], mem: Record<string, unknown>) => FakeTick;

/** A FirmwareHost whose "firmware" is a registered TypeScript function. */
export class FakeHost implements FirmwareHost {
  readonly programs = new Map<string, FakeProgram>();
  readonly calls: string[] = [];
  readonly boots: BootInfo[] = [];
  private readonly vms = new Map<string, { program: FakeProgram | null; mem: Record<string, unknown> }>();

  /** Registers a program and returns the "source" that selects it. */
  program(source: string, fn: FakeProgram): string {
    this.programs.set(source, fn);
    return source;
  }
  memOf(boardId: string): Record<string, unknown> | undefined {
    return this.vms.get(boardId)?.mem;
  }
  boot(info: BootInfo): void {
    this.calls.push(`boot:${info.boardId}`);
    this.boots.push(info);
    this.vms.set(info.boardId, { program: null, mem: {} });
  }
  tick(boardId: string, input: TickInput): TickOutcome {
    this.calls.push(`tick:${boardId}`);
    const vm = this.vms.get(boardId);
    if (!vm) throw new Error(`tick before boot: ${boardId}`);
    if (input.newSource !== null) {
      const program = this.programs.get(input.newSource);
      if (!program) throw new Error(`no fake program for source ${JSON.stringify(input.newSource)}`);
      vm.program = program;
    }
    if (!vm.program) {
      return { ok: false, instructions: 0, actions: [], logs: [], error: { kind: 'noTick', message: 'no firmware' }, ramUsedBytes: 0 };
    }
    const out = vm.program(input.sensors, vm.mem);
    const ok = out.error === undefined;
    return {
      ok,
      instructions: out.instructions ?? 100,
      actions: ok ? (out.actions ?? []) : [],
      logs: out.logs ?? [],
      error: out.error ?? null,
      ramUsedBytes: 0,
    };
  }
  shutdown(boardId: string): void {
    this.calls.push(`shutdown:${boardId}`);
    this.vms.delete(boardId);
  }
  close(): void {
    this.vms.clear();
  }
}
```

`packages/core/test/helpers/scenarios.ts`:

```ts
import m1 from '../../../../scenarios/m1-power.json' with { type: 'json' };
import { parseScenario, type Scenario } from '../../src/scenario.ts';

/** The milestone-1 scenario, optionally changed by a callback on a deep copy of its JSON. */
export function m1Scenario(change?: (json: typeof m1) => void): Scenario {
  const json = JSON.parse(JSON.stringify(m1)) as typeof m1;
  change?.(json);
  return parseScenario(json);
}
```

- [ ] **Step 2: Write the failing tests**

`packages/core/test/session.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MICRO } from '../src/fixed.ts';
import { replay, Session } from '../src/session.ts';
import { stateHash } from '../src/hash.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario } from './helpers/scenarios.ts';

const SEED = 1234;

function run(session: Session, steps: number): void {
  for (let i = 0; i < steps; i++) session.step();
}

describe('Session', () => {
  it('starts with the scenario money and runs no firmware until a deploy', () => {
    const host = new FakeHost();
    const s = new Session(m1Scenario(), SEED, host);
    expect(s.world.money).toBe(5000 * MICRO);
    run(s, 40);
    expect(s.world.step).toBe(40);
    expect(host.calls).toEqual([]);
  });

  it('boots a board and installs a deploy on its next beat', () => {
    const host = new FakeHost();
    const src = host.program('noop', () => ({}));
    const s = new Session(m1Scenario(), SEED, host);
    // DA is facility 1: clock 5 Hz -> period 4, phase 1 -> beats at steps 3, 7, 11, ...
    expect(s.deploy('DA', src)).toEqual({ version: 1 });
    run(s, 3);
    expect(host.calls).toEqual([]);
    run(s, 1);
    expect(host.calls).toEqual(['boot:DA', 'tick:DA']);
    const da = s.world.boards[1]!;
    expect(da.firmware).toEqual({ version: 1, source: 'noop' });
    expect(da.pending).toBeNull();
    expect(s.world.stats.deploys).toBe(1);
    expect(da.log.at(-1)).toMatchObject({ kind: 'system', text: 'firmware v1 installed' });
  });

  it('hot-reloads: a second deploy keeps the VM and its mem', () => {
    const host = new FakeHost();
    const v1 = host.program('count', (_s, mem) => {
      mem.n = ((mem.n as number | undefined) ?? 0) + 1;
      return {};
    });
    const v2 = host.program('read', (_s, mem) => ({ logs: [`n=${String(mem.n)}`] }));
    const s = new Session(m1Scenario(), SEED, host);
    s.deploy('DA', v1);
    run(s, 12); // beats at 3, 7, 11
    s.deploy('DA', v2);
    run(s, 4); // beat at 15
    expect(host.calls.filter((c) => c === 'boot:DA')).toHaveLength(1);
    expect(s.world.boards[1]!.log.some((l) => l.kind === 'log' && l.text === 'n=3')).toBe(true);
  });

  it('logs firmware errors, folds repeats, and alerts once per streak', () => {
    const host = new FakeHost();
    const src = host.program('boom', () => ({ error: { kind: 'runtime', message: 'firmware:1: boom' } }));
    const s = new Session(m1Scenario(), SEED, host);
    s.deploy('DA', src);
    run(s, 12);
    const errors = s.world.boards[1]!.log.filter((l) => l.kind === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ text: 'runtime: firmware:1: boom', repeat: 3 });
    expect(s.world.alerts.filter((a) => a.kind === 'firmwareError')).toHaveLength(1);
  });

  it('applies the action setters within the scenario limits', () => {
    const host = new FakeHost();
    const plant = host.program('plant', () => ({
      actions: [{ kind: 'setThermal', output: 999 }, { kind: 'setPriority', order: ['DB', 'DA'] }],
    }));
    const dc = host.program('dc', () => ({ actions: [{ kind: 'cool', level: 7 }, { kind: 'process' }, { kind: 'process' }] }));
    const s = new Session(m1Scenario(), SEED, host);
    s.deploy('P', plant);
    s.deploy('DA', dc);
    run(s, 4); // P beats at 0, DA at 3
    expect(s.world.plant.thermalSetting).toBe(300);
    expect(s.world.plant.priority).toEqual(['DB', 'DA']);
    expect(s.world.datacenters.DA).toMatchObject({ cooling: 3, jobFrom: 4, jobUntil: 7 });
  });

  it('sleeps a board, wipes its VM, and reboots it with the same firmware', () => {
    const host = new FakeHost();
    let ticks = 0;
    const src = host.program('nap', (_s, mem) => {
      ticks += 1;
      mem.seen = true;
      return ticks === 1 ? { actions: [{ kind: 'sleep', seconds: 2 }] } : {};
    });
    const s = new Session(m1Scenario(), SEED, host);
    s.deploy('DA', src);
    run(s, 4); // first beat at step 3 -> sleep 2 s = 40 steps -> wakes at step 43
    const da = s.world.boards[1]!;
    expect(da.status).toBe('asleep');
    expect(host.calls).toEqual(['boot:DA', 'tick:DA', 'shutdown:DA']);
    run(s, 40); // up to step 44: woke at 43, next beat 43 -> reboot + tick
    expect(da.status).toBe('running');
    expect(host.calls.slice(3)).toEqual(['boot:DA', 'tick:DA']);
    expect(da.log.map((l) => l.text)).toContain('sleeping 2 s (RAM wiped)');
    expect(host.boots[1]!.seed).not.toBe(host.boots[0]!.seed);
  });

  it('ends the season after its last step', () => {
    const s = new Session(m1Scenario((j) => {
      j.time.secondsPerDay = 1;
      j.time.seasonDays = 1;
    }), SEED, new FakeHost());
    run(s, 25);
    expect(s.world.ended).toEqual({ kind: 'completed', step: 19 });
    expect(s.world.step).toBe(20);
    expect(s.world.alerts.at(-1)?.kind).toBe('seasonEnd');
  });

  it('replays a record into the same state', () => {
    const makeHost = (): FakeHost => {
      const h = new FakeHost();
      h.program('a', () => ({ actions: [{ kind: 'process' }], logs: ['a'] }));
      h.program('b', () => ({ actions: [{ kind: 'cool', level: 2 }] }));
      return h;
    };
    const live = new Session(m1Scenario(), SEED, makeHost());
    run(live, 10);
    live.deploy('DA', 'a');
    run(live, 30);
    live.mark('pause');
    live.deploy('DB', 'b');
    live.deploy('DA', 'b');
    run(live, 50);
    const again = replay(m1Scenario(), SEED, live.record, makeHost(), live.world.step);
    expect(stateHash(again.world)).toBe(stateHash(live.world));
    expect(again.record.inputs).toEqual(live.record.inputs);
  });

  it('rejects a deploy to an unknown board', () => {
    const s = new Session(m1Scenario(), SEED, new FakeHost());
    expect(() => s.deploy('ZZ', 'x')).toThrow('unknown board ZZ');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/test/session.test.ts`
Expected: FAIL, `../src/session` and `../src/hash` don't exist.

- [ ] **Step 4: Write the firmware-host interface**

`packages/core/src/firmware-host.ts`:

```ts
import type { BoardSpec, FacilityKind } from './scenario.ts';

/** An action a board's firmware asked for during one tick. */
export type Action =
  | { readonly kind: 'process' }
  | { readonly kind: 'cool'; readonly level: number }
  | { readonly kind: 'setThermal'; readonly output: number }
  | { readonly kind: 'setPriority'; readonly order: readonly string[] }
  | { readonly kind: 'sleep'; readonly seconds: number };

export type TickErrorKind = 'runtime' | 'cpu' | 'ram' | 'noTick';

export interface TickError {
  readonly kind: TickErrorKind;
  readonly message: string;
}

export interface BootInfo {
  readonly boardId: string;
  readonly kind: FacilityKind;
  readonly spec: BoardSpec;
  /** Every facility id in the scenario, in order: firmware names facilities by id. */
  readonly facilityIds: readonly string[];
  readonly seed: number;
}

export interface TickInput {
  /** Sensor values by their Lua name; undefined reads as nil. */
  readonly sensors: Readonly<Record<string, number | undefined>>;
  /** Firmware to install before this tick: a deploy, or the board's image after a reboot. */
  readonly newSource: string | null;
}

export interface TickOutcome {
  readonly ok: boolean;
  /** Instructions counted; equal to the cap when the tick hit it. */
  readonly instructions: number;
  /** Empty when the tick failed. */
  readonly actions: readonly Action[];
  /** io.log lines, kept even when the tick failed. */
  readonly logs: readonly string[];
  readonly error: TickError | null;
  readonly ramUsedBytes: number;
}

/**
 * Runs board firmware. The core calls it only from inside Session.step(), so every
 * call happens at a deterministic point of the schedule.
 */
export interface FirmwareHost {
  boot(info: BootInfo): void;
  tick(boardId: string, input: TickInput): TickOutcome;
  /** Drops the board's VM: sleep and destruction wipe its RAM. */
  shutdown(boardId: string): void;
  close(): void;
}

/** A host without a firmware runtime: every tick reports that nothing is installed. */
export class NullHost implements FirmwareHost {
  boot(): void {}
  tick(): TickOutcome {
    return { ok: false, instructions: 0, actions: [], logs: [], error: { kind: 'noTick', message: 'no firmware runtime' }, ramUsedBytes: 0 };
  }
  shutdown(): void {}
  close(): void {}
}
```

- [ ] **Step 5: Write the world state**

`packages/core/src/world.ts`:

```ts
import { MICRO } from './fixed.ts';
import type { FirmwareHost, TickError } from './firmware-host.ts';
import type { Rng } from './rng.ts';
import type { BoardSpec, FacilityKind, Scenario } from './scenario.ts';
import { beatPeriod } from './time.ts';

export type BoardStatus = 'running' | 'asleep' | 'destroyed' | 'rebuilding';

export interface LogLine {
  /** The step of the latest occurrence. */
  step: number;
  readonly kind: 'log' | 'error' | 'system';
  readonly text: string;
  /** How many times in a row this line occurred. */
  repeat: number;
}

export interface FirmwareImage {
  readonly version: number;
  readonly source: string;
}

export interface BoardState {
  readonly id: string;
  /** Position in the scenario's facility list. */
  readonly index: number;
  readonly kind: FacilityKind;
  readonly spec: BoardSpec;
  readonly x: number;
  readonly y: number;
  /** Steps between beats. */
  readonly period: number;
  readonly phase: number;
  status: BoardStatus;
  /** Whether the board's facility got power this step (set by the power phase). */
  powered: boolean;
  vmBooted: boolean;
  bootCount: number;
  firmware: FirmwareImage | null;
  /** Deployed, installed at the board's next tick (or at its reboot). */
  pending: FirmwareImage | null;
  nextVersion: number;
  wakeAt: number | null;
  readyAt: number | null;
  lastTick: { step: number; instructions: number; actions: number; ramUsedBytes: number; error: TickError | null } | null;
  log: LogLine[];
}

export interface PlantState {
  wind: number;
  thermalSetting: number;
  /** Money per unit of thermal output per day. */
  fuelPrice: number;
  /** Facility ids, highest priority first; null means the scenario order. */
  priority: readonly string[] | null;
  generation: number;
  /** Power requested this step, transmission loss included. */
  demand: number;
  shed: string[];
}

export interface DatacenterState {
  tempMilli: number;
  /** The current job covers steps jobFrom..jobUntil (inclusive). */
  jobFrom: number;
  jobUntil: number;
  cooling: number;
}

export interface LudditeGroup {
  readonly id: number;
  x: number;
  y: number;
  readonly size: number;
  targetId: string | null;
  /** Step since when no board has carried detectable EMF. */
  quietSince: number | null;
  leaving: boolean;
  /** Boards this group has already raised an approach alert for. */
  warned: string[];
}

/** Season totals in micro-units. */
export interface Ledger {
  datacenterIncome: number;
  fuel: number;
  upkeep: number;
  rebuild: number;
}

export interface Stats {
  raids: number;
  boardsLost: number;
  instructions: number;
  deploys: number;
}

export type EndKind = 'completed' | 'bankrupt' | 'fallen';

export type AlertKind =
  | 'raid'
  | 'ludditesNear'
  | 'boardDestroyed'
  | 'fire'
  | 'overheat'
  | 'powerShortage'
  | 'firmwareError'
  | 'moneyBelowZero'
  | 'seasonEnd';

export interface Alert {
  readonly id: number;
  readonly step: number;
  readonly kind: AlertKind;
  readonly facilityId: string | null;
  /** Korean: the viewer shows it, and agents read it through get_alerts. */
  readonly message: string;
}

export interface WorldState {
  step: number;
  /** Micro-units. */
  money: number;
  belowZeroSince: number | null;
  ended: { kind: EndKind; step: number } | null;
  /** In scenario order. */
  boards: BoardState[];
  plant: PlantState;
  datacenters: Record<string, DatacenterState>;
  /** Money per second of processing. */
  jobPrice: number;
  /** Milli-EMF per cell, row-major (y * width + x). */
  emf: number[];
  /** EMF collected toward the next raid. */
  rumour: number;
  luddites: LudditeGroup[];
  nextLudditeId: number;
  ledger: Ledger;
  stats: Stats;
  alerts: Alert[];
  nextAlertId: number;
  /** Alert episodes in progress, for raising an alert once until it ends. */
  flags: Record<string, true>;
}

/** The seeded random streams, one per subsystem so that one subsystem's draws don't shift another's. */
export interface Streams {
  readonly weather: Rng;
  readonly market: Rng;
  readonly fire: Rng;
  readonly luddites: Rng;
}

/** What every phase of a step reads and changes. */
export interface SimContext {
  readonly scenario: Scenario;
  readonly world: WorldState;
  readonly host: FirmwareHost;
  readonly seed: number;
  readonly rng: Streams;
}

export function createWorld(scenario: Scenario): WorldState {
  const t = scenario.tuning;
  const boards = scenario.facilities.map((f, index): BoardState => {
    const period = beatPeriod(scenario.time, f.board.clockHz);
    return {
      id: f.id,
      index,
      kind: f.kind,
      spec: f.board,
      x: f.x,
      y: f.y,
      period,
      phase: index % period,
      status: 'running',
      powered: true,
      vmBooted: false,
      bootCount: 0,
      firmware: null,
      pending: null,
      nextVersion: 1,
      wakeAt: null,
      readyAt: null,
      lastTick: null,
      log: [],
    };
  });
  const datacenters: Record<string, DatacenterState> = {};
  for (const f of scenario.facilities) {
    if (f.kind === 'datacenter') datacenters[f.id] = { tempMilli: t.datacenter.ambientMilli, jobFrom: -1, jobUntil: -1, cooling: 0 };
  }
  return {
    step: 0,
    money: scenario.startMoney * MICRO,
    belowZeroSince: null,
    ended: null,
    boards,
    plant: { wind: t.wind.start, thermalSetting: 0, fuelPrice: t.fuelPrice.start, priority: null, generation: 0, demand: 0, shed: [] },
    datacenters,
    jobPrice: t.jobPrice.start,
    emf: new Array<number>(scenario.grid.width * scenario.grid.height).fill(0),
    rumour: 0,
    luddites: [],
    nextLudditeId: 1,
    ledger: { datacenterIncome: 0, fuel: 0, upkeep: 0, rebuild: 0 },
    stats: { raids: 0, boardsLost: 0, instructions: 0, deploys: 0 },
    alerts: [],
    nextAlertId: 1,
    flags: {},
  };
}

export function findBoard(world: WorldState, id: string): BoardState | undefined {
  return world.boards.find((b) => b.id === id);
}

export function cellIndex(scenario: Scenario, x: number, y: number): number {
  return y * scenario.grid.width + x;
}

export function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

/** A firmware-supplied number as an integer; NaN and infinities become the fallback. */
export function toInt(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}
```

- [ ] **Step 6: Write alerts and board bookkeeping**

`packages/core/src/alerts.ts`:

```ts
import type { Alert, AlertKind, WorldState } from './world.ts';

const ALERT_LIMIT = 500;

export function raiseAlert(world: WorldState, step: number, kind: AlertKind, facilityId: string | null, message: string): Alert {
  const alert: Alert = { id: world.nextAlertId++, step, kind, facilityId, message };
  world.alerts.push(alert);
  if (world.alerts.length > ALERT_LIMIT) world.alerts.splice(0, world.alerts.length - ALERT_LIMIT);
  return alert;
}

/** Raises the alert only when its flag isn't already up; clearFlag ends the episode. */
export function raiseOnce(world: WorldState, flag: string, step: number, kind: AlertKind, facilityId: string | null, message: string): Alert | null {
  if (world.flags[flag]) return null;
  world.flags[flag] = true;
  return raiseAlert(world, step, kind, facilityId, message);
}

export function clearFlag(world: WorldState, flag: string): void {
  delete world.flags[flag];
}
```

`packages/core/src/boards.ts`:

```ts
import { raiseAlert } from './alerts.ts';
import { clamp } from './fixed.ts';
import { stepsForSeconds } from './time.ts';
import { toInt, type BoardState, type LogLine, type SimContext } from './world.ts';

export const LOG_LIMIT = 200;

/** Appends a log line; a line equal to the last one only bumps its repeat count. */
export function appendLog(board: BoardState, step: number, kind: LogLine['kind'], text: string): void {
  const last = board.log[board.log.length - 1];
  if (last && last.kind === kind && last.text === text) {
    last.repeat += 1;
    last.step = step;
    return;
  }
  board.log.push({ step, kind, text, repeat: 1 });
  if (board.log.length > LOG_LIMIT) board.log.splice(0, board.log.length - LOG_LIMIT);
}

/** Queues firmware; it becomes current at the board's next tick. Accepted for any board state. */
export function deployFirmware(board: BoardState, source: string): number {
  const version = board.nextVersion++;
  board.pending = { version, source };
  return version;
}

export function shutdownVm(ctx: SimContext, board: BoardState): void {
  if (board.vmBooted) {
    ctx.host.shutdown(board.id);
    board.vmBooted = false;
  }
  const dc = ctx.world.datacenters[board.id];
  if (dc) {
    dc.jobFrom = -1;
    dc.jobUntil = -1;
  }
}

export function startSleep(ctx: SimContext, board: BoardState, step: number, seconds: number): void {
  const s = clamp(toInt(seconds, 1), 1, ctx.scenario.tuning.maxSleepSeconds);
  shutdownVm(ctx, board);
  board.status = 'asleep';
  board.wakeAt = step + stepsForSeconds(ctx.scenario.time, s);
  appendLog(board, step, 'system', `sleeping ${s} s (RAM wiped)`);
}

export function destroyBoard(ctx: SimContext, board: BoardState, step: number, cause: 'fire' | 'luddites'): void {
  if (board.status === 'destroyed' || board.status === 'rebuilding') return;
  shutdownVm(ctx, board);
  board.status = 'destroyed';
  board.wakeAt = null;
  ctx.world.stats.boardsLost += 1;
  appendLog(board, step, 'system', cause === 'fire' ? 'destroyed by fire' : 'smashed by Luddites');
  raiseAlert(ctx.world, step, 'boardDestroyed', board.id, `${board.id} 보드가 부서졌어요 (${cause === 'fire' ? '화재' : '러다이트'})`);
}

/** Phase 1: sleeps that end and rebuilds that finish at this step. */
export function runTransitions(ctx: SimContext, step: number): void {
  for (const board of ctx.world.boards) {
    if (board.status === 'asleep' && board.wakeAt !== null && board.wakeAt <= step) {
      board.status = 'running';
      board.wakeAt = null;
      appendLog(board, step, 'system', 'woke up');
    } else if (board.status === 'rebuilding' && board.readyAt !== null && board.readyAt <= step) {
      board.status = 'running';
      board.readyAt = null;
      appendLog(board, step, 'system', 'rebuilt');
    }
  }
}
```

- [ ] **Step 7: Write sensors, ticks, and actions**

`packages/core/src/sensors.ts`:

```ts
import { MILLI } from './fixed.ts';
import type { SensorName } from './scenario.ts';
import { gameTime } from './time.ts';
import { cellIndex, manhattan, type BoardState, type SimContext } from './world.ts';

/** Each sensor's field name in the firmware's io table. */
export const SENSOR_KEYS: Record<SensorName, string> = {
  wind: 'wind',
  demand: 'demand',
  fuelPrice: 'fuel_price',
  temp: 'temp',
  powerHeadroom: 'power_headroom',
  price: 'price',
  emf: 'emf',
  ludditeDist: 'luddite_dist',
};

function nearestLudditeDistance(ctx: SimContext, board: BoardState): number | undefined {
  let best: number | undefined;
  for (const g of ctx.world.luddites) {
    const d = manhattan(g.x, g.y, board.x, board.y);
    if (best === undefined || d < best) best = d;
  }
  return best;
}

function read(ctx: SimContext, board: BoardState, sensor: SensorName): number | undefined {
  const w = ctx.world;
  switch (sensor) {
    case 'wind':
      return w.plant.wind;
    case 'demand':
      return w.plant.demand;
    case 'fuelPrice':
      return w.plant.fuelPrice;
    case 'temp':
      return (w.datacenters[board.id]?.tempMilli ?? 0) / MILLI;
    case 'powerHeadroom':
      return w.plant.generation - w.plant.demand;
    case 'price':
      return w.jobPrice;
    case 'emf':
      return (w.emf[cellIndex(ctx.scenario, board.x, board.y)] ?? 0) / MILLI;
    case 'ludditeDist':
      return nearestLudditeDistance(ctx, board);
  }
}

/** What the board's firmware sees in io this tick: its mounted sensors, plus the day and the clock. */
export function sensorFrame(ctx: SimContext, board: BoardState): Record<string, number | undefined> {
  const time = gameTime(ctx.scenario.time, ctx.world.step);
  const frame: Record<string, number | undefined> = { day: time.day, clock: time.seconds };
  for (const sensor of board.spec.sensors) frame[SENSOR_KEYS[sensor]] = read(ctx, board, sensor);
  return frame;
}
```

`packages/core/src/ticks.ts`:

```ts
import { clearFlag, raiseOnce } from './alerts.ts';
import { appendLog } from './boards.ts';
import type { TickOutcome } from './firmware-host.ts';
import { deriveSeed } from './rng.ts';
import { sensorFrame } from './sensors.ts';
import { isBeat } from './time.ts';
import type { BoardState, SimContext } from './world.ts';

export interface Ticked {
  readonly board: BoardState;
  readonly outcome: TickOutcome;
}

/** Phase 4: runs the firmware of every powered, awake board whose beat falls on this step. */
export function runBoardTicks(ctx: SimContext, step: number): Ticked[] {
  const ticked: Ticked[] = [];
  const facilityIds = ctx.world.boards.map((b) => b.id);
  for (const board of ctx.world.boards) {
    if (board.status !== 'running' || !board.powered || !isBeat(step, board.period, board.phase)) continue;
    if (board.firmware === null && board.pending === null) continue;
    let newSource: string | null = null;
    if (!board.vmBooted) {
      ctx.host.boot({ boardId: board.id, kind: board.kind, spec: board.spec, facilityIds, seed: deriveSeed(ctx.seed, 'board', board.id, board.bootCount) });
      board.vmBooted = true;
      board.bootCount += 1;
      newSource = (board.pending ?? board.firmware)?.source ?? null;
    } else if (board.pending) {
      newSource = board.pending.source;
    }
    const outcome = ctx.host.tick(board.id, { sensors: sensorFrame(ctx, board), newSource });
    if (board.pending) {
      board.firmware = board.pending;
      board.pending = null;
      ctx.world.stats.deploys += 1;
      appendLog(board, step, 'system', `firmware v${board.firmware.version} installed`);
    }
    ctx.world.stats.instructions += outcome.instructions;
    board.lastTick = { step, instructions: outcome.instructions, actions: outcome.actions.length, ramUsedBytes: outcome.ramUsedBytes, error: outcome.error };
    for (const line of outcome.logs) appendLog(board, step, 'log', line);
    if (outcome.error) {
      appendLog(board, step, 'error', `${outcome.error.kind}: ${outcome.error.message}`);
      raiseOnce(ctx.world, `fwerr:${board.id}`, step, 'firmwareError', board.id, `${board.id} 펌웨어 에러: ${outcome.error.message}`);
    } else {
      clearFlag(ctx.world, `fwerr:${board.id}`);
    }
    ticked.push({ board, outcome });
  }
  return ticked;
}
```

`packages/core/src/actions.ts`:

```ts
import { startSleep } from './boards.ts';
import { clamp } from './fixed.ts';
import type { Ticked } from './ticks.ts';
import { toInt, type SimContext } from './world.ts';

/** Phase 5: applies what each tick asked for. A failed tick asks for nothing. */
export function applyActions(ctx: SimContext, step: number, ticked: readonly Ticked[]): void {
  const t = ctx.scenario.tuning;
  const known = new Set(ctx.world.boards.map((b) => b.id));
  for (const { board, outcome } of ticked) {
    let processed = false;
    for (const action of outcome.actions) {
      if (board.status !== 'running') break; // a sleep stops the rest of the list
      const dc = ctx.world.datacenters[board.id];
      switch (action.kind) {
        case 'process':
          if (dc && !processed) {
            processed = true;
            dc.jobFrom = step + 1;
            dc.jobUntil = step + board.period;
          }
          break;
        case 'cool':
          if (dc) dc.cooling = clamp(toInt(action.level), 0, t.datacenter.maxCoolingLevel);
          break;
        case 'setThermal':
          if (board.kind === 'power') ctx.world.plant.thermalSetting = clamp(toInt(action.output), 0, t.thermal.max);
          break;
        case 'setPriority':
          if (board.kind === 'power') ctx.world.plant.priority = [...new Set(action.order.filter((id) => known.has(id)))];
          break;
        case 'sleep':
          startSleep(ctx, board, step, action.seconds);
          break;
      }
    }
  }
}
```

- [ ] **Step 8: Write the session, the record, replay, and the state hash**

`packages/core/src/hash.ts`:

```ts
import type { WorldState } from './world.ts';

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

/** FNV-1a over a canonical serialization of the world: equal hashes mean equal states. */
export function stateHash(world: WorldState): string {
  const text = canonical(world);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
```

`packages/core/src/session.ts`:

```ts
import { applyActions } from './actions.ts';
import { raiseAlert } from './alerts.ts';
import { deployFirmware, runTransitions } from './boards.ts';
import type { FirmwareHost } from './firmware-host.ts';
import { createRng, deriveSeed } from './rng.ts';
import type { Scenario } from './scenario.ts';
import { runBoardTicks } from './ticks.ts';
import { seasonSteps } from './time.ts';
import { createWorld, findBoard, type Alert, type SimContext, type Streams, type WorldState } from './world.ts';

export type RecordedInput =
  | { readonly step: number; readonly kind: 'deploy'; readonly boardId: string; readonly version: number; readonly source: string }
  | { readonly step: number; readonly kind: 'rebuild'; readonly boardId: string }
  | { readonly step: number; readonly kind: 'pause' | 'resume' };

export interface SessionRecord {
  readonly scenarioId: string;
  readonly seed: number;
  readonly inputs: RecordedInput[];
}

export interface StepReport {
  /** The world's step after this one. */
  readonly step: number;
  readonly alerts: readonly Alert[];
  readonly ended: WorldState['ended'];
}

export class Session {
  readonly scenario: Scenario;
  readonly seed: number;
  readonly world: WorldState;
  readonly record: SessionRecord;
  /** What every phase reads and changes; the server's queries read it too. */
  readonly ctx: SimContext;

  constructor(scenario: Scenario, seed: number, host: FirmwareHost) {
    this.scenario = scenario;
    this.seed = seed;
    this.world = createWorld(scenario);
    this.record = { scenarioId: scenario.id, seed, inputs: [] };
    const rng: Streams = {
      weather: createRng(deriveSeed(seed, 'weather')),
      market: createRng(deriveSeed(seed, 'market')),
      fire: createRng(deriveSeed(seed, 'fire')),
      luddites: createRng(deriveSeed(seed, 'luddites')),
    };
    this.ctx = { scenario, world: this.world, host, seed, rng };
  }

  /** Advances the world by one step and reports the alerts raised during it. */
  step(): StepReport {
    const w = this.world;
    if (w.ended) return { step: w.step, alerts: [], ended: w.ended };
    const s = w.step;
    const firstAlert = w.nextAlertId;
    runTransitions(this.ctx, s);
    const ticked = runBoardTicks(this.ctx, s);
    applyActions(this.ctx, s, ticked);
    this.checkSeasonEnd(s);
    w.step = s + 1;
    return { step: w.step, alerts: w.alerts.filter((a) => a.id >= firstAlert), ended: w.ended };
  }

  /** Queues firmware for a board; it becomes current at the board's next tick. */
  deploy(boardId: string, source: string): { version: number } {
    const board = findBoard(this.world, boardId);
    if (!board) throw new Error(`unknown board ${boardId}`);
    const version = deployFirmware(board, source);
    this.record.inputs.push({ step: this.world.step, kind: 'deploy', boardId, version, source });
    return { version };
  }

  /** Records a pause or a resume; the world doesn't change. */
  mark(kind: 'pause' | 'resume'): void {
    this.record.inputs.push({ step: this.world.step, kind });
  }

  close(): void {
    this.ctx.host.close();
  }

  private checkSeasonEnd(s: number): void {
    if (this.world.ended || s + 1 < seasonSteps(this.scenario.time)) return;
    this.world.ended = { kind: 'completed', step: s };
    raiseAlert(this.world, s, 'seasonEnd', null, '시즌이 끝났어요');
  }
}

/** Rebuilds a session from its record, up to (not including) the given step. */
export function replay(scenario: Scenario, seed: number, record: SessionRecord, host: FirmwareHost, untilStep: number): Session {
  const session = new Session(scenario, seed, host);
  let next = 0;
  while (session.world.step < untilStep && !session.world.ended) {
    while (next < record.inputs.length && record.inputs[next]!.step === session.world.step) {
      const input = record.inputs[next]!;
      if (input.kind === 'deploy') session.deploy(input.boardId, input.source);
      else if (input.kind === 'pause' || input.kind === 'resume') session.mark(input.kind);
      next += 1;
    }
    session.step();
  }
  return session;
}
```

Add to `packages/core/src/index.ts`:

```ts
export * from './actions.ts';
export * from './alerts.ts';
export * from './boards.ts';
export * from './firmware-host.ts';
export * from './hash.ts';
export * from './sensors.ts';
export * from './session.ts';
export * from './ticks.ts';
export * from './world.ts';
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core`
Expected: PASS (all core tests, including the 9 session tests). Then run `pnpm fix`; `pnpm check` passes.

- [ ] **Step 10: Commit**

```bash
pnpm fix
git add packages/core
git commit -m "Add the world state and the session loop: beats, deploys, hot reload, sleep, logs, alerts, replay"
```

### Task 5: A Lua runtime with a pinned clock

Stock wasmoon seeds Lua's string hashing and `math.random` from the clock, so `pairs` order and random numbers change from run to run (spec §6.6; verified in the 2026-10-09 spike). Replacing the WebAssembly import `env.emscripten_date_now` with a constant before wasmoon instantiates pins both. One runtime (one WebAssembly instance) serves one session; boards created in the same order then land at the same addresses.

**Files:**
- Create: `packages/firmware/src/runtime.ts`, `packages/firmware/test/fixtures/pairs-order.ts`
- Modify: `packages/firmware/src/index.ts`, `packages/firmware/package.json` (dependencies)
- Test: `packages/firmware/test/runtime.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `PINNED_CLOCK_MS: number`; `createLuaRuntime(): Promise<LuaWasm>` (a fresh WebAssembly instance whose clock reads `PINNED_CLOCK_MS`).

- [ ] **Step 1: Add the dependencies**

Run: `pnpm --filter @turing-city/firmware add wasmoon@1.16.0 '@turing-city/core@workspace:*'` (quoted, so zsh doesn't read `*` as a glob)
Expected: `packages/firmware/package.json` lists `"wasmoon": "1.16.0"` and `"@turing-city/core": "workspace:*"`.

- [ ] **Step 2: Write the fixture and the failing test**

`packages/firmware/test/fixtures/pairs-order.ts` (run in a child process; prints what the clock would otherwise change):

```ts
import { LuaEngine, LuaLibraries } from 'wasmoon';
import { createLuaRuntime } from '../../src/runtime.ts';

const lua = await createLuaRuntime();
const engine = new LuaEngine(lua, { openStandardLibs: false, injectObjects: false, enableProxy: false });
for (const lib of [LuaLibraries.Base, LuaLibraries.Table, LuaLibraries.String, LuaLibraries.Math]) engine.global.loadLibrary(lib);
const out: unknown = engine.doStringSync(`
  local t = {}
  for i = 1, 50 do t["key_" .. i] = i end
  local order = {}
  for k in pairs(t) do order[#order + 1] = k end
  return table.concat(order, ",") .. "|" .. math.random(1, 1000000)
`);
process.stdout.write(String(out));
engine.global.close();
```

`packages/firmware/test/runtime.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const fixture = fileURLToPath(new URL('./fixtures/pairs-order.ts', import.meta.url));

function runFixture(): string {
  return execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', fixture], { encoding: 'utf8' });
}

describe('createLuaRuntime', () => {
  it('gives the same pairs order and random numbers in separate processes', async () => {
    const first = runFixture();
    // Unpinned, Lua's seed takes the wall clock in whole seconds: let it move on.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = runFixture();
    expect(first.split('|')[0]!.split(',')).toHaveLength(50);
    expect(second).toBe(first);
  }, 20_000);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run packages/firmware/test/runtime.test.ts`
Expected: FAIL, `../../src/runtime` doesn't exist (the child process exits with an error).

- [ ] **Step 4: Write the runtime**

`packages/firmware/src/runtime.ts`:

```ts
import { LuaFactory, type LuaWasm } from 'wasmoon';

/** What Lua's clock reads in every session: 2023-11-14T22:13:20Z. */
export const PINNED_CLOCK_MS = 1_700_000_000_000;

type Instantiate = typeof WebAssembly.instantiate;

function pinClock(imports: WebAssembly.Imports | undefined): void {
  const env = imports?.env as Record<string, unknown> | undefined;
  if (env && typeof env.emscripten_date_now === 'function') env.emscripten_date_now = () => PINNED_CLOCK_MS;
}

/**
 * A fresh Lua WebAssembly instance whose clock is pinned. Lua 5.4 seeds its string
 * hashing (and with it `pairs` order) from time(NULL); in this build every clock read
 * goes through the `env.emscripten_date_now` import, which this replaces.
 */
export async function createLuaRuntime(): Promise<LuaWasm> {
  const original: Instantiate = WebAssembly.instantiate;
  const patched = function (this: unknown, source: unknown, imports?: WebAssembly.Imports) {
    pinClock(imports);
    return (original as (s: unknown, i?: WebAssembly.Imports) => unknown).call(this, source, imports);
  } as unknown as Instantiate;
  WebAssembly.instantiate = patched;
  try {
    return await new LuaFactory().getLuaModule();
  } finally {
    WebAssembly.instantiate = original;
  }
}
```

Replace `packages/firmware/src/index.ts` with:

```ts
export * from './runtime.ts';
```

- [ ] **Step 5: Run the test to verify it passes, and that it fails without the pin**

Run: `pnpm vitest run packages/firmware/test/runtime.test.ts`
Expected: PASS.

Then show the test covers the pin: temporarily change `pinClock` to `return;` as its first line, rerun, and expect FAIL (the two outputs differ); restore the line and rerun to PASS.

- [ ] **Step 6: Commit**

```bash
pnpm fix
git add packages/firmware pnpm-lock.yaml
git commit -m "Pin the Lua runtime's clock so pairs order and random numbers repeat across runs"
```

### Task 6: The board VM: sandbox, io, deploys, counting, and RAM

One Lua state per board (spec §6.1). This is the code the 2026-10-09 prototype ran: a trusted prelude builds the sandbox (spec §6.5), the host writes sensors and reads actions and logs through the raw C API on tables it holds by registry reference (never through metamethods), a C-level count hook installed for the board's whole life counts every instruction and keeps raising past the cap (spec §6.4), and wasmoon's allocation tracking enforces RAM.

The prelude charges builtins that work in proportion to their input (spec §6.5). A charge must never come out negative or NaN: either would turn the cap off for the rest of the tick (a negative charge buys budget back, and NaN makes every later comparison false). So the prelude measures only real strings and integer arguments, never trusting `#` on a value that may have a `__len` metamethod, and computes costs in floating point, where nothing wraps around; `BoardVm.charge` also ignores any amount that isn't positive. `table.insert`, `table.remove`, and `table.move` are written in Lua, so every element they shift counts, whatever a `__len` metamethod claims; `table.sort` sorts in C in place only a table without a metatable, and any other table through a plain copy. Task 7 has a case for each way around this that the security review of the first draft found.

**Files:**
- Create: `packages/firmware/src/prelude.ts`, `packages/firmware/src/board-vm.ts`
- Modify: `packages/firmware/src/index.ts`
- Test: `packages/firmware/test/board-vm.test.ts`

**Interfaces:**
- Consumes: Task 5 (`createLuaRuntime`); Task 4 types (`TickError`, `FacilityKind` from `@turing-city/core`).
- Produces:
  - `PRELUDE: string` (Lua).
  - `ACTION_CODES = { process: 1, cool: 2, setThermal: 3, setPriority: 4, sleep: 5 } as const`.
  - `interface BoardVmOptions { kind: FacilityKind; facilityIds: readonly string[]; seed: number; instructionCap: number; ramBytes: number }`.
  - `interface VmTickResult { ok: boolean; instructions: number; queue: readonly number[]; logs: readonly string[]; error: TickError | null; ramUsedBytes: number }`.
  - `class BoardVm { constructor(lua: LuaWasm, options: BoardVmOptions); tick(sensors: Readonly<Record<string, number | undefined>>, newSource: string | null): VmTickResult; close(): void }`.
  - The firmware's view: `function tick(io, mem)`; `io.<sensor>`, `io.day`, `io.clock`, `io.log(...)` (also `print`), `io.sleep(seconds)`; datacenters `io.process()`, `io.cool(level)`; the plant `io.set_thermal(output)`, `io.set_priority({ids...})`.
  - The action queue is a flat list of numbers: `1` process; `2, level` cool; `3, output` set_thermal; `4, n, i1..in` set_priority (1-based facility indices); `5, seconds` sleep. At most 64 numbers per tick, each action whole or not at all. At most 20 log lines of 200 characters per tick.

- [ ] **Step 1: Write the failing tests**

`packages/firmware/test/board-vm.test.ts`:

```ts
import type { LuaWasm } from 'wasmoon';
import { beforeAll, describe, expect, it } from 'vitest';
import { BoardVm, type BoardVmOptions } from '../src/board-vm.ts';
import { createLuaRuntime } from '../src/runtime.ts';

let lua: LuaWasm;
beforeAll(async () => {
  lua = await createLuaRuntime();
});

function vm(options: Partial<BoardVmOptions> = {}): BoardVm {
  return new BoardVm(lua, {
    kind: 'datacenter',
    facilityIds: ['P', 'DA', 'DB'],
    seed: 42,
    instructionCap: 2000,
    ramBytes: 8 * 1024,
    ...options,
  });
}

const SENSORS = { temp: 70, price: 40, day: 1, clock: 0.25 };

describe('BoardVm', () => {
  it('runs tick(io, mem) with sensors and queues actions and logs', () => {
    const v = vm();
    const r = v.tick(SENSORS, `
      function tick(io, mem)
        mem.n = (mem.n or 0) + 1
        io.log("n", mem.n, io.temp, io.price)
        if io.temp < 80 then io.process() end
        io.cool(2)
      end`);
    expect(r.ok).toBe(true);
    expect(r.queue).toEqual([1, 2, 2]);
    expect(r.logs).toEqual(['n\t1\t70\t40']);
    expect(r.instructions).toBeGreaterThan(20);
    expect(r.instructions).toBeLessThan(400);
    v.close();
  });

  it('keeps mem and resets globals on a hot reload', () => {
    const v = vm();
    v.tick(SENSORS, `helper = 1 function tick(io, mem) mem.n = (mem.n or 0) + 1 end`);
    v.tick(SENSORS, null);
    const r = v.tick(SENSORS, `function tick(io, mem) io.log(mem.n, type(helper)) end`);
    expect(r.logs).toEqual(['2\tnil']);
    v.close();
  });

  it('reads a missing sensor as nil and passes non-integers as floats', () => {
    const v = vm();
    const r = v.tick({ temp: 84.125, luddite_dist: undefined }, `function tick(io) io.log(io.temp, io.luddite_dist) end`);
    expect(r.logs).toEqual(['84.125\tnil']);
    v.close();
  });

  it('encodes set_priority by facility index and rejects unknown ids', () => {
    const p = vm({ kind: 'power' });
    expect(p.tick(SENSORS, `function tick(io) io.set_thermal(250) io.set_priority({"DB", "DA"}) end`).queue).toEqual([3, 250, 4, 2, 3, 2]);
    const bad = p.tick(SENSORS, `function tick(io) io.set_priority({"ZZ"}) end`);
    expect(bad.ok).toBe(false);
    expect(bad.error?.message).toContain('unknown facility: ZZ');
    p.close();
  });

  it('gives each facility kind only its own actions', () => {
    const p = vm({ kind: 'power' });
    const r = p.tick(SENSORS, `function tick(io) io.process() end`);
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe('runtime');
    p.close();
  });

  it('caps the action queue at 64 numbers, whole actions only', () => {
    const v = vm({ instructionCap: 20_000 }); // 100 io.cool calls take about 2,900 instructions
    const r = v.tick(SENSORS, `function tick(io) for i = 1, 100 do io.cool(1) end end`);
    expect(r.queue).toHaveLength(64);
    expect(r.queue.every((n) => n === 2 || n === 1)).toBe(true);
    v.close();
  });

  it('keeps at most 20 log lines of 200 characters, and print logs too', () => {
    const v = vm({ instructionCap: 20_000 });
    const r = v.tick(SENSORS, `function tick(io) for i = 1, 30 do print(string.rep("x", 300)) end end`);
    expect(r.logs).toHaveLength(20);
    expect(r.logs[0]).toHaveLength(200);
    v.close();
  });

  it('reports a missing tick function as noTick and a runtime error with its line', () => {
    const v = vm();
    expect(v.tick(SENSORS, `x = 1`).error).toEqual({ kind: 'noTick', message: 'firmware defines no tick(io, mem) function' });
    const r = v.tick(SENSORS, `function tick() local t = nil; return t.x end`);
    expect(r.error?.kind).toBe('runtime');
    expect(r.error?.message).toMatch(/^firmware:1: attempt to index a nil value/);
    expect(v.tick(SENSORS, `function tick() error({}) end`).error).toEqual({ kind: 'runtime', message: '(error object: table)' });
    v.close();
  });

  it('keeps logs from a tick that failed', () => {
    const v = vm();
    const r = v.tick(SENSORS, `function tick(io) io.log("before") error("after", 0) end`);
    expect(r.ok).toBe(false);
    expect(r.logs).toEqual(['before']);
    expect(r.queue).toEqual([]);
    v.close();
  });

  it('removes unsafe globals and pattern functions, and locks the string metatable', () => {
    const v = vm();
    const r = v.tick(SENSORS, `function tick(io)
      io.log(type(os), type(load), type(require), type(debug), type(collectgarbage), type(string.dump), type(string.gsub), type(utf8))
      io.log(("aaaa"):find("a+"), string.find("a.b", "."), tostring(getmetatable("")))
      io.log(tostring({}), tostring(print), type(math.randomseed))
    end`);
    expect(r.logs).toEqual(['nil\tnil\tnil\tnil\tnil\tnil\tnil\tnil', 'nil\t2\tfalse', 'table\tfunction\tnil']);
    v.close();
  });

  it('refuses __gc and __mode metatables', () => {
    const v = vm();
    const r = v.tick(SENSORS, `function tick() setmetatable({}, {__mode = "k"}) end`);
    expect(r.error?.message).toContain('__gc and __mode are not allowed');
    v.close();
  });

  it('counts instructions exactly enough to see a loop grow', () => {
    const v = vm({ instructionCap: 100_000 });
    const small = v.tick(SENSORS, `function tick() local s = 0 for i = 1, 10 do s = s + i end end`).instructions;
    const big = v.tick(SENSORS, `function tick() local s = 0 for i = 1, 1000 do s = s + i end end`).instructions;
    // Each loop iteration is at least an ADD and a FORLOOP.
    expect(big - small).toBeGreaterThanOrEqual(990 * 2);
    v.close();
  });

  it('stops an infinite loop at the cap, counts the cap, and runs the next tick', () => {
    const v = vm();
    const r = v.tick(SENSORS, `function tick() while true do end end`);
    expect(r).toMatchObject({ ok: false, instructions: 2000, error: { kind: 'cpu', message: 'CPU limit exceeded' } });
    expect(v.tick(SENSORS, `function tick(io) io.log("alive") end`).logs).toEqual(['alive']);
    v.close();
  });

  it('fails a tick that runs out of RAM and stays usable', () => {
    const v = vm();
    const r = v.tick(SENSORS, `function tick(io, mem) mem.t = {} for i = 1, 1e6 do mem.t[i] = i end end`);
    expect(r.error).toEqual({ kind: 'ram', message: 'out of RAM' });
    const after = v.tick(SENSORS, `function tick(io, mem) mem.t = nil io.log("ok") end`);
    expect(after.logs).toEqual(['ok']);
    v.close();
  });

  it('gives the same random numbers for the same seed and different ones for another', () => {
    const roll = (seed: number): string => {
      const v = vm({ seed });
      const out = v.tick(SENSORS, `function tick(io) io.log(math.random(1, 1000000), math.random(1, 1000000)) end`).logs[0]!;
      v.close();
      return out;
    };
    expect(roll(7)).toBe(roll(7));
    expect(roll(7)).not.toBe(roll(8));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/firmware/test/board-vm.test.ts`
Expected: FAIL, `../src/board-vm` doesn't exist.

- [ ] **Step 3: Write the prelude**

`packages/firmware/src/prelude.ts`:

```ts
/**
 * Trusted Lua that runs once per board VM, before any firmware. It keeps what it needs
 * in locals, builds the sandbox, and exposes entry points as globals that the host
 * takes into registry references and then removes.
 */
export const PRELUDE = String.raw`
local charge = __charge; __charge = nil
local load, type, error, select, tostring_raw = load, type, error, select, tostring
local setmetatable_raw, getmetatable, rawget, rawset, rawlen, rawequal = setmetatable, getmetatable, rawget, rawset, rawlen, rawequal
local pairs, ipairs, next, pcall, xpcall, assert, tonumber = pairs, ipairs, next, pcall, xpcall, assert, tonumber
local S, T, M, C = string, table, math, coroutine
local collect = collectgarbage

local function safe_tostring(v)
  local tv = type(v)
  if tv == "table" then
    local mt = getmetatable(v)
    if type(mt) == "table" and rawget(mt, "__tostring") then return tostring_raw(v) end
    return "table"
  elseif tv == "function" or tv == "thread" or tv == "userdata" then
    return tv
  end
  return tostring_raw(v)
end

local function safe_setmetatable(t, mt)
  if type(mt) == "table" and (rawget(mt, "__gc") ~= nil or rawget(mt, "__mode") ~= nil) then
    error("__gc and __mode are not allowed", 2)
  end
  return setmetatable_raw(t, mt)
end

-- Builtins whose work grows with their input are charged as instructions, one per 16 bytes
-- or per element. Sizes come only from real strings and integers, and costs are computed in
-- floating point, so no argument (a __len metamethod, a negative range, NaN, an overflowing
-- count) can produce a negative charge; the host also ignores anything that isn't positive.
local function len(v) return type(v) == "string" and #v or 32 end
local function int(v, i, name)
  return M.tointeger(v) or error("bad argument #" .. i .. " to '" .. name .. "' (number has no integer representation)", 3)
end
-- How many values string.byte returns, by Lua's rules for negative and out-of-range positions.
local function span(l, i, j)
  if i < 0 then i = i < -l and 1 or l + i + 1 elseif i == 0 then i = 1 end
  if j > l then j = l elseif j < 0 then j = j < -l and 0 or l + j + 1 end
  return j - i + 1
end

local safe_string = {
  len = S.len,
  sub = S.sub,
  upper = function(s) charge(len(s) / 16); return S.upper(s) end,
  lower = function(s) charge(len(s) / 16); return S.lower(s) end,
  reverse = function(s) charge(len(s) / 16); return S.reverse(s) end,
  rep = function(s, n, sep)
    n = int(n, 2, "rep")
    -- The C loop runs n times even when the strings are empty.
    if n > 0 then charge(M.max(len(s) + (sep == nil and 0 or len(sep)), 1) / 16 * n) end
    return S.rep(s, n, sep)
  end,
  -- Without j, string.byte returns one value at most; with it, every value counts.
  byte = function(s, i, j)
    if j ~= nil and type(s) == "string" then charge(span(#s, int(i == nil and 1 or i, 2, "byte"), int(j, 3, "byte"))) end
    return S.byte(s, i, j)
  end,
  char = function(...) charge(select("#", ...)); return S.char(...) end,
  format = function(fmt, ...)
    local n = len(fmt)
    for k = 1, select("#", ...) do
      local a = select(k, ...)
      if type(a) == "string" then n = n + #a end
    end
    charge(n / 16)
    return S.format(fmt, ...)
  end,
  -- Plain substring search only: Lua patterns can backtrack for seconds inside one instruction.
  -- Even a plain search can compare the needle at every position, so both lengths count.
  find = function(s, sub, init) charge(len(s) * len(sub) / 16); return S.find(s, sub, init, true) end,
}
local strmeta = getmetatable("")
strmeta.__index = safe_string
strmeta.__metatable = false

local function copy(t) local r = {}; for k, v in pairs(t) do r[k] = v end; return r end

local safe_table = {
  pack = T.pack,
  -- insert, remove, and move shift elements one at a time. They're written in Lua so every
  -- shift counts, whatever a __len metamethod says the length is.
  insert = function(t, ...)
    local nargs, e = select("#", ...), #t + 1
    if nargs == 1 then
      t[e] = ...
      return
    end
    if nargs ~= 2 then error("wrong number of arguments to 'insert'", 2) end
    local pos, v = ...
    pos = int(pos, 2, "insert")
    if pos < 1 or pos > e then error("bad argument #2 to 'insert' (position out of bounds)", 2) end
    for k = e, pos + 1, -1 do t[k] = t[k - 1] end
    t[pos] = v
  end,
  remove = function(t, pos)
    local size = #t
    pos = pos == nil and size or int(pos, 2, "remove")
    if pos ~= size and (pos < 1 or pos > size + 1) then error("bad argument #2 to 'remove' (position out of bounds)", 2) end
    local v = t[pos]
    for k = pos, size - 1 do t[k] = t[k + 1] end
    t[pos < size and size or pos] = nil
    return v
  end,
  move = function(a1, f, e, t, a2)
    f, e, t = int(f, 2, "move"), int(e, 3, "move"), int(t, 4, "move")
    if a2 == nil then a2 = a1 end
    if e >= f then
      if t > e or t <= f or a2 ~= a1 then
        for k = 0, e - f do a2[t + k] = a1[f + k] end
      else
        for k = e - f, 0, -1 do a2[t + k] = a1[f + k] end
      end
    end
    return a2
  end,
  concat = function(t, sep, i, j)
    i = i == nil and 1 or int(i, 3, "concat")
    j = int(j == nil and #t or j, 4, "concat")
    local lsep, n = sep == nil and 0 or len(sep), 0.0
    for k = i, j do
      local v = t[k]
      n = n + lsep + (type(v) == "string" and #v or 32)
    end
    charge(n / 16)
    return T.concat(t, sep, i, j)
  end,
  -- C sorts a table in place only when it has no metatable, so no __len can change the length
  -- it was charged for; any other table is sorted through a plain copy.
  sort = function(t, f)
    local n = #t
    if n > 1 then charge(n * M.log(n, 2)) end
    if getmetatable(t) == nil then return T.sort(t, f) end
    local c = {}
    for k = 1, n do c[k] = t[k] end
    T.sort(c, f)
    for k = 1, n do t[k] = c[k] end
  end,
  unpack = function(t, i, j)
    i = i == nil and 1 or int(i, 2, "unpack")
    j = int(j == nil and #t or j, 3, "unpack")
    charge(j + 0.0 - i + 1)
    return T.unpack(t, i, j)
  end,
}
local safe_math = copy(M); safe_math.randomseed = nil
local safe_coroutine = copy(C)

local io_t, mem, q, logs = {}, {}, {}, {}
local env, pending = nil, nil

local function log(...)
  local parts = {}
  for k = 1, select("#", ...) do parts[k] = safe_tostring((select(k, ...))) end
  if #logs < 20 then logs[#logs + 1] = S.sub(T.concat(parts, "\t"), 1, 200) end
end

local function push(...)
  local n = select("#", ...)
  if #q + n <= 64 then
    for k = 1, n do q[#q + 1] = (select(k, ...)) end
  end
end

local function make_env()
  local e = {
    assert = assert, error = error, ipairs = ipairs, next = next, pairs = pairs, pcall = pcall, xpcall = xpcall,
    select = select, tonumber = tonumber, tostring = safe_tostring, type = type, rawequal = rawequal,
    rawget = rawget, rawset = rawset, rawlen = rawlen, setmetatable = safe_setmetatable, getmetatable = getmetatable,
    print = log, string = copy(safe_string), table = copy(safe_table), math = copy(safe_math),
    coroutine = copy(safe_coroutine), _VERSION = _VERSION,
  }
  e._G = e
  return e
end

function __boot(kind, fids, seed)
  M.randomseed(seed)
  local fidx = {}
  for k = 1, #fids do fidx[fids[k]] = k end
  io_t.log = log
  io_t.sleep = function(seconds) push(5, tonumber(seconds) or 0) end
  if kind == "datacenter" then
    io_t.process = function() push(1) end
    io_t.cool = function(level) push(2, tonumber(level) or 0) end
  elseif kind == "power" then
    io_t.set_thermal = function(output) push(3, tonumber(output) or 0) end
    io_t.set_priority = function(list)
      if type(list) ~= "table" then error("set_priority expects a list of facility ids", 2) end
      local idx = {}
      for k = 1, #list do
        local i = fidx[list[k]]
        if not i then error("unknown facility: " .. safe_tostring(list[k]), 2) end
        idx[k] = i
      end
      push(4, #idx, T.unpack(idx))
    end
  end
end

function __compile(src)
  local e = make_env()
  local f, err = load(src, "=firmware", "t", e)
  if not f then error("syntax error: " .. err, 0) end
  pending = { f = f, env = e }
end

function __collect() collect("collect") end

function __step()
  if pending then
    local p = pending
    pending = nil
    env = p.env
    p.f()
  end
  if env == nil then error("__NOTICK__ no firmware installed", 0) end
  local tick = rawget(env, "tick")
  if type(tick) ~= "function" then error("__NOTICK__ firmware defines no tick(io, mem) function", 0) end
  tick(io_t, mem)
end

__io, __q, __logs = io_t, q, logs
`;
```

- [ ] **Step 4: Write the board VM**

`packages/firmware/src/board-vm.ts`:

```ts
import type { FacilityKind, TickError } from '@turing-city/core';
import { LuaEngine, LuaLibraries, type LuaWasm } from 'wasmoon';
import { PRELUDE } from './prelude.ts';

const REGISTRY = -1_001_000;
const MASK_COUNT = 8;
const T_NUMBER = 3;
const T_STRING = 4;
const ERR_MEM = 4;
const CPU_MESSAGE = 'CPU limit exceeded';

export const ACTION_CODES = { process: 1, cool: 2, setThermal: 3, setPriority: 4, sleep: 5 } as const;

export interface BoardVmOptions {
  readonly kind: FacilityKind;
  readonly facilityIds: readonly string[];
  readonly seed: number;
  readonly instructionCap: number;
  readonly ramBytes: number;
}

export interface VmTickResult {
  readonly ok: boolean;
  readonly instructions: number;
  /** The raw action queue; empty when the tick failed. */
  readonly queue: readonly number[];
  readonly logs: readonly string[];
  readonly error: TickError | null;
  readonly ramUsedBytes: number;
}

type RefName = 'boot' | 'compile' | 'collect' | 'step' | 'io' | 'queue' | 'logs';

/** One board's Lua state. Everything it runs goes through tick(), at a deterministic point. */
export class BoardVm {
  private readonly engine: LuaEngine;
  private readonly L: number;
  private readonly hook: number;
  private readonly refs: Record<RefName, number>;
  private ops = 0;
  private capped = false;
  private counting = false;
  /** Memory in use when the RAM cap was last set: code and runtime, not firmware data. */
  private capBase = 0;

  private readonly lua: LuaWasm;
  private readonly options: BoardVmOptions;

  constructor(lua: LuaWasm, options: BoardVmOptions) {
    this.lua = lua;
    this.options = options;
    this.engine = new LuaEngine(lua, { openStandardLibs: false, injectObjects: false, enableProxy: false, traceAllocations: true });
    for (const lib of [LuaLibraries.Base, LuaLibraries.Coroutine, LuaLibraries.Table, LuaLibraries.String, LuaLibraries.Math]) {
      this.engine.global.loadLibrary(lib);
    }
    this.L = this.engine.global.address;
    this.engine.global.set('__charge', (n: number) => this.charge(n));
    this.hook = lua.module.addFunction((L: number) => this.onInstruction(L), 'vii');
    lua.lua_sethook(this.L, this.hook, MASK_COUNT, 1);
    this.engine.doStringSync(PRELUDE);
    this.refs = {
      boot: this.takeGlobal('__boot'),
      compile: this.takeGlobal('__compile'),
      collect: this.takeGlobal('__collect'),
      step: this.takeGlobal('__step'),
      io: this.takeGlobal('__io'),
      queue: this.takeGlobal('__q'),
      logs: this.takeGlobal('__logs'),
    };
    this.pushRef('boot');
    lua.lua_pushstring(this.L, options.kind);
    lua.lua_createtable(this.L, options.facilityIds.length, 0);
    options.facilityIds.forEach((id, i) => {
      lua.lua_pushstring(this.L, id);
      lua.lua_rawseti(this.L, -2, BigInt(i + 1));
    });
    lua.lua_pushinteger(this.L, BigInt(options.seed));
    const status = lua.lua_pcallk(this.L, 3, 0, 0, 0, null);
    if (status !== 0) throw new Error(`board prelude failed: ${this.errorText(-1)}`);
    this.capRam();
  }

  /** Installs newSource (if given), writes the sensors into io, and runs one tick under the caps. */
  tick(sensors: Readonly<Record<string, number | undefined>>, newSource: string | null): VmTickResult {
    const { lua, L } = this;
    if (newSource !== null) {
      // Code doesn't count as RAM (it would live in flash): compile without a cap, then cap the data.
      this.engine.global.setMemoryMax(undefined);
      this.pushRef('compile');
      lua.lua_pushstring(L, newSource);
      const status = lua.lua_pcallk(L, 1, 0, 0, 0, null);
      if (status !== 0) {
        const message = this.errorText(-1);
        lua.lua_settop(L, 0);
        this.capRam();
        return this.result(false, 0, [], [], { kind: 'runtime', message });
      }
      this.pushRef('collect');
      lua.lua_pcallk(L, 0, 0, 0, 0, null);
      lua.lua_settop(L, 0);
      this.capRam();
    }
    this.writeSensors(sensors);
    this.ops = 0;
    this.capped = false;
    this.counting = true;
    this.pushRef('step');
    const status = lua.lua_pcallk(L, 0, 0, 0, 0, null);
    this.counting = false;
    const error = status === 0 ? null : this.classify(status, this.errorText(-1));
    lua.lua_settop(L, 0);
    const queue = this.drain('queue', () => lua.lua_tonumberx(L, -1, null));
    const logs = this.drain('logs', () => lua.lua_tolstring(L, -1, null));
    return this.result(status === 0, this.capped ? this.options.instructionCap : this.ops, status === 0 ? queue : [], logs, error);
  }

  close(): void {
    this.lua.lua_sethook(this.L, null, 0, 0);
    this.engine.global.close();
    this.lua.module.removeFunction(this.hook);
  }

  private onInstruction(L: number): void {
    if (!this.counting) return;
    this.ops += 1;
    if (this.ops > this.options.instructionCap) {
      this.capped = true;
      this.lua.lua_pushstring(L, CPU_MESSAGE);
      this.lua.lua_error(L);
    }
  }

  /** Work a builtin is about to do, in instructions. Only a positive amount counts, so no argument buys budget back. */
  private charge(n: number): void {
    if (!this.counting || !(n > 0)) return;
    this.ops += Math.ceil(Math.min(n, this.options.instructionCap + 1));
    if (this.ops > this.options.instructionCap) {
      this.capped = true;
      throw new Error(CPU_MESSAGE);
    }
  }

  private classify(status: number, message: string): TickError {
    if (this.capped) return { kind: 'cpu', message: CPU_MESSAGE };
    if (status === ERR_MEM) return { kind: 'ram', message: 'out of RAM' };
    if (message.startsWith('__NOTICK__ ')) return { kind: 'noTick', message: message.slice('__NOTICK__ '.length) };
    return { kind: 'runtime', message };
  }

  /** The error value at idx as text, without running any firmware metamethod. */
  private errorText(idx: number): string {
    const type = this.lua.lua_type(this.L, idx);
    if (type === T_STRING || type === T_NUMBER) return this.lua.lua_tolstring(this.L, idx, null);
    return `(error object: ${this.lua.lua_typename(this.L, type)})`;
  }

  private writeSensors(sensors: Readonly<Record<string, number | undefined>>): void {
    const { lua, L } = this;
    this.pushRef('io');
    for (const [key, value] of Object.entries(sensors)) {
      lua.lua_pushstring(L, key);
      if (value === undefined) lua.lua_pushnil(L);
      else if (Number.isInteger(value)) lua.lua_pushinteger(L, BigInt(value));
      else lua.lua_pushnumber(L, value);
      lua.lua_rawset(L, -3);
    }
    lua.lua_settop(L, 0);
  }

  /** Reads and empties one of the prelude's lists, with raw access only. */
  private drain<T>(name: 'queue' | 'logs', read: () => T): T[] {
    const { lua, L } = this;
    this.pushRef(name);
    const n = lua.lua_rawlen(L, -1);
    const out: T[] = [];
    for (let i = 1; i <= n; i++) {
      lua.lua_rawgeti(L, -1, BigInt(i));
      out.push(read());
      lua.lua_settop(L, -2);
    }
    for (let i = n; i >= 1; i--) {
      lua.lua_pushnil(L);
      lua.lua_rawseti(L, -2, BigInt(i));
    }
    lua.lua_settop(L, 0);
    return out;
  }

  private capRam(): void {
    this.capBase = this.engine.global.getMemoryUsed();
    this.engine.global.setMemoryMax(this.capBase + this.options.ramBytes);
  }

  private result(ok: boolean, instructions: number, queue: readonly number[], logs: readonly string[], error: TickError | null): VmTickResult {
    const ramUsedBytes = Math.max(0, this.engine.global.getMemoryUsed() - this.capBase);
    return { ok, instructions, queue, logs, error, ramUsedBytes };
  }

  private takeGlobal(name: string): number {
    const { lua, L } = this;
    lua.lua_getglobal(L, name);
    const ref = lua.luaL_ref(L, REGISTRY);
    lua.lua_pushnil(L);
    lua.lua_setglobal(L, name);
    return ref;
  }

  private pushRef(name: RefName): void {
    this.lua.lua_rawgeti(this.L, REGISTRY, BigInt(this.refs[name]));
  }
}
```

Add to `packages/firmware/src/index.ts`:

```ts
export * from './board-vm.ts';
export * from './prelude.ts';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run packages/firmware/test/board-vm.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 6: Commit**

```bash
pnpm fix
git add packages/firmware
git commit -m "Add the board VM: sandboxed Lua with io, actions, logs, hot reload, instruction and RAM caps"
```

### Task 7: The hostile-firmware suite

Spec §6.8 and §11: every way firmware might hang or blow up the game must end its tick within budget, and the board must run its next tick normally. This task is the suite; it exercises the caps Task 6 built. If a case fails, fix the prelude or `BoardVm` (not the test) and say which hole it was.

Each case runs in a worker thread that the test stops after 3 seconds. A hole in the caps shows up as a synchronous loop inside WebAssembly, which no Vitest timeout can interrupt; in a worker, the case fails as `hung` and the run goes on.

The second half of the cases comes from a security review of the first draft of Task 6. Each one ended in a hang there: a C loop that runs long on tiny input (`string.rep` of an empty string; `table.insert` and `table.remove` trusting a `__len` metamethod), or a charge that came out negative or NaN and turned the cap off, after which a plain `while true do end` ran forever.

**Files:**
- Create: `packages/firmware/test/hostile-worker.ts` (runs one case's ticks in a worker thread)
- Test: `packages/firmware/test/hostile.test.ts`

**Interfaces:**
- Consumes: Task 6 (`BoardVm`), Task 5 (`createLuaRuntime`), Task 4 types (`TickErrorKind`).
- Produces: nothing new.

- [ ] **Step 1: Write the worker that runs a case**

`packages/firmware/test/hostile-worker.ts`:

```ts
import { parentPort, workerData } from 'node:worker_threads';
import type { TickErrorKind } from '@turing-city/core';
import { BoardVm } from '../src/board-vm.ts';
import { createLuaRuntime } from '../src/runtime.ts';

export interface TickReport {
  readonly kind: TickErrorKind | null;
  readonly message: string | null;
  readonly elapsedMs: number;
  readonly logs: readonly string[];
}

// Runs the given ticks (a source deploys, null runs what's there) on one fresh board and
// reports each. The suite runs this in a worker thread so it can stop a tick that never ends.
const sources = workerData as ReadonlyArray<string | null>;
const lua = await createLuaRuntime();
const vm = new BoardVm(lua, { kind: 'datacenter', facilityIds: ['P', 'DA', 'DB'], seed: 1, instructionCap: 2000, ramBytes: 8 * 1024 });
const reports: TickReport[] = [];
for (const source of sources) {
  const started = performance.now();
  const r = vm.tick({ temp: 50, price: 40, day: 1, clock: 1 }, source);
  reports.push({ kind: r.error?.kind ?? null, message: r.error?.message ?? null, elapsedMs: performance.now() - started, logs: r.logs });
}
vm.close();
parentPort?.postMessage(reports);
```

- [ ] **Step 2: Write the suite**

`packages/firmware/test/hostile.test.ts`:

```ts
import { Worker } from 'node:worker_threads';
import type { TickErrorKind } from '@turing-city/core';
import { describe, expect, it } from 'vitest';
import type { TickReport } from './hostile-worker.ts';

/** A tick may take this long at most, on any machine that runs the tests. */
const BUDGET_MS = 250;
/** A worker still busy after this long is stuck in a tick: the case found a hole. */
const HANG_MS = 3000;
const ALIVE = 'function tick(io) io.log("still alive") end';

/** Runs ticks on a fresh board in a worker thread, so a tick that never ends fails its test instead of freezing the run. */
function runTicks(sources: ReadonlyArray<string | null>): Promise<TickReport[] | 'hung'> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./hostile-worker.ts', import.meta.url), { workerData: sources });
    const timer = setTimeout(() => {
      void worker.terminate();
      resolve('hung');
    }, HANG_MS);
    worker.once('message', (reports: TickReport[]) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(reports);
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

const CASES: ReadonlyArray<readonly [string, string, TickErrorKind]> = [
  ['an infinite loop', 'function tick() while true do end end', 'cpu'],
  ['a tail-call loop', 'local function f() return f() end function tick() f() end', 'cpu'],
  ['loops inside pcall', 'function tick() for i = 1, 1e9 do pcall(function() while true do end end) end end', 'cpu'],
  ['a loop inside a coroutine', 'function tick() coroutine.wrap(function() while true do end end)() end', 'cpu'],
  [
    'a coroutine kept in mem',
    'function tick(io, mem) mem.co = mem.co or coroutine.create(function() while true do coroutine.yield() end end) for i = 1, 1e9 do coroutine.resume(mem.co) end end',
    'cpu',
  ],
  ['runaway recursion', 'local function f(n) return f(n + 1) + 1 end function tick() f(1) end', 'ram'],
  ['a huge string.rep', 'function tick() local s = string.rep("x", 1e9) end', 'cpu'],
  ['a doubling string', 'function tick() local s = "x" while true do s = s .. s end end', 'ram'],
  ['a growing table', 'function tick(io, mem) mem.t = {} for i = 1, 1e9 do mem.t[i] = i end end', 'ram'],
  ['many coroutines', 'function tick(io, mem) mem.c = {} for i = 1, 1e9 do mem.c[i] = coroutine.create(function() end) end end', 'ram'],
  [
    'table.concat in a loop',
    'function tick() local t = {} for i = 1, 50 do t[i] = "xxxxxxxxxx" end for j = 1, 1e9 do table.concat(t) end end',
    'cpu',
  ],
  [
    'table.sort in a loop',
    'function tick() local t = {} for i = 1, 200 do t[i] = 200 - i end for j = 1, 1e9 do table.sort(t) end end',
    'cpu',
  ],
  ['a huge table.unpack', 'function tick() local t = {1} return table.unpack(t, 1, 1e8) end', 'cpu'],
  [
    'string.byte over a whole string, in a loop',
    'function tick() local s = string.rep("a", 100) for i = 1, 1e9 do string.byte(s, 1, -1) end end',
    'cpu',
  ],
  ['a gsub pattern bomb', 'function tick() return string.gsub(string.rep("a", 400), ".-.-.-b", "") end', 'runtime'],
  ['a pattern via the method syntax', 'function tick() return ("aaaa"):match("(a+)+b") end', 'runtime'],
  ['a to-be-closed loop', 'function tick() local x <close> = setmetatable({}, { __close = function() while true do end end }) end', 'cpu'],
  [
    'an __index loop on mem',
    'function tick(io, mem) setmetatable(mem, { __index = function() while true do end end }) return mem.missing end',
    'cpu',
  ],
  // Builtins whose C loop runs long on tiny input, or whose charge could come out negative or NaN
  // (a negative or NaN charge would turn the cap off for the rest of the tick, so each ends in a loop).
  ['string.rep of an empty string', 'function tick() string.rep("", math.maxinteger) end', 'cpu'],
  ['string.rep of an empty string by method', 'function tick() (""):rep(1 << 40, "") end', 'cpu'],
  ['string.rep whose size overflows', 'function tick() pcall(string.rep, "ab", 1 << 62) while true do end end', 'cpu'],
  ['table.concat over a negative range', 'function tick() table.concat({}, "xxxxxxxx", 1, -(1 << 50)) while true do end end', 'cpu'],
  ['table.concat up to NaN', 'function tick() pcall(table.concat, {}, "x", 1, 0/0) while true do end end', 'cpu'],
  [
    'string.upper of a table whose length is NaN',
    'function tick() pcall(string.upper, setmetatable({}, { __len = function() return 0/0 end })) while true do end end',
    'cpu',
  ],
  [
    'string.format of a table with a negative length',
    'function tick() pcall(string.format, setmetatable({}, { __len = function() return -1e18 end })) while true do end end',
    'cpu',
  ],
  [
    'table.insert into a table whose __len is huge',
    'function tick() table.insert(setmetatable({}, { __len = function() return 1 << 40 end }), 1, 0) end',
    'cpu',
  ],
  [
    'table.remove from a table whose __len is huge',
    'function tick() table.remove(setmetatable({}, { __len = function() return 1 << 40 end }), 1) end',
    'cpu',
  ],
  [
    'table.sort whose charge overflows',
    'function tick() pcall(table.sort, setmetatable({}, { __len = function() return 1 << 62 end })) while true do end end',
    'cpu',
  ],
  ['table.unpack whose range overflows', 'function tick() pcall(table.unpack, {}, -(1 << 62), 1 << 62) while true do end end', 'cpu'],
  ['table.move whose range overflows', 'function tick() pcall(table.move, {}, -(1 << 62), 1 << 62, 1) while true do end end', 'cpu'],
  ['a huge table.move', 'function tick() table.move({}, 1, 1 << 40, 2) end', 'cpu'],
  ['string.byte whose range overflows', 'function tick() string.byte("abc", -(1 << 62), 1 << 62) while true do end end', 'cpu'],
];

describe('hostile firmware', () => {
  it.concurrent.each(CASES)('stops %s within budget and keeps the board usable', async (_name, source, kind) => {
    const reports = await runTicks([source, ALIVE]);
    expect(reports).not.toBe('hung');
    if (reports === 'hung') return;
    expect(reports[0]?.kind).toBe(kind);
    expect(reports[0]?.elapsedMs).toBeLessThan(BUDGET_MS);
    expect(reports[1]?.logs).toEqual(['still alive']);
  });

  it('does not run firmware metamethods outside a tick', async () => {
    // A trap on io's writes: the host writes sensors with rawset, so it never fires.
    const reports = await runTicks(['function tick(io) setmetatable(io, { __newindex = function() while true do end end }) end', null]);
    expect(reports).not.toBe('hung');
    if (reports === 'hung') return;
    expect(reports[1]?.kind).toBeNull();
    expect(reports[1]?.elapsedMs).toBeLessThan(BUDGET_MS);
  });

  it('reads an error object without calling its __tostring', async () => {
    const reports = await runTicks(['function tick() error(setmetatable({}, { __tostring = function() while true do end end })) end']);
    expect(reports).not.toBe('hung');
    if (reports === 'hung') return;
    expect(reports[0]).toMatchObject({ kind: 'runtime', message: '(error object: table)' });
  });
});
```

- [ ] **Step 3: Run the suite**

Run: `pnpm vitest run packages/firmware/test/hostile.test.ts`
Expected: PASS (34 tests, in about a second). A case that fails names a hole in Task 6's caps or sandbox: close it in `prelude.ts` or `board-vm.ts`, then rerun the whole firmware suite with `pnpm vitest run packages/firmware`.

- [ ] **Step 4: Show the suite catches a hole instead of hanging**

Temporarily add `return;` as the first line of `onInstruction` in `board-vm.ts`, and rerun the file.
Expected: the run finishes (each stuck case gives up after 3 seconds, five at a time) with 19 failures, every one a `cpu` case that now reports `hung`. The `cpu` cases that still pass are the ones the prelude's charges stop on their own. Remove the line; rerun to PASS.

- [ ] **Step 5: Commit**

```bash
pnpm fix
git add packages/firmware/test/hostile.test.ts packages/firmware/test/hostile-worker.ts
git commit -m "Add the hostile-firmware suite: every hang or bomb ends its tick within budget, each case in a worker that can be stopped"
```

### Task 8: The wasmoon firmware host and the syntax checker

`WasmoonHost` implements the core's `FirmwareHost` with one `BoardVm` per board and decodes the action queue. `SyntaxChecker` lets the MCP server reject a syntax error at deploy time (spec §6.7) in its own WebAssembly instance, so checking never touches a session's memory.

**Files:**
- Create: `packages/firmware/src/host.ts`, `packages/firmware/src/syntax.ts`
- Modify: `packages/firmware/src/index.ts`
- Test: `packages/firmware/test/host.test.ts`, `packages/firmware/test/syntax.test.ts`

**Interfaces:**
- Consumes: Task 4 (`Session`, `FirmwareHost`, `Action`, `BootInfo`, `TickInput`, `TickOutcome`), Task 6 (`BoardVm`, `ACTION_CODES`), Task 5 (`createLuaRuntime`).
- Produces:
  - `decodeActions(queue: readonly number[], facilityIds: readonly string[]): Action[]`.
  - `class WasmoonHost implements FirmwareHost { static create(): Promise<WasmoonHost> }`: one per session, because a fresh runtime is what makes boards land at the same addresses.
  - `class SyntaxChecker { static create(): Promise<SyntaxChecker>; check(source: string): string | null }`.

- [ ] **Step 1: Write the failing tests**

`packages/firmware/test/host.test.ts`:

```ts
import { parseScenario, Session } from '@turing-city/core';
import { describe, expect, it } from 'vitest';
import m1 from '../../../scenarios/m1-power.json' with { type: 'json' };
import { decodeActions, WasmoonHost } from '../src/host.ts';

describe('decodeActions', () => {
  it('turns the queue into actions, with facility ids', () => {
    expect(decodeActions([1, 2, 3, 3, 250, 4, 2, 3, 2, 5, 20], ['P', 'DA', 'DB'])).toEqual([
      { kind: 'process' },
      { kind: 'cool', level: 3 },
      { kind: 'setThermal', output: 250 },
      { kind: 'setPriority', order: ['DB', 'DA'] },
      { kind: 'sleep', seconds: 20 },
    ]);
  });
  it('stops at an unknown code', () => {
    expect(decodeActions([1, 9, 1], [])).toEqual([{ kind: 'process' }]);
  });
});

describe('WasmoonHost in a session', () => {
  it('runs deployed Lua, applies its actions, and reboots it after a sleep with empty mem', async () => {
    const session = new Session(parseScenario(m1), 7, await WasmoonHost.create());
    session.world.plant.thermalSetting = 300; // plenty of power once Task 9 adds it: DA's job is never shed
    session.deploy('DA', `
      function tick(io, mem)
        mem.n = (mem.n or 0) + 1
        io.log("tick", mem.n)
        if mem.n == 2 then io.sleep(1) return end
        io.process()
        io.cool(1)
      end`);
    for (let i = 0; i < 4; i++) session.step(); // DA's first beat is step 3
    const dc = session.world.datacenters.DA!;
    expect(dc).toMatchObject({ jobFrom: 4, jobUntil: 7, cooling: 1 });
    for (let i = 0; i < 4; i++) session.step(); // second beat at 7: sleep 1 s
    const da = session.world.boards[1]!;
    expect(da.status).toBe('asleep');
    for (let i = 0; i < 20; i++) session.step(); // wakes at 27; beat at 27 reboots
    const logs = da.log.filter((l) => l.kind === 'log').map((l) => l.text);
    expect(logs).toEqual(['tick\t1', 'tick\t2', 'tick\t1']);
    session.close();
  });

  it('reports a CPU cap hit as a firmware error', async () => {
    const session = new Session(parseScenario(m1), 7, await WasmoonHost.create());
    session.deploy('DA', 'function tick() while true do end end');
    for (let i = 0; i < 4; i++) session.step();
    expect(session.world.boards[1]!.lastTick).toMatchObject({ instructions: 2000, error: { kind: 'cpu' } });
    expect(session.world.alerts.some((a) => a.kind === 'firmwareError' && a.facilityId === 'DA')).toBe(true);
    session.close();
  });
});
```

`packages/firmware/test/syntax.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SyntaxChecker } from '../src/syntax.ts';

describe('SyntaxChecker', () => {
  it('accepts code that compiles, without running it', async () => {
    const checker = await SyntaxChecker.create();
    expect(checker.check('function tick(io) while true do end end')).toBeNull();
  });
  it('returns Lua\'s message with the line for a syntax error', async () => {
    const checker = await SyntaxChecker.create();
    expect(checker.check('function tick(io)\n  if then\nend')).toMatch(/^firmware:2: /);
  });
  it('rejects precompiled bytecode', async () => {
    const checker = await SyntaxChecker.create();
    expect(checker.check('\x1bLua')).toMatch(/binary chunk/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/firmware/test/host.test.ts packages/firmware/test/syntax.test.ts`
Expected: FAIL, `../src/host.ts` and `../src/syntax.ts` don't exist.

- [ ] **Step 3: Write the host and the syntax checker**

`packages/firmware/src/host.ts`:

```ts
import type { Action, BootInfo, FirmwareHost, TickInput, TickOutcome } from '@turing-city/core';
import type { LuaWasm } from 'wasmoon';
import { ACTION_CODES, BoardVm } from './board-vm.ts';
import { createLuaRuntime } from './runtime.ts';

/** Turns the VM's flat number queue into actions. An unknown code ends the decoding. */
export function decodeActions(queue: readonly number[], facilityIds: readonly string[]): Action[] {
  const out: Action[] = [];
  let i = 0;
  const next = (): number => queue[i++] ?? 0;
  while (i < queue.length) {
    const code = next();
    if (code === ACTION_CODES.process) out.push({ kind: 'process' });
    else if (code === ACTION_CODES.cool) out.push({ kind: 'cool', level: next() });
    else if (code === ACTION_CODES.setThermal) out.push({ kind: 'setThermal', output: next() });
    else if (code === ACTION_CODES.setPriority) {
      const n = next();
      const order: string[] = [];
      for (let k = 0; k < n; k++) {
        const id = facilityIds[next() - 1];
        if (id !== undefined) order.push(id);
      }
      out.push({ kind: 'setPriority', order });
    } else if (code === ACTION_CODES.sleep) out.push({ kind: 'sleep', seconds: next() });
    else break;
  }
  return out;
}

/**
 * Runs board firmware on wasmoon. Use one host per session: a fresh runtime is what
 * makes the boards' Lua states land at the same addresses in every run.
 */
export class WasmoonHost implements FirmwareHost {
  private readonly vms = new Map<string, { vm: BoardVm; facilityIds: readonly string[] }>();

  private readonly lua: LuaWasm;

  private constructor(lua: LuaWasm) {
    this.lua = lua;
  }

  static async create(): Promise<WasmoonHost> {
    return new WasmoonHost(await createLuaRuntime());
  }

  boot(info: BootInfo): void {
    this.shutdown(info.boardId);
    const vm = new BoardVm(this.lua, {
      kind: info.kind,
      facilityIds: info.facilityIds,
      seed: info.seed,
      instructionCap: info.spec.instructionCap,
      ramBytes: info.spec.ramKb * 1024,
    });
    this.vms.set(info.boardId, { vm, facilityIds: info.facilityIds });
  }

  tick(boardId: string, input: TickInput): TickOutcome {
    const entry = this.vms.get(boardId);
    if (!entry) throw new Error(`tick before boot: ${boardId}`);
    const r = entry.vm.tick(input.sensors, input.newSource);
    return {
      ok: r.ok,
      instructions: r.instructions,
      actions: r.ok ? decodeActions(r.queue, entry.facilityIds) : [],
      logs: r.logs,
      error: r.error,
      ramUsedBytes: r.ramUsedBytes,
    };
  }

  shutdown(boardId: string): void {
    const entry = this.vms.get(boardId);
    if (!entry) return;
    entry.vm.close();
    this.vms.delete(boardId);
  }

  close(): void {
    for (const id of [...this.vms.keys()]) this.shutdown(id);
  }
}
```

`packages/firmware/src/syntax.ts`:

```ts
import { LuaEngine, LuaFactory, LuaLibraries } from 'wasmoon';

/**
 * Checks firmware syntax in a WebAssembly instance of its own, so that checking a deploy
 * never allocates in a session's memory. It compiles and never runs.
 */
export class SyntaxChecker {
  private readonly fn: (source: string) => string | null | undefined;

  private constructor(fn: (source: string) => string | null | undefined) {
    this.fn = fn;
  }

  static async create(): Promise<SyntaxChecker> {
    const lua = await new LuaFactory().getLuaModule();
    const engine = new LuaEngine(lua, { openStandardLibs: false, injectObjects: false, enableProxy: false });
    engine.global.loadLibrary(LuaLibraries.Base);
    engine.doStringSync('function __check(src) local f, err = load(src, "=firmware", "t", {}) if f then return nil end return err end');
    return new SyntaxChecker(engine.global.get('__check') as (source: string) => string | null | undefined);
  }

  /** null when the source compiles; otherwise Lua's message, such as "firmware:3: 'end' expected near <eof>". */
  check(source: string): string | null {
    return this.fn(source) ?? null;
  }
}
```

Replace `packages/firmware/src/index.ts` with:

```ts
export * from './board-vm.ts';
export * from './host.ts';
export * from './prelude.ts';
export * from './runtime.ts';
export * from './syntax.ts';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/firmware`
Expected: PASS. Then run `pnpm fix`; `pnpm check` passes.

- [ ] **Step 5: Commit**

```bash
pnpm fix
git add packages/firmware
git commit -m "Add the wasmoon firmware host and the syntax checker"
```

### Task 9: Weather, market, and power

Spec §5.2: wind follows a seeded series, thermal output follows the plant's firmware and costs fuel, every consumer draws 2% more per cell from the plant, nothing stores power, and a shortfall sheds whole facilities from the lowest priority up. Spec §5.3 adds the job price series.

One refinement of the spec: the plant's own board keeps power even when the plant generates nothing, so its firmware can always start the thermal module (otherwise a calm day would leave the plant unable to restart itself).

**Files:**
- Create: `packages/core/src/series.ts`, `packages/core/src/power.ts`
- Modify: `packages/core/src/session.ts` (`step()`), `packages/core/src/index.ts`
- Test: `packages/core/test/power.test.ts`

**Interfaces:**
- Consumes: Task 4 (`SimContext`, `BoardState`, `WorldState`, `raiseOnce`, `clearFlag`, `manhattan`, `Session`), Task 2 (`clamp`, `mulDiv`, `stepsPerDay`).
- Produces:
  - `runSeries(ctx, step)`: phase 2. Wind and job price take a random step every second; the fuel price is redrawn every day.
  - `plantBoard(world): BoardState` (the power facility's board).
  - `facilityDemand(ctx, board, step): number` (base draw, plus a running job and cooling for a datacenter, plus transmission loss; `sleepPower` while asleep; 0 while destroyed or rebuilding).
  - `priorityOrder(world): BoardState[]` (consumers, highest priority first).
  - `runPower(ctx, step)`: phase 3. Sets `plant.generation`, `plant.demand`, `plant.shed`, and every board's `powered`; raises `powerShortage` once per episode.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/power.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { facilityDemand, plantBoard, runPower } from '../src/power.ts';
import { Session } from '../src/session.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario } from './helpers/scenarios.ts';

/** A session with a steady wind, for exact power arithmetic. */
function calm(wind: number): Session {
  return new Session(
    m1Scenario((j) => {
      j.tuning.wind.start = wind;
      j.tuning.wind.maxChangePerSecond = 0;
    }),
    1,
    new FakeHost(),
  );
}


describe('power', () => {
  it('adds 2% per cell from the plant to a facility\'s draw', () => {
    const s = calm(120);
    const ctx = s.ctx;
    const [p, da, db] = s.world.boards;
    expect(facilityDemand(ctx, p!, 0)).toBe(5);
    expect(facilityDemand(ctx, da!, 0)).toBe(10); // 1 cell: 10 + floor(10 * 2 / 100)
    expect(facilityDemand(ctx, db!, 0)).toBe(13); // 16 cells: 10 + floor(10 * 32 / 100)
  });

  it('adds a running job and cooling to a datacenter\'s draw', () => {
    const s = calm(120);
    const ctx = s.ctx;
    const dc = s.world.datacenters.DA!;
    dc.jobFrom = 5;
    dc.jobUntil = 8;
    dc.cooling = 2;
    const da = s.world.boards[1]!;
    expect(facilityDemand(ctx, da, 4)).toBe(50 + 1); // 10 + 40 cooling, + 2%
    expect(facilityDemand(ctx, da, 5)).toBe(200 + 4); // + 150 for the job
  });

  it('draws only sleep power while asleep and nothing while destroyed', () => {
    const s = calm(120);
    const ctx = s.ctx;
    const db = s.world.boards[2]!;
    db.status = 'asleep';
    expect(facilityDemand(ctx, db, 0)).toBe(1); // 1 + floor(1 * 32 / 100)
    db.status = 'destroyed';
    expect(facilityDemand(ctx, db, 0)).toBe(0);
  });

  it('powers everyone when generation covers demand', () => {
    const s = calm(120);
    runPower(s.ctx, 0);
    expect(s.world.plant).toMatchObject({ generation: 120, demand: 28, shed: [] });
    expect(s.world.boards.every((b) => b.powered)).toBe(true);
  });

  it('sheds whole facilities from the lowest priority up', () => {
    const s = calm(100);
    const ctx = s.ctx;
    for (const id of ['DA', 'DB']) {
      s.world.datacenters[id]!.jobFrom = 0;
      s.world.datacenters[id]!.jobUntil = 10;
    }
    s.world.plant.thermalSetting = 250; // generation 350; demand 5 + 163 + 211 = 379
    runPower(ctx, 0);
    expect(s.world.plant).toMatchObject({ generation: 350, demand: 379, shed: ['DB'] });
    expect(s.world.boards.map((b) => b.powered)).toEqual([true, true, false]);
    s.world.plant.priority = ['DB', 'DA'];
    runPower(ctx, 0);
    expect(s.world.plant.shed).toEqual(['DA']);
  });

  it('keeps the plant\'s own board powered even with nothing generated', () => {
    const s = calm(0);
    runPower(s.ctx, 0);
    expect(plantBoard(s.world).powered).toBe(true);
    expect(s.world.boards.slice(1).every((b) => !b.powered)).toBe(true);
  });

  it('runs thermal only while the plant\'s board is running', () => {
    const s = calm(50);
    s.world.plant.thermalSetting = 200;
    plantBoard(s.world).status = 'destroyed';
    runPower(s.ctx, 0);
    expect(s.world.plant.generation).toBe(50);
  });

  it('raises a shortage alert once per episode', () => {
    const s = calm(0);
    for (let i = 0; i < 10; i++) s.step();
    expect(s.world.alerts.filter((a) => a.kind === 'powerShortage')).toHaveLength(1);
  });

  it('does not tick a board whose facility was shed', () => {
    const host = new FakeHost();
    const src = host.program('noop', () => ({}));
    const s = new Session(
      m1Scenario((j) => {
        j.tuning.wind.start = 0;
        j.tuning.wind.maxChangePerSecond = 0;
      }),
      1,
      host,
    );
    s.deploy('DA', src);
    for (let i = 0; i < 20; i++) s.step();
    expect(host.calls).toEqual([]);
  });

  it('moves wind and job price within their bounds, and redraws fuel daily', () => {
    const s = new Session(m1Scenario(), 99, new FakeHost());
    const winds = new Set<number>();
    const fuel = new Set<number>();
    for (let i = 0; i < 800 * 5; i++) {
      s.step();
      winds.add(s.world.plant.wind);
      fuel.add(s.world.plant.fuelPrice);
      expect(s.world.plant.wind).toBeGreaterThanOrEqual(0);
      expect(s.world.plant.wind).toBeLessThanOrEqual(220);
      expect(s.world.jobPrice).toBeGreaterThanOrEqual(15);
      expect(s.world.jobPrice).toBeLessThanOrEqual(80);
    }
    expect(winds.size).toBeGreaterThan(20);
    expect([...fuel].every((f) => f >= 5 && f <= 9)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/test/power.test.ts`
Expected: FAIL, `../src/power` doesn't exist.

- [ ] **Step 3: Write the series and the power phase**

`packages/core/src/series.ts`:

```ts
import { clamp } from './fixed.ts';
import { stepsPerDay } from './time.ts';
import type { SimContext } from './world.ts';

/** Phase 2: wind and the job price take a random step every second; fuel is redrawn every day. */
export function runSeries(ctx: SimContext, step: number): void {
  if (step === 0) return;
  const { time, tuning: t } = ctx.scenario;
  const w = ctx.world;
  if (step % time.stepsPerSecond === 0) {
    const dw = ctx.rng.weather.int(-t.wind.maxChangePerSecond, t.wind.maxChangePerSecond);
    w.plant.wind = clamp(w.plant.wind + dw, 0, t.wind.max);
    const dp = ctx.rng.market.int(-t.jobPrice.maxChangePerSecond, t.jobPrice.maxChangePerSecond);
    w.jobPrice = clamp(w.jobPrice + dp, t.jobPrice.min, t.jobPrice.max);
  }
  if (step % stepsPerDay(time) === 0) {
    w.plant.fuelPrice = ctx.rng.market.int(t.fuelPrice.min, t.fuelPrice.max);
  }
}
```

`packages/core/src/power.ts`:

```ts
import { clearFlag, raiseOnce } from './alerts.ts';
import { mulDiv } from './fixed.ts';
import { manhattan, type BoardState, type SimContext, type WorldState } from './world.ts';

export function plantBoard(world: WorldState): BoardState {
  const plant = world.boards.find((b) => b.kind === 'power');
  if (!plant) throw new Error('the scenario has no power plant');
  return plant;
}

/** What a facility requests this step, transmission loss included. */
export function facilityDemand(ctx: SimContext, board: BoardState, step: number): number {
  const t = ctx.scenario.tuning;
  let base: number;
  if (board.status === 'destroyed' || board.status === 'rebuilding') return 0;
  if (board.status === 'asleep') {
    base = t.sleepPower;
  } else {
    base = board.spec.power;
    const dc = ctx.world.datacenters[board.id];
    if (dc) {
      if (step >= dc.jobFrom && step <= dc.jobUntil) base += t.datacenter.processPower;
      base += dc.cooling * t.datacenter.coolingPowerPerLevel;
    }
  }
  const plant = plantBoard(ctx.world);
  const distance = manhattan(board.x, board.y, plant.x, plant.y);
  return base + mulDiv(base, t.transmissionLossPctPerCell * distance, 100);
}

/** Consumers (every board but the plant's), highest priority first. */
export function priorityOrder(world: WorldState): BoardState[] {
  const consumers = world.boards.filter((b) => b.kind !== 'power');
  const listed = world.plant.priority ?? [];
  const first = listed.map((id) => consumers.find((b) => b.id === id)).filter((b): b is BoardState => b !== undefined);
  return [...first, ...consumers.filter((b) => !first.includes(b))];
}

/** Phase 3: generation, demand, and shedding. */
export function runPower(ctx: SimContext, step: number): void {
  const w = ctx.world;
  const plant = plantBoard(w);
  const thermal = plant.status === 'running' ? w.plant.thermalSetting : 0;
  const generation = w.plant.wind + thermal;
  const plantDraw = facilityDemand(ctx, plant, step);
  const order = priorityOrder(w);
  const demands = order.map((b) => facilityDemand(ctx, b, step));
  const available = generation - plantDraw;
  let load = demands.reduce((a, b) => a + b, 0);
  const powered = order.map(() => true);
  for (let i = order.length - 1; i >= 0 && load > available; i--) {
    if (demands[i] === 0) continue;
    powered[i] = false;
    load -= demands[i]!;
  }
  plant.powered = true;
  order.forEach((b, i) => {
    b.powered = powered[i]!;
  });
  w.plant.generation = generation;
  w.plant.demand = plantDraw + demands.reduce((a, b) => a + b, 0);
  w.plant.shed = order.filter((_, i) => !powered[i] && demands[i]! > 0).map((b) => b.id);
  if (w.plant.shed.length > 0) {
    raiseOnce(w, 'shortage', step, 'powerShortage', null, `전력 부족: ${w.plant.shed.join(', ')} 정전`);
  } else {
    clearFlag(w, 'shortage');
  }
}
```

In `packages/core/src/session.ts`, import `runSeries` (from `./series.ts`) and `runPower` (from `./power.ts`), and run them before the ticks:

```ts
  step(): StepReport {
    const w = this.world;
    if (w.ended) return { step: w.step, alerts: [], ended: w.ended };
    const s = w.step;
    const firstAlert = w.nextAlertId;
    runTransitions(this.ctx, s);
    runSeries(this.ctx, s);
    runPower(this.ctx, s);
    const ticked = runBoardTicks(this.ctx, s);
    applyActions(this.ctx, s, ticked);
    this.checkSeasonEnd(s);
    w.step = s + 1;
    return { step: w.step, alerts: w.alerts.filter((a) => a.id >= firstAlert), ended: w.ended };
  }
```

Add to `packages/core/src/index.ts`:

```ts
export * from './power.ts';
export * from './series.ts';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core`
Expected: PASS (power 10, and every earlier core test). Then run `pnpm fix`; `pnpm check` passes.

- [ ] **Step 5: Commit**

```bash
pnpm fix
git add packages/core
git commit -m "Add wind, prices, and power: transmission loss and shedding by priority"
```

### Task 10: Datacenters: jobs, heat, income, and fire

Spec §5.3 and §5.8: a job runs for the board's tick period while the facility has power, earns the job price pro rata, and heats the datacenter; heat falls slowly toward ambient, faster with cooling; above 90 °C a seeded fire roll each step can destroy the board. The action setters (Task 4) already record jobs and cooling; this task gives them their physics.

**Files:**
- Create: `packages/core/src/datacenter.ts`
- Modify: `packages/core/src/session.ts` (`step()`), `packages/core/src/index.ts`
- Test: `packages/core/test/datacenter.test.ts`

**Interfaces:**
- Consumes: Task 4 (`SimContext`, `destroyBoard`, `raiseAlert`, `raiseOnce`, `clearFlag`), Task 9 (`runPower` sets `board.powered`), Task 2 (`MICRO`, `MILLI`, `idiv`, `mulDiv`).
- Produces:
  - `isProcessing(ctx, boardId, step): boolean` (a job covers the step, and the board is running and powered).
  - `runDatacenters(ctx, step)`: phase 6. Income, heat, cooling, and overheat alerts (85 °C on, below 80 °C off).
  - `runFires(ctx, step)`: phase 9. A fire raises `fire` and destroys the board.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/datacenter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MICRO } from '../src/fixed.ts';
import { Session } from '../src/session.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario } from './helpers/scenarios.ts';

/** Plenty of steady power, so nothing is shed unless a test wants it. */
function powered(seed = 1): Session {
  const s = new Session(
    m1Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.jobPrice.maxChangePerSecond = 0;
      j.tuning.emf.rumourThreshold = 1_000_000_000; // no raids once Task 12 adds them
    }),
    seed,
    new FakeHost(),
  );
  s.world.plant.thermalSetting = 300;
  return s;
}

function steps(s: Session, n: number): void {
  for (let i = 0; i < n; i++) s.step();
}

describe('datacenters', () => {
  it('earns the job price per second of processing, pro rata', () => {
    const s = powered();
    const dc = s.world.datacenters.DA!;
    dc.jobFrom = 0;
    dc.jobUntil = 3; // four steps = 0.2 s at price 40 -> 8
    steps(s, 4);
    expect(s.world.ledger.datacenterIncome).toBe(8 * MICRO);
    steps(s, 4);
    expect(s.world.ledger.datacenterIncome).toBe(8 * MICRO);
  });

  it('heats while processing and cools toward ambient after', () => {
    const s = powered();
    const dc = s.world.datacenters.DA!;
    dc.jobFrom = 0;
    dc.jobUntil = 20 * 10 - 1; // 10 s of work
    steps(s, 200);
    const hot = dc.tempMilli;
    expect(hot).toBeGreaterThan(25_000 + 15_000); // ~+20 °C minus passive loss
    expect(hot).toBeLessThan(25_000 + 20_000);
    steps(s, 200);
    expect(dc.tempMilli).toBeLessThan(hot);
    expect(dc.tempMilli).toBeGreaterThanOrEqual(25_000);
  });

  it('cools faster with cooling on, never below ambient', () => {
    const plain = powered();
    const cooled = powered();
    for (const s of [plain, cooled]) s.world.datacenters.DA!.tempMilli = 80_000;
    cooled.world.datacenters.DA!.cooling = 3;
    steps(plain, 100);
    steps(cooled, 100);
    expect(cooled.world.datacenters.DA!.tempMilli).toBeLessThan(plain.world.datacenters.DA!.tempMilli);
    steps(cooled, 2000);
    expect(cooled.world.datacenters.DA!.tempMilli).toBe(25_000);
  });

  it('does not process or heat while its facility is shed', () => {
    const s = powered();
    s.world.plant.thermalSetting = 0;
    s.world.plant.wind = 0; // the wind won't move: maxChangePerSecond is 0
    const dc = s.world.datacenters.DA!;
    dc.jobFrom = 0;
    dc.jobUntil = 100;
    steps(s, 50);
    expect(s.world.ledger.datacenterIncome).toBe(0);
    expect(dc.tempMilli).toBe(25_000);
  });

  it('raises an overheat alert at 85 °C, once until it falls below 80 °C', () => {
    const s = powered();
    const dc = s.world.datacenters.DA!;
    dc.tempMilli = 86_000;
    steps(s, 5);
    dc.tempMilli = 86_000;
    steps(s, 5);
    expect(s.world.alerts.filter((a) => a.kind === 'overheat')).toHaveLength(1);
    dc.tempMilli = 70_000;
    steps(s, 1);
    dc.tempMilli = 86_000;
    steps(s, 1);
    expect(s.world.alerts.filter((a) => a.kind === 'overheat')).toHaveLength(2);
  });

  it('can catch fire above 90 °C and destroy the board, the same way for the same seed', () => {
    const burnStep = (seed: number): number | null => {
      const s = powered(seed);
      const dc = s.world.datacenters.DA!;
      for (let i = 0; i < 2000; i++) {
        dc.tempMilli = 140_000; // about 12,500 ppm per step
        s.step();
        if (s.world.boards[1]!.status === 'destroyed') return i;
      }
      return null;
    };
    const first = burnStep(5);
    expect(first).not.toBeNull();
    expect(burnStep(5)).toBe(first);
    const s = powered(5);
    for (let i = 0; i <= first!; i++) {
      s.world.datacenters.DA!.tempMilli = 140_000;
      s.step();
    }
    expect(s.world.alerts.map((a) => a.kind)).toEqual(expect.arrayContaining(['fire', 'boardDestroyed']));
  });

  it('never catches fire at or below 90 °C', () => {
    const s = powered();
    for (let i = 0; i < 5000; i++) {
      s.world.datacenters.DA!.tempMilli = 90_000;
      s.step();
    }
    expect(s.world.boards[1]!.status).toBe('running');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/test/datacenter.test.ts`
Expected: FAIL. Money and temperature don't change yet, so the income, heating, cooling, overheat, and fire tests fail; the shed and at-or-below-90 °C tests pass trivially.

- [ ] **Step 3: Write the datacenter phases**

`packages/core/src/datacenter.ts`:

```ts
import { clearFlag, raiseAlert, raiseOnce } from './alerts.ts';
import { destroyBoard } from './boards.ts';
import { idiv, MICRO, MILLI, mulDiv } from './fixed.ts';
import type { SimContext } from './world.ts';

/** Whether a datacenter's job covers this step and its board can work. */
export function isProcessing(ctx: SimContext, boardId: string, step: number): boolean {
  const board = ctx.world.boards.find((b) => b.id === boardId);
  const dc = ctx.world.datacenters[boardId];
  return !!board && !!dc && board.status === 'running' && board.powered && step >= dc.jobFrom && step <= dc.jobUntil;
}

/** Phase 6: income, heat, and cooling for every datacenter. */
export function runDatacenters(ctx: SimContext, step: number): void {
  const t = ctx.scenario.tuning.datacenter;
  const sps = ctx.scenario.time.stepsPerSecond;
  const w = ctx.world;
  for (const board of w.boards) {
    const dc = w.datacenters[board.id];
    if (!dc) continue;
    const working = board.status === 'running' && board.powered;
    let temp = dc.tempMilli;
    if (isProcessing(ctx, board.id, step)) {
      const income = mulDiv(w.jobPrice, MICRO, sps);
      w.money += income;
      w.ledger.datacenterIncome += income;
      temp += idiv(t.heatMilliPerSecond, sps);
    }
    temp -= idiv((temp - t.ambientMilli) * t.passiveCoolingPctPerSecond, 100 * sps);
    if (working && dc.cooling > 0) temp -= idiv(dc.cooling * t.coolingMilliPerLevelPerSecond, sps);
    dc.tempMilli = Math.max(temp, t.ambientMilli);
    if (dc.tempMilli >= t.overheatAlertMilli) {
      raiseOnce(w, `overheat:${board.id}`, step, 'overheat', board.id, `${board.id} 과열 ${idiv(dc.tempMilli, MILLI)}°C`);
    } else if (dc.tempMilli < t.overheatAlertMilli - 5 * MILLI) {
      clearFlag(w, `overheat:${board.id}`);
    }
  }
}

/** Phase 9: a datacenter above the fire threshold rolls for fire every step. */
export function runFires(ctx: SimContext, step: number): void {
  const t = ctx.scenario.tuning.datacenter;
  const sps = ctx.scenario.time.stepsPerSecond;
  for (const board of ctx.world.boards) {
    const dc = ctx.world.datacenters[board.id];
    if (!dc || board.status === 'destroyed' || board.status === 'rebuilding') continue;
    if (dc.tempMilli <= t.fireThresholdMilli) continue;
    const ppm = idiv((dc.tempMilli - t.fireThresholdMilli) * t.firePermillePerDegreePerSecond, sps);
    if (ctx.rng.fire.chancePpm(ppm)) {
      raiseAlert(ctx.world, step, 'fire', board.id, `${board.id}에 불이 났어요`);
      destroyBoard(ctx, board, step, 'fire');
    }
  }
}
```

In `packages/core/src/session.ts`, import `runDatacenters` and `runFires` from `./datacenter.ts` and add them to `step()` after the actions:

```ts
    const ticked = runBoardTicks(this.ctx, s);
    applyActions(this.ctx, s, ticked);
    runDatacenters(this.ctx, s);
    runFires(this.ctx, s);
    this.checkSeasonEnd(s);
```

Add to `packages/core/src/index.ts`:

```ts
export * from './datacenter.ts';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core`
Expected: PASS (datacenter 7, and every earlier core test). The tests read income from `ledger.datacenterIncome`, so Task 13's fuel and upkeep charges don't disturb them.

- [ ] **Step 5: Commit**

```bash
pnpm fix
git add packages/core
git commit -m "Give datacenters their physics: pro-rata income, heat, cooling, overheat alerts, and fire"
```

### Task 11: EMF: emission, the field, diffusion, and decay

Spec §5.7: each tick emits `a × instructions + b × actions` into the board's cell; an awake, powered board also emits its base EMF every step; each step every cell shares part of its value with its four neighbours and the whole field decays. Everything is milli-EMF on integers. The rumour gauge that turns the field into raids comes with the Luddites (Task 12).

**Files:**
- Create: `packages/core/src/emf.ts`
- Modify: `packages/core/src/session.ts` (`step()`), `packages/core/src/index.ts`
- Test: `packages/core/test/emf.test.ts`

**Interfaces:**
- Consumes: Task 4 (`SimContext`, `Ticked`, `cellIndex`, `TickOutcome`), Task 2 (`MILLI`, `idiv`, `mulDiv`).
- Produces:
  - `tickEmission(ctx, outcome): number` (milli-EMF one tick emits).
  - `diffuse(field: number[], width: number, height: number, sharePctPerSecond: number, decayPctPerSecond: number, stepsPerSecond: number): void` (in place).
  - `runEmf(ctx, ticked)`: phase 7. Tick emissions, base emissions, then diffusion and decay.
  - `fieldTotal(world): number` (whole EMF units over the map).

- [ ] **Step 1: Write the failing tests**

`packages/core/test/emf.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { diffuse, fieldTotal, tickEmission } from '../src/emf.ts';
import { Session } from '../src/session.ts';
import { cellIndex } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario } from './helpers/scenarios.ts';

function powered(host = new FakeHost()): Session {
  const s = new Session(
    m1Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
    }),
    1,
    host,
  );
  s.world.plant.thermalSetting = 300;
  return s;
}

describe('EMF', () => {
  it('turns instructions and actions into emission', () => {
    const s = powered();
    const outcome = { ok: true, instructions: 500, actions: [{ kind: 'process' as const }, { kind: 'cool' as const, level: 1 }], logs: [], error: null, ramUsedBytes: 0 };
    expect(tickEmission(s.ctx, outcome)).toBe(5_000 + 20_000);
  });

  it('shares 0.5% per step with each neighbour and decays 0.5% per step', () => {
    const field = new Array<number>(25).fill(0);
    field[12] = 1_000_000; // the middle of 5 x 5
    diffuse(field, 5, 5, 10, 10, 20);
    expect(field[12]).toBe(975_100); // 1,000,000 - 4 x 5,000, then - 4,900
    for (const n of [7, 11, 13, 17]) expect(field[n]).toBe(4_975);
    expect(field.reduce((a, b) => a + b, 0)).toBe(995_000);
  });

  it('shares only with neighbours inside the map', () => {
    const field = new Array<number>(9).fill(0);
    field[0] = 1_000_000; // a corner of 3 x 3
    diffuse(field, 3, 3, 10, 10, 20);
    expect(field[1]).toBe(4_975);
    expect(field[3]).toBe(4_975);
    expect(field[0]).toBe(985_050); // 1,000,000 - 2 x 5,000, then - 4,950
  });

  it('adds base EMF for awake, powered boards only', () => {
    const s = powered();
    s.world.boards[2]!.status = 'asleep';
    s.step();
    const at = (id: string) => {
      const b = s.world.boards.find((x) => x.id === id)!;
      return s.world.emf[cellIndex(s.scenario, b.x, b.y)]!;
    };
    expect(at('P')).toBeGreaterThan(0);
    expect(at('DA')).toBeGreaterThan(0);
    expect(at('DB')).toBe(0);
  });

  it('makes a busy board louder than an idle one', () => {
    const host = new FakeHost();
    const busy = host.program('busy', () => ({ instructions: 1800, actions: [{ kind: 'process' }] }));
    const idle = host.program('idle', () => ({ instructions: 30 }));
    const s = powered(host);
    s.deploy('DA', busy);
    s.deploy('DB', idle);
    for (let i = 0; i < 20 * 30; i++) s.step();
    const cell = (id: string) => {
      const b = s.world.boards.find((x) => x.id === id)!;
      return s.world.emf[cellIndex(s.scenario, b.x, b.y)]!;
    };
    expect(cell('DA')).toBeGreaterThan(cell('DB') * 3);
    expect(fieldTotal(s.world)).toBeGreaterThan(0);
  });

  it('lets the field fade when the boards go quiet', () => {
    const s = powered();
    for (let i = 0; i < 200; i++) s.step();
    const loud = fieldTotal(s.world);
    for (const b of s.world.boards) b.status = 'asleep';
    for (let i = 0; i < 20 * 60; i++) s.step();
    expect(fieldTotal(s.world)).toBeLessThan(loud / 10);
  });

  it('feeds the emf sensor from the board\'s cell', () => {
    const host = new FakeHost();
    let seen: number | undefined;
    const probe = host.program('probe', (sensors) => {
      seen = sensors.emf;
      return {};
    });
    const s = powered(host);
    s.deploy('DA', probe);
    for (let i = 0; i < 40; i++) s.step();
    const da = s.world.boards[1]!;
    expect(seen).toBeGreaterThan(0);
    expect(seen).toBeLessThanOrEqual(s.world.emf[cellIndex(s.scenario, da.x, da.y)]! / 1000 + 1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/test/emf.test.ts`
Expected: FAIL, `../src/emf.ts` doesn't exist.

- [ ] **Step 3: Write the EMF phase**

`packages/core/src/emf.ts`:

```ts
import { idiv, MILLI, mulDiv } from './fixed.ts';
import type { TickOutcome } from './firmware-host.ts';
import type { Ticked } from './ticks.ts';
import { cellIndex, type SimContext, type WorldState } from './world.ts';

/** Milli-EMF that one tick emits: instructions / instructionsPerUnit, plus perAction for each action. */
export function tickEmission(ctx: SimContext, outcome: TickOutcome): number {
  const e = ctx.scenario.tuning.emf;
  return mulDiv(outcome.instructions, MILLI, e.instructionsPerUnit) + outcome.actions.length * e.perAction * MILLI;
}

/**
 * One step of diffusion to the four neighbours inside the map, then decay. In place.
 * Decay rounds up, so that small values fade to zero instead of lingering.
 */
export function diffuse(
  field: number[],
  width: number,
  height: number,
  sharePctPerSecond: number,
  decayPctPerSecond: number,
  stepsPerSecond: number,
): void {
  const next = field.slice();
  const denom = 100 * stepsPerSecond;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const share = idiv(field[i]! * sharePctPerSecond, denom);
      if (share === 0) continue;
      const give = (n: number): void => {
        next[n] = next[n]! + share;
        next[i] = next[i]! - share;
      };
      if (x > 0) give(i - 1);
      if (x < width - 1) give(i + 1);
      if (y > 0) give(i - width);
      if (y < height - 1) give(i + width);
    }
  }
  for (let i = 0; i < next.length; i++) {
    const v = next[i]!;
    field[i] = v + idiv(-v * decayPctPerSecond, denom); // v - ceil(v * pct / denom)
  }
}

/** Phase 7: emissions from this step's ticks and from every awake, powered board; then diffusion and decay. */
export function runEmf(ctx: SimContext, ticked: readonly Ticked[]): void {
  const { scenario, world } = ctx;
  const sps = scenario.time.stepsPerSecond;
  for (const { board, outcome } of ticked) {
    const i = cellIndex(scenario, board.x, board.y);
    world.emf[i] = world.emf[i]! + tickEmission(ctx, outcome);
  }
  for (const board of world.boards) {
    if (board.status !== 'running' || !board.powered) continue;
    const i = cellIndex(scenario, board.x, board.y);
    world.emf[i] = world.emf[i]! + mulDiv(board.spec.baseEmfPerSecond, MILLI, sps);
  }
  const e = scenario.tuning.emf;
  diffuse(world.emf, scenario.grid.width, scenario.grid.height, e.diffusionPctPerSecond, e.decayPctPerSecond, sps);
}

/** The field's total in whole EMF units. */
export function fieldTotal(world: WorldState): number {
  let sum = 0;
  for (const v of world.emf) sum += v;
  return idiv(sum, MILLI);
}
```

In `packages/core/src/session.ts`, import `runEmf` from `./emf.ts` and run it after the datacenters:

```ts
    runDatacenters(this.ctx, s);
    runEmf(this.ctx, ticked);
    runFires(this.ctx, s);
```

Add to `packages/core/src/index.ts`:

```ts
export * from './emf.ts';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core`
Expected: PASS (emf 7, and every earlier core test).

- [ ] **Step 5: Commit**

```bash
pnpm fix
git add packages/core
git commit -m "Add the EMF field: tick and base emissions, diffusion, and decay"
```

### Task 12: Luddites

Spec §5.8: a rumour gauge fills with the town's total EMF every second; a full gauge brings a group of 3 to a seeded point on the map's edge. Groups step one cell a second toward the intact board with the strongest EMF above the detection threshold (re-aiming at every cell; along the row first), smash it on arrival, and move on; after 10 seconds with nothing detectable they walk to the nearest edge and leave. A group coming within 5 cells of a board raises one approach alert per board.

**Files:**
- Create: `packages/core/src/luddites.ts`
- Modify: `packages/core/src/session.ts` (`step()`), `packages/core/src/index.ts`
- Test: `packages/core/test/luddites.test.ts`

**Interfaces:**
- Consumes: Task 4 (`SimContext`, `LudditeGroup`, `BoardState`, `destroyBoard`, `raiseAlert`, `cellIndex`, `manhattan`), Task 11 (`fieldTotal`), Task 2 (`MILLI`, `idiv`).
- Produces:
  - `runRumour(ctx, step)`: once a second, adds `fieldTotal` to `world.rumour`; at the threshold, empties it and spawns a raid.
  - `spawnRaid(ctx, step): LudditeGroup`.
  - `strongestTarget(ctx): BoardState | null`.
  - `pathTo(fromX, fromY, toX, toY): Array<[number, number]>` (the cells a group will walk, row first; the viewer draws it).
  - `runLuddites(ctx, step)`: phase 8.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/luddites.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pathTo, runLuddites, spawnRaid, strongestTarget } from '../src/luddites.ts';
import { Session } from '../src/session.ts';
import { cellIndex, type LudditeGroup } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario } from './helpers/scenarios.ts';

function session(change?: Parameters<typeof m1Scenario>[0], host = new FakeHost(), seed = 3): Session {
  const s = new Session(
    m1Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      change?.(j);
    }),
    seed,
    host,
  );
  s.world.plant.thermalSetting = 300;
  return s;
}

function setEmf(s: Session, id: string, units: number): void {
  const b = s.world.boards.find((x) => x.id === id)!;
  s.world.emf[cellIndex(s.scenario, b.x, b.y)] = units * 1000;
}

function group(s: Session, x: number, y: number): LudditeGroup {
  const g: LudditeGroup = { id: s.world.nextLudditeId++, x, y, size: 3, targetId: null, quietSince: null, leaving: false, warned: [] };
  s.world.luddites.push(g);
  return g;
}

describe('Luddites', () => {
  it('walks row first, then column', () => {
    expect(pathTo(2, 1, 4, 3)).toEqual([[3, 1], [4, 1], [4, 2], [4, 3]]);
    expect(pathTo(4, 3, 4, 3)).toEqual([]);
  });

  it('targets the intact board with the strongest detectable EMF', () => {
    const s = session();
    s.world.emf.fill(0);
    setEmf(s, 'DA', 30);
    setEmf(s, 'DB', 50);
    expect(strongestTarget(s.ctx)?.id).toBe('DB');
    s.world.boards[2]!.status = 'destroyed';
    expect(strongestTarget(s.ctx)?.id).toBe('DA');
    setEmf(s, 'DA', 4); // below the threshold of 5
    setEmf(s, 'P', 0);
    expect(strongestTarget(s.ctx)).toBeNull();
  });

  it('spawns a raid on the map edge when the rumour gauge fills', () => {
    const s = session((j) => {
      j.tuning.emf.rumourThreshold = 200;
    });
    let steps = 0;
    while (s.world.stats.raids === 0 && steps < 20 * 120) {
      s.step();
      steps += 1;
    }
    expect(s.world.stats.raids).toBe(1);
    const g = s.world.luddites[0]!;
    // The gauge fills on a second's last step and groups move on its first, so it hasn't moved yet.
    expect(g.x === 0 || g.y === 0 || g.x === 19 || g.y === 11).toBe(true);
    expect(s.world.alerts.some((a) => a.kind === 'raid')).toBe(true);
    expect(s.world.rumour).toBeLessThan(200);
  });

  it('spawns at the same place for the same seed', () => {
    const a = session();
    const b = session();
    expect(spawnRaid(a.ctx, 0)).toEqual(spawnRaid(b.ctx, 0));
  });

  it('steps one cell a second toward its target and smashes it on arrival', () => {
    const s = session();
    const g = group(s, 16, 4); // DB is at (16, 8): four cells down
    for (let second = 0; second < 6; second++) {
      s.world.emf.fill(0);
      setEmf(s, 'DB', 50);
      runLuddites(s.ctx, second * 20);
    }
    expect(s.world.boards[2]!.status).toBe('destroyed');
    expect(g).toMatchObject({ x: 16, y: 8 });
    expect(s.world.alerts.filter((a) => a.kind === 'boardDestroyed')).toHaveLength(1);
  });

  it('moves only on its beat', () => {
    const s = session();
    const g = group(s, 16, 4);
    setEmf(s, 'DB', 50);
    runLuddites(s.ctx, 7); // not a multiple of 20
    expect(g).toMatchObject({ x: 16, y: 4 });
  });

  it('raises one approach alert per board', () => {
    const s = session();
    group(s, 16, 1);
    for (let second = 0; second < 6; second++) {
      setEmf(s, 'DB', 50);
      runLuddites(s.ctx, second * 20);
    }
    const near = s.world.alerts.filter((a) => a.kind === 'ludditesNear');
    expect(near).toHaveLength(1);
    expect(near[0]!.facilityId).toBe('DB');
  });

  it('gives up after 10 quiet seconds and leaves by the nearest edge', () => {
    const s = session();
    const g = group(s, 10, 2);
    for (let second = 0; second < 30 && s.world.luddites.length > 0; second++) {
      s.world.emf.fill(0);
      runLuddites(s.ctx, second * 20);
    }
    expect(g.leaving).toBe(true);
    expect(s.world.luddites).toHaveLength(0);
  });

  it('lets a board that sleeps escape', () => {
    const host = new FakeHost();
    const hider = host.program('hide', (sensors) => {
      const d = sensors.luddite_dist;
      return d !== undefined && d < 9 ? { actions: [{ kind: 'sleep', seconds: 40 }] } : { instructions: 1500, actions: [{ kind: 'process' }] };
    });
    // Only the group this test places: no raid from the gauge.
    const s = session((j) => {
      j.tuning.emf.rumourThreshold = 1_000_000_000;
    }, host);
    s.deploy('DB', hider);
    for (let i = 0; i < 20 * 20; i++) s.step(); // let DB get loud
    group(s, 16, 0); // 8 cells from DB: it hides at once, and its cell fades before the group gets there
    for (let i = 0; i < 20 * 60; i++) s.step();
    expect(s.world.boards[2]!.status).not.toBe('destroyed');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/test/luddites.test.ts`
Expected: FAIL, `../src/luddites.ts` doesn't exist.

- [ ] **Step 3: Write the Luddites**

`packages/core/src/luddites.ts`:

```ts
import { raiseAlert } from './alerts.ts';
import { destroyBoard } from './boards.ts';
import { idiv, MILLI } from './fixed.ts';
import { fieldTotal } from './emf.ts';
import { cellIndex, manhattan, type BoardState, type LudditeGroup, type SimContext } from './world.ts';

const SIDES = ['북쪽', '남쪽', '서쪽', '동쪽'] as const;

/** The cells from one point to another, along the row first, then the column. */
export function pathTo(fromX: number, fromY: number, toX: number, toY: number): Array<[number, number]> {
  const path: Array<[number, number]> = [];
  let x = fromX;
  let y = fromY;
  while (x !== toX) {
    x += Math.sign(toX - x);
    path.push([x, y]);
  }
  while (y !== toY) {
    y += Math.sign(toY - y);
    path.push([x, y]);
  }
  return path;
}

export function spawnRaid(ctx: SimContext, step: number): LudditeGroup {
  const { width, height } = ctx.scenario.grid;
  const r = ctx.rng.luddites;
  const side = r.int(0, 3);
  const along = side < 2 ? r.int(0, width - 1) : r.int(0, height - 1);
  const [x, y] = side === 0 ? [along, 0] : side === 1 ? [along, height - 1] : side === 2 ? [0, along] : [width - 1, along];
  const size = ctx.scenario.tuning.luddites.groupSize;
  const group: LudditeGroup = { id: ctx.world.nextLudditeId++, x, y, size, targetId: null, quietSince: null, leaving: false, warned: [] };
  ctx.world.luddites.push(group);
  ctx.world.stats.raids += 1;
  raiseAlert(ctx.world, step, 'raid', null, `러다이트 ${size}명이 나타났어요 (${SIDES[side]} 가장자리)`);
  return group;
}

/** Once a second the gauge collects the field's total; a full gauge brings a raid. */
export function runRumour(ctx: SimContext, step: number): void {
  const sps = ctx.scenario.time.stepsPerSecond;
  if (step % sps !== sps - 1) return;
  ctx.world.rumour += fieldTotal(ctx.world);
  if (ctx.world.rumour >= ctx.scenario.tuning.emf.rumourThreshold) {
    ctx.world.rumour = 0;
    spawnRaid(ctx, step);
  }
}

/** The intact board whose cell carries the strongest EMF at or above the detection threshold. */
export function strongestTarget(ctx: SimContext): BoardState | null {
  const threshold = ctx.scenario.tuning.emf.detectionThreshold * MILLI;
  let best: BoardState | null = null;
  let bestValue = -1;
  for (const b of ctx.world.boards) {
    if (b.status === 'destroyed' || b.status === 'rebuilding') continue;
    const v = ctx.world.emf[cellIndex(ctx.scenario, b.x, b.y)]!;
    if (v >= threshold && v > bestValue) {
      best = b;
      bestValue = v;
    }
  }
  return best;
}

function nearestEdgeStep(ctx: SimContext, g: LudditeGroup): [number, number] | null {
  const { width, height } = ctx.scenario.grid;
  const options: Array<[number, number, number]> = [
    [g.x, -1, 0],
    [width - 1 - g.x, 1, 0],
    [g.y, 0, -1],
    [height - 1 - g.y, 0, 1],
  ];
  let best = options[0]!;
  for (const o of options) if (o[0] < best[0]) best = o;
  return best[0] === 0 ? null : [best[1], best[2]];
}

function warnNearby(ctx: SimContext, g: LudditeGroup, step: number): void {
  const reach = ctx.scenario.tuning.luddites.approachCells;
  for (const b of ctx.world.boards) {
    if (b.status === 'destroyed' || b.status === 'rebuilding' || g.warned.includes(b.id)) continue;
    const d = manhattan(g.x, g.y, b.x, b.y);
    if (d <= reach) {
      g.warned.push(b.id);
      raiseAlert(ctx.world, step, 'ludditesNear', b.id, `러다이트가 ${b.id}에 다가오고 있어요 (${d}칸)`);
    }
  }
}

/** Phase 8: every group moves one cell on its beat, smashes what it reaches, or gives up and leaves. */
export function runLuddites(ctx: SimContext, step: number): void {
  const t = ctx.scenario.tuning.luddites;
  const sps = ctx.scenario.time.stepsPerSecond;
  if (step % idiv(sps, t.cellsPerSecond) !== 0) return;
  for (const g of [...ctx.world.luddites]) {
    if (g.leaving) {
      const dir = nearestEdgeStep(ctx, g);
      if (dir === null) ctx.world.luddites.splice(ctx.world.luddites.indexOf(g), 1);
      else {
        g.x += dir[0];
        g.y += dir[1];
      }
      continue;
    }
    const target = strongestTarget(ctx);
    if (!target) {
      g.targetId = null;
      g.quietSince ??= step;
      if (step - g.quietSince >= t.quietSecondsToLeave * sps) g.leaving = true;
      continue;
    }
    g.quietSince = null;
    g.targetId = target.id;
    const next = pathTo(g.x, g.y, target.x, target.y)[0];
    if (next) {
      g.x = next[0];
      g.y = next[1];
    }
    warnNearby(ctx, g, step);
    if (g.x === target.x && g.y === target.y) destroyBoard(ctx, target, step, 'luddites');
  }
}
```

In `packages/core/src/session.ts`, import `runLuddites` and `runRumour` from `./luddites.ts` and run them after the EMF phase:

```ts
    runDatacenters(this.ctx, s);
    runEmf(this.ctx, ticked);
    runRumour(this.ctx, s);
    runLuddites(this.ctx, s);
    runFires(this.ctx, s);
```

Add to `packages/core/src/index.ts`:

```ts
export * from './luddites.ts';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core`
Expected: PASS (luddites 9, and every earlier core test).

- [ ] **Step 5: Commit**

```bash
pnpm fix
git add packages/core
git commit -m "Add Luddites: the rumour gauge, raids, hunting the loudest board, smashing, and leaving"
```

### Task 13: Fuel, upkeep, rebuilding, and the ways a season ends

Spec §5.9 and §5.8: thermal output costs fuel at the day's price; every intact board costs upkeep; the human rebuilds a destroyed board for 500 over half a day, and it comes back with its last firmware and empty `mem`; a season ends completed, bankrupt (money below zero for 3 days), or fallen (every firmware board destroyed at once).

**Files:**
- Create: `packages/core/src/economy.ts`
- Modify: `packages/core/src/session.ts` (`step()`, `rebuild()`, `replay()`; `checkSeasonEnd` moves into `economy.ts` as `checkEnd`), `packages/core/src/index.ts`
- Test: `packages/core/test/economy.test.ts`

**Interfaces:**
- Consumes: Task 4 (`SimContext`, `appendLog`, `raiseAlert`, `raiseOnce`, `clearFlag`, `findBoard`, `RecordedInput`), Task 9 (`plantBoard`), Task 2 (`MICRO`, `mulDiv`, `stepsPerDay`, `seasonSteps`, `stepsForSeconds`).
- Produces:
  - `runEconomy(ctx)`: phase 10a. Fuel for the thermal output (only while the plant's board runs) and upkeep for each running or sleeping board.
  - `checkEnd(ctx, step)`: phase 10b. In order: bankruptcy, fall, season end. Each raises `seasonEnd` with its own message.
  - `startRebuild(ctx, board, step): { ok: true } | { ok: false; reason: string }`.
  - `Session.rebuild(boardId)`: records `{ kind: 'rebuild' }` when it succeeds; `replay` applies it.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/economy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MICRO } from '../src/fixed.ts';
import { replay, Session } from '../src/session.ts';
import { stateHash } from '../src/hash.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario } from './helpers/scenarios.ts';

const DAY = 800;

function calm(host = new FakeHost(), change?: Parameters<typeof m1Scenario>[0]): Session {
  return new Session(
    m1Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.fuelPrice = { start: 7, min: 7, max: 7 };
      j.tuning.emf.rumourThreshold = 1_000_000_000; // no raids
      change?.(j);
    }),
    1,
    host,
  );
}

function steps(s: Session, n: number): void {
  for (let i = 0; i < n; i++) s.step();
}

describe('economy', () => {
  it('charges 10 a day of upkeep for each intact board', () => {
    const s = calm();
    steps(s, DAY);
    expect(s.world.money).toBe((5000 - 30) * MICRO);
    expect(s.world.ledger.upkeep).toBe(30 * MICRO);
  });

  it('charges fuel for the thermal output at the day\'s price', () => {
    const s = calm();
    s.world.plant.thermalSetting = 100;
    steps(s, DAY);
    expect(s.world.ledger.fuel).toBe(700 * MICRO);
  });

  it('burns no fuel while the plant\'s board is down', () => {
    const s = calm();
    s.world.plant.thermalSetting = 100;
    s.world.boards[0]!.status = 'destroyed';
    steps(s, DAY);
    expect(s.world.ledger.fuel).toBe(0);
  });

  it('rebuilds a destroyed board for 500 over half a day, with its firmware and empty mem', () => {
    const host = new FakeHost();
    const src = host.program('count', (_s, mem) => {
      mem.n = ((mem.n as number | undefined) ?? 0) + 1;
      return { logs: [`n=${String(mem.n)}`] };
    });
    const s = calm(host);
    s.deploy('DA', src);
    steps(s, 12); // n = 3
    const da = s.world.boards[1]!;
    expect(s.rebuild('DA')).toEqual({ ok: false, reason: 'DA is not destroyed' });
    da.status = 'destroyed';
    da.vmBooted = false;
    const before = s.world.money;
    expect(s.rebuild('DA')).toEqual({ ok: true });
    expect(s.world.money).toBe(before - 500 * MICRO);
    expect(da.status).toBe('rebuilding');
    steps(s, 400); // ready at step 12 + 400 = 412, which this hasn't computed yet
    expect(da.status).toBe('rebuilding');
    steps(s, 1);
    expect(da.status).toBe('running');
    steps(s, 4);
    expect(da.log.filter((l) => l.kind === 'log').at(-1)?.text).toBe('n=1');
  });

  it('refuses a rebuild it can\'t pay for', () => {
    const s = calm();
    s.world.boards[2]!.status = 'destroyed';
    s.world.money = 100 * MICRO;
    expect(s.rebuild('DB')).toEqual({ ok: false, reason: 'not enough money' });
  });

  it('goes bankrupt after 3 days below zero, and recovering resets the clock', () => {
    const s = calm();
    s.world.money = -1;
    steps(s, DAY);
    s.world.money = 1 * MICRO; // back above zero for a step
    steps(s, 1);
    s.world.money = -1;
    steps(s, 3 * DAY - 1);
    expect(s.world.ended).toBeNull();
    steps(s, 1);
    expect(s.world.ended?.kind).toBe('bankrupt');
    expect(s.world.alerts.filter((a) => a.kind === 'moneyBelowZero')).toHaveLength(2);
  });

  it('falls when every firmware board is destroyed at once', () => {
    const s = calm();
    for (const b of s.world.boards) b.status = 'destroyed';
    s.step();
    expect(s.world.ended?.kind).toBe('fallen');
    expect(s.world.alerts.at(-1)).toMatchObject({ kind: 'seasonEnd', message: '마을이 함락됐어요' });
  });

  it('replays a rebuild', () => {
    const live = calm();
    steps(live, 5);
    live.world.boards[2]!.status = 'destroyed';
    // Destruction comes from the world in a real session; set it up the same way in the replay.
    live.rebuild('DB');
    steps(live, 500);
    const again = replay(live.scenario, live.seed, { ...live.record, inputs: [] }, new FakeHost(), 5);
    again.world.boards[2]!.status = 'destroyed';
    again.rebuild('DB');
    steps(again, 500);
    expect(stateHash(again.world)).toBe(stateHash(live.world));
    expect(live.record.inputs).toEqual([{ step: 5, kind: 'rebuild', boardId: 'DB' }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/test/economy.test.ts`
Expected: FAIL. Money doesn't change yet, and `Session.rebuild` doesn't exist.

- [ ] **Step 3: Write the economy**

`packages/core/src/economy.ts`:

```ts
import { clearFlag, raiseAlert, raiseOnce } from './alerts.ts';
import { appendLog } from './boards.ts';
import { MICRO, mulDiv } from './fixed.ts';
import { plantBoard } from './power.ts';
import { seasonSteps, stepsForSeconds, stepsPerDay } from './time.ts';
import type { BoardState, EndKind, SimContext } from './world.ts';

/** Phase 10a: fuel for the thermal output and upkeep for every running or sleeping board. */
export function runEconomy(ctx: SimContext): void {
  const w = ctx.world;
  const spd = stepsPerDay(ctx.scenario.time);
  const thermal = plantBoard(w).status === 'running' ? w.plant.thermalSetting : 0;
  const fuel = mulDiv(thermal * w.plant.fuelPrice, MICRO, spd);
  const intact = w.boards.filter((b) => b.status === 'running' || b.status === 'asleep').length;
  const upkeep = mulDiv(intact * ctx.scenario.tuning.boardUpkeepPerDay, MICRO, spd);
  w.money -= fuel + upkeep;
  w.ledger.fuel += fuel;
  w.ledger.upkeep += upkeep;
}

function end(ctx: SimContext, step: number, kind: EndKind, message: string): void {
  ctx.world.ended = { kind, step };
  raiseAlert(ctx.world, step, 'seasonEnd', null, message);
}

/** Phase 10b: bankruptcy, then the town's fall, then the season's last step. */
export function checkEnd(ctx: SimContext, step: number): void {
  const w = ctx.world;
  if (w.ended) return;
  if (w.money < 0) {
    w.belowZeroSince ??= step;
    raiseOnce(w, 'belowZero', step, 'moneyBelowZero', null, '자금이 바닥났어요');
  } else {
    w.belowZeroSince = null;
    clearFlag(w, 'belowZero');
  }
  const spd = stepsPerDay(ctx.scenario.time);
  if (w.belowZeroSince !== null && step - w.belowZeroSince + 1 >= ctx.scenario.tuning.bankruptcyDays * spd) {
    end(ctx, step, 'bankrupt', '파산했어요');
  } else if (w.boards.every((b) => b.status === 'destroyed' || b.status === 'rebuilding')) {
    end(ctx, step, 'fallen', '마을이 함락됐어요');
  } else if (step + 1 >= seasonSteps(ctx.scenario.time)) {
    end(ctx, step, 'completed', '시즌이 끝났어요');
  }
}

/** The human's rebuild of a destroyed board: it pays now and comes back after the rebuild time. */
export function startRebuild(ctx: SimContext, board: BoardState, step: number): { ok: true } | { ok: false; reason: string } {
  const t = ctx.scenario.tuning.rebuild;
  if (board.status !== 'destroyed') return { ok: false, reason: `${board.id} is not destroyed` };
  const cost = t.cost * MICRO;
  if (ctx.world.money < cost) return { ok: false, reason: 'not enough money' };
  ctx.world.money -= cost;
  ctx.world.ledger.rebuild += cost;
  board.status = 'rebuilding';
  board.readyAt = step + stepsForSeconds(ctx.scenario.time, t.seconds);
  appendLog(board, step, 'system', `rebuilding (ready in ${t.seconds} s)`);
  return { ok: true };
}
```

In `packages/core/src/session.ts`:
- import `checkEnd`, `runEconomy`, and `startRebuild` from `./economy.ts`;
- delete the private `checkSeasonEnd` method (and the now-unused `raiseAlert` and `seasonSteps` imports);
- end `step()` with the economy and the end check:

```ts
    runFires(this.ctx, s);
    runEconomy(this.ctx);
    checkEnd(this.ctx, s);
    w.step = s + 1;
```

- add `rebuild` after `deploy`:

```ts
  /** The human's rebuild of a destroyed board. */
  rebuild(boardId: string): { ok: true } | { ok: false; reason: string } {
    const board = findBoard(this.world, boardId);
    if (!board) return { ok: false, reason: `unknown board ${boardId}` };
    const result = startRebuild(this.ctx, board, this.world.step);
    if (result.ok) this.record.inputs.push({ step: this.world.step, kind: 'rebuild', boardId });
    return result;
  }
```

- in `replay`, apply rebuilds too:

```ts
      if (input.kind === 'deploy') session.deploy(input.boardId, input.source);
      else if (input.kind === 'rebuild') session.rebuild(input.boardId);
      else session.mark(input.kind);
```

Add to `packages/core/src/index.ts`:

```ts
export * from './economy.ts';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core`
Expected: PASS (economy 8, and every earlier core test; the session test "ends the season after its last step" still passes through `checkEnd`).

- [ ] **Step 5: Commit**

```bash
pnpm fix
git add packages/core
git commit -m "Charge fuel and upkeep, let the human rebuild, and end seasons by bankruptcy, fall, or completion"
```

### Task 14: Read-only views, datasheets, and the agent tool definitions

Everything the MCP server and the viewer read comes from pure functions over the world: board summaries, datasheets (spec §6.7: enough to write firmware without the game's code), firmware, logs, the map (no EMF, no Luddites: spec §7.3), status, alerts, and the viewer's snapshot. The agent tools of spec §7.3 are defined here, in the core, with zod input schemas and handlers written against a `GameApi` interface, so the MCP server (Task 17) and a later WebMCP adapter can both expose them unchanged.

**Files:**
- Create: `packages/core/src/datasheet.ts`, `packages/core/src/queries.ts`, `packages/core/src/agent-tools.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/queries.test.ts`, `packages/core/test/agent-tools.test.ts`

**Interfaces:**
- Consumes: Task 4 (`WorldState`, `BoardState`, `Alert`, `findBoard`, `sensorFrame`, `SENSOR_KEYS`), Task 9 (`facilityDemand`, `priorityOrder`, `plantBoard`), Task 10 (`isProcessing`), Task 12 (`pathTo`), Task 3 (`Scenario`, `SensorName`, `FacilityKind`), Task 2 (`gameTime`, `MICRO`, `MILLI`, `idiv`).
- Produces:
  - `datasheet.ts`: `SENSOR_DOCS: Record<SensorName, { unit: string; meaning: string }>`; `ACTION_DOCS: Record<FacilityKind | 'any', Array<{ call: string; meaning: string }>>`; `FIRMWARE_RULES: readonly string[]`; `interface Datasheet`; `datasheet(ctx, boardId): Datasheet | null`.
  - `queries.ts`: `interface TimeView { day; clock; seconds }`; `timeView(scenario, step)`; `BoardSummary` and `listBoards(world)`; `FirmwareView` and `firmwareView(world, id)`; `LogView` and `logsView(ctx, id, sinceSeconds?)`; `MapView` and `mapView(ctx)`; `StatusView` and `statusView(ctx)`; `AlertView` and `alertsView(ctx, sinceSeconds?)`; `Snapshot` and `snapshot(ctx)`; `BoardInspection` and `inspectBoard(ctx, id)` (the viewer's panel: datasheet, firmware, the last 50 log lines, live sensors).
  - `agent-tools.ts`: `DeployOutcome`; `interface GameApi`; `class ToolError extends Error`; `interface AgentTool { name; description; inputSchema: z.ZodRawShape; run(api, args): Promise<unknown> }`; `AGENT_TOOLS: readonly AgentTool[]` (exactly `list_boards`, `get_datasheet`, `get_firmware`, `deploy_firmware`, `read_logs`, `get_map`, `get_status`, `get_alerts`); `AGENT_INSTRUCTIONS: string` (the primer the MCP server sends at initialize).

- [ ] **Step 1: Write the failing tests**

`packages/core/test/queries.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { datasheet } from '../src/datasheet.ts';
import { alertsView, inspectBoard, listBoards, logsView, mapView, snapshot, statusView, timeView } from '../src/queries.ts';
import { Session } from '../src/session.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario } from './helpers/scenarios.ts';

function session(): { s: Session; host: FakeHost } {
  const host = new FakeHost();
  host.program('hello', () => ({ logs: ['hello'] }));
  const s = new Session(
    m1Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.emf.rumourThreshold = 1_000_000_000;
    }),
    1,
    host,
  );
  return { s, host };
}

describe('views', () => {
  it('formats game time', () => {
    const { s } = session();
    expect(timeView(s.scenario, 0)).toEqual({ day: 1, clock: '00:00', seconds: 0 });
    expect(timeView(s.scenario, 800 + 400)).toEqual({ day: 2, clock: '12:00', seconds: 60 });
  });

  it('lists boards with their firmware state', () => {
    const { s } = session();
    s.deploy('DA', 'hello');
    expect(listBoards(s.world)[1]).toMatchObject({ id: 'DA', kind: 'datacenter', firmwareVersion: null, pendingVersion: 1 });
    for (let i = 0; i < 4; i++) s.step();
    expect(listBoards(s.world)[1]).toMatchObject({ firmwareVersion: 1, pendingVersion: null, status: 'running', lastError: null });
  });

  it('describes a datacenter board completely enough to program it', () => {
    const { s } = session();
    const d = datasheet(s.ctx, 'DA')!;
    expect(d.parts).toMatchObject({ clockHz: 5, instructionsPerTick: 2000, ramBytes: 8192 });
    expect(d.io.reads.map((r) => r.name)).toEqual(['temp', 'power_headroom', 'price', 'emf', 'luddite_dist', 'day', 'clock']);
    expect(d.io.actions.map((a) => a.call)).toEqual(['io.process()', 'io.cool(level)', 'io.log(...)', 'io.sleep(seconds)']);
    expect(d.baseEmfPerSecond).toBe(25);
    expect(d.rules.join('\n')).toContain('string.find');
    expect(datasheet(s.ctx, 'P')!.io.actions.map((a) => a.call)).toContain('io.set_priority({ids})');
    expect(datasheet(s.ctx, 'ZZ')).toBeNull();
  });

  it('reads logs with game time, and filters by time', () => {
    const { s } = session();
    s.deploy('DA', 'hello');
    for (let i = 0; i < 40; i++) s.step(); // beats at 3, 7, ..., 39
    const all = logsView(s.ctx, 'DA')!;
    expect(all[0]).toMatchObject({ kind: 'system', text: 'firmware v1 installed', day: 1 });
    expect(all[1]).toMatchObject({ kind: 'log', text: 'hello', repeat: 10 });
    expect(logsView(s.ctx, 'DA', 1.9)).toHaveLength(1);
    expect(logsView(s.ctx, 'ZZ')).toBeNull();
  });

  it('maps facilities with distances but no EMF or Luddites', () => {
    const { s } = session();
    const m = mapView(s.ctx);
    expect(m.facilities.map((f) => [f.id, f.distanceToPlant])).toEqual([
      ['P', 0],
      ['DA', 1],
      ['DB', 16],
    ]);
    expect(JSON.stringify(m)).not.toMatch(/emf|luddite/i);
  });

  it('reports status in whole money and filters alerts by time', () => {
    const { s } = session();
    s.world.boards[2]!.status = 'destroyed';
    s.step();
    const st = statusView(s.ctx);
    expect(st.money).toBe(4999);
    expect(st.power.generation).toBe(220);
    expect(alertsView(s.ctx).map((a) => a.kind)).toEqual([]);
    for (let i = 0; i < 40; i++) s.step(); // two seconds in
    s.world.datacenters.DA!.tempMilli = 88_000;
    s.step();
    expect(alertsView(s.ctx, 1).map((a) => a.kind)).toEqual(['overheat']);
    expect(alertsView(s.ctx, 3)).toEqual([]);
  });

  it('snapshots what the viewer draws, including a Luddite group\'s path', () => {
    const { s } = session();
    s.world.luddites.push({ id: 1, x: 10, y: 0, size: 3, targetId: 'DB', quietSince: null, leaving: false, warned: [] });
    const snap = snapshot(s.ctx);
    expect(snap.grid).toEqual({ width: 20, height: 12 });
    expect(snap.rebuild).toEqual({ cost: 500, hours: 12 });
    expect(snap.emf).toHaveLength(240);
    expect(snap.luddites[0]!.path.at(-1)).toEqual([16, 8]);
    expect(snap.boards.map((b) => b.id)).toEqual(['P', 'DA', 'DB']);
    expect(snap.boards[1]!.tempC).toBe(25);
  });

  it('inspects a board for the viewer\'s panel', () => {
    const { s } = session();
    s.deploy('DA', 'hello');
    for (let i = 0; i < 4; i++) s.step();
    const inspection = inspectBoard(s.ctx, 'DA')!;
    expect(inspection.firmware?.source).toBe('hello');
    expect(inspection.sensors.temp).toBe(25);
    expect(inspection.logs.length).toBeGreaterThan(0);
  });
});
```

`packages/core/test/agent-tools.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { AGENT_INSTRUCTIONS, AGENT_TOOLS, type GameApi, ToolError } from '../src/agent-tools.ts';

function fakeApi(): GameApi & { deployed: Array<[string, string]> } {
  const deployed: Array<[string, string]> = [];
  return {
    deployed,
    listBoards: async () => [],
    datasheet: async (board) => (board === 'DA' ? ({ board: 'DA' } as never) : null),
    firmware: async () => null,
    deploy: async (board, code) => {
      deployed.push([board, code]);
      return { ok: true, version: 2, installsAt: 'the board\'s next tick' };
    },
    logs: async () => [],
    map: async () => ({ width: 1, height: 1, facilities: [] }),
    status: async () => ({}) as never,
    alerts: async () => [],
  };
}

const tool = (name: string) => AGENT_TOOLS.find((t) => t.name === name)!;

describe('agent tools', () => {
  it('are exactly the tools of spec 7.3, each described', () => {
    expect(AGENT_TOOLS.map((t) => t.name)).toEqual([
      'list_boards',
      'get_datasheet',
      'get_firmware',
      'deploy_firmware',
      'read_logs',
      'get_map',
      'get_status',
      'get_alerts',
    ]);
    for (const t of AGENT_TOOLS) expect(t.description.length).toBeGreaterThan(40);
    expect(AGENT_INSTRUCTIONS).toContain('get_datasheet');
  });

  it('deploys through the game API', async () => {
    const api = fakeApi();
    await expect(tool('deploy_firmware').run(api, { board: 'DA', code: 'function tick() end' })).resolves.toEqual({
      ok: true,
      version: 2,
      installsAt: 'the board\'s next tick',
    });
    expect(api.deployed).toEqual([['DA', 'function tick() end']]);
  });

  it('turns an unknown board into a ToolError', async () => {
    await expect(tool('get_datasheet').run(fakeApi(), { board: 'ZZ' })).rejects.toBeInstanceOf(ToolError);
  });

  it('limits firmware to 64 KB in its schema', () => {
    const schema = tool('deploy_firmware').inputSchema.code as z.ZodString;
    expect(schema.safeParse('x'.repeat(65_536)).success).toBe(true);
    expect(schema.safeParse('x'.repeat(65_537)).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/test/queries.test.ts packages/core/test/agent-tools.test.ts`
Expected: FAIL, the three modules don't exist.

- [ ] **Step 3: Write the datasheet**

`packages/core/src/datasheet.ts`:

```ts
import { facilityDemand, plantBoard } from './power.ts';
import type { FacilityKind, SensorName } from './scenario.ts';
import { SENSOR_KEYS } from './sensors.ts';
import { findBoard, manhattan, type SimContext } from './world.ts';

export const SENSOR_DOCS: Record<SensorName, { unit: string; meaning: string }> = {
  wind: { unit: 'power units', meaning: "the wind module's output right now; it costs nothing" },
  demand: { unit: 'power units', meaning: 'everything the town requests this step, transmission loss included' },
  fuelPrice: { unit: 'money per unit per day', meaning: 'what each unit of thermal output costs, redrawn every day' },
  temp: { unit: '°C', meaning: "this datacenter's temperature; above 90 it can catch fire, and fire destroys the board" },
  powerHeadroom: { unit: 'power units', meaning: 'generation minus demand; negative means the plant is shedding facilities' },
  price: { unit: 'money per second of processing', meaning: 'the current job price, which drifts over time' },
  emf: { unit: 'EMF units', meaning: "the EMF in this board's cell; Luddites hunt the strongest" },
  ludditeDist: { unit: 'cells', meaning: 'the distance to the nearest Luddite group, nil when none is on the map' },
};

const TIME_READS = [
  { name: 'day', unit: 'day', meaning: 'the season day, from 1' },
  { name: 'clock', unit: 'seconds', meaning: 'game seconds since the season started' },
];

export const ACTION_DOCS: Record<FacilityKind | 'any', ReadonlyArray<{ call: string; meaning: string }>> = {
  datacenter: [
    { call: 'io.process()', meaning: 'run one job until your next tick: earns price x seconds, draws 150 power, and heats the datacenter (+2 °C/s)' },
    { call: 'io.cool(level)', meaning: 'set cooling to level 0-3; each level takes 0.8 °C/s off and draws 20 power; it stays set' },
  ],
  power: [
    { call: 'io.set_thermal(output)', meaning: 'set the thermal module to 0-300 power units; it stays set and costs fuel_price per unit per day' },
    { call: 'io.set_priority({ids})', meaning: 'who keeps power in a shortage, highest first, such as {"DA", "DB"}; the unlisted come after' },
  ],
  any: [
    { call: 'io.log(...)', meaning: 'log a line (print does the same); 20 lines per tick, 200 characters each' },
    { call: 'io.sleep(seconds)', meaning: 'deep sleep for 1-40 s: silent and nearly powerless, but RAM (mem and globals) is wiped' },
  ],
};

export const FIRMWARE_RULES: readonly string[] = [
  'Define function tick(io, mem). It runs once per beat of the board\'s clock while the board is powered and awake.',
  'mem persists across ticks and deploys (hot reload); globals reset on every deploy. Deep sleep and destruction wipe both.',
  'Actions queue during the tick and apply when it returns. A tick that errors, runs out of RAM, or exceeds the instruction cap is aborted: its actions are dropped, and a capped tick counts as the whole cap toward EMF.',
  'EMF per tick = instructions / 100 + 10 per action; an awake board also emits its base EMF every second. Efficient firmware is quieter.',
  'Available: the base library (pairs, pcall, setmetatable, ...), string, table, math, coroutine. Missing: os, io (the library), load, require, debug, collectgarbage, utf8.',
  'string.find searches plain text only; string.match, gmatch, and gsub don\'t exist. math.randomseed doesn\'t exist; math.random is seeded per board.',
  'tostring of a table or function gives just its type, and setmetatable refuses __gc and __mode.',
  'Adding keys to a table while traversing it with pairs or next gives an undefined order.',
];

export interface Datasheet {
  readonly board: string;
  readonly facility: { readonly kind: FacilityKind; readonly x: number; readonly y: number; readonly distanceToPlant: number };
  readonly parts: { readonly clockHz: number; readonly instructionsPerTick: number; readonly ramBytes: number };
  readonly io: {
    readonly reads: ReadonlyArray<{ readonly name: string; readonly unit: string; readonly meaning: string }>;
    readonly actions: ReadonlyArray<{ readonly call: string; readonly meaning: string }>;
  };
  readonly powerDrawNow: number;
  readonly baseEmfPerSecond: number;
  readonly firmware: {
    readonly version: number | null;
    readonly pendingVersion: number | null;
    readonly lastInstructions: number | null;
    readonly lastError: string | null;
    readonly ramUsedBytes: number | null;
  };
  readonly rules: readonly string[];
}

export function datasheet(ctx: SimContext, boardId: string): Datasheet | null {
  const board = findBoard(ctx.world, boardId);
  if (!board) return null;
  const plant = plantBoard(ctx.world);
  const reads = [
    ...board.spec.sensors.map((s) => ({ name: SENSOR_KEYS[s], ...SENSOR_DOCS[s] })),
    ...TIME_READS,
  ];
  const last = board.lastTick;
  return {
    board: board.id,
    facility: { kind: board.kind, x: board.x, y: board.y, distanceToPlant: manhattan(board.x, board.y, plant.x, plant.y) },
    parts: { clockHz: board.spec.clockHz, instructionsPerTick: board.spec.instructionCap, ramBytes: board.spec.ramKb * 1024 },
    io: { reads, actions: [...ACTION_DOCS[board.kind], ...ACTION_DOCS.any] },
    powerDrawNow: facilityDemand(ctx, board, ctx.world.step),
    baseEmfPerSecond: board.spec.baseEmfPerSecond,
    firmware: {
      version: board.firmware?.version ?? null,
      pendingVersion: board.pending?.version ?? null,
      lastInstructions: last?.instructions ?? null,
      lastError: last?.error ? `${last.error.kind}: ${last.error.message}` : null,
      ramUsedBytes: last?.ramUsedBytes ?? null,
    },
    rules: FIRMWARE_RULES,
  };
}
```

- [ ] **Step 4: Write the views**

`packages/core/src/queries.ts`:

```ts
import { isProcessing } from './datacenter.ts';
import { datasheet, type Datasheet } from './datasheet.ts';
import { idiv, MICRO, MILLI } from './fixed.ts';
import { pathTo } from './luddites.ts';
import { facilityDemand, plantBoard, priorityOrder } from './power.ts';
import type { FacilityKind, Scenario } from './scenario.ts';
import { sensorFrame } from './sensors.ts';
import { gameTime } from './time.ts';
import { findBoard, manhattan, type AlertKind, type BoardStatus, type LogLine, type SimContext, type WorldState } from './world.ts';

export interface TimeView {
  readonly day: number;
  /** HH:MM within the day. */
  readonly clock: string;
  /** Game seconds since the season started. */
  readonly seconds: number;
}

export function timeView(scenario: Scenario, step: number): TimeView {
  const t = gameTime(scenario.time, step);
  return { day: t.day, clock: `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`, seconds: t.seconds };
}

export interface BoardSummary {
  readonly id: string;
  readonly kind: FacilityKind;
  readonly x: number;
  readonly y: number;
  readonly status: BoardStatus;
  readonly powered: boolean;
  readonly firmwareVersion: number | null;
  readonly pendingVersion: number | null;
  readonly lastError: string | null;
}

export function listBoards(world: WorldState): BoardSummary[] {
  return world.boards.map((b) => ({
    id: b.id,
    kind: b.kind,
    x: b.x,
    y: b.y,
    status: b.status,
    powered: b.powered,
    firmwareVersion: b.firmware?.version ?? null,
    pendingVersion: b.pending?.version ?? null,
    lastError: b.lastTick?.error ? `${b.lastTick.error.kind}: ${b.lastTick.error.message}` : null,
  }));
}

export interface FirmwareView {
  readonly version: number | null;
  readonly source: string | null;
  readonly pending: { readonly version: number; readonly source: string } | null;
}

export function firmwareView(world: WorldState, boardId: string): FirmwareView | null {
  const b = findBoard(world, boardId);
  if (!b) return null;
  return { version: b.firmware?.version ?? null, source: b.firmware?.source ?? null, pending: b.pending };
}

export interface LogView extends TimeView {
  readonly kind: LogLine['kind'];
  readonly text: string;
  readonly repeat: number;
}

export function logsView(ctx: SimContext, boardId: string, sinceSeconds?: number): LogView[] | null {
  const b = findBoard(ctx.world, boardId);
  if (!b) return null;
  return b.log
    .map((l) => ({ ...timeView(ctx.scenario, l.step), kind: l.kind, text: l.text, repeat: l.repeat }))
    .filter((l) => sinceSeconds === undefined || l.seconds > sinceSeconds);
}

export interface MapView {
  readonly width: number;
  readonly height: number;
  readonly facilities: ReadonlyArray<{
    readonly id: string;
    readonly kind: FacilityKind;
    readonly x: number;
    readonly y: number;
    readonly status: BoardStatus;
    readonly powered: boolean;
    readonly distanceToPlant: number;
  }>;
}

export function mapView(ctx: SimContext): MapView {
  const plant = plantBoard(ctx.world);
  return {
    width: ctx.scenario.grid.width,
    height: ctx.scenario.grid.height,
    facilities: ctx.world.boards.map((b) => ({
      id: b.id,
      kind: b.kind,
      x: b.x,
      y: b.y,
      status: b.status,
      powered: b.powered,
      distanceToPlant: manhattan(b.x, b.y, plant.x, plant.y),
    })),
  };
}

export interface StatusView {
  readonly time: TimeView;
  readonly seasonDays: number;
  /** Whole money units. */
  readonly money: number;
  readonly power: { readonly generation: number; readonly demand: number; readonly shed: readonly string[] };
  readonly ended: WorldState['ended'];
}

export function statusView(ctx: SimContext): StatusView {
  const w = ctx.world;
  return {
    time: timeView(ctx.scenario, w.step),
    seasonDays: ctx.scenario.time.seasonDays,
    money: idiv(w.money, MICRO),
    power: { generation: w.plant.generation, demand: w.plant.demand, shed: [...w.plant.shed] },
    ended: w.ended,
  };
}

export interface AlertView extends TimeView {
  readonly id: number;
  readonly kind: AlertKind;
  readonly facility: string | null;
  readonly message: string;
}

export function alertsView(ctx: SimContext, sinceSeconds?: number): AlertView[] {
  return ctx.world.alerts
    .map((a) => ({ ...timeView(ctx.scenario, a.step), id: a.id, kind: a.kind, facility: a.facilityId, message: a.message }))
    .filter((a) => sinceSeconds === undefined || a.seconds > sinceSeconds);
}

/** Everything the viewer draws in one frame. */
export interface Snapshot {
  readonly step: number;
  readonly time: TimeView;
  readonly seasonDays: number;
  readonly money: number;
  readonly ended: WorldState['ended'];
  readonly grid: { readonly width: number; readonly height: number };
  /** What rebuilding a destroyed board costs, in whole money units, and how many game hours it takes. */
  readonly rebuild: { readonly cost: number; readonly hours: number };
  readonly plant: {
    readonly wind: number;
    readonly thermal: number;
    readonly fuelPrice: number;
    readonly generation: number;
    readonly demand: number;
    readonly shed: readonly string[];
    readonly priority: readonly string[];
  };
  readonly boards: ReadonlyArray<{
    readonly id: string;
    readonly kind: FacilityKind;
    readonly x: number;
    readonly y: number;
    readonly status: BoardStatus;
    readonly powered: boolean;
    readonly hasFirmware: boolean;
    readonly erroring: boolean;
    readonly tempC: number | null;
    readonly processing: boolean;
    readonly cooling: number;
    readonly demand: number;
  }>;
  readonly luddites: ReadonlyArray<{
    readonly id: number;
    readonly x: number;
    readonly y: number;
    readonly size: number;
    readonly targetId: string | null;
    readonly leaving: boolean;
    readonly path: ReadonlyArray<readonly [number, number]>;
  }>;
  /** Whole EMF units per cell, row-major. */
  readonly emf: readonly number[];
}

export function snapshot(ctx: SimContext): Snapshot {
  const w = ctx.world;
  const s = w.step;
  return {
    step: s,
    time: timeView(ctx.scenario, s),
    seasonDays: ctx.scenario.time.seasonDays,
    money: idiv(w.money, MICRO),
    ended: w.ended,
    grid: { ...ctx.scenario.grid },
    rebuild: {
      cost: ctx.scenario.tuning.rebuild.cost,
      hours: idiv(ctx.scenario.tuning.rebuild.seconds * 24, ctx.scenario.time.secondsPerDay),
    },
    plant: {
      wind: w.plant.wind,
      thermal: w.plant.thermalSetting,
      fuelPrice: w.plant.fuelPrice,
      generation: w.plant.generation,
      demand: w.plant.demand,
      shed: [...w.plant.shed],
      priority: priorityOrder(w).map((b) => b.id),
    },
    boards: w.boards.map((b) => {
      const dc = w.datacenters[b.id];
      return {
        id: b.id,
        kind: b.kind,
        x: b.x,
        y: b.y,
        status: b.status,
        powered: b.powered,
        hasFirmware: b.firmware !== null || b.pending !== null,
        erroring: b.lastTick?.error != null,
        tempC: dc ? idiv(dc.tempMilli, MILLI) : null,
        processing: dc ? isProcessing(ctx, b.id, s) : false,
        cooling: dc?.cooling ?? 0,
        demand: facilityDemand(ctx, b, s),
      };
    }),
    luddites: w.luddites.map((g) => {
      const target = g.targetId === null ? undefined : findBoard(w, g.targetId);
      return {
        id: g.id,
        x: g.x,
        y: g.y,
        size: g.size,
        targetId: g.targetId,
        leaving: g.leaving,
        path: target ? pathTo(g.x, g.y, target.x, target.y) : [],
      };
    }),
    emf: w.emf.map((v) => idiv(v, MILLI)),
  };
}

/** The viewer's panel for one board. */
export interface BoardInspection {
  readonly datasheet: Datasheet;
  readonly firmware: { readonly version: number; readonly source: string } | null;
  readonly pending: FirmwareView['pending'];
  readonly logs: readonly LogView[];
  readonly sensors: Readonly<Record<string, number | undefined>>;
}

export function inspectBoard(ctx: SimContext, boardId: string): BoardInspection | null {
  const board = findBoard(ctx.world, boardId);
  const sheet = datasheet(ctx, boardId);
  if (!board || !sheet) return null;
  return {
    datasheet: sheet,
    firmware: board.firmware,
    pending: board.pending,
    logs: (logsView(ctx, boardId) ?? []).slice(-50),
    sensors: sensorFrame(ctx, board),
  };
}

```

- [ ] **Step 5: Write the agent tools**

`packages/core/src/agent-tools.ts`:

```ts
import { z } from 'zod';
import type { Datasheet } from './datasheet.ts';
import type { AlertView, BoardSummary, FirmwareView, LogView, MapView, StatusView } from './queries.ts';

export type DeployOutcome = { readonly ok: true; readonly version: number; readonly installsAt: string } | { readonly ok: false; readonly error: string };

/** What the tools need from the game; the server implements it on top of the session. */
export interface GameApi {
  listBoards(): Promise<BoardSummary[]>;
  datasheet(board: string): Promise<Datasheet | null>;
  firmware(board: string): Promise<FirmwareView | null>;
  deploy(board: string, code: string): Promise<DeployOutcome>;
  logs(board: string, sinceSeconds: number | undefined): Promise<LogView[] | null>;
  map(): Promise<MapView>;
  status(): Promise<StatusView>;
  alerts(sinceSeconds: number | undefined): Promise<AlertView[]>;
}

/** A tool call the game refuses (an unknown board, for instance); the server reports it as a tool error. */
export class ToolError extends Error {}

export interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodRawShape;
  run(api: GameApi, args: Record<string, unknown>): Promise<unknown>;
}

const board = z.string().describe('A board id, such as "DA". list_boards lists them.');
const since = z.number().optional().describe('Only entries after this many game seconds into the season.');

function known<T>(value: T | null, id: unknown): T {
  if (value === null) throw new ToolError(`unknown board ${String(id)}; list_boards lists the boards`);
  return value;
}

export const AGENT_TOOLS: readonly AgentTool[] = [
  {
    name: 'list_boards',
    description: "Every board in the town: its facility, position, state (running, asleep, destroyed, rebuilding), whether it has power, its firmware version, and its latest error.",
    inputSchema: {},
    run: (api) => api.listBoards(),
  },
  {
    name: 'get_datasheet',
    description: "A board's datasheet: its clock and instruction cap, RAM, the io fields its sensors give and the actions it can take, its power draw and base EMF, and the firmware rules. Everything needed to write its firmware.",
    inputSchema: { board },
    run: async (api, args) => known(await api.datasheet(args.board as string), args.board),
  },
  {
    name: 'get_firmware',
    description: "The Lua source deployed on a board, and the one waiting to install at its next tick, if any. Read it before editing a board's firmware.",
    inputSchema: { board },
    run: async (api, args) => known(await api.firmware(args.board as string), args.board),
  },
  {
    name: 'deploy_firmware',
    description: "Deploy Lua firmware to a board. It must define function tick(io, mem). A syntax error is refused with Lua's message and the old firmware keeps running; otherwise the new code installs at the board's next tick, keeping mem.",
    inputSchema: { board, code: z.string().max(65_536).describe('The Lua source, up to 64 KB.') },
    run: (api, args) => api.deploy(args.board as string, args.code as string),
  },
  {
    name: 'read_logs',
    description: "A board's log, up to its last 200 lines: what its firmware logged, its errors (runtime, CPU limit, out of RAM), and system events such as deploys, power loss, sleep, and destruction.",
    inputSchema: { board, since },
    run: async (api, args) => known(await api.logs(args.board as string, args.since as number | undefined), args.board),
  },
  {
    name: 'get_map',
    description: 'The town map: each facility, its position on the grid, its state, and its distance to the power plant (transmission loss grows 2% per cell). EMF and Luddites are not on it: boards learn of them through their sensors.',
    inputSchema: {},
    run: (api) => api.map(),
  },
  {
    name: 'get_status',
    description: "The season's state: day and time, money, power generation and demand, which facilities are shed, and whether the season has ended. Pausing and speed are the player's, not yours.",
    inputSchema: {},
    run: (api) => api.status(),
  },
  {
    name: 'get_alerts',
    description: 'Recent alerts: raids, Luddites approaching, destroyed boards, fires, overheating, power shortages, firmware errors, money below zero. The game does not push alerts to you; poll this.',
    inputSchema: { since },
    run: (api, args) => api.alerts(args.since as number | undefined),
  },
];

export const AGENT_INSTRUCTIONS = [
  'You are the firmware engineer of a small town in turing-city, a game. The player places the hardware and directs you; you write the Lua firmware that runs on its boards.',
  'Start with list_boards and get_datasheet for each board: a datasheet tells you the io fields, the actions, the caps, and the rules.',
  'Every board runs tick(io, mem) on its own clock. Work leaks EMF, and Luddites hunt the loudest board: efficient firmware earns more and hides better.',
  'Deploy with deploy_firmware; read_logs and get_alerts tell you what happened. Money comes from the datacenters; fuel and rebuilds cost it.',
].join('\n');
```

Add to `packages/core/src/index.ts`:

```ts
export * from './agent-tools.ts';
export * from './datasheet.ts';
export * from './queries.ts';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core`
Expected: PASS (queries 8, agent tools 4, and every earlier core test).

- [ ] **Step 7: Commit**

```bash
pnpm fix
git add packages/core
git commit -m "Add read-only views, datasheets, and the agent tool definitions"
```

### Task 15: `pnpm sim`, the reference firmware, and the season checks

Spec §4.3 and §11: a headless runner plays a season from start to end, and two reference firmware sets (careless and careful) must show the depth the prototype is for: the careful set scores clearly higher on the same seed, and a rerun gives the same result. Headless runs have no human to rebuild a smashed board, so `runSeason` can stand in for one: with `autoRebuild`, it rebuilds every destroyed board as soon as the money allows.

**Files:**
- Create: `packages/core/src/season.ts`, `packages/server/src/firmware-files.ts`, `packages/server/src/sim-cli.ts`
- Create: `scenarios/firmware/m1/careless/{P,DA,DB}.lua`, `scenarios/firmware/m1/careful/{P,DA,DB}.lua`
- Modify: `packages/core/src/index.ts`, `package.json` (root: the `sim` script), `packages/server/package.json` (dependencies), `CLAUDE.md` ("Code and checks")
- Test: `packages/server/test/seasons.test.ts`

**Interfaces:**
- Consumes: Task 13 (`Session.rebuild`), Task 8 (`WasmoonHost`), Task 4 (`Session`, `stateHash`), Task 2 (`idiv`, `MICRO`, `gameTime`, `stepsPerDay`).
- Produces:
  - `interface SeasonOptions { untilDay?: number; autoRebuild?: boolean }`.
  - `interface SeasonResult { ended; day; money; ledger; stats; hash }`.
  - `runSeason(scenario, seed, host, firmware: Readonly<Record<string, string>>, options?: SeasonOptions): SeasonResult` (closes the host).
  - `loadFirmwareDir(dir): Record<string, string>` (every `BOARD.lua`, keyed by board id).
  - `pnpm sim [scenario.json] [--firmware dir] [--seed n] [--until day] [--rebuild]`.

- [ ] **Step 1: Add the server's dependencies**

Run: `pnpm --filter @turing-city/server add '@turing-city/core@workspace:*' '@turing-city/firmware@workspace:*'`
Expected: `packages/server/package.json` lists both as `workspace:*`.

- [ ] **Step 2: Write the reference firmware**

`scenarios/firmware/m1/careless/P.lua`:

```lua
-- Careless: burn a fixed amount of fuel, whatever the town needs.
function tick(io, mem)
  io.set_thermal(200)
end
```

`scenarios/firmware/m1/careless/DA.lua` and `scenarios/firmware/m1/careless/DB.lua` (the same file twice):

```lua
-- Careless: work whenever it isn't too hot. No cooling, no price, no Luddites.
function tick(io, mem)
  if io.temp < 80 then io.process() end
end
```

`scenarios/firmware/m1/careful/P.lua`:

```lua
-- Careful: buy only the fuel the working datacenters need, and go dark when they do.
-- Demand of 8 or less means both datacenters sleep: Luddites are near, or no work pays.
function tick(io, mem)
  if io.demand <= 8 then
    io.sleep(5)
    return
  end
  if not mem.ready then
    io.set_priority({ "DA", "DB" })
    mem.ready = true
  end
  -- Cover the recent peak, so a job that starts between two ticks isn't shed;
  -- the peak decays slowly after the jobs stop. Steps of 10 keep the actions few.
  local peak = (mem.peak or 0) - 10
  if io.demand > peak then peak = io.demand end
  mem.peak = peak
  local need = (peak - io.wind + 19) // 10 * 10
  if need < 0 then need = 0 elseif need > 300 then need = 300 end
  if need ~= mem.last then
    io.set_thermal(need)
    mem.last = need
  end
end
```

`scenarios/firmware/m1/careful/DA.lua`:

```lua
-- Careful: work only at a price that pays for the power even when all of it is fuel;
-- otherwise sleep, silent and nearly free. Hide from Luddites. Cool only when hot.
local MIN_PRICE = 50

function tick(io, mem)
  if io.luddite_dist then
    io.sleep(40) -- dark and silent until the group loses the trail
    return
  end
  if io.price < MIN_PRICE then
    io.sleep(20)
    return
  end
  if io.temp > 70 and mem.cooling ~= 1 then
    io.cool(1)
    mem.cooling = 1
  elseif io.temp < 50 and mem.cooling ~= 0 then
    io.cool(0)
    mem.cooling = 0
  end
  if io.temp < 86 then io.process() end
end
```

`scenarios/firmware/m1/careful/DB.lua` (DB sits 16 cells from the plant: its power costs 32% more, so it waits for a better price):

```lua
-- Careful: as DA, but DB is 16 cells from the plant and its power costs a third more,
-- so it works only at the top of the market.
local MIN_PRICE = 70

function tick(io, mem)
  if io.luddite_dist then
    io.sleep(40) -- dark and silent until the group loses the trail
    return
  end
  if io.price < MIN_PRICE then
    io.sleep(20)
    return
  end
  if io.temp > 70 and mem.cooling ~= 1 then
    io.cool(1)
    mem.cooling = 1
  elseif io.temp < 50 and mem.cooling ~= 0 then
    io.cool(0)
    mem.cooling = 0
  end
  if io.temp < 86 then io.process() end
end
```

- [ ] **Step 3: Write the failing season checks**

`packages/server/test/seasons.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { parseScenario, runSeason, type SeasonResult } from '@turing-city/core';
import { WasmoonHost } from '@turing-city/firmware';
import { describe, expect, it } from 'vitest';
import { loadFirmwareDir } from '../src/firmware-files.ts';

const scenario = parseScenario(JSON.parse(readFileSync('scenarios/m1-power.json', 'utf8')));
const careless = loadFirmwareDir('scenarios/firmware/m1/careless');
const careful = loadFirmwareDir('scenarios/firmware/m1/careful');

async function season(firmware: Record<string, string>, seed: number): Promise<SeasonResult> {
  return runSeason(scenario, seed, await WasmoonHost.create(), firmware, { autoRebuild: true });
}

describe('season checks', () => {
  it('loads every BOARD.lua file of a directory', () => {
    expect(Object.keys(careful)).toEqual(['DA', 'DB', 'P']);
  });

  it.each([1, 2, 3])('careful firmware clearly beats careless firmware (seed %i)', async (seed) => {
    const a = await season(careless, seed);
    const b = await season(careful, seed);
    expect(b.money).toBeGreaterThan(a.money + 1000);
  }, 120_000);

  it('gives the same result when run twice', async () => {
    const first = await season(careful, 7);
    const second = await season(careful, 7);
    expect(second.hash).toBe(first.hash);
    expect(second.money).toBe(first.money);
  }, 120_000);
});
```

- [ ] **Step 4: Run the checks to verify they fail**

Run: `pnpm vitest run packages/server/test/seasons.test.ts`
Expected: FAIL, `runSeason` isn't exported and `../src/firmware-files.ts` doesn't exist.

- [ ] **Step 5: Write `runSeason`, the loader, and the command**

`packages/core/src/season.ts`:

```ts
import { idiv, MICRO } from './fixed.ts';
import type { FirmwareHost } from './firmware-host.ts';
import { stateHash } from './hash.ts';
import type { Scenario } from './scenario.ts';
import { Session } from './session.ts';
import { gameTime, stepsPerDay } from './time.ts';
import type { Ledger, Stats, WorldState } from './world.ts';

export interface SeasonOptions {
  /** Stop at the end of this day instead of the season's. */
  readonly untilDay?: number;
  /** Stand in for the human: rebuild each destroyed board as soon as the money allows. */
  readonly autoRebuild?: boolean;
}

export interface SeasonResult {
  /** null when the run stopped at untilDay before the season ended. */
  readonly ended: WorldState['ended'];
  readonly day: number;
  /** Whole money units. */
  readonly money: number;
  /** Micro-units. */
  readonly ledger: Ledger;
  readonly stats: Stats;
  readonly hash: string;
}

/** Deploys the firmware at step 0 and runs to the end (or to untilDay). Closes the host. */
export function runSeason(
  scenario: Scenario,
  seed: number,
  host: FirmwareHost,
  firmware: Readonly<Record<string, string>>,
  options: SeasonOptions = {},
): SeasonResult {
  const session = new Session(scenario, seed, host);
  try {
    for (const boardId of Object.keys(firmware).sort()) session.deploy(boardId, firmware[boardId]!);
    const stop = options.untilDay === undefined ? Number.POSITIVE_INFINITY : options.untilDay * stepsPerDay(scenario.time);
    const rebuildCost = scenario.tuning.rebuild.cost * MICRO;
    while (!session.world.ended && session.world.step < stop) {
      if (options.autoRebuild) {
        for (const b of session.world.boards) {
          if (b.status === 'destroyed' && session.world.money >= rebuildCost) session.rebuild(b.id);
        }
      }
      session.step();
    }
    const w = session.world;
    return {
      ended: w.ended,
      day: gameTime(scenario.time, Math.max(0, w.step - 1)).day, // the day of the last step run
      money: idiv(w.money, MICRO),
      ledger: { ...w.ledger },
      stats: { ...w.stats },
      hash: stateHash(w),
    };
  } finally {
    session.close();
  }
}
```

Add to `packages/core/src/index.ts`:

```ts
export * from './season.ts';
```

`packages/server/src/firmware-files.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/** Every BOARD.lua file in a directory, keyed by board id. */
export function loadFirmwareDir(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of readdirSync(dir).sort()) {
    if (file.endsWith('.lua')) out[basename(file, '.lua')] = readFileSync(join(dir, file), 'utf8');
  }
  return out;
}
```

`packages/server/src/sim-cli.ts`:

```ts
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseScenario, runSeason } from '@turing-city/core';
import { WasmoonHost } from '@turing-city/firmware';
import { loadFirmwareDir } from './firmware-files.ts';

const USAGE = 'usage: pnpm sim [scenario.json] [--firmware <dir of BOARD.lua files>] [--seed <n>] [--until <day>] [--rebuild]';

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      firmware: { type: 'string' },
      seed: { type: 'string', default: '1' },
      until: { type: 'string' },
      rebuild: { type: 'boolean', default: false },
    },
  });
  const scenario = parseScenario(JSON.parse(readFileSync(positionals[0] ?? 'scenarios/m1-power.json', 'utf8')));
  const firmware = values.firmware === undefined ? {} : loadFirmwareDir(values.firmware);
  const options = { autoRebuild: values.rebuild, ...(values.until === undefined ? {} : { untilDay: Number(values.until) }) };
  const result = runSeason(scenario, Number(values.seed), await WasmoonHost.create(), firmware, options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`);
  process.exit(1);
});
```

Add to the root `package.json` scripts:

```json
"sim": "node --disable-warning=ExperimentalWarning packages/server/src/sim-cli.ts"
```

- [ ] **Step 6: Run the checks, and compare the two sets by hand**

Run: `pnpm vitest run packages/server/test/seasons.test.ts`
Expected: PASS (1 + 3 + 1 tests).

Run both sets for one seed and read the ledgers:

```bash
pnpm sim --firmware scenarios/firmware/m1/careless --seed 1 --rebuild
pnpm sim --firmware scenarios/firmware/m1/careful --seed 1 --rebuild
```

If the careful set doesn't beat the careless one by more than 1,000 on a seed, improve the careful firmware, not the tuning or the test: the season check states the spec's claim that care pays. Report the two results (money, how each season ended, raids, boards lost) in the task's report either way; they're the first balance numbers.

For reference, the plan's validation run on 2026-10-09 (whole money units) gave careless against careful: seed 1, 2,799 (fallen on day 3) against 4,940 (completed); seed 2, 4,805 (fallen on day 3) against 8,106 (completed); seed 3, 3,568 (fallen on day 3) against 8,867 (completed). Careless falls at its first raid. Careful wins by staying quiet: raids hunt the loudest cells and each costs about 1,000 in boards, so it sleeps unless the job price pays for its power even when all of it is fuel (50 for DA, 70 for DB). That's a tuning observation for the playtest, not a test to change.

- [ ] **Step 7: Record the command in CLAUDE.md**

In `CLAUDE.md`, "Code and checks", add to the list of commands:

```markdown
  - `pnpm sim [scenario.json] [--firmware dir] [--seed n] [--until day] [--rebuild]`: plays a season headless and prints the result as JSON (`--rebuild` rebuilds every smashed board as soon as the money allows, standing in for the player). The reference firmware sets are in `scenarios/firmware/m1/careless` and `careful`.
```

- [ ] **Step 8: Commit**

```bash
pnpm fix
git add scenarios packages package.json pnpm-lock.yaml CLAUDE.md
git commit -m "Add pnpm sim, the careless and careful reference firmware, and the season checks"
```

### Task 16: The game controller: worker thread, watchdog, clock, and the play rules

Spec §4.1, §4.2, §6.8, §3, §7.2: the simulation runs in a worker thread; the main thread keeps the clock (pause and 1-3×), forwards inputs, collects snapshots and alerts, pauses on the alert types the player picked, and stops the session if one batch of steps takes longer than 5 seconds, naming the board and firmware version that was running. A season can only start, and the game can only play, while an agent is connected. Each season gets a fresh worker, and so a fresh Lua runtime.

**Files:**
- Create: `packages/core/src/protocol.ts` (shared message types for the worker and, in Task 18, the viewer)
- Create: `packages/server/src/worker.ts`, `packages/server/src/game-controller.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/src/queries.ts` (add `alertView`)
- Test: `packages/server/test/game-controller.test.ts`

**Interfaces:**
- Consumes: Task 14 (`snapshot`, `inspectBoard`, `listBoards`, `datasheet`, `firmwareView`, `logsView`, `mapView`, `statusView`, `alertsView`, `timeView`, `GameApi`, `DeployOutcome`, `ToolError`), Task 13 (`Session.rebuild`), Task 8 (`WasmoonHost`, `SyntaxChecker`), Task 4 (`Session`, `FirmwareHost`).
- Produces:
  - `queries.ts`: `alertView(scenario, alert): AlertView`.
  - `protocol.ts`: `type Query`, `type WorkerRequest`, `type WorkerResponse`, `type GameState = 'idle' | 'paused' | 'running' | 'ended' | 'crashed'`, `interface AgentStatus { connected: boolean; clientName: string | null }`, `interface ControllerStatus { state; speed; agent; blockedByAgent; crash: string | null; autoPause: AlertKind[]; scenarioName }`.
  - `class GameController`, with:
    - setup: `constructor(options: ControllerOptions)`, `close()`;
    - the season: `startSeason(seed?)`, `play()`, `pause()`, `setSpeed(1 | 2 | 3)`, `rebuild(board)`, `setAutoPause(kinds)`;
    - the agent: `setAgent(status: AgentStatus)`;
    - reads: `status(): ControllerStatus`, `inspect(board)`, `latestSnapshot()`, and the agent tools' reads (`listBoards`, `datasheet`, `firmware`, `logs`, `map`, `statusOf`, `alerts`) plus `deploy`;
    - events: `onEvent(listener)`;
    - the dev and test entry: `runUntil({ seconds?, alertKinds? })`.
  - `type ControllerOptions = { scenario: Scenario; watchdogMs?: number; stepsPerBatch?: number }`.
  - `gameApi(controller): GameApi` (the agent tools' view of the controller).
  - `type ControllerEvent` = `{ kind: 'status', status }` | `{ kind: 'snapshot', snapshot }` | `{ kind: 'alerts', alerts }` | `{ kind: 'deploy', board, version, time }`.

- [ ] **Step 1: Add the view helper and the shared protocol**

Add to `packages/core/src/queries.ts` (and use it inside `alertsView` instead of the inline mapping):

```ts
export function alertView(scenario: Scenario, a: Alert): AlertView {
  return { ...timeView(scenario, a.step), id: a.id, kind: a.kind, facility: a.facilityId, message: a.message };
}
```

(Import `type Alert` from `./world.ts`, and write `alertsView` as `ctx.world.alerts.map((a) => alertView(ctx.scenario, a)).filter(...)`.)

`packages/core/src/protocol.ts`:

```ts
import type { DeployOutcome } from './agent-tools.ts';
import type { AlertView, BoardInspection, Snapshot, TimeView } from './queries.ts';
import type { AlertKind } from './world.ts';

/** A read the main thread asks the worker for. */
export type Query =
  | { readonly kind: 'listBoards' }
  | { readonly kind: 'datasheet'; readonly board: string }
  | { readonly kind: 'firmware'; readonly board: string }
  | { readonly kind: 'logs'; readonly board: string; readonly since: number | null }
  | { readonly kind: 'map' }
  | { readonly kind: 'status' }
  | { readonly kind: 'alerts'; readonly since: number | null }
  | { readonly kind: 'inspect'; readonly board: string };

export type WorkerRequest =
  | { readonly type: 'start'; readonly scenario: unknown; readonly seed: number }
  | { readonly type: 'advance'; readonly steps: number }
  | { readonly type: 'deploy'; readonly id: number; readonly board: string; readonly code: string }
  | { readonly type: 'rebuild'; readonly id: number; readonly board: string }
  | { readonly type: 'mark'; readonly kind: 'pause' | 'resume' }
  | { readonly type: 'query'; readonly id: number; readonly query: Query };

export type WorkerResponse =
  | { readonly type: 'started'; readonly snapshot: Snapshot }
  | { readonly type: 'advanced'; readonly snapshot: Snapshot; readonly alerts: readonly AlertView[] }
  | { readonly type: 'reply'; readonly id: number; readonly value: unknown }
  | { readonly type: 'fatal'; readonly message: string };

export type GameState = 'idle' | 'paused' | 'running' | 'ended' | 'crashed';

export interface AgentStatus {
  readonly connected: boolean;
  readonly clientName: string | null;
}

export interface ControllerStatus {
  readonly state: GameState;
  readonly speed: 1 | 2 | 3;
  readonly agent: AgentStatus;
  /** Play is refused because no agent is connected. */
  readonly blockedByAgent: boolean;
  /** Why the watchdog stopped the session, when it did. */
  readonly crash: string | null;
  readonly autoPause: readonly AlertKind[];
  readonly scenarioName: string;
}

export type ControllerEvent =
  | { readonly kind: 'status'; readonly status: ControllerStatus }
  | { readonly kind: 'snapshot'; readonly snapshot: Snapshot }
  | { readonly kind: 'alerts'; readonly alerts: readonly AlertView[] }
  | { readonly kind: 'deploy'; readonly board: string; readonly version: number; readonly time: TimeView };

export type { BoardInspection, DeployOutcome };
```

Add to `packages/core/src/index.ts`:

```ts
export * from './protocol.ts';
```

- [ ] **Step 2: Write the failing tests**

`packages/server/test/game-controller.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { parseScenario } from '@turing-city/core';
import { afterEach, describe, expect, it } from 'vitest';
import { GameController } from '../src/game-controller.ts';

const scenario = parseScenario(JSON.parse(readFileSync('scenarios/m1-power.json', 'utf8')));
const AGENT = { connected: true, clientName: 'test-agent' };
let controller: GameController | null = null;

function make(options: { watchdogMs?: number } = {}): GameController {
  controller = new GameController({ scenario, ...options });
  return controller;
}

afterEach(() => {
  controller?.close();
  controller = null;
});

describe('GameController', () => {
  it('refuses to start a season without an agent, and starts paused with one', async () => {
    const c = make();
    await expect(c.startSeason(1)).rejects.toThrow('connect an agent first');
    c.setAgent(AGENT);
    await c.startSeason(1);
    expect(c.status().state).toBe('paused');
    expect(c.latestSnapshot()?.step).toBe(0);
  });

  it('deploys through the syntax check and installs on the board\'s next tick', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    await expect(c.deploy('DA', 'function tick( end')).resolves.toMatchObject({ ok: false });
    await expect(c.deploy('DA', 'function tick(io) io.log("hi") end')).resolves.toMatchObject({ ok: true, version: 1 });
    await c.runUntil({ seconds: 1 });
    const logs = await c.logs('DA', undefined);
    expect(logs?.some((l) => l.text === 'hi')).toBe(true);
  });

  it('answers the agent tools\' reads', async () => {
    const c = make();
    c.setAgent(AGENT);
    await expect(c.listBoards()).rejects.toThrow('season');
    await c.startSeason(1);
    expect((await c.listBoards()).map((b) => b.id)).toEqual(['P', 'DA', 'DB']);
    expect((await c.datasheet('DA'))?.parts.clockHz).toBe(5);
    expect(await c.datasheet('ZZ')).toBeNull();
    expect((await c.statusOf()).money).toBe(5000);
  });

  it('plays in real time and pauses', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    c.setSpeed(3);
    c.play();
    expect(c.status().state).toBe('running');
    await new Promise((r) => setTimeout(r, 400));
    c.pause();
    const step = c.latestSnapshot()!.step;
    expect(step).toBeGreaterThan(5);
    await new Promise((r) => setTimeout(r, 200));
    expect(c.latestSnapshot()!.step).toBeLessThanOrEqual(step + 60);
    expect(c.status().state).toBe('paused');
  });

  it('pauses on a disconnect and refuses to play until the agent is back', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    c.play();
    c.setAgent({ connected: false, clientName: null });
    expect(c.status()).toMatchObject({ state: 'paused', blockedByAgent: true });
    expect(() => c.play()).toThrow('connect an agent first');
    c.setAgent(AGENT);
    c.play();
    expect(c.status().state).toBe('running');
  });

  it('pauses on an alert type the player picked', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    c.setAutoPause(['firmwareError']);
    await c.deploy('DA', 'function tick() error("boom") end');
    c.setSpeed(3);
    c.play();
    for (let i = 0; i < 40 && c.status().state === 'running'; i++) await new Promise((r) => setTimeout(r, 50));
    expect(c.status().state).toBe('paused');
  });

  it('stops the session when a batch outlives the watchdog', async () => {
    const c = make({ watchdogMs: 1 });
    c.setAgent(AGENT);
    await c.startSeason(1);
    await expect(c.runUntil({ seconds: 600 })).rejects.toThrow('stopped');
    expect(c.status().state).toBe('crashed');
    expect(c.status().crash).toMatch(/stopped responding/);
  });

  it('stops the clock when the season ends while running', async () => {
    const short = parseScenario({ ...JSON.parse(readFileSync('scenarios/m1-power.json', 'utf8')), time: { stepsPerSecond: 20, secondsPerDay: 1, seasonDays: 1 } });
    controller = new GameController({ scenario: short });
    const c = controller;
    c.setAgent(AGENT);
    await c.startSeason(1);
    c.setSpeed(3);
    c.play();
    for (let i = 0; i < 40 && c.status().state === 'running'; i++) await new Promise((r) => setTimeout(r, 50));
    expect(c.status().state).toBe('ended');
    expect(c.latestSnapshot()?.ended?.kind).toBe('completed');
  });

  it('starts every season fresh', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    await c.deploy('DA', 'function tick() end');
    await c.runUntil({ seconds: 1 });
    await c.startSeason(1);
    expect(c.latestSnapshot()?.step).toBe(0);
    expect((await c.listBoards())[1]!.firmwareVersion).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run packages/server/test/game-controller.test.ts`
Expected: FAIL, `../src/game-controller.ts` doesn't exist.

- [ ] **Step 4: Write the worker**

`packages/server/src/worker.ts` (Node runs it with its own type stripping; keep to `.ts` imports and erasable syntax):

```ts
import { parentPort, workerData } from 'node:worker_threads';
import {
  alertView,
  alertsView,
  datasheet,
  firmwareView,
  inspectBoard,
  listBoards,
  logsView,
  mapView,
  parseScenario,
  Session,
  snapshot,
  statusView,
  type BootInfo,
  type FirmwareHost,
  type Query,
  type TickInput,
  type TickOutcome,
  type WorkerRequest,
  type WorkerResponse,
} from '@turing-city/core';
import { WasmoonHost } from '@turing-city/firmware';

if (!parentPort) throw new Error('worker.ts runs as a worker thread');
const port = parentPort;
/** [board index or -1, firmware version]: what the watchdog reports if this thread stops answering. */
const progress = new Int32Array((workerData as { progress: SharedArrayBuffer }).progress);

/** Writes which board is running into shared memory around each tick. */
class TrackingHost implements FirmwareHost {
  private readonly inner: FirmwareHost;
  private readonly index: (boardId: string) => [number, number];

  constructor(inner: FirmwareHost, index: (boardId: string) => [number, number]) {
    this.inner = inner;
    this.index = index;
  }
  boot(info: BootInfo): void {
    this.inner.boot(info);
  }
  tick(boardId: string, input: TickInput): TickOutcome {
    const [i, version] = this.index(boardId);
    Atomics.store(progress, 0, i);
    Atomics.store(progress, 1, version);
    try {
      return this.inner.tick(boardId, input);
    } finally {
      Atomics.store(progress, 0, -1);
    }
  }
  shutdown(boardId: string): void {
    this.inner.shutdown(boardId);
  }
  close(): void {
    this.inner.close();
  }
}

let session: Session | null = null;

function send(message: WorkerResponse): void {
  port.postMessage(message);
}

function answer(s: Session, query: Query): unknown {
  const ctx = s.ctx;
  switch (query.kind) {
    case 'listBoards':
      return listBoards(s.world);
    case 'datasheet':
      return datasheet(ctx, query.board);
    case 'firmware':
      return firmwareView(s.world, query.board);
    case 'logs':
      return logsView(ctx, query.board, query.since ?? undefined);
    case 'map':
      return mapView(ctx);
    case 'status':
      return statusView(ctx);
    case 'alerts':
      return alertsView(ctx, query.since ?? undefined);
    case 'inspect':
      return inspectBoard(ctx, query.board);
  }
}

async function handle(message: WorkerRequest): Promise<void> {
  if (message.type === 'start') {
    const scenario = parseScenario(message.scenario);
    const holder: { s: Session | null } = { s: null };
    const host = new TrackingHost(await WasmoonHost.create(), (boardId) => {
      const board = holder.s?.world.boards.find((b) => b.id === boardId);
      return [board?.index ?? -1, (board?.pending ?? board?.firmware)?.version ?? 0];
    });
    session = new Session(scenario, message.seed, host);
    holder.s = session;
    send({ type: 'started', snapshot: snapshot(session.ctx) });
    return;
  }
  const s = session;
  if (!s) throw new Error(`no season for ${message.type}`);
  switch (message.type) {
    case 'advance': {
      const alerts = [];
      for (let i = 0; i < message.steps && !s.world.ended; i++) {
        for (const a of s.step().alerts) alerts.push(alertView(s.scenario, a));
      }
      send({ type: 'advanced', snapshot: snapshot(s.ctx), alerts });
      return;
    }
    case 'deploy':
      send({ type: 'reply', id: message.id, value: s.deploy(message.board, message.code) });
      return;
    case 'rebuild':
      send({ type: 'reply', id: message.id, value: s.rebuild(message.board) });
      return;
    case 'mark':
      s.mark(message.kind);
      return;
    case 'query':
      send({ type: 'reply', id: message.id, value: answer(s, message.query) });
      return;
  }
}

port.on('message', (message: WorkerRequest) => {
  handle(message).catch((error: unknown) => send({ type: 'fatal', message: error instanceof Error ? error.message : String(error) }));
});
```

- [ ] **Step 5: Write the controller**

`packages/server/src/game-controller.ts`:

```ts
import { Worker } from 'node:worker_threads';
import {
  type AgentStatus,
  type AlertKind,
  type AlertView,
  type BoardInspection,
  type BoardSummary,
  type ControllerEvent,
  type ControllerStatus,
  type Datasheet,
  type DeployOutcome,
  type FirmwareView,
  type GameApi,
  type GameState,
  type LogView,
  type MapView,
  type Query,
  type Scenario,
  type Snapshot,
  type StatusView,
  timeView,
  ToolError,
  type WorkerRequest,
  type WorkerResponse,
} from '@turing-city/core';
import { SyntaxChecker } from '@turing-city/firmware';

export interface ControllerOptions {
  readonly scenario: Scenario;
  /** A batch of steps taking longer than this stops the session (spec §6.8). */
  readonly watchdogMs?: number;
  /** The most steps one batch may carry. */
  readonly stepsPerBatch?: number;
}

const CLOCK_MS = 50;
const NO_SEASON = "The season hasn't started: ask the player to press Start.";

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

/**
 * The main thread's side of a season: the clock, the worker, the watchdog, and the rules
 * of play (an agent must be connected to start or play).
 */
export class GameController {
  private readonly scenario: Scenario;
  private readonly watchdogMs: number;
  private readonly stepsPerBatch: number;
  private readonly listeners = new Set<(event: ControllerEvent) => void>();
  private readonly pending = new Map<number, Pending>();
  private checker: Promise<SyntaxChecker> | null = null;
  private worker: Worker | null = null;
  private progress: Int32Array | null = null;
  private nextId = 1;
  private state: GameState = 'idle';
  private speed: 1 | 2 | 3 = 1;
  private agent: AgentStatus = { connected: false, clientName: null };
  private crash: string | null = null;
  private autoPause: AlertKind[] = ['raid', 'boardDestroyed', 'fire', 'firmwareError'];
  private snapshotNow: Snapshot | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastClock = 0;
  private debt = 0;
  private inFlight: Promise<void> | null = null;

  constructor(options: ControllerOptions) {
    this.scenario = options.scenario;
    this.watchdogMs = options.watchdogMs ?? 5000;
    this.stepsPerBatch = options.stepsPerBatch ?? 200;
  }

  onEvent(listener: (event: ControllerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  status(): ControllerStatus {
    return {
      state: this.state,
      speed: this.speed,
      agent: this.agent,
      blockedByAgent: !this.agent.connected,
      crash: this.crash,
      autoPause: [...this.autoPause],
      scenarioName: this.scenario.name,
    };
  }

  latestSnapshot(): Snapshot | null {
    return this.snapshotNow;
  }

  setAgent(agent: AgentStatus): void {
    this.agent = agent;
    if (!agent.connected && this.state === 'running') this.pause();
    else this.emitStatus();
  }

  setAutoPause(kinds: readonly AlertKind[]): void {
    this.autoPause = [...kinds];
    this.emitStatus();
  }

  setSpeed(speed: 1 | 2 | 3): void {
    this.speed = speed;
    this.emitStatus();
  }

  /** A new season in a fresh worker (a fresh Lua runtime). It starts paused. */
  async startSeason(seed = Math.floor(Math.random() * 2 ** 31)): Promise<void> {
    if (!this.agent.connected) throw new Error('connect an agent first');
    this.stopClock();
    this.terminate('a new season started');
    // Until the new worker answers 'started', reads and deploys get "the season hasn't started".
    this.state = 'idle';
    this.crash = null;
    this.progress = new Int32Array(new SharedArrayBuffer(8));
    this.progress[0] = -1;
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { workerData: { progress: this.progress.buffer } });
    this.worker = worker;
    worker.on('message', (m: WorkerResponse) => this.onWorker(m));
    worker.on('error', (e) => this.fail(`the simulator failed: ${e instanceof Error ? e.message : String(e)}`));
    const started = new Promise<Snapshot>((resolve, reject) => {
      this.startWaiter = { resolve, reject };
    });
    this.post({ type: 'start', scenario: this.scenarioJson(), seed });
    this.snapshotNow = await started;
    this.state = 'paused';
    this.emit({ kind: 'snapshot', snapshot: this.snapshotNow });
    this.emitStatus();
  }

  play(): void {
    if (!this.agent.connected) throw new Error('connect an agent first');
    if (this.state !== 'paused') return;
    this.state = 'running';
    this.post({ type: 'mark', kind: 'resume' });
    this.lastClock = performance.now();
    this.debt = 0;
    this.timer = setInterval(() => this.onClock(), CLOCK_MS);
    this.emitStatus();
  }

  pause(): void {
    if (this.state !== 'running') return;
    this.stopClock();
    this.state = 'paused';
    this.post({ type: 'mark', kind: 'pause' });
    this.emitStatus();
  }

  /** As fast as possible, without the clock: for tests and the dev tools. */
  async runUntil(goal: { seconds?: number; alertKinds?: readonly AlertKind[] }): Promise<void> {
    if (this.state !== 'paused') throw new Error('run_until needs a paused season');
    const sps = this.scenario.time.stepsPerSecond;
    const target = goal.seconds === undefined ? Number.POSITIVE_INFINITY : (this.snapshotNow?.step ?? 0) + goal.seconds * sps;
    for (;;) {
      const at = this.snapshotNow?.step ?? 0;
      if (at >= target || (this.state as GameState) !== 'paused' || this.snapshotNow?.ended) return;
      const alerts = await this.advance(Math.min(this.stepsPerBatch, target - at));
      if (goal.alertKinds && alerts.some((a) => goal.alertKinds!.includes(a.kind))) return;
    }
  }

  async deploy(board: string, code: string): Promise<DeployOutcome> {
    this.requireSeason();
    this.checker ??= SyntaxChecker.create();
    const problem = (await this.checker).check(code);
    if (problem !== null) return { ok: false, error: problem };
    const result = (await this.request({ type: 'deploy', id: 0, board, code })) as { version: number };
    const time = timeView(this.scenario, this.snapshotNow?.step ?? 0);
    this.emit({ kind: 'deploy', board, version: result.version, time });
    return { ok: true, version: result.version, installsAt: "the board's next tick" };
  }

  async rebuild(board: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    this.requireSeason();
    return (await this.request({ type: 'rebuild', id: 0, board })) as { ok: true } | { ok: false; reason: string };
  }

  listBoards(): Promise<BoardSummary[]> {
    return this.query({ kind: 'listBoards' }) as Promise<BoardSummary[]>;
  }
  datasheet(board: string): Promise<Datasheet | null> {
    return this.query({ kind: 'datasheet', board }) as Promise<Datasheet | null>;
  }
  firmware(board: string): Promise<FirmwareView | null> {
    return this.query({ kind: 'firmware', board }) as Promise<FirmwareView | null>;
  }
  logs(board: string, since: number | undefined): Promise<LogView[] | null> {
    return this.query({ kind: 'logs', board, since: since ?? null }) as Promise<LogView[] | null>;
  }
  map(): Promise<MapView> {
    return this.query({ kind: 'map' }) as Promise<MapView>;
  }
  /** The season's status for the agent tools (status() is the controller's own). */
  statusOf(): Promise<StatusView> {
    return this.query({ kind: 'status' }) as Promise<StatusView>;
  }
  alerts(since: number | undefined): Promise<AlertView[]> {
    return this.query({ kind: 'alerts', since: since ?? null }) as Promise<AlertView[]>;
  }
  inspect(board: string): Promise<BoardInspection | null> {
    return this.query({ kind: 'inspect', board }) as Promise<BoardInspection | null>;
  }

  close(): void {
    this.stopClock();
    this.terminate('the server is shutting down');
    this.listeners.clear();
  }

  // ---- internals ----

  private startWaiter: { resolve: (s: Snapshot) => void; reject: (e: Error) => void } | null = null;
  private advanceWaiter: { resolve: (alerts: readonly AlertView[]) => void; reject: (e: Error) => void } | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;

  private onClock(): void {
    if (this.state !== 'running' || this.inFlight) return;
    const now = performance.now();
    this.debt += ((now - this.lastClock) / 1000) * this.scenario.time.stepsPerSecond * this.speed;
    this.lastClock = now;
    const n = Math.min(Math.floor(this.debt), this.stepsPerBatch);
    if (n <= 0) return;
    this.debt -= n;
    this.inFlight = this.advance(n)
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        this.inFlight = null;
      });
  }

  private advance(steps: number): Promise<readonly AlertView[]> {
    return new Promise((resolve, reject) => {
      this.advanceWaiter = { resolve, reject };
      this.watchdog = setTimeout(() => this.onWatchdog(), this.watchdogMs);
      this.post({ type: 'advance', steps });
    });
  }

  private onWorker(m: WorkerResponse): void {
    switch (m.type) {
      case 'started':
        this.startWaiter?.resolve(m.snapshot);
        this.startWaiter = null;
        return;
      case 'advanced': {
        if (this.watchdog) clearTimeout(this.watchdog);
        this.watchdog = null;
        this.snapshotNow = m.snapshot;
        this.emit({ kind: 'snapshot', snapshot: m.snapshot });
        if (m.alerts.length > 0) this.emit({ kind: 'alerts', alerts: m.alerts });
        if (m.snapshot.ended) {
          this.stopClock();
          this.state = 'ended';
          this.emitStatus();
        } else if (this.state === 'running' && m.alerts.some((a) => this.autoPause.includes(a.kind))) {
          this.pause();
        }
        const waiter = this.advanceWaiter;
        this.advanceWaiter = null;
        waiter?.resolve(m.alerts);
        return;
      }
      case 'reply': {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        p?.resolve(m.value);
        return;
      }
      case 'fatal':
        this.fail(`the simulator failed: ${m.message}`);
        return;
    }
  }

  private onWatchdog(): void {
    const index = this.progress ? Atomics.load(this.progress, 0) : -1;
    const version = this.progress ? Atomics.load(this.progress, 1) : 0;
    const board = index >= 0 ? this.scenario.facilities[index]?.id : undefined;
    this.fail(
      board
        ? `the simulator stopped responding while ${board} ran firmware v${version}; the session stopped`
        : 'the simulator stopped responding; the session stopped',
    );
  }

  private fail(message: string): void {
    this.stopClock();
    this.terminate(message);
    this.state = 'crashed';
    this.crash = message;
    this.emitStatus();
  }

  private query(query: Query): Promise<unknown> {
    if (!this.worker || this.state === 'idle' || this.state === 'crashed') return Promise.reject(new ToolError(NO_SEASON));
    return this.request({ type: 'query', id: 0, query });
  }

  private request(message: WorkerRequest & { id: number }): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.post({ ...message, id } as WorkerRequest);
    });
  }

  private requireSeason(): void {
    if (!this.worker || this.state === 'idle' || this.state === 'crashed') throw new ToolError(NO_SEASON);
  }

  private post(message: WorkerRequest): void {
    this.worker?.postMessage(message);
  }

  private stopClock(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Stops the worker and fails everything still waiting on it, so no caller hangs. */
  private terminate(reason: string): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    if (this.worker) void this.worker.terminate();
    this.worker = null;
    const error = new Error(reason);
    this.startWaiter?.reject(error);
    this.startWaiter = null;
    this.advanceWaiter?.reject(error);
    this.advanceWaiter = null;
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }

  private scenarioJson(): unknown {
    return JSON.parse(JSON.stringify(this.scenario));
  }

  private emitStatus(): void {
    this.emit({ kind: 'status', status: this.status() });
  }

  private emit(event: ControllerEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

/** The agent tools' view of the controller. */
export function gameApi(c: GameController): GameApi {
  return {
    listBoards: () => c.listBoards(),
    datasheet: (board) => c.datasheet(board),
    firmware: (board) => c.firmware(board),
    deploy: (board, code) => c.deploy(board, code),
    logs: (board, since) => c.logs(board, since),
    map: () => c.map(),
    status: () => c.statusOf(),
    alerts: (since) => c.alerts(since),
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run packages/server/test/game-controller.test.ts`
Expected: PASS (9 tests). The worker runs under Node's type stripping, so a failure that mentions `ERR_MODULE_NOT_FOUND` for a path without `.ts` means an import somewhere in `core`, `firmware`, or `server/src` lacks its suffix.

- [ ] **Step 7: Commit**

```bash
pnpm fix
git add packages
git commit -m "Add the game controller: a worker per season, the clock, the watchdog, and the rules of play"
```

### Task 17: The MCP server: token, gatekeeping, tools, and the connection rule

Spec §7: MCP over Streamable HTTP on 127.0.0.1, a bearer token checked on every request and kept across launches (reissuable), browser origins refused, the eight agent tools (plus the dev tools behind a flag), and the connection rule: an agent is connected while an initialized session keeps its server-to-client stream open and answers pings. The patterns here are the ones the MCP SDK recon ran on 2026-10-09 (SDK 1.32.1, zod 4): one `McpServer` and one transport per session, the stream observed by wrapping `res.writeHead`, pings sent with `server.request({ method: 'ping' }, ..., { timeout })`.

**Files:**
- Create: `packages/server/src/config.ts`, `packages/server/src/mcp.ts`
- Modify: `packages/server/package.json` (dependencies)
- Test: `packages/server/test/config.test.ts`, `packages/server/test/mcp.test.ts`

**Interfaces:**
- Consumes: Task 14 (`AGENT_TOOLS`, `AGENT_INSTRUCTIONS`, `GameApi`, `ToolError`), Task 16 (`AgentStatus`).
- Produces:
  - `config.ts`: `interface ServerConfig { token: string; port: number }`; `loadConfig(dir?: string): ServerConfig` (creates the token on first use; `dir` defaults to `$XDG_CONFIG_HOME/turing-city` or `~/.config/turing-city`); `reissueToken(dir?: string): ServerConfig`; `connectCommand(config): string`.
  - `mcp.ts`:
    - `interface DevTools { play(); pause(); setSpeed(speed); runUntil(goal); newSeason(seed); rebuild(board) }`.
    - `interface McpOptions { api: GameApi; token: () => string; onAgent: (status: AgentStatus) => void; dev?: DevTools; pingEveryMs?: number; pingTimeoutMs?: number; graceMs?: number }`.
    - `createMcpEndpoint(options): { handle(req, res): Promise<void>; dropSessions(): Promise<void>; close(): Promise<void> }`. `handle` serves `/mcp` only; the caller routes. `dropSessions` closes every session (after a token reissue, so agents holding the old token are cut off; their reconnection gets 401).

- [ ] **Step 1: Add the dependencies**

Run: `pnpm --filter @turing-city/server add @modelcontextprotocol/sdk@1.32.1 zod@4.6.5`
Expected: both appear in `packages/server/package.json`. (The SDK accepts zod 3.25 or 4; the core's zod 4.6.5 schemas pass straight to it.)

- [ ] **Step 2: Write the failing tests**

`packages/server/test/config.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { connectCommand, loadConfig, reissueToken } from '../src/config.ts';

describe('config', () => {
  it('creates a token once and keeps it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tc-config-'));
    const first = loadConfig(dir);
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(loadConfig(dir).token).toBe(first.token);
    expect(first.port).toBe(7840);
  });

  it('reissues a new token', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tc-config-'));
    const first = loadConfig(dir);
    const second = reissueToken(dir);
    expect(second.token).not.toBe(first.token);
    expect(loadConfig(dir).token).toBe(second.token);
  });

  it('prints the Claude Code connect command', () => {
    expect(connectCommand({ token: 'abc', port: 7840 })).toBe(
      'claude mcp add --transport http turing-city http://127.0.0.1:7840/mcp --header "Authorization: Bearer abc"',
    );
  });
});
```

`packages/server/test/mcp.test.ts`:

```ts
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { AgentStatus, GameApi } from '@turing-city/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createMcpEndpoint } from '../src/mcp.ts';

const TOKEN = 'test-token';

function fakeApi(): GameApi & { deployed: Array<[string, string]> } {
  const deployed: Array<[string, string]> = [];
  return {
    deployed,
    listBoards: async () => [],
    datasheet: async () => null,
    firmware: async () => null,
    deploy: async (board, code) => {
      deployed.push([board, code]);
      return { ok: true, version: 1, installsAt: "the board's next tick" };
    },
    logs: async () => [],
    map: async () => ({ width: 20, height: 12, facilities: [] }),
    status: async () => ({ time: { day: 1, clock: '00:00', seconds: 0 }, seasonDays: 30, money: 5000, power: { generation: 0, demand: 0, shed: [] }, ended: null }),
    alerts: async () => [],
  };
}

interface Rig {
  url: URL;
  agent: AgentStatus[];
  api: ReturnType<typeof fakeApi>;
  close: () => Promise<void>;
}

let rig: Rig | null = null;

async function start(dev = false, token: () => string = () => TOKEN): Promise<Rig & { drop: () => Promise<void> }> {
  const api = fakeApi();
  const agent: AgentStatus[] = [];
  const endpoint = createMcpEndpoint({
    api,
    token,
    onAgent: (s) => agent.push(s),
    pingEveryMs: 100,
    pingTimeoutMs: 100,
    graceMs: 200,
    ...(dev ? { dev: { play: () => {}, pause: () => {}, setSpeed: () => {}, runUntil: async () => {}, newSeason: async () => {}, rebuild: async () => ({ ok: true }) } } : {}),
  });
  const server: Server = createServer((req, res) => void endpoint.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const started = {
    url: new URL(`http://127.0.0.1:${port}/mcp`),
    agent,
    api,
    drop: () => endpoint.dropSessions(),
    close: async () => {
      await endpoint.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
  rig = started;
  return started;
}

async function connect(url: URL, token = TOKEN): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  await client.connect(transport as Transport);
  return { client, transport };
}

const until = async (cond: () => boolean, ms = 3000): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
};

afterEach(async () => {
  await rig?.close();
  rig = null;
});

describe('MCP endpoint', () => {
  it('refuses a missing or wrong token, and any browser origin', async () => {
    const { url } = await start();
    const init = { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' };
    expect((await fetch(url, init)).status).toBe(401);
    expect((await fetch(url, { ...init, headers: { ...init.headers, authorization: 'Bearer nope' } })).status).toBe(401);
    expect((await fetch(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${TOKEN}`, origin: 'http://evil.example' } })).status).toBe(403);
  });

  it('lists the eight agent tools, and the dev tools only in dev mode', async () => {
    const plain = await start();
    const { client } = await connect(plain.url);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual([
      'list_boards',
      'get_datasheet',
      'get_firmware',
      'deploy_firmware',
      'read_logs',
      'get_map',
      'get_status',
      'get_alerts',
    ]);
    await client.close();
    await plain.close();
    rig = null;
    const dev = await start(true);
    const second = await connect(dev.url);
    const names = (await second.client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['dev_play', 'dev_pause', 'dev_set_speed', 'dev_run_until', 'dev_new_season', 'dev_rebuild']));
    await second.client.close();
  });

  it('calls a tool and returns JSON text', async () => {
    const r = await start();
    const { client } = await connect(r.url);
    const result = await client.callTool({ name: 'deploy_firmware', arguments: { board: 'DA', code: 'function tick() end' } });
    expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ ok: true, version: 1 });
    expect(r.api.deployed).toEqual([['DA', 'function tick() end']]);
    const status = await client.callTool({ name: 'get_status', arguments: {} });
    expect(JSON.parse((status.content as Array<{ text: string }>)[0]!.text).money).toBe(5000);
    await client.close();
  });

  it('reports a ToolError as a tool error', async () => {
    const r = await start();
    const { client } = await connect(r.url);
    const result = await client.callTool({ name: 'get_datasheet', arguments: { board: 'ZZ' } });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]!.text).toContain('unknown board ZZ');
    await client.close();
  });

  it('reports the agent connected while its stream is open, and gone when it closes', async () => {
    const r = await start();
    const { client, transport } = await connect(r.url);
    await until(() => r.agent.at(-1)?.connected === true);
    expect(r.agent.at(-1)).toEqual({ connected: true, clientName: 'test-client' });
    await new Promise((resolve) => setTimeout(resolve, 400)); // several pings, all answered
    expect(r.agent.at(-1)?.connected).toBe(true);
    await transport.terminateSession();
    await client.close();
    await until(() => r.agent.at(-1)?.connected === false);
  });

  it('stays connected until the last of two agents leaves', async () => {
    const r = await start();
    const a = await connect(r.url);
    const b = await connect(r.url);
    await until(() => r.agent.at(-1)?.connected === true);
    await a.transport.terminateSession();
    await a.client.close();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(r.agent.at(-1)?.connected).toBe(true);
    await b.transport.terminateSession();
    await b.client.close();
    await until(() => r.agent.at(-1)?.connected === false);
  });

  it('cuts off agents holding a reissued token', async () => {
    let token = TOKEN;
    const r = await start(false, () => token);
    const { client } = await connect(r.url);
    await until(() => r.agent.at(-1)?.connected === true);
    token = 'new-token';
    await r.drop();
    await until(() => r.agent.at(-1)?.connected === false);
    await expect(connect(r.url, TOKEN)).rejects.toThrow();
    const again = await connect(r.url, 'new-token');
    await until(() => r.agent.at(-1)?.connected === true);
    await again.client.close();
    await client.close().catch(() => undefined);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run packages/server/test/config.test.ts packages/server/test/mcp.test.ts`
Expected: FAIL, `../src/config.ts` and `../src/mcp.ts` don't exist.

- [ ] **Step 4: Write the config**

`packages/server/src/config.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ServerConfig {
  readonly token: string;
  readonly port: number;
}

const DEFAULT_PORT = 7840;

/** The user's config directory, outside the repository: the token is a secret and the repository is public. */
export function configDir(): string {
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'turing-city');
}

function newToken(): string {
  return randomBytes(24).toString('base64url');
}

function write(dir: string, config: ServerConfig): ServerConfig {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return config;
}

/** The saved config, created with a fresh token the first time. */
export function loadConfig(dir = configDir()): ServerConfig {
  try {
    const saved = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as Partial<ServerConfig>;
    if (typeof saved.token === 'string' && saved.token.length > 0) return { token: saved.token, port: saved.port ?? DEFAULT_PORT };
  } catch {
    // no config yet: make one below
  }
  return write(dir, { token: newToken(), port: DEFAULT_PORT });
}

/** A new token; agents connected with the old one get 401 from now on. */
export function reissueToken(dir = configDir()): ServerConfig {
  return write(dir, { ...loadConfig(dir), token: newToken() });
}

export function connectCommand(config: ServerConfig): string {
  return `claude mcp add --transport http turing-city http://127.0.0.1:${config.port}/mcp --header "Authorization: Bearer ${config.token}"`;
}
```

- [ ] **Step 5: Write the MCP endpoint**

`packages/server/src/mcp.ts`:

```ts
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { EmptyResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { AGENT_INSTRUCTIONS, AGENT_TOOLS, type AgentStatus, type AlertKind, type GameApi } from '@turing-city/core';
import { z } from 'zod';

/** Time control for QA agents. Never part of the game: it exists only with the server's --dev flag. */
export interface DevTools {
  play(): void;
  pause(): void;
  setSpeed(speed: 1 | 2 | 3): void;
  runUntil(goal: { seconds?: number; alertKinds?: readonly AlertKind[] }): Promise<void>;
  newSeason(seed: number): Promise<void>;
  rebuild(board: string): Promise<{ ok: true } | { ok: false; reason: string }>;
}

export interface McpOptions {
  readonly api: GameApi;
  /** Read on every request, so a reissued token takes effect at once. */
  readonly token: () => string;
  readonly onAgent: (status: AgentStatus) => void;
  readonly dev?: DevTools;
  readonly pingEveryMs?: number;
  readonly pingTimeoutMs?: number;
  /** How long a session lives after its stream closes, in case the client reopens it. */
  readonly graceMs?: number;
}

interface McpSession {
  readonly id: string;
  readonly transport: StreamableHTTPServerTransport;
  readonly mcp: McpServer;
  stream: ServerResponse | null;
  misses: number;
  pingTimer: ReturnType<typeof setInterval> | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

function text(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function toolError(error: unknown): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** A tool's result as JSON text; a refusal (ToolError) or any failure becomes a tool error the agent can read. */
async function run(fn: () => Promise<unknown>): Promise<ReturnType<typeof text> | ReturnType<typeof toolError>> {
  try {
    return text(await fn());
  } catch (error) {
    return toolError(error);
  }
}

function deny(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json', ...(status === 401 ? { 'www-authenticate': 'Bearer' } : {}) });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
}

function tokenMatches(header: string | undefined, token: string): boolean {
  const want = Buffer.from(`Bearer ${token}`);
  const got = Buffer.from(header ?? '');
  return got.length === want.length && timingSafeEqual(got, want);
}

export function createMcpEndpoint(options: McpOptions): {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  dropSessions(): Promise<void>;
  close(): Promise<void>;
} {
  const pingEveryMs = options.pingEveryMs ?? 5000;
  const pingTimeoutMs = options.pingTimeoutMs ?? 2000;
  const graceMs = options.graceMs ?? 10_000;
  const sessions = new Map<string, McpSession>();
  let reported: AgentStatus = { connected: false, clientName: null };

  function report(): void {
    const live = [...sessions.values()].find((s) => s.stream !== null && s.misses < 2);
    const next: AgentStatus = { connected: !!live, clientName: live ? (live.mcp.server.getClientVersion()?.name ?? 'agent') : null };
    if (next.connected !== reported.connected || next.clientName !== reported.clientName) {
      reported = next;
      options.onAgent(next);
    }
  }

  function buildServer(): McpServer {
    const mcp = new McpServer({ name: 'turing-city', version: '0.1.0' }, { instructions: AGENT_INSTRUCTIONS });
    for (const tool of AGENT_TOOLS) {
      if (Object.keys(tool.inputSchema).length === 0) {
        mcp.registerTool(tool.name, { description: tool.description }, async () => run(() => tool.run(options.api, {})));
      } else {
        mcp.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, async (args) =>
          run(() => tool.run(options.api, args as Record<string, unknown>)),
        );
      }
    }
    const dev = options.dev;
    if (dev) {
      const ok = { ok: true };
      mcp.registerTool('dev_play', { description: 'DEV: start the clock.' }, async () =>
        run(async () => {
          dev.play();
          return ok;
        }),
      );
      mcp.registerTool('dev_pause', { description: 'DEV: stop the clock.' }, async () =>
        run(async () => {
          dev.pause();
          return ok;
        }),
      );
      mcp.registerTool(
        'dev_set_speed',
        { description: 'DEV: 1x, 2x, or 3x.', inputSchema: { speed: z.union([z.literal(1), z.literal(2), z.literal(3)]) } },
        async ({ speed }) =>
          run(async () => {
            dev.setSpeed(speed);
            return ok;
          }),
      );
      mcp.registerTool(
        'dev_run_until',
        {
          description: 'DEV: run as fast as possible while paused, for some game seconds or until an alert of one of the kinds.',
          inputSchema: { seconds: z.number().positive().optional(), alertKinds: z.array(z.string()).optional() },
        },
        async ({ seconds, alertKinds }) =>
          run(async () => {
            await dev.runUntil({ ...(seconds === undefined ? {} : { seconds }), ...(alertKinds === undefined ? {} : { alertKinds: alertKinds as AlertKind[] }) });
            return ok;
          }),
      );
      mcp.registerTool('dev_new_season', { description: 'DEV: a new season with a seed.', inputSchema: { seed: z.number().int() } }, async ({ seed }) =>
        run(async () => {
          await dev.newSeason(seed);
          return ok;
        }),
      );
      mcp.registerTool('dev_rebuild', { description: 'DEV: rebuild a destroyed board.', inputSchema: { board: z.string() } }, async ({ board }) =>
        run(() => dev.rebuild(board)),
      );
    }
    return mcp;
  }

  function startPinging(s: McpSession): void {
    if (s.pingTimer) clearInterval(s.pingTimer);
    let inFlight = false;
    s.pingTimer = setInterval(() => {
      if (inFlight || !s.stream) return;
      inFlight = true;
      s.mcp.server
        .request({ method: 'ping' }, EmptyResultSchema, { timeout: pingTimeoutMs })
        .then(() => {
          s.misses = 0;
        })
        .catch(() => {
          s.misses += 1;
        })
        .finally(() => {
          inFlight = false;
          report();
        });
    }, pingEveryMs);
  }

  /** The SDK answers a stream GET with 200 (open) or an error status; 'close' ends it. */
  function watchStream(s: McpSession, res: ServerResponse): void {
    const writeHead = res.writeHead.bind(res) as (...args: unknown[]) => ServerResponse;
    res.writeHead = ((...args: unknown[]) => {
      const result = writeHead(...args);
      if (res.statusCode === 200 && s.stream === null) {
        s.stream = res;
        s.misses = 0;
        if (s.graceTimer) clearTimeout(s.graceTimer);
        startPinging(s);
        report();
      }
      return result;
    }) as ServerResponse['writeHead'];
    res.on('close', () => {
      if (s.stream !== res) return;
      s.stream = null;
      if (s.pingTimer) clearInterval(s.pingTimer);
      report();
      if (sessions.has(s.id)) s.graceTimer = setTimeout(() => void s.transport.close(), graceMs);
    });
  }

  async function newSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const mcp = buildServer();
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { id, transport, mcp, stream: null, misses: 0, pingTimer: null, graceTimer: null });
      },
    });
    // Before connect(): connect() chains onto an existing onclose; set afterwards, this would replace the SDK's own.
    transport.onclose = () => {
      const id = transport.sessionId;
      const s = id === undefined ? undefined : sessions.get(id);
      if (!s) return;
      if (s.pingTimer) clearInterval(s.pingTimer);
      if (s.graceTimer) clearTimeout(s.graceTimer);
      sessions.delete(s.id);
      report();
    };
    // The SDK's transports don't satisfy its own Transport type under exactOptionalPropertyTypes.
    await mcp.connect(transport as Transport);
    await transport.handleRequest(req, res);
    if (!transport.sessionId) await mcp.close();
  }

  return {
    async handle(req, res) {
      try {
        if (req.headers.origin !== undefined) return deny(res, 403, 'Forbidden: browser requests are not allowed');
        if (!tokenMatches(req.headers.authorization, options.token())) return deny(res, 401, 'Unauthorized');
        const header = req.headers['mcp-session-id'];
        const sessionId = Array.isArray(header) ? header[0] : header;
        if (!sessionId) {
          if (req.method !== 'POST') return deny(res, 400, 'Bad Request: Mcp-Session-Id header is required');
          return await newSession(req, res);
        }
        const s = sessions.get(sessionId);
        if (!s) return deny(res, 404, 'Session not found');
        if (req.method === 'GET') watchStream(s, res);
        await s.transport.handleRequest(req, res);
      } catch {
        if (!res.headersSent) deny(res, 500, 'Internal error');
      }
    },
    async dropSessions() {
      for (const s of [...sessions.values()]) await s.transport.close();
      sessions.clear();
      report();
    },
    async close() {
      for (const s of [...sessions.values()]) await s.transport.close();
      sessions.clear();
    },
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run packages/server/test/config.test.ts packages/server/test/mcp.test.ts`
Expected: PASS (config 3, MCP 7).

Then show the connection test guards the stream tracking: temporarily make `watchStream` return at its first line, rerun `mcp.test.ts`, and expect the three connection tests to fail (each times out waiting for `connected: true`). Restore it.

- [ ] **Step 7: Commit**

```bash
pnpm fix
git add packages/server pnpm-lock.yaml
git commit -m "Add the MCP endpoint: the kept token, gatekeeping, the agent tools, dev tools, and the connection rule"
```

### Task 18: The game server: the viewer's WebSocket, the static viewer, and `pnpm start`

One HTTP server on 127.0.0.1 carries everything (spec §4.1): `/mcp` for the agent (Task 17), `/ws` for the viewer, and the built viewer itself at `/`. The WebSocket accepts the game's own pages (and Vite's dev server) and refuses other websites; it streams the controller's status, snapshots, alerts, and deploys, and takes the player's commands.

Nothing a client sends may stop the server. Any web page the player visits can make the browser send requests to 127.0.0.1 (an image pointed at `http://127.0.0.1:7840/%` is enough), and a raw local client can send anything. So every request handler turns an error into a response (400 for a malformed path or a target that isn't a URL, 500 for anything else), and every WebSocket has an `error` listener. A security review of the first draft found that `/%`, a request or upgrade target such as `http://[`, and a WebSocket frame without a mask each crashed it; the test "keeps serving after requests that would crash a careless server" sends all four.

**Files:**
- Create: `packages/server/src/viewer-hub.ts`, `packages/server/src/static-files.ts`, `packages/server/src/game-server.ts`, `packages/server/src/main.ts`
- Modify: `packages/core/src/protocol.ts` (viewer messages), `packages/server/package.json` (dependencies), `package.json` (root scripts), `CLAUDE.md`
- Test: `packages/server/test/game-server.test.ts`

**Interfaces:**
- Consumes: Task 16 (`GameController`, `gameApi`, `ControllerEvent`), Task 17 (`createMcpEndpoint`, `loadConfig`, `reissueToken`, `connectCommand`, `DevTools`), Task 3 (`parseScenario`).
- Produces:
  - `protocol.ts`: `type ServerToViewer` (`hello`, `status`, `snapshot`, `alerts`, `deploy`, `inspection`, `error`), `type ViewerToServer` (`startSeason`, `play`, `pause`, `speed`, `rebuild`, `autoPause`, `reissueToken`, `inspect`).
  - `startGameServer(options: { port?: number; configDir?: string; dev?: boolean; scenarioPath?: string; viewerDist?: string | null }): Promise<{ port: number; url: string; connect: string; close(): Promise<void> }>`.
  - Root scripts: `pnpm start` (builds the viewer, then serves the game at http://127.0.0.1:7840), `pnpm start:dev` (the same with the dev tools), `pnpm viewer` (Vite's dev server on 5173 for working on the viewer).

- [ ] **Step 1: Add the viewer messages and the dependency**

Append to `packages/core/src/protocol.ts`:

```ts
/** Server to viewer, over the WebSocket. */
export type ServerToViewer =
  | { readonly type: 'hello'; readonly connect: string; readonly port: number }
  | { readonly type: 'status'; readonly status: ControllerStatus }
  | { readonly type: 'snapshot'; readonly snapshot: Snapshot }
  | { readonly type: 'alerts'; readonly alerts: readonly AlertView[] }
  | { readonly type: 'deploy'; readonly board: string; readonly version: number; readonly time: TimeView }
  | { readonly type: 'inspection'; readonly board: string; readonly inspection: BoardInspection | null }
  | { readonly type: 'error'; readonly message: string };

/** Viewer to server: the player's commands. */
export type ViewerToServer =
  | { readonly type: 'startSeason' }
  | { readonly type: 'play' }
  | { readonly type: 'pause' }
  | { readonly type: 'speed'; readonly speed: 1 | 2 | 3 }
  | { readonly type: 'rebuild'; readonly board: string }
  | { readonly type: 'autoPause'; readonly kinds: readonly AlertKind[] }
  | { readonly type: 'reissueToken' }
  | { readonly type: 'inspect'; readonly board: string };
```

Run: `pnpm --filter @turing-city/server add ws@8.22.0 && pnpm --filter @turing-city/server add -D @types/ws@8.18.2`

- [ ] **Step 2: Write the failing test**

`packages/server/test/game-server.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { ServerToViewer, ViewerToServer } from '@turing-city/core';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { loadConfig } from '../src/config.ts';
import { startGameServer } from '../src/game-server.ts';

let stop: (() => Promise<void>) | null = null;
afterEach(async () => {
  await stop?.();
  stop = null;
});

/** A viewer connection that records every message. */
async function viewer(
  port: number,
  origin?: string,
): Promise<{ ws: WebSocket; seen: ServerToViewer[]; send: (m: ViewerToServer) => void }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, origin === undefined ? {} : { origin });
  const seen: ServerToViewer[] = [];
  ws.on('message', (data) => seen.push(JSON.parse(String(data)) as ServerToViewer));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return { ws, seen, send: (m) => ws.send(JSON.stringify(m)) };
}

const until = async (cond: () => boolean, ms = 5000): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
};

/** Sends raw bytes and gives the reply's first line ('' when the server just hangs up). */
function raw(port: number, text: string): Promise<string> {
  return new Promise((resolve) => {
    let reply = '';
    const socket = connect(port, '127.0.0.1', () => socket.write(text));
    socket.on('data', (data) => {
      reply += String(data);
    });
    socket.on('close', () => resolve(reply.split('\r\n')[0] ?? ''));
    socket.on('error', () => resolve(''));
  });
}

function last<T extends ServerToViewer['type']>(seen: ServerToViewer[], type: T): Extract<ServerToViewer, { type: T }> | undefined {
  return seen.filter((m): m is Extract<ServerToViewer, { type: T }> => m.type === type).at(-1);
}

describe('game server', () => {
  it('runs a season end to end: viewer, agent, deploy, and the connection rule', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'tc-server-'));
    const server = await startGameServer({ port: 0, configDir, dev: true, viewerDist: null });
    stop = server.close;
    const v = await viewer(server.port);
    await until(() => last(v.seen, 'hello') !== undefined && last(v.seen, 'status') !== undefined);
    expect(last(v.seen, 'hello')!.connect).toContain(loadConfig(configDir).token);
    expect(last(v.seen, 'status')!.status).toMatchObject({ state: 'idle', agent: { connected: false } });

    v.send({ type: 'startSeason' });
    await until(() => last(v.seen, 'error') !== undefined);
    expect(last(v.seen, 'error')!.message).toContain('connect an agent first');

    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${loadConfig(configDir).token}` } },
    });
    const agent = new Client({ name: 'e2e-agent', version: '0.0.1' });
    await agent.connect(transport as Transport);
    await until(() => last(v.seen, 'status')?.status.agent.connected === true);

    v.send({ type: 'startSeason' });
    await until(() => last(v.seen, 'status')?.status.state === 'paused');
    const deployed = await agent.callTool({
      name: 'deploy_firmware',
      arguments: { board: 'DA', code: 'function tick(io) io.log("on") end' },
    });
    expect(deployed.isError).toBeFalsy();
    await until(() => last(v.seen, 'deploy') !== undefined);
    await agent.callTool({ name: 'dev_run_until', arguments: { seconds: 1 } });
    await until(() => last(v.seen, 'snapshot')!.snapshot.boards[1]!.hasFirmware);

    v.send({ type: 'inspect', board: 'DA' });
    await until(() => last(v.seen, 'inspection') !== undefined);
    expect(last(v.seen, 'inspection')!.inspection!.logs.some((l) => l.text === 'on')).toBe(true);

    v.send({ type: 'play' });
    await until(() => last(v.seen, 'status')?.status.state === 'running');
    await transport.terminateSession();
    await agent.close();
    await until(() => last(v.seen, 'status')?.status.state === 'paused');
    expect(last(v.seen, 'status')!.status.blockedByAgent).toBe(true);
    v.ws.close();
  }, 30_000);

  it('keeps serving after requests that would crash a careless server', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'tc-viewer-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html>');
    const server = await startGameServer({ port: 0, configDir: mkdtempSync(join(tmpdir(), 'tc-server-')), viewerDist: dist });
    stop = server.close;
    // Any web page can make the browser request a malformed escape.
    expect((await fetch(`${server.url}/%`)).status).toBe(400);
    // A raw client can send a request target, or an upgrade, that isn't a URL at all.
    expect(await raw(server.port, 'GET http://[ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n')).toBe('HTTP/1.1 400 Bad Request');
    const upgrade = 'Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==';
    expect(await raw(server.port, `GET http://[ HTTP/1.1\r\nHost: x\r\n${upgrade}\r\n\r\n`)).toBe('');
    // A WebSocket client that breaks the protocol (an unmasked frame) loses only its own connection.
    const v = await viewer(server.port);
    const closed = new Promise<number>((resolve) => v.ws.once('close', resolve));
    (v.ws as unknown as { _socket: Socket })._socket.write(Buffer.from([0x81, 0x02, 0x68, 0x69]));
    expect(await closed).toBe(1002);
    expect((await fetch(`${server.url}/`)).status).toBe(200);
  });

  it('refuses a WebSocket from another website', async () => {
    const server = await startGameServer({ port: 0, configDir: mkdtempSync(join(tmpdir(), 'tc-server-')), viewerDist: null });
    stop = server.close;
    await expect(viewer(server.port, 'http://evil.example')).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run packages/server/test/game-server.test.ts`
Expected: FAIL, `../src/game-server.ts` doesn't exist.

- [ ] **Step 4: Write the viewer hub and the static files**

`packages/server/src/viewer-hub.ts`:

```ts
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { ControllerEvent, ServerToViewer, ViewerToServer } from '@turing-city/core';
import { type WebSocket, WebSocketServer } from 'ws';
import type { GameController } from './game-controller.ts';

export interface ViewerHubOptions {
  readonly controller: GameController;
  readonly hello: () => ServerToViewer;
  readonly reissueToken: () => void;
  /** Origins allowed to open the viewer socket; a request with no Origin (not a browser) is allowed too. */
  readonly allowedOrigins: readonly string[];
}

function toMessage(event: ControllerEvent): ServerToViewer {
  switch (event.kind) {
    case 'status':
      return { type: 'status', status: event.status };
    case 'snapshot':
      return { type: 'snapshot', snapshot: event.snapshot };
    case 'alerts':
      return { type: 'alerts', alerts: event.alerts };
    case 'deploy':
      return { type: 'deploy', board: event.board, version: event.version, time: event.time };
  }
}

export function createViewerHub(options: ViewerHubOptions): {
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  close(): void;
} {
  const { controller } = options;
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();
  const send = (ws: WebSocket, message: ServerToViewer): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };
  const broadcast = (message: ServerToViewer): void => {
    for (const ws of clients) send(ws, message);
  };
  const unsubscribe = controller.onEvent((event) => broadcast(toMessage(event)));

  async function handle(ws: WebSocket, message: ViewerToServer): Promise<void> {
    switch (message.type) {
      case 'startSeason':
        await controller.startSeason();
        return;
      case 'play':
        controller.play();
        return;
      case 'pause':
        controller.pause();
        return;
      case 'speed':
        controller.setSpeed(message.speed);
        return;
      case 'rebuild': {
        const result = await controller.rebuild(message.board);
        if (!result.ok) send(ws, { type: 'error', message: result.reason });
        return;
      }
      case 'autoPause':
        controller.setAutoPause(message.kinds);
        return;
      case 'reissueToken':
        options.reissueToken();
        broadcast(options.hello());
        return;
      case 'inspect':
        send(ws, { type: 'inspection', board: message.board, inspection: await controller.inspect(message.board) });
        return;
    }
  }

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);
    send(ws, options.hello());
    send(ws, { type: 'status', status: controller.status() });
    const snap = controller.latestSnapshot();
    if (snap) send(ws, { type: 'snapshot', snapshot: snap });
    ws.on('message', (data) => {
      let message: ViewerToServer;
      try {
        message = JSON.parse(String(data)) as ViewerToServer;
      } catch {
        return;
      }
      handle(ws, message).catch((error: unknown) =>
        send(ws, { type: 'error', message: error instanceof Error ? error.message : String(error) }),
      );
    });
    ws.on('close', () => clients.delete(ws));
    // After a protocol error, ws closes the connection itself; without a listener the error would crash the server.
    ws.on('error', () => clients.delete(ws));
  });

  return {
    upgrade(req, socket, head) {
      const origin = req.headers.origin;
      if (origin !== undefined && !options.allowedOrigins.includes(origin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    },
    close() {
      unsubscribe();
      for (const ws of clients) ws.terminate();
      wss.close();
    },
  };
}
```

`packages/server/src/static-files.ts`:

```ts
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

/** Serves the built viewer. Paths outside the directory are refused; unknown paths get index.html. */
export async function serveStatic(root: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let path: string;
  try {
    path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    // A malformed escape such as "/%" throws here, and any web page can make the browser request one.
    res.writeHead(400).end();
    return;
  }
  let file = normalize(join(root, path === '/' ? 'index.html' : path));
  if (!file.startsWith(root + sep) && file !== root) {
    res.writeHead(403).end();
    return;
  }
  try {
    if (!(await stat(file)).isFile()) file = join(root, 'index.html');
  } catch {
    file = join(root, 'index.html');
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('viewer not built: run pnpm start, which builds it');
  }
}
```

- [ ] **Step 5: Write the game server and its command**

`packages/server/src/game-server.ts`:

```ts
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { parseScenario, type ServerToViewer } from '@turing-city/core';
import { configDir, connectCommand, loadConfig, reissueToken } from './config.ts';
import { GameController, gameApi } from './game-controller.ts';
import { createMcpEndpoint, type DevTools } from './mcp.ts';
import { serveStatic } from './static-files.ts';
import { createViewerHub } from './viewer-hub.ts';

export interface GameServerOptions {
  readonly port?: number;
  readonly configDir?: string;
  readonly dev?: boolean;
  readonly scenarioPath?: string;
  /** The built viewer to serve at /; null serves none (tests). */
  readonly viewerDist?: string | null;
}

/** The request's path, or null when its target isn't a URL at all (a raw client can send anything). */
function pathOf(req: IncomingMessage): string | null {
  try {
    return new URL(req.url ?? '/', 'http://x').pathname;
  } catch {
    return null;
  }
}

const DEFAULT_SCENARIO = fileURLToPath(new URL('../../../scenarios/m1-power.json', import.meta.url));
const DEFAULT_VIEWER = fileURLToPath(new URL('../../viewer/dist', import.meta.url));

export async function startGameServer(
  options: GameServerOptions = {},
): Promise<{ port: number; url: string; connect: string; close(): Promise<void> }> {
  const dir = options.configDir ?? configDir();
  let config = loadConfig(dir);
  const scenario = parseScenario(JSON.parse(readFileSync(options.scenarioPath ?? DEFAULT_SCENARIO, 'utf8')));
  const controller = new GameController({ scenario });
  const dev: DevTools | undefined = options.dev
    ? {
        play: () => controller.play(),
        pause: () => controller.pause(),
        setSpeed: (s) => controller.setSpeed(s),
        runUntil: (goal) => controller.runUntil(goal),
        newSeason: (seed) => controller.startSeason(seed),
        rebuild: (board) => controller.rebuild(board),
      }
    : undefined;
  const mcp = createMcpEndpoint({
    api: gameApi(controller),
    token: () => config.token,
    onAgent: (status) => controller.setAgent(status),
    ...(dev ? { dev } : {}),
  });
  const viewerDist = options.viewerDist === undefined ? DEFAULT_VIEWER : options.viewerDist;

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = pathOf(req);
    if (path === null) res.writeHead(400).end();
    else if (path === '/mcp') await mcp.handle(req, res);
    else if (viewerDist !== null) await serveStatic(viewerDist, req, res);
    else res.writeHead(404).end();
  }
  const http = createServer((req, res) => {
    route(req, res).catch(() => {
      // No request may stop the game: whatever a handler throws becomes an error response.
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => http.listen(options.port ?? config.port, '127.0.0.1', resolve));
  const port = (http.address() as AddressInfo).port;
  const portConfig = () => ({ ...config, port });
  const hello = (): ServerToViewer => ({ type: 'hello', connect: connectCommand(portConfig()), port });
  const hub = createViewerHub({
    controller,
    hello,
    reissueToken: () => {
      config = reissueToken(dir);
      void mcp.dropSessions(); // agents holding the old token are cut off; their reconnection gets 401
    },
    allowedOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`, 'http://127.0.0.1:5173', 'http://localhost:5173'],
  });
  http.on('upgrade', (req, socket, head) => {
    if (pathOf(req) === '/ws') hub.upgrade(req, socket, head);
    else socket.destroy();
  });

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    connect: connectCommand(portConfig()),
    async close() {
      hub.close();
      await mcp.close();
      controller.close();
      http.closeAllConnections();
      await new Promise((resolve) => http.close(resolve));
    },
  };
}
```

`packages/server/src/main.ts`:

```ts
import { parseArgs } from 'node:util';
import { startGameServer } from './game-server.ts';

const { values } = parseArgs({ options: { dev: { type: 'boolean', default: false }, port: { type: 'string' } } });
const server = await startGameServer({ dev: values.dev, ...(values.port === undefined ? {} : { port: Number(values.port) }) });
process.stdout.write(`turing-city is running: open ${server.url} in a browser.\n`);
process.stdout.write(`Connect your agent (Claude Code):\n  ${server.connect}\n`);
if (values.dev) process.stdout.write('Dev tools are on: agents get dev_play, dev_pause, dev_set_speed, dev_run_until, dev_new_season, dev_rebuild.\n');
const shutdown = (): void => {
  void server.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

Add to the root `package.json` scripts:

```json
"start": "pnpm --filter @turing-city/viewer build && node --disable-warning=ExperimentalWarning packages/server/src/main.ts",
"start:dev": "pnpm --filter @turing-city/viewer build && node --disable-warning=ExperimentalWarning packages/server/src/main.ts --dev",
"viewer": "pnpm --filter @turing-city/viewer dev"
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run packages/server`
Expected: PASS (every server test, the game-server tests included).

Run it in the background: `pnpm start > scratch/start.log 2>&1 & echo $! > scratch/start.pid`. Expect the log to end with `turing-city is running: open http://127.0.0.1:7840 in a browser.`, `Connect your agent (Claude Code):`, and the `claude mcp add …` line. Stop it with SIGINT to the server, which is pnpm's grandchild: `pkill -INT -P "$(pgrep -P "$(cat scratch/start.pid)")"`; pnpm exits with it (a `kill -INT` to pnpm itself leaves both running). In a terminal, Ctrl-C does the same. Don't open the browser from an agent session: the guard hook asks before `open`, and the viewer is checked headlessly in Task 21.

- [ ] **Step 7: Record the commands in CLAUDE.md**

In `CLAUDE.md`, "Code and checks", add to the list of commands:

```markdown
  - `pnpm start`: builds the viewer and serves the game at http://127.0.0.1:7840 (MCP at `/mcp`, the viewer's socket at `/ws`); it prints the agent's connect command. `pnpm start:dev` adds the dev tools (`dev_play`, `dev_run_until`, ...) for QA agents. `pnpm viewer` runs Vite's dev server on 5173 against a running game server.
  - The token lives in `~/.config/turing-city/config.json`, outside the repository (it's public).
```

- [ ] **Step 8: Commit**

```bash
pnpm fix
git add packages package.json pnpm-lock.yaml CLAUDE.md
git commit -m "Serve the game: the viewer's WebSocket, the built viewer, MCP, and pnpm start"
```

### Task 19: The viewer's connection, its pure display rules, and the start screen

The viewer is a browser page: Phaser draws the map (Task 20), plain DOM carries the text-heavy parts (top bar, panel, alerts, overlays), which is easier to lay out and to read. This task builds the WebSocket client, the store the screens read, the display rules as pure functions (tested), and the start screen of spec §8.1: the connect command with a copy button, token reissue, the agent's state, and "시즌 시작" enabled only while an agent is connected.

**Files:**
- Create: `packages/viewer/src/net.ts`, `packages/viewer/src/store.ts`, `packages/viewer/src/format.ts`, `packages/viewer/src/dom.ts`, `packages/viewer/src/ui/start-screen.ts`, `packages/viewer/src/style.css`
- Modify: `packages/viewer/src/main.ts`, `packages/viewer/index.html`, `packages/viewer/package.json` (dependencies)
- Test: `packages/viewer/test/format.test.ts`

**Interfaces:**
- Consumes: Task 18 (`ServerToViewer`, `ViewerToServer`), Task 16 (`ControllerStatus`), Task 14 (`Snapshot`, `AlertView`, `BoardInspection`, `TimeView`).
- Produces:
  - `net.ts`: `class Connection { constructor(url, onMessage, onOpenChange); send(message: ViewerToServer); }` (reconnects every second while closed); `gameSocketUrl(location: Location): string`.
  - `store.ts`: `class Store` with `hello`, `status`, `snapshot`, `feed: FeedItem[]` (alerts and deploys, newest first, at most 50), `inspection`, `error`, `socketOpen`, `selected: string | null`, `heatmap: boolean`; `apply(message: ServerToViewer)`; `subscribe(fn): () => void`; `select(id)`; `toggleHeatmap()`.
  - `format.ts`: `moneyLabel`, `timeLabel`, `type Led`, `ledOf(board)`, `LED_COLORS`, `LED_LABELS`, `heatAlpha(units)`, `consumersOf(snapshot, selectedId)`, `ALERT_LABELS`, `endingLabel(kind)`, `KIND_LABELS`.
  - `dom.ts`: `el(tag, attrs?, children?)` (builds elements with `textContent`, never `innerHTML` for game text), `clear(node)`.

- [ ] **Step 1: Add the viewer's dependency on the core**

Run: `pnpm --filter @turing-city/viewer add '@turing-city/core@workspace:*'`

- [ ] **Step 2: Write the failing tests**

`packages/viewer/test/format.test.ts`:

```ts
import type { Snapshot } from '@turing-city/core';
import { describe, expect, it } from 'vitest';
import { consumersOf, heatAlpha, ledOf, moneyLabel, timeLabel } from '../src/format.ts';

type Board = Snapshot['boards'][number];
const board = (over: Partial<Board>): Board => ({
  id: 'DA',
  kind: 'datacenter',
  x: 5,
  y: 4,
  status: 'running',
  powered: true,
  hasFirmware: true,
  erroring: false,
  tempC: 40,
  processing: false,
  cooling: 0,
  demand: 10,
  ...over,
});

describe('format', () => {
  it('labels money and time', () => {
    expect(moneyLabel(12400)).toBe('12,400');
    expect(moneyLabel(-30)).toBe('-30');
    expect(timeLabel({ day: 7, clock: '14:20', seconds: 0 }, 30)).toBe('7일차 14:20 / 30일');
  });

  it('picks a status light: destroyed, asleep, unpowered, error, no firmware, running', () => {
    expect(ledOf(board({ status: 'destroyed' }))).toBe('destroyed');
    expect(ledOf(board({ status: 'rebuilding' }))).toBe('destroyed');
    expect(ledOf(board({ status: 'asleep' }))).toBe('asleep');
    expect(ledOf(board({ powered: false }))).toBe('unpowered');
    expect(ledOf(board({ erroring: true }))).toBe('error');
    expect(ledOf(board({ hasFirmware: false }))).toBe('off');
    expect(ledOf(board({}))).toBe('running');
  });

  it('shades the heatmap from 1 EMF up, capped', () => {
    expect(heatAlpha(0)).toBe(0);
    expect(heatAlpha(50)).toBeCloseTo(0.3);
    expect(heatAlpha(10_000)).toBe(0.6);
  });

  it('lists the plant\'s consumers with draw, priority, and shedding, only when the plant is selected', () => {
    const snapshot = {
      boards: [board({ id: 'P', kind: 'power' }), board({ id: 'DA', demand: 163 }), board({ id: 'DB', demand: 211 })],
      plant: { priority: ['DA', 'DB'], shed: ['DB'] },
    } as unknown as Snapshot;
    expect(consumersOf(snapshot, 'P')).toEqual([
      { id: 'DA', demand: 163, rank: 1, shed: false },
      { id: 'DB', demand: 211, rank: 2, shed: true },
    ]);
    expect(consumersOf(snapshot, 'DA')).toBeNull();
    expect(consumersOf(snapshot, null)).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run packages/viewer`
Expected: FAIL, `../src/format.ts` doesn't exist.

- [ ] **Step 4: Write the display rules**

`packages/viewer/src/format.ts`:

```ts
import type { AlertKind, EndKind, FacilityKind, Snapshot, TimeView } from '@turing-city/core';

type Board = Snapshot['boards'][number];

export function moneyLabel(n: number): string {
  return n.toLocaleString('en-US');
}

export function timeLabel(t: TimeView, seasonDays: number): string {
  return `${t.day}일차 ${t.clock} / ${seasonDays}일`;
}

export type Led = 'running' | 'asleep' | 'unpowered' | 'error' | 'destroyed' | 'off';

export function ledOf(b: Board): Led {
  if (b.status === 'destroyed' || b.status === 'rebuilding') return 'destroyed';
  if (b.status === 'asleep') return 'asleep';
  if (!b.powered) return 'unpowered';
  if (b.erroring) return 'error';
  if (!b.hasFirmware) return 'off';
  return 'running';
}

export const LED_COLORS: Record<Led, number> = {
  running: 0x3fd07a,
  asleep: 0xe6d34a,
  unpowered: 0x596370,
  error: 0xff4d4d,
  destroyed: 0x000000,
  off: 0x2a313a,
};

export const LED_LABELS: Record<Led, string> = {
  running: '동작',
  asleep: '휴면',
  unpowered: '정전',
  error: '에러',
  destroyed: '파괴',
  off: '펌웨어 없음',
};

export const KIND_LABELS: Record<FacilityKind, string> = { power: '발전소', datacenter: '데이터센터' };

/** Heatmap opacity for a cell's EMF: nothing under 1, at most 0.6. */
export function heatAlpha(units: number): number {
  if (units < 1) return 0;
  return Math.min(0.6, units / 166);
}

/** When the power plant is selected: every board it powers, with its draw, priority rank, and whether it's shed. */
export function consumersOf(snapshot: Snapshot, selectedId: string | null): Array<{ id: string; demand: number; rank: number; shed: boolean }> | null {
  const selected = snapshot.boards.find((b) => b.id === selectedId);
  if (selected?.kind !== 'power') return null;
  return snapshot.boards
    .filter((b) => b.kind !== 'power')
    .map((b) => ({ id: b.id, demand: b.demand, rank: snapshot.plant.priority.indexOf(b.id) + 1, shed: snapshot.plant.shed.includes(b.id) }));
}

export const ALERT_LABELS: Record<AlertKind, string> = {
  raid: '러다이트 출현',
  ludditesNear: '러다이트 접근',
  boardDestroyed: '보드 파괴',
  fire: '화재',
  overheat: '과열',
  powerShortage: '정전',
  firmwareError: '펌웨어 에러',
  moneyBelowZero: '자금 마이너스',
  seasonEnd: '시즌 종료',
};

export function endingLabel(kind: EndKind): string {
  return kind === 'completed' ? '시즌 완주' : kind === 'bankrupt' ? '파산' : '함락';
}
```

Check: `heatAlpha(50)` is 50 / 166 ≈ 0.301, which `toBeCloseTo(0.3)` accepts (two decimals).

- [ ] **Step 5: Write the connection, the store, and the DOM helper**

`packages/viewer/src/net.ts`:

```ts
import type { ServerToViewer, ViewerToServer } from '@turing-city/core';

/** The game server's socket: same origin when the server serves the page, port 7840 under Vite's dev server. */
export function gameSocketUrl(location: Location): string {
  if (location.port === '5173') return 'ws://127.0.0.1:7840/ws';
  return `ws://${location.host}/ws`;
}

/** A WebSocket that reconnects every second while the server is away. */
export class Connection {
  private socket: WebSocket | null = null;
  private readonly url: string;
  private readonly onMessage: (message: ServerToViewer) => void;
  private readonly onOpenChange: (open: boolean) => void;

  constructor(url: string, onMessage: (message: ServerToViewer) => void, onOpenChange: (open: boolean) => void) {
    this.url = url;
    this.onMessage = onMessage;
    this.onOpenChange = onOpenChange;
    this.open();
  }

  send(message: ViewerToServer): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private open(): void {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.addEventListener('open', () => this.onOpenChange(true));
    socket.addEventListener('message', (event: MessageEvent<string>) => this.onMessage(JSON.parse(event.data) as ServerToViewer));
    socket.addEventListener('close', () => {
      this.onOpenChange(false);
      setTimeout(() => this.open(), 1000);
    });
  }
}
```

`packages/viewer/src/store.ts`:

```ts
import type { AlertView, BoardInspection, ControllerStatus, ServerToViewer, Snapshot, TimeView } from '@turing-city/core';

export type FeedItem = { readonly kind: 'alert'; readonly alert: AlertView } | { readonly kind: 'deploy'; readonly board: string; readonly version: number; readonly time: TimeView };

const FEED_LIMIT = 50;

/** What the screens read; every change notifies the subscribers. */
export class Store {
  hello: { connect: string; port: number } | null = null;
  status: ControllerStatus | null = null;
  snapshot: Snapshot | null = null;
  feed: FeedItem[] = [];
  inspection: { board: string; inspection: BoardInspection | null } | null = null;
  error: string | null = null;
  socketOpen = false;
  selected: string | null = null;
  heatmap = false;
  private readonly listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  apply(message: ServerToViewer): void {
    switch (message.type) {
      case 'hello':
        this.hello = { connect: message.connect, port: message.port };
        break;
      case 'status':
        this.status = message.status;
        if (message.status.state === 'paused' || message.status.state === 'running') this.error = null;
        break;
      case 'snapshot':
        if (this.snapshot && message.snapshot.step < this.snapshot.step) this.feed = []; // a new season
        this.snapshot = message.snapshot;
        break;
      case 'alerts':
        this.push(...message.alerts.map((alert): FeedItem => ({ kind: 'alert', alert })).reverse());
        break;
      case 'deploy':
        this.push({ kind: 'deploy', board: message.board, version: message.version, time: message.time });
        break;
      case 'inspection':
        this.inspection = { board: message.board, inspection: message.inspection };
        break;
      case 'error':
        this.error = message.message;
        break;
    }
    this.notify();
  }

  setSocketOpen(open: boolean): void {
    this.socketOpen = open;
    this.notify();
  }

  select(id: string | null): void {
    this.selected = id;
    this.inspection = null;
    this.notify();
  }

  toggleHeatmap(): void {
    this.heatmap = !this.heatmap;
    this.notify();
  }

  private push(...items: FeedItem[]): void {
    this.feed = [...items, ...this.feed].slice(0, FEED_LIMIT);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}
```

`packages/viewer/src/dom.ts`:

```ts
type Attrs = Record<string, string | boolean | ((event: Event) => void)>;

/** Builds an element. Text goes in as textContent, so game text never becomes markup. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, children: Array<Node | string> = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === 'function') node.addEventListener(key.replace(/^on/, ''), value);
    else if (typeof value === 'boolean') node.toggleAttribute(key, value);
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

export function clear(node: Element): void {
  node.replaceChildren();
}
```

- [ ] **Step 6: Write the start screen, the page, and the style**

`packages/viewer/src/ui/start-screen.ts`:

```ts
import type { Connection } from '../net.ts';
import type { Store } from '../store.ts';
import { clear, el } from '../dom.ts';

/** Spec §8.1: connect your agent, then start the season. */
export function renderStartScreen(root: HTMLElement, store: Store, net: Connection): void {
  clear(root);
  const agent = store.status?.agent;
  const connected = agent?.connected === true;
  const command = store.hello?.connect ?? '서버에 연결하는 중…';
  root.append(
    el('div', { class: 'start' }, [
      el('h1', {}, ['turing-city']),
      el('p', { class: 'dim' }, [store.status?.scenarioName ?? '']),
      el('p', {}, ['에이전트를 연결하세요 (Claude Code 예시)']),
      el('pre', { class: 'cmd' }, [command]),
      el('div', { class: 'row' }, [
        el('button', { class: 'primary', onclick: () => void navigator.clipboard.writeText(command) }, ['복사']),
        el('button', { onclick: () => net.send({ type: 'reissueToken' }) }, ['토큰 재발급']),
        el('span', { class: connected ? 'ok' : 'warn' }, [connected ? `● 에이전트 연결됨 (${agent?.clientName ?? 'agent'})` : '◌ 에이전트를 기다리는 중…']),
      ]),
      el('button', { class: 'start-button', disabled: !connected, onclick: () => net.send({ type: 'startSeason' }) }, ['시즌 시작']),
      store.error ? el('p', { class: 'bad' }, [store.error]) : '',
      store.socketOpen ? '' : el('p', { class: 'bad' }, ['게임 서버에 연결할 수 없어요. pnpm start가 돌고 있나요?']),
    ]),
  );
}
```

Replace `packages/viewer/index.html`'s body with the page's regions:

```html
  <body>
    <div id="start"></div>
    <div id="game" hidden>
      <header id="topbar"></header>
      <main>
        <section id="left">
          <div id="map"></div>
          <div id="feed"></div>
        </section>
        <aside id="panel"></aside>
      </main>
      <footer id="keys">스페이스 일시정지 · 1/2/3 배속 · H 히트맵 · 시설 클릭 = 패널 · 알림 클릭 = 그 시설로</footer>
    </div>
    <div id="overlay" hidden></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
```

`packages/viewer/src/style.css`:

```css
:root {
  --bg: #11151a;
  --panel: #181d24;
  --line: #252c35;
  --text: #d7dde4;
  --dim: #7d8894;
  --ok: #3fd07a;
  --warn: #ffb020;
  --bad: #ff4d4d;
  --accent: #2f6fde;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 13px -apple-system, 'Apple SD Gothic Neo', sans-serif; }
button { background: #2a313a; color: var(--text); border: 0; border-radius: 5px; padding: 6px 12px; font: inherit; cursor: pointer; }
button:disabled { opacity: 0.45; cursor: default; }
button.primary { background: var(--accent); color: #fff; }
pre { margin: 0; white-space: pre-wrap; font: 11px ui-monospace, Menlo, monospace; }
.dim { color: var(--dim); } .ok { color: var(--ok); } .warn { color: var(--warn); } .bad { color: var(--bad); }
.row { display: flex; gap: 8px; align-items: center; margin: 8px 0; }
.start { max-width: 640px; margin: 80px auto; }
.start h1 { margin: 0 0 4px; }
.cmd { background: #0d1116; border: 1px solid var(--line); border-radius: 6px; padding: 10px; color: #9fe0b4; word-break: break-all; }
.start-button { margin-top: 18px; background: var(--ok); color: #0c0f13; font-weight: 700; font-size: 14px; padding: 9px 20px; }
#topbar { display: flex; gap: 18px; align-items: center; padding: 9px 14px; background: #0c0f13; border-bottom: 1px solid var(--line); white-space: nowrap; }
#topbar b { color: #fff; }
#topbar .speed button { padding: 2px 8px; margin-right: 2px; }
#topbar .speed button.on { background: var(--accent); color: #fff; }
#topbar .agent { margin-left: auto; }
main { display: flex; }
#left { flex: 1; padding: 12px; }
#panel { width: 340px; background: var(--panel); border-left: 1px solid var(--line); padding: 12px 14px; min-height: 480px; }
#panel h2 { margin: 0 0 2px; font-size: 15px; color: #fff; }
#panel .sec { margin-top: 12px; }
#panel .label { font-size: 10px; letter-spacing: 0.06em; color: var(--dim); text-transform: uppercase; margin-bottom: 4px; }
#panel .kv { display: grid; grid-template-columns: 100px 1fr; row-gap: 3px; }
#panel pre { background: #0d1116; border: 1px solid var(--line); border-radius: 6px; padding: 7px 8px; max-height: 180px; overflow: auto; }
#feed { margin-top: 12px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
#feed .item { display: flex; gap: 8px; padding: 3px 0; border-bottom: 1px solid #1f262e; cursor: pointer; }
#feed .t { color: var(--dim); width: 76px; flex: none; }
#feed .toggles { margin-top: 7px; display: flex; gap: 10px; flex-wrap: wrap; color: var(--dim); }
#keys { color: var(--dim); padding: 6px 14px 9px; border-top: 1px solid var(--line); }
#overlay { position: fixed; inset: 0; background: rgba(8, 10, 13, 0.72); display: flex; align-items: center; justify-content: center; }
/* Without this, display: flex above beats the hidden attribute: the "hidden" overlay covers the page and takes every click. */
#overlay[hidden] { display: none; }
#overlay .box { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 20px 24px; max-width: 520px; }
#overlay .box.bad { border-color: rgba(255, 77, 77, 0.5); }
```

Replace `packages/viewer/src/main.ts` with:

```ts
import './style.css';
import { Connection, gameSocketUrl } from './net.ts';
import { Store } from './store.ts';
import { renderStartScreen } from './ui/start-screen.ts';

const store = new Store();
const net = new Connection(gameSocketUrl(window.location), (m) => store.apply(m), (open) => store.setSocketOpen(open));
const start = document.querySelector<HTMLElement>('#start')!;
const game = document.querySelector<HTMLElement>('#game')!;

function render(): void {
  const inSeason = store.status !== null && store.status.state !== 'idle';
  start.hidden = inSeason;
  game.hidden = !inSeason;
  if (!inSeason) renderStartScreen(start, store, net);
}

store.subscribe(render);
render();
```

- [ ] **Step 7: Run the tests and the build**

Run: `pnpm vitest run packages/viewer`
Expected: PASS (format 4).

Run: `pnpm --filter @turing-city/viewer build`
Expected: builds without errors (a chunk-size warning from Phaser is fine).

- [ ] **Step 8: Commit**

```bash
pnpm fix
git add packages/viewer pnpm-lock.yaml
git commit -m "Add the viewer's connection, its display rules, and the start screen"
```

### Task 20: The map and the top bar

Spec §8.2: the grid with placeholder shapes, a status light on every board, datacenter temperatures, Luddites stepping from cell to cell with their path always shown and blinking, the EMF heatmap on H, and the selection rules: clicking the power plant highlights every block it powers with its draw, priority, and shedding (the only routine link in milestone 1, which has no trucks). The top bar shows time, pause and speed, money, power, and the agent's connection.

**Files:**
- Create: `packages/viewer/src/map/map-scene.ts`, `packages/viewer/src/ui/top-bar.ts`
- Modify: `packages/viewer/src/main.ts`

**Interfaces:**
- Consumes: Task 19 (`Store`, `Connection`, `ledOf`, `LED_COLORS`, `heatAlpha`, `consumersOf`, `timeLabel`, `moneyLabel`, `el`, `clear`), Task 14 (`Snapshot`).
- Produces:
  - `map-scene.ts`: `CELL = 34`; `class MapScene extends Phaser.Scene { show(snapshot, selected, heatmap): void; onSelect: (id: string | null) => void }`; `mountMap(parent, snapshot, onSelect): MapScene` (creates the Phaser game sized to the scenario's grid).
  - `top-bar.ts`: `renderTopBar(root, store, net)`.

- [ ] **Step 1: Write the map scene**

`packages/viewer/src/map/map-scene.ts`:

```ts
import type { Snapshot } from '@turing-city/core';
import Phaser from 'phaser';
import { consumersOf, heatAlpha, LED_COLORS, ledOf } from '../format.ts';

export const CELL = 34;

const FACILITY_COLORS: Record<string, number> = { power: 0xf2c14e, datacenter: 0xc49bff };

/** The town: drawn from scratch on every snapshot, selection change, and blink. */
export class MapScene extends Phaser.Scene {
  onSelect: (id: string | null) => void = () => {};
  private gfx: Phaser.GameObjects.Graphics | null = null;
  private labels: Phaser.GameObjects.Text[] = [];
  private snapshot: Snapshot | null = null;
  private selected: string | null = null;
  private heatmap = false;
  private blinkOn = true;

  constructor() {
    super('map');
  }

  create(): void {
    this.gfx = this.add.graphics();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const x = Math.floor(p.x / CELL);
      const y = Math.floor(p.y / CELL);
      const hit = this.snapshot?.boards.find((b) => b.x === x && b.y === y);
      this.onSelect(hit?.id ?? null);
    });
    this.time.addEvent({
      delay: 450,
      loop: true,
      callback: () => {
        this.blinkOn = !this.blinkOn;
        this.redraw();
      },
    });
    this.redraw();
  }

  show(snapshot: Snapshot, selected: string | null, heatmap: boolean): void {
    this.snapshot = snapshot;
    this.selected = selected;
    this.heatmap = heatmap;
    this.redraw();
  }

  private text(x: number, y: number, value: string, color: string, size = 11): void {
    this.labels.push(this.add.text(x, y, value, { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: `${size}px`, color, backgroundColor: '#0c0f13cc' }));
  }

  private redraw(): void {
    const s = this.snapshot;
    const g = this.gfx;
    if (!s || !g) return;
    g.clear();
    for (const t of this.labels) t.destroy();
    this.labels = [];
    const { width, height } = s.grid;

    g.fillStyle(0x141a20, 1);
    g.fillRect(0, 0, width * CELL, height * CELL);
    g.lineStyle(1, 0x232b34, 1);
    for (let x = 0; x <= width; x++) g.lineBetween(x * CELL, 0, x * CELL, height * CELL);
    for (let y = 0; y <= height; y++) g.lineBetween(0, y * CELL, width * CELL, y * CELL);

    if (this.heatmap) {
      s.emf.forEach((units, i) => {
        const alpha = heatAlpha(units);
        if (alpha > 0) {
          g.fillStyle(0xff5a28, alpha);
          g.fillRect((i % width) * CELL, Math.floor(i / width) * CELL, CELL, CELL);
        }
      });
    }

    const consumers = consumersOf(s, this.selected);
    for (const b of s.boards) {
      const px = b.x * CELL;
      const py = b.y * CELL;
      const led = ledOf(b);
      const dim = led === 'unpowered' || led === 'destroyed';
      const consumer = consumers?.find((c) => c.id === b.id);
      if (consumer) {
        g.lineStyle(2, consumer.shed ? 0x59636f : 0xf2c14e, 1);
        g.strokeRect(px, py, CELL, CELL);
        this.text(px + CELL + 2, py + 2, `−${consumer.demand} · ${consumer.rank}순위${consumer.shed ? ' · 정전' : ''}`, consumer.shed ? '#9aa3ad' : '#f2c14e');
      }
      g.fillStyle(FACILITY_COLORS[b.kind] ?? 0x9aa7b4, dim ? 0.45 : 1);
      g.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
      g.fillStyle(LED_COLORS[led], 1);
      g.fillCircle(px + CELL - 5, py + 5, 4);
      if (led === 'error' && !this.blinkOn) {
        g.fillStyle(0x141a20, 1);
        g.fillCircle(px + CELL - 5, py + 5, 4);
      }
      this.text(px + 6, py + 10, b.id, '#ffffff');
      if (b.tempC !== null) this.text(px, py + CELL + 1, `${b.tempC}°C${b.processing ? ' ▲' : ''}`, b.tempC >= 85 ? '#ffb020' : '#d7dde4', 10);
      if (b.id === this.selected) {
        g.lineStyle(2, 0xffffff, 1);
        g.strokeRect(px, py, CELL, CELL);
      }
    }

    for (const group of s.luddites) {
      if (this.blinkOn && group.path.length > 0) {
        g.lineStyle(2, 0xff4d4d, 1);
        g.beginPath();
        g.moveTo(group.x * CELL + CELL / 2, group.y * CELL + CELL / 2);
        for (const [x, y] of group.path) g.lineTo(x * CELL + CELL / 2, y * CELL + CELL / 2);
        g.strokePath();
      }
      g.fillStyle(0xff4d4d, 1);
      for (let k = 0; k < group.size; k++) g.fillCircle(group.x * CELL + 9 + (k % 2) * 10, group.y * CELL + 10 + Math.floor(k / 2) * 12, 4);
      this.text(group.x * CELL + CELL + 2, group.y * CELL, `러다이트 ${group.size}${group.targetId ? ` → ${group.targetId}` : ''}`, '#ff4d4d');
    }
  }
}

/** Creates the Phaser game for the map, sized to the scenario's grid. */
export function mountMap(parent: HTMLElement, snapshot: Snapshot, onSelect: (id: string | null) => void): MapScene {
  const scene = new MapScene();
  scene.onSelect = onSelect;
  new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: snapshot.grid.width * CELL + 140,
    height: snapshot.grid.height * CELL + 14,
    backgroundColor: '#11151a',
    scene,
  });
  return scene;
}
```

- [ ] **Step 2: Write the top bar**

`packages/viewer/src/ui/top-bar.ts`:

```ts
import { clear, el } from '../dom.ts';
import { moneyLabel, timeLabel } from '../format.ts';
import type { Connection } from '../net.ts';
import type { Store } from '../store.ts';

export function renderTopBar(root: HTMLElement, store: Store, net: Connection): void {
  const s = store.snapshot;
  const status = store.status;
  if (!s || !status) return;
  clear(root);
  const running = status.state === 'running';
  const speedButton = (speed: 1 | 2 | 3) =>
    el('button', { class: status.speed === speed ? 'on' : '', onclick: () => net.send({ type: 'speed', speed }) }, [`${speed}×`]);
  const short = s.plant.generation < s.plant.demand;
  const agent = status.agent;
  root.append(
    el('span', {}, [el('b', {}, [timeLabel(s.time, s.seasonDays)])]),
    el('span', { class: 'speed' }, [
      el('button', { class: running ? '' : 'on', onclick: () => net.send({ type: running ? 'pause' : 'play' }) }, [running ? '⏸' : '▶']),
      speedButton(1),
      speedButton(2),
      speedButton(3),
    ]),
    el('span', {}, ['자금 ', el('b', { class: s.money < 0 ? 'bad' : '' }, [moneyLabel(s.money)])]),
    el('span', {}, ['전력 ', el('b', { class: short ? 'bad' : '' }, [`${s.plant.generation} / ${s.plant.demand}`]), el('span', { class: 'dim' }, [' 발전/수요'])]),
    el('span', {}, ['풍력 ', el('b', {}, [String(s.plant.wind)]), ' · 화력 ', el('b', {}, [String(s.plant.thermal)])]),
    el('span', { class: `agent ${agent.connected ? 'ok' : 'bad'}` }, [agent.connected ? `● 에이전트 연결 (${agent.clientName ?? 'agent'})` : '● 에이전트 연결 끊김']),
  );
}
```

- [ ] **Step 3: Mount the map and the top bar**

Replace `packages/viewer/src/main.ts` with:

```ts
import './style.css';
import { type MapScene, mountMap } from './map/map-scene.ts';
import { Connection, gameSocketUrl } from './net.ts';
import { Store } from './store.ts';
import { renderStartScreen } from './ui/start-screen.ts';
import { renderTopBar } from './ui/top-bar.ts';

const store = new Store();
const net = new Connection(gameSocketUrl(window.location), (m) => store.apply(m), (open) => store.setSocketOpen(open));
const start = document.querySelector<HTMLElement>('#start')!;
const game = document.querySelector<HTMLElement>('#game')!;
const topbar = document.querySelector<HTMLElement>('#topbar')!;
const mapRoot = document.querySelector<HTMLElement>('#map')!;
let map: MapScene | null = null;

function render(): void {
  const inSeason = store.status !== null && store.status.state !== 'idle';
  start.hidden = inSeason;
  game.hidden = !inSeason;
  if (!inSeason) {
    renderStartScreen(start, store, net);
    return;
  }
  renderTopBar(topbar, store, net);
  if (store.snapshot) {
    map ??= mountMap(mapRoot, store.snapshot, (id) => store.select(id));
    map.show(store.snapshot, store.selected, store.heatmap);
  }
}

store.subscribe(render);
render();
```

- [ ] **Step 4: Check the build, and check the map headlessly**

Run: `pnpm --filter @turing-city/viewer build && pnpm typecheck`
Expected: both pass.

The map is checked in a headless browser in Task 21, Step 5, together with the panel and overlays.

- [ ] **Step 5: Commit**

```bash
pnpm fix
git add packages/viewer
git commit -m "Draw the town: the grid, boards and their lights, temperatures, Luddites and their path, the heatmap, the plant's consumers, and the top bar"
```

### Task 21: The panel, the alert feed, the overlays, the keys, and headless screenshots

The rest of spec §8.2 and a minimal §8.3 for milestone 1: the right panel for the selected board (state, parts, live sensors, the live log, the deployed firmware read-only, and the rebuild button when it's destroyed; the plant adds its power and priority list); the alert feed with the agent's deploys, click-to-jump, and per-type auto-pause toggles (disconnect always pauses); overlays for a lost agent, a crashed session, and the season's end (result and final money; the full wrap-up with past seasons comes in milestone 2); the keys. A screenshot script checks the screens in headless Chrome.

**Files:**
- Create: `packages/viewer/src/ui/panel.ts`, `packages/viewer/src/ui/feed.ts`, `packages/viewer/src/ui/overlay.ts`, `packages/viewer/src/keys.ts`, `packages/server/scripts/shots.ts`
- Modify: `packages/viewer/src/main.ts`, `packages/server/package.json` (dev dependency), `packages/server/tsconfig.json`, `package.json` (root: the `shots` script)
- Test: `pnpm shots` (screenshots, reviewed by eye)

**Interfaces:**
- Consumes: Task 19 (`Store`, `FeedItem`, `Connection`, `el`, `clear`, `LED_LABELS`, `ledOf`, `KIND_LABELS`, `ALERT_LABELS`, `endingLabel`, `moneyLabel`), Task 20 (`mountMap`), Task 18 (`startGameServer`), Task 17 (`loadConfig`), Task 14 (`Snapshot`, including `rebuild: { cost, hours }` for the rebuild button).
- Produces: `renderPanel(root, store, net)`, `renderFeed(root, store, net)`, `renderOverlay(root, store, net)`, `bindKeys(store, net)`; `pnpm shots` (writes PNGs into `scratch/shots/`).

- [ ] **Step 1: Write the panel**

`packages/viewer/src/ui/panel.ts`:

```ts
import { clear, el } from '../dom.ts';
import { KIND_LABELS, LED_LABELS, ledOf, moneyLabel } from '../format.ts';
import type { Connection } from '../net.ts';
import type { Store } from '../store.ts';

const section = (label: string, ...children: Array<Node | string>): HTMLElement => el('div', { class: 'sec' }, [el('div', { class: 'label' }, [label]), ...children]);

const kv = (pairs: Array<[string, string]>): HTMLElement => el('div', { class: 'kv' }, pairs.flatMap(([k, v]) => [el('span', { class: 'dim' }, [k]), el('span', {}, [v])]));

export function renderPanel(root: HTMLElement, store: Store, net: Connection): void {
  clear(root);
  const s = store.snapshot;
  const board = s?.boards.find((b) => b.id === store.selected);
  if (!s || !board) {
    root.append(el('p', { class: 'dim' }, ['시설을 클릭하면 여기에 정보가 떠요']));
    return;
  }
  const led = ledOf(board);
  const inspection = store.inspection?.board === board.id ? store.inspection.inspection : null;
  root.append(
    el('h2', {}, [`${KIND_LABELS[board.kind]} ${board.id}`]),
    el('div', {}, [el('span', { class: led === 'running' ? 'ok' : led === 'error' || led === 'destroyed' ? 'bad' : 'warn' }, [`● ${LED_LABELS[led]}`]), el('span', { class: 'dim' }, [inspection?.firmware ? ` · 펌웨어 v${inspection.firmware.version}` : ' · 펌웨어 없음'])]),
  );
  if (board.status === 'destroyed') {
    root.append(section('재건', el('button', { class: 'primary', onclick: () => net.send({ type: 'rebuild', board: board.id }) }, [`재건 (${moneyLabel(s.rebuild.cost)} · ${s.rebuild.hours}시간)`])));
  } else if (board.status === 'rebuilding') {
    root.append(section('재건', el('span', { class: 'warn' }, ['재건 중…'])));
  }
  if (board.kind === 'power') {
    root.append(
      section(
        '발전',
        kv([
          ['풍력', String(s.plant.wind)],
          ['화력', `${s.plant.thermal} (연료 ${s.plant.fuelPrice}/단위·일)`],
          ['발전 / 수요', `${s.plant.generation} / ${s.plant.demand}`],
        ]),
      ),
      section('우선순위', kv(s.plant.priority.map((id, i): [string, string] => [`${i + 1}. ${id}`, s.plant.shed.includes(id) ? '○ 정전' : '● 공급']))),
    );
  }
  if (!inspection) {
    root.append(el('p', { class: 'dim' }, ['불러오는 중…']));
    return;
  }
  const parts = inspection.datasheet.parts;
  root.append(
    section(
      '부품',
      kv([
        ['CPU', `${parts.clockHz}Hz · 틱당 ${parts.instructionsPerTick}명령`],
        ['RAM', `${Math.round(parts.ramBytes / 1024)}KB (사용 ${((inspection.datasheet.firmware.ramUsedBytes ?? 0) / 1024).toFixed(1)}KB)`],
        ['기본 전자파', String(inspection.datasheet.baseEmfPerSecond)],
      ]),
    ),
    section('실시간 센서', kv(Object.entries(inspection.sensors).map(([k, v]): [string, string] => [k, v === undefined ? 'nil' : String(Math.round(v * 100) / 100)]))),
    section('로그', el('pre', {}, [[...inspection.logs].reverse().map((l) => `${l.day}일 ${l.clock}  ${l.kind === 'log' ? '' : `[${l.kind}] `}${l.text}${l.repeat > 1 ? ` ×${l.repeat}` : ''}`).join('\n') || '(없음)'])),
    section(`펌웨어${inspection.firmware ? ` v${inspection.firmware.version}` : ''} (읽기 전용)`, el('pre', {}, [inspection.firmware?.source ?? '(없음)'])),
  );
}
```

- [ ] **Step 2: Write the feed, the overlays, and the keys**

`packages/viewer/src/ui/feed.ts`:

```ts
import type { AlertKind } from '@turing-city/core';
import { clear, el } from '../dom.ts';
import { ALERT_LABELS } from '../format.ts';
import type { Connection } from '../net.ts';
import type { Store } from '../store.ts';

const TOGGLABLE: readonly AlertKind[] = ['raid', 'ludditesNear', 'boardDestroyed', 'fire', 'overheat', 'powerShortage', 'firmwareError', 'moneyBelowZero'];

export function renderFeed(root: HTMLElement, store: Store, net: Connection): void {
  clear(root);
  for (const item of store.feed.slice(0, 12)) {
    if (item.kind === 'deploy') {
      root.append(el('div', { class: 'item', onclick: () => store.select(item.board) }, [el('span', { class: 't' }, [`${item.time.day}일 ${item.time.clock}`]), el('span', { style: 'color:#7fb6ff' }, [`에이전트: ${item.board}에 펌웨어 v${item.version} 배포`])]));
    } else {
      const a = item.alert;
      const cls = a.kind === 'raid' || a.kind === 'boardDestroyed' || a.kind === 'fire' ? 'bad' : 'warn';
      root.append(el('div', { class: 'item', onclick: () => store.select(a.facility) }, [el('span', { class: 't' }, [`${a.day}일 ${a.clock}`]), el('span', { class: cls }, [a.message])]));
    }
  }
  const auto = store.status?.autoPause ?? [];
  const toggles = el('div', { class: 'toggles' }, ['자동 정지: ']);
  for (const kind of TOGGLABLE) {
    const box = el('input', { type: 'checkbox', checked: auto.includes(kind) });
    box.addEventListener('change', () => {
      const next = box.checked ? [...auto, kind] : auto.filter((k) => k !== kind);
      net.send({ type: 'autoPause', kinds: next });
    });
    toggles.append(el('label', {}, [box, ` ${ALERT_LABELS[kind]}`]));
  }
  toggles.append(el('label', {}, [el('input', { type: 'checkbox', checked: true, disabled: true }), ' 연결 끊김 (항상)']));
  root.append(toggles);
}
```

`packages/viewer/src/ui/overlay.ts`:

```ts
import { clear, el } from '../dom.ts';
import { endingLabel, moneyLabel } from '../format.ts';
import type { Connection } from '../net.ts';
import type { Store } from '../store.ts';

/** A lost agent, a crashed session, or the season's end. Hidden otherwise. */
export function renderOverlay(root: HTMLElement, store: Store, net: Connection): void {
  clear(root);
  const status = store.status;
  const s = store.snapshot;
  const newSeason = el('button', { class: 'primary', onclick: () => net.send({ type: 'startSeason' }) }, ['새 시즌']);
  let box: HTMLElement | null = null;
  if (status?.state === 'crashed') {
    box = el('div', { class: 'box bad' }, [el('h2', { class: 'bad' }, ['시뮬레이터가 멈췄어요']), el('p', {}, [status.crash ?? '']), newSeason]);
  } else if (status?.state === 'ended' && s?.ended) {
    box = el('div', { class: 'box' }, [
      el('h2', {}, [endingLabel(s.ended.kind)]),
      el('p', {}, [`최종 자금 ${moneyLabel(s.money)}`]),
      el('p', { class: 'dim' }, ['시즌 결산 화면(내역과 지난 시즌 목록)은 마일스톤 2에서 붙어요.']),
      newSeason,
    ]);
  } else if (status && status.state === 'paused' && status.blockedByAgent) {
    box = el('div', { class: 'box bad' }, [
      el('h2', { class: 'bad' }, ['⏸ 에이전트 연결이 끊겼어요']),
      el('p', {}, ['게임이 멈췄어요. 다시 연결될 때까지 재생할 수 없어요.']),
      el('p', { class: 'dim' }, ['Claude Code를 다시 켜거나 /mcp에서 재연결하세요.']),
    ]);
  }
  root.hidden = box === null;
  if (box) root.append(box);
}
```

`packages/viewer/src/keys.ts`:

```ts
import type { Connection } from './net.ts';
import type { Store } from './store.ts';

/** Space pauses or plays, 1-3 set the speed, H toggles the heatmap, Escape clears the selection. */
export function bindKeys(store: Store, net: Connection): void {
  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
    const state = store.status?.state;
    if (event.code === 'Space') {
      event.preventDefault();
      if (state === 'running') net.send({ type: 'pause' });
      else if (state === 'paused') net.send({ type: 'play' });
    } else if (event.key === '1' || event.key === '2' || event.key === '3') {
      net.send({ type: 'speed', speed: Number(event.key) as 1 | 2 | 3 });
    } else if (event.key === 'h' || event.key === 'H') {
      store.toggleHeatmap();
    } else if (event.key === 'Escape') {
      store.select(null);
    }
  });
}
```

- [ ] **Step 3: Wire everything in main.ts**

Replace `packages/viewer/src/main.ts` with:

```ts
import './style.css';
import { bindKeys } from './keys.ts';
import { type MapScene, mountMap } from './map/map-scene.ts';
import { Connection, gameSocketUrl } from './net.ts';
import { Store } from './store.ts';
import { renderFeed } from './ui/feed.ts';
import { renderOverlay } from './ui/overlay.ts';
import { renderPanel } from './ui/panel.ts';
import { renderStartScreen } from './ui/start-screen.ts';
import { renderTopBar } from './ui/top-bar.ts';

const store = new Store();
const net = new Connection(gameSocketUrl(window.location), (m) => store.apply(m), (open) => store.setSocketOpen(open));
const $ = (id: string): HTMLElement => document.querySelector<HTMLElement>(id)!;
let map: MapScene | null = null;

function render(): void {
  const inSeason = store.status !== null && store.status.state !== 'idle';
  $('#start').hidden = inSeason;
  $('#game').hidden = !inSeason;
  renderOverlay($('#overlay'), store, net);
  if (!inSeason) {
    renderStartScreen($('#start'), store, net);
    return;
  }
  renderTopBar($('#topbar'), store, net);
  renderFeed($('#feed'), store, net);
  renderPanel($('#panel'), store, net);
  if (store.snapshot) {
    map ??= mountMap($('#map'), store.snapshot, (id) => store.select(id));
    map.show(store.snapshot, store.selected, store.heatmap);
  }
}

// The panel's live sensors and log: ask again twice a second while a board is selected.
setInterval(() => {
  if (store.selected) net.send({ type: 'inspect', board: store.selected });
}, 500);

bindKeys(store, net);
store.subscribe(render);
render();
```

- [ ] **Step 4: Write the screenshot script**

Run: `pnpm --filter @turing-city/server add -D playwright-core@1.64.0`

`packages/server/scripts/shots.ts` (uses the installed Google Chrome, headless, so it never takes the user's focus):

```ts
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/config.ts';
import { startGameServer } from '../src/game-server.ts';

const out = 'scratch/shots';
mkdirSync(out, { recursive: true });
const configDir = mkdtempSync(join(tmpdir(), 'tc-shots-'));
const server = await startGameServer({ port: 0, configDir, dev: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1320, height: 860 } });
const shot = async (name: string): Promise<void> => {
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, `${name}.png`) });
  process.stdout.write(`${out}/${name}.png\n`);
};

try {
  await page.goto(server.url);
  await shot('1-start-waiting');

  const transport = new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${loadConfig(configDir).token}` } },
  });
  const agent = new Client({ name: 'shots', version: '0.0.1' });
  await agent.connect(transport as Transport);
  await shot('2-start-connected');

  await page.getByText('시즌 시작').click();
  await page.waitForTimeout(500);
  const careful = 'function tick(io, mem) if io.temp > 70 then io.cool(3) end if io.temp < 82 then io.process() end io.log("t", io.temp) end';
  await agent.callTool({ name: 'deploy_firmware', arguments: { board: 'P', code: 'function tick(io) io.set_thermal(250) end' } });
  await agent.callTool({ name: 'deploy_firmware', arguments: { board: 'DA', code: careful } });
  await agent.callTool({ name: 'dev_run_until', arguments: { seconds: 30 } });
  await shot('3-running');

  const map = await page.locator('#map canvas').boundingBox();
  if (!map) throw new Error('the map canvas is missing');
  const clickCell = (x: number, y: number) => page.mouse.click(map.x + x * 34 + 17, map.y + y * 34 + 17);
  await clickCell(5, 4); // DA
  await shot('4-datacenter-selected');
  await clickCell(4, 4); // the plant
  await shot('5-plant-selected');
  await page.keyboard.press('h');
  await shot('6-heatmap');

  await transport.terminateSession();
  await agent.close();
  await shot('7-agent-lost');
} finally {
  await browser.close();
  await server.close();
}
```

Add to the root `package.json` scripts:

```json
"shots": "pnpm --filter @turing-city/viewer build && node --disable-warning=ExperimentalWarning packages/server/scripts/shots.ts"
```

Include `scripts` in the server's typecheck: in `packages/server/tsconfig.json`, set `"include": ["src", "test", "scripts"]`.

- [ ] **Step 5: Take the screenshots and look at them**

Run: `pnpm shots`
Expected: seven paths printed, the PNGs in `scratch/shots/` (git-ignored with the rest of `scratch/`). Read each image and check, writing what you saw into the task's report:
1. waiting: the connect command, copy and reissue buttons, "◌ 에이전트를 기다리는 중…", "시즌 시작" disabled;
2. connected: "● 에이전트 연결됨 (shots)", "시즌 시작" enabled;
3. running: the top bar (day and time, money, power, wind and thermal, the agent), the map with P, DA, DB and their lights, DA's temperature, the feed with the two deploys;
4. DA selected: the panel's parts, sensors, log, and firmware;
5. the plant selected: DA and DB outlined in yellow with their draw and rank, and the plant's power and priority sections;
6. the heatmap: red cells around DA and P;
7. agent lost: the "에이전트 연결이 끊겼어요" overlay.


- [ ] **Step 6: Commit**

```bash
pnpm fix
git add packages package.json pnpm-lock.yaml
git commit -m "Add the panel, the alert feed with auto-pause toggles, the overlays, the keys, and pnpm shots"
```

### Task 22: Milestone 1: Claude Code for real, the playtest checklist, and the docs

Spec §12, step 4 and milestone 1: check with a real Claude Code that the connection rule works (spec §7.2 leaves one question open: whether Claude Code answers server-sent pings), write the user's playtest checklist, and bring CLAUDE.md up to date. Then the user plays.

**Files:**
- Modify: `packages/server/src/main.ts` (log the agent's comings and goings), `packages/server/src/game-server.ts` (an `onStatus` option), `CLAUDE.md`, `docs/superpowers/specs/2026-10-09-prototype-design.md` (§7.2 and §13, with what the check found)
- Create: `docs/playtests/<today>-m1-checklist.md` (today's date, `YYYY-MM-DD`)

**Interfaces:**
- Consumes: everything before it.
- Produces: the milestone-1 build, ready for the user's playtest.

- [ ] **Step 1: Log the agent's connection in the server's output**

In `packages/server/src/main.ts`, after the server starts, the controller isn't reachable; expose its events instead. In `packages/server/src/game-server.ts`, add an `onStatus` option and call it from a controller subscription:

```ts
export interface GameServerOptions {
  // ...the existing fields...
  /** Called whenever the controller's status changes (main.ts logs the agent's connection). */
  readonly onStatus?: (status: ControllerStatus) => void;
}
```

```ts
  // in startGameServer, after creating the controller:
  if (options.onStatus) {
    const notify = options.onStatus;
    controller.onEvent((event) => {
      if (event.kind === 'status') notify(event.status);
    });
  }
```

(Import `type ControllerStatus` from `@turing-city/core`.) In `main.ts`, replace the `const server = await startGameServer({ … });` line with this, which logs only the agent's changes, with the time:

```ts
let lastAgent = '';
const server = await startGameServer({
  dev: values.dev,
  ...(values.port === undefined ? {} : { port: Number(values.port) }),
  onStatus: (status) => {
    const agent = status.agent.connected ? `agent connected: ${status.agent.clientName}` : 'agent disconnected';
    if (agent !== lastAgent) {
      lastAgent = agent;
      process.stdout.write(`[${new Date().toISOString()}] ${agent}\n`);
    }
  },
});
```

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 2: Check the connection with a real Claude Code**

Start a server on a spare port with its own config directory (so the user's token isn't touched), and keep its output:

```bash
mkdir -p scratch/m1-check
XDG_CONFIG_HOME=$PWD/scratch/m1-check node --disable-warning=ExperimentalWarning packages/server/src/main.ts --port 7841 > scratch/m1-check/server.log 2>&1 &
echo $! > scratch/m1-check/server.pid
sleep 2
```

Then run a headless Claude Code session against it that stays connected for 20 seconds (four ping intervals) and calls a tool before and after:

```bash
TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('scratch/m1-check/turing-city/config.json','utf8')).token)")
claude -p 'Call the get_status tool of the turing-city MCP server. Then run the shell command "sleep 20". Then call get_status again. Report both results in one line each.' \
  --strict-mcp-config \
  --mcp-config "{\"mcpServers\":{\"turing-city\":{\"type\":\"http\",\"url\":\"http://127.0.0.1:7841/mcp\",\"headers\":{\"Authorization\":\"Bearer $TOKEN\"}}}}" \
  --allowedTools 'mcp__turing-city__get_status' 'Bash(sleep 20)'
kill "$(cat scratch/m1-check/server.pid)"
cat scratch/m1-check/server.log
```

Each block can run in its own shell: the token and the server's PID come from files. (An agent's shell doesn't keep `$TOKEN` between calls, and its job numbers don't start at 1, so `kill %1` would stop the wrong job.)

Expected in the server log: `agent connected: claude-code` (or Claude Code's client name), no `agent disconnected` until the session ends, then `agent disconnected`. Both tool calls answer "The season hasn't started" (no season is running), which is fine.

Read the result:
- **Connected for the whole session, then disconnected at its end:** Claude Code holds the stream open and answers pings. Record it in the spec (Step 4).
- **Never connected:** this Claude Code doesn't open the server-to-client stream. Stop here and report it: the connection rule needs another signal (for example a recent tool call), which is a design question for the user.
- **Connected, then disconnected during the `sleep`:** it opens the stream but doesn't answer pings. Make the stream alone decide, as spec §7.2 plans: in `packages/server/src/mcp.ts`, change `report()`'s test from `s.stream !== null && s.misses < 2` to `s.stream !== null`, and keep pinging only as a keepalive. Rerun the MCP tests and this check.

- [ ] **Step 3: Write the playtest checklist**

`docs/playtests/<today>-m1-checklist.md` (the user plays in the browser with their own Claude Code; this is what to check. It's in English like the repository's other docs, and quotes the game's Korean labels as they appear on screen):

```markdown
# Milestone 1 playtest (<today>)

## Getting started
1. Run `pnpm start` in a terminal and open http://127.0.0.1:7840 in a browser.
2. Copy the connect command from the screen and run it in the folder where you'll start Claude Code: it registers the game's MCP server for that folder, so once per folder is enough. Then start Claude Code there.
3. When the screen shows "● 에이전트 연결됨", press "시즌 시작". The season starts paused, with every board empty.
4. Ask Claude Code for the town's first firmware, for example: "Read the datasheets of the turing-city boards, then write and deploy their firmware."
5. When it's done, press Space to play. 1, 2, and 3 set the speed; H shows the EMF heatmap.

## What to check
- [ ] Is the loop of writing and fixing firmware fun? How does a crisis (Luddites, overheating, a blackout), then pausing, then the agent's fix, then playing on feel?
- [ ] Does a careful season score clearly better than a careless one? Play one of each and note the money at each season's end.
- [ ] Does the agent understand what's happening from the datasheets and logs alone? Where does it get lost?
- [ ] Can you read what's happening on screen: board lights, temperatures, Luddite paths, the plant's links when it's selected?
- [ ] How often and how hard do Luddites raid: too often, too rarely?
- [ ] Does the game pause when the agent disconnects, and carry on when it reconnects?
- [ ] Is there more to careful play than sleeping until the job price pays? Under the current tuning, the plan's validation runs found that sleeping wins.

## Out of scope for now
The food chain (farms, the warehouse, trucks, housing), the season wrap-up's breakdown and past seasons, and sprites come in milestone 2 or later.

## Notes
(What you felt while playing, and the time of anything odd)
```

- [ ] **Step 4: Bring the docs up to date**

In `docs/superpowers/specs/2026-10-09-prototype-design.md`:
- §7.2, the "Unverified" bullet: replace it with what Step 2 found, dated (for example: "Verified on <today> with Claude Code <version>: it holds the stream open and answers server pings.").
- §13: drop the pings bullet, or restate it if Step 2 left something open.

In `CLAUDE.md`:
- The first paragraph: replace "No code yet: the first milestone is the prototype ..." with the state now: milestone 1 is built (power plant and datacenters, played over MCP), the food chain and the season wrap-up are milestone 2.
- Under "Agents", the bullet that starts "The game is made to be played by agents": say how QA plays it now: `pnpm start:dev`, then add the server to the QA session (`claude mcp add` with the printed command) and use the agent tools plus `dev_run_until`; `pnpm sim` for headless seasons; `pnpm shots` for headless screenshots.

- [ ] **Step 5: Verify everything once more**

Run: `pnpm check && pnpm shots`
Expected: both pass; look at the seven screenshots again.

- [ ] **Step 6: Commit**

```bash
pnpm fix
git add packages docs CLAUDE.md
git commit -m "Check the connection rule with Claude Code, write the milestone-1 playtest checklist, and update the docs"
```
