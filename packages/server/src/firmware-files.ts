import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/** Every BOARD.lua file in a directory, keyed by board id. */
export function loadFirmwareDir(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of readdirSync(dir).sort()) {
    if (file.endsWith('.lua')) out[basename(file, '.lua')] = readFileSync(join(dir, file), 'utf8');
  }
  return out;
}
