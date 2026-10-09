import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const fixture = fileURLToPath(new URL('./fixtures/pairs-order.ts', import.meta.url));

function runFixture(): string {
  return execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', fixture], { encoding: 'utf8' });
}

/**
 * The fixture started from another script, as a differently placed checkout or another launcher would start it:
 * the script's path is at least 16 characters longer than the fixture's, and the host reports a locale tag far
 * longer than a real one. Emscripten copies both into the environment strings it puts in the wasm heap, and the
 * heap's layout is rounded to 8 bytes, so each of the two alone is enough to move an unpinned runtime.
 */
function runFixtureFromAnotherLauncher(): string {
  const root = mkdtempSync(join(tmpdir(), 'turing-city-'));
  try {
    let dir = root;
    while (join(dir, 'launcher.mjs').length < fixture.length + 16) dir = join(dir, 'd'.repeat(100));
    mkdirSync(dir, { recursive: true });
    const launcher = join(dir, 'launcher.mjs');
    writeFileSync(
      launcher,
      [
        `Object.defineProperty(globalThis, 'navigator', { value: { languages: ['${'l'.repeat(40)}'] }, configurable: true });`,
        `await import(${JSON.stringify(pathToFileURL(fixture).href)});`,
      ].join('\n'),
    );
    return execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', launcher], { encoding: 'utf8' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

  it('gives the same pairs order and random numbers from a longer script path and another locale', () => {
    expect(runFixtureFromAnotherLauncher()).toBe(runFixture());
  }, 20_000);
});
