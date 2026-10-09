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
