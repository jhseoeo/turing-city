import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { AGENT_INSTRUCTIONS, AGENT_TOOLS, type GameApi, ToolError } from '../src/agent-tools.ts';

function fakeApi(): GameApi & { deployed: Array<[string, string]> } {
  const deployed: Array<[string, string]> = [];
  return {
    deployed,
    listBoards: async () => [],
    datasheet: async (board) => (board === 'DA' ? ({ board: 'DA' } as never) : null),
    firmware: async () => null,
    deploy: async (board, code) => {
      deployed.push([board, code]);
      return { ok: true, version: 2, installsAt: "the board's next tick" };
    },
    logs: async () => [],
    map: async () => ({ width: 1, height: 1, facilities: [] }),
    status: async () => ({}) as never,
    alerts: async () => [],
  };
}

const tool = (name: string) => AGENT_TOOLS.find((t) => t.name === name)!;

describe('agent tools', () => {
  it('are exactly the tools of spec 7.3, each described', () => {
    expect(AGENT_TOOLS.map((t) => t.name)).toEqual([
      'list_boards',
      'get_datasheet',
      'get_firmware',
      'deploy_firmware',
      'read_logs',
      'get_map',
      'get_status',
      'get_alerts',
    ]);
    for (const t of AGENT_TOOLS) expect(t.description.length).toBeGreaterThan(40);
    expect(AGENT_INSTRUCTIONS).toContain('get_datasheet');
  });

  it('deploys through the game API', async () => {
    const api = fakeApi();
    await expect(tool('deploy_firmware').run(api, { board: 'DA', code: 'function tick() end' })).resolves.toEqual({
      ok: true,
      version: 2,
      installsAt: "the board's next tick",
    });
    expect(api.deployed).toEqual([['DA', 'function tick() end']]);
  });

  it('turns an unknown board into a ToolError', async () => {
    await expect(tool('get_datasheet').run(fakeApi(), { board: 'ZZ' })).rejects.toBeInstanceOf(ToolError);
  });

  it('limits firmware to 64 KB in its schema', () => {
    const schema = tool('deploy_firmware').inputSchema.code as z.ZodString;
    expect(schema.safeParse('x'.repeat(65_536)).success).toBe(true);
    expect(schema.safeParse('x'.repeat(65_537)).success).toBe(false);
  });

  it('refuses firmware with a NUL byte in its schema: the board would cut the source off there, silently', () => {
    const schema = tool('deploy_firmware').inputSchema.code as z.ZodString;
    for (const source of [
      '\u0000',
      '\u0000function tick() end',
      'function tick() end\u0000',
      'function tick() end\u0000\nerror("never runs")',
    ]) {
      const parsed = schema.safeParse(source);
      expect(parsed.success, JSON.stringify(source)).toBe(false);
      expect(parsed.error?.issues[0]?.message ?? '(no issue)').toMatch(/NUL byte/);
    }
    // Only the NUL itself is refused: other control characters, non-ASCII text, and a backslash-zero escape inside a Lua string are fine.
    expect(schema.safeParse('-- 한글, é, 😀\t\r\n\u0001\u007f print("a\\0b")').success).toBe(true);
  });
});
