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
