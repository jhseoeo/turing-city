import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseScenario, runSeason } from '@turing-city/core';
import { WasmoonHost } from '@turing-city/firmware';
import { loadFirmwareDir } from './firmware-files.ts';

const USAGE =
  'usage: pnpm sim [scenario.json] [--firmware <dir of BOARD.lua files>] [--install all|<ids, comma-separated>] [--seed <n>] [--until <day>] [--rebuild]';

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      firmware: { type: 'string' },
      install: { type: 'string' },
      seed: { type: 'string', default: '1' },
      until: { type: 'string' },
      rebuild: { type: 'boolean', default: false },
    },
  });
  const scenario = parseScenario(JSON.parse(readFileSync(positionals[0] ?? 'scenarios/m2-town.json', 'utf8')));
  const firmware = values.firmware === undefined ? {} : loadFirmwareDir(values.firmware);
  // Firmware runs only on an installed board: without --install, the boards the firmware is for are installed.
  const install =
    values.install === undefined
      ? Object.keys(firmware)
      : values.install === 'all'
        ? ('all' as const)
        : values.install.split(',').filter((id) => id !== '');
  const options = { autoRebuild: values.rebuild, install, ...(values.until === undefined ? {} : { untilDay: Number(values.until) }) };
  const result = runSeason(scenario, Number(values.seed), await WasmoonHost.create(), firmware, options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`);
  process.exit(1);
});
