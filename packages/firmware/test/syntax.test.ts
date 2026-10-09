import { describe, expect, it } from 'vitest';
import { SyntaxChecker } from '../src/syntax.ts';

describe('SyntaxChecker', () => {
  it('accepts code that compiles, without running it', async () => {
    const checker = await SyntaxChecker.create();
    expect(checker.check('function tick(io) while true do end end')).toBeNull();
  });
  it("returns Lua's message with the line for a syntax error", async () => {
    const checker = await SyntaxChecker.create();
    expect(checker.check('function tick(io)\n  if then\nend')).toMatch(/^firmware:2: /);
  });
  it('rejects precompiled bytecode', async () => {
    const checker = await SyntaxChecker.create();
    expect(checker.check('\x1bLua')).toMatch(/binary chunk/);
  });
});
