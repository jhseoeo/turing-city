import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ServerConfig {
  readonly token: string;
  readonly port: number;
}

const DEFAULT_PORT = 7840;

/** The user's config directory, outside the repository: the token is a secret and the repository is public. */
export function configDir(): string {
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'turing-city');
}

function newToken(): string {
  return randomBytes(24).toString('base64url');
}

function write(dir: string, config: ServerConfig): ServerConfig {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return config;
}

/** The saved config, created with a fresh token the first time. */
export function loadConfig(dir = configDir()): ServerConfig {
  try {
    const saved = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as Partial<ServerConfig>;
    if (typeof saved.token === 'string' && saved.token.length > 0) return { token: saved.token, port: saved.port ?? DEFAULT_PORT };
  } catch {
    // no config yet: make one below
  }
  return write(dir, { token: newToken(), port: DEFAULT_PORT });
}

/** A new token; agents connected with the old one get 401 from now on. */
export function reissueToken(dir = configDir()): ServerConfig {
  return write(dir, { ...loadConfig(dir), token: newToken() });
}

export function connectCommand(config: ServerConfig): string {
  return `claude mcp add --transport http turing-city http://127.0.0.1:${config.port}/mcp --header "Authorization: Bearer ${config.token}"`;
}
