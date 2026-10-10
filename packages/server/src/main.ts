import { parseArgs } from 'node:util';
import { startGameServer } from './game-server.ts';

/** One line and exit code 1: the player who started the server sees what is wrong, not a stack trace. */
function fail(reason: string): never {
  process.stderr.write(`turing-city could not start: ${reason}\n`);
  process.exit(1);
}

/** The command line, or one line about what is wrong with it. */
function options(): { dev: boolean; port: number | undefined } {
  try {
    const { dev, port } = parseArgs({ options: { dev: { type: 'boolean', default: false }, port: { type: 'string' } } }).values;
    if (port !== undefined && !(/^\d{1,5}$/.test(port) && Number(port) < 65536)) {
      return fail(`--port "${port}" is not a port (a whole number from 0 to 65535).`);
    }
    return { dev, port: port === undefined ? undefined : Number(port) };
  } catch (error) {
    return fail(error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : String(error));
  }
}
const { dev, port } = options();

/** Why the server could not listen, for the player. */
function startError(error: unknown): string {
  if (error instanceof Error && 'code' in error && error.code === 'EADDRINUSE') {
    const port = 'port' in error ? error.port : '';
    return `port ${port} is already in use. Is another turing-city running? Stop it, or pass --port <number>.`;
  }
  return error instanceof Error ? error.message : String(error);
}

// Only the agent's comings and goings are logged: the controller announces every status change (speed, auto-pause, ...).
const DISCONNECTED = 'agent disconnected';
let lastAgent = DISCONNECTED;
const server = await startGameServer({
  dev,
  ...(port === undefined ? {} : { port }),
  onStatus: (status) => {
    const agent = status.agent.connected ? `agent connected: ${status.agent.clientName}` : DISCONNECTED;
    if (agent !== lastAgent) {
      lastAgent = agent;
      process.stdout.write(`[${new Date().toISOString()}] ${agent}\n`);
    }
  },
}).catch((error: unknown) => fail(startError(error)));
process.stdout.write(`turing-city is running: open ${server.url} in a browser.\n`);
process.stdout.write(`Connect your agent (Claude Code):\n  ${server.connect}\n`);
if (dev)
  process.stdout.write('Dev tools are on: agents get dev_play, dev_pause, dev_set_speed, dev_run_until, dev_new_season, dev_rebuild.\n');
const shutdown = (): void => {
  void server.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
