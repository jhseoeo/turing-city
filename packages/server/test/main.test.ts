import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** Runs the server's entry point with a config directory of its own (the token never lands in the user's real one). */
function run(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const configDir = mkdtempSync(join(tmpdir(), 'tc-main-'));
  cleanups.push(() => rmSync(configDir, { recursive: true, force: true }));
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', MAIN, ...args], {
    env: { ...process.env, XDG_CONFIG_HOME: configDir },
    encoding: 'utf8',
    timeout: 20_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('main: when the server cannot start', () => {
  it('says in one line that the port is taken, and how to pick another, instead of printing a stack trace', async () => {
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise((resolve) => taken.close(resolve)));
    const { port } = taken.address() as AddressInfo;
    const r = run('--port', String(port));
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe(
      `turing-city could not start: port ${port} is already in use. Is another turing-city running? Stop it, or pass --port <number>.\n`,
    );
  });

  it('says in one line when --port is not a port', () => {
    for (const bad of ['abc', '-1', '70000', '1.5', '']) {
      const r = run(`--port=${bad}`);
      expect(r.status, bad).toBe(1);
      expect(r.stdout, bad).toBe('');
      expect(r.stderr, bad).toBe(`turing-city could not start: --port "${bad}" is not a port (a whole number from 0 to 65535).\n`);
    }
  });

  it("says in one line what is wrong with a command line that the parser refuses, the first line of the parser's own words", () => {
    const refused: Array<[string[], string]> = [
      [['--port'], "Option '--port <value>' argument missing"],
      [['--port', '-1'], "Option '--port' argument is ambiguous."], // the parser's message goes on for three lines
      [['--nope'], "Unknown option '--nope'"],
      [['stray'], "Unexpected argument 'stray'. This command does not take positional arguments"],
    ];
    for (const [args, reason] of refused) {
      const r = run(...args);
      expect(r.status, args.join(' ')).toBe(1);
      expect(r.stdout, args.join(' ')).toBe('');
      expect(r.stderr, args.join(' ')).toBe(`turing-city could not start: ${reason}\n`);
    }
  });
});
