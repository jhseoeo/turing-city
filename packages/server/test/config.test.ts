import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { configDir, connectCommand, loadConfig, reissueToken } from '../src/config.ts';

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

describe('config: what the brief left unpinned', () => {
  it('keeps the port of a saved config, through a reissue too', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tc-config-'));
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ token: 'saved-token', port: 9000 }));
    expect(loadConfig(dir)).toEqual({ token: 'saved-token', port: 9000 });
    const reissued = reissueToken(dir);
    expect(reissued.port).toBe(9000);
    expect(reissued.token).not.toBe('saved-token');
    expect(loadConfig(dir)).toEqual(reissued);
  });

  it('puts the port in the connect command', () => {
    expect(connectCommand({ token: 'abc', port: 9000 })).toContain('http://127.0.0.1:9000/mcp');
  });

  // The token is a secret: only its owner may read the file, and it stays so when the token is reissued.
  it.skipIf(process.platform === 'win32')('keeps the token where only its owner can read it', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'tc-config-')), 'turing-city'); // not there yet: loadConfig makes it
    loadConfig(dir);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, 'config.json')).mode & 0o777).toBe(0o600);
    reissueToken(dir);
    expect(statSync(join(dir, 'config.json')).mode & 0o777).toBe(0o600);
  });

  it("lives in the user's config directory: XDG_CONFIG_HOME, else ~/.config", () => {
    withXdgConfigHome('/somewhere/config', () => expect(configDir()).toBe(join('/somewhere/config', 'turing-city')));
    withXdgConfigHome(undefined, () => expect(configDir()).toBe(join(homedir(), '.config', 'turing-city')));
  });

  // The XDG Base Directory spec treats an empty XDG_CONFIG_HOME as unset and a relative one as invalid. Taken as it stands,
  // either would keep the token under the server's working directory (join('', 'turing-city') is the relative 'turing-city'),
  // which is inside the repository when the server starts from a package script. These tests only ask configDir() for the
  // path: nothing is loaded or written at the fallback, which is the user's real ~/.config.
  it.each(['', 'config', './config', '../config', '~/.config'])('ignores XDG_CONFIG_HOME=%j, which is not an absolute path', (value) => {
    withXdgConfigHome(value, () => expect(configDir()).toBe(join(homedir(), '.config', 'turing-city')));
  });

  // The same hole through the fallback: an empty or relative HOME gives the relative '.config', so there is no fallback then.
  // (os.homedir() answers "" for HOME="" and the value itself for a relative HOME, as it reads HOME at each call.)
  it.skipIf(process.platform === 'win32')(
    'has no config directory, rather than one under the working directory, when HOME is not absolute',
    () => {
      const saved = process.env.HOME;
      try {
        for (const home of ['', 'relative/home']) {
          process.env.HOME = home;
          withXdgConfigHome(undefined, () => expect(() => configDir()).toThrow('absolute'));
          withXdgConfigHome('config', () => expect(() => configDir()).toThrow('absolute'));
          // an absolute XDG_CONFIG_HOME does not depend on HOME
          withXdgConfigHome('/somewhere/config', () => expect(configDir()).toBe(join('/somewhere/config', 'turing-city')));
        }
      } finally {
        if (saved === undefined) delete process.env.HOME;
        else process.env.HOME = saved;
      }
    },
  );
});

/** Runs `check` with XDG_CONFIG_HOME set to `value` (unset when undefined), then puts back what was there. */
function withXdgConfigHome(value: string | undefined, check: () => void): void {
  const saved = process.env.XDG_CONFIG_HOME;
  try {
    if (value === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = value;
    check();
  } finally {
    if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved;
  }
}
