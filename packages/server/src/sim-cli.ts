import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseScenario, runSeason } from '@turing-city/core';
import { WasmoonHost } from '@turing-city/firmware';
import { loadFirmwareDir } from './firmware-files.ts';

const USAGE = 'usage: pnpm sim [scenario.json] [--firmware <dir of BOARD.lua files>] [--seed <n>] [--until <day>] [--rebuild]';

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      firmware: { type: 'string' },
      seed: { type: 'string', default: '1' },
      until: { type: 'string' },
      rebuild: { type: 'boolean', default: false },
    },
  });
  const scenario = parseScenario(JSON.parse(readFileSync(positionals[0] ?? 'scenarios/m1-power.json', 'utf8')));
  const firmware = values.firmware === undefined ? {} : loadFirmwareDir(values.firmware);
  const options = { autoRebuild: values.rebuild, ...(values.until === undefined ? {} : { untilDay: Number(values.until) }) };
  const result = runSeason(scenario, Number(values.seed), await WasmoonHost.create(), firmware, options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`);
  process.exit(1);
});
