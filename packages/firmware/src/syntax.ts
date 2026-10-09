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
