import { describe, expect, it } from 'vitest';
import { LuaFactory } from 'wasmoon';

describe('wasmoon', () => {
  it('runs Lua', async () => {
    const engine = await new LuaFactory().createEngine();
    expect(engine.doStringSync('return 1 + 1')).toBe(2);
    engine.global.close();
  });
});
