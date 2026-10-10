import { parseArgs } from 'node:util';
import { startGameServer } from './game-server.ts';

const { values } = parseArgs({ options: { dev: { type: 'boolean', default: false }, port: { type: 'string' } } });
// Only the agent's comings and goings are logged: the controller announces every status change (speed, auto-pause, ...).
const DISCONNECTED = 'agent disconnected';
let lastAgent = DISCONNECTED;
const server = await startGameServer({
  dev: values.dev,
  ...(values.port === undefined ? {} : { port: Number(values.port) }),
  onStatus: (status) => {
    const agent = status.agent.connected ? `agent connected: ${status.agent.clientName}` : DISCONNECTED;
    if (agent !== lastAgent) {
      lastAgent = agent;
      process.stdout.write(`[${new Date().toISOString()}] ${agent}\n`);
    }
  },
});
process.stdout.write(`turing-city is running: open ${server.url} in a browser.\n`);
process.stdout.write(`Connect your agent (Claude Code):\n  ${server.connect}\n`);
if (values.dev)
  process.stdout.write('Dev tools are on: agents get dev_play, dev_pause, dev_set_speed, dev_run_until, dev_new_season, dev_rebuild.\n');
const shutdown = (): void => {
  void server.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
