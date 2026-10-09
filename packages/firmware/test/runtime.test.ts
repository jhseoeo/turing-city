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
