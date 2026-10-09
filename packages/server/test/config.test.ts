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
    const saved = process.env.XDG_CONFIG_HOME;
    try {
      process.env.XDG_CONFIG_HOME = '/somewhere/config';
      expect(configDir()).toBe(join('/somewhere/config', 'turing-city'));
      delete process.env.XDG_CONFIG_HOME;
      expect(configDir()).toBe(join(homedir(), '.config', 'turing-city'));
    } finally {
      if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = saved;
    }
  });
});
