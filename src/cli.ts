#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { failure, success } from './color.js';
import { TOOL, loadConfig, requireCredentials, text } from './config.js';
import { startServer } from './server.js';
import { env, setup } from './setup.js';
import { version } from './version.js';
import type { Flags } from './types.js';

/** The page's port when none is given. The email builder's preview uses 4321, so both can run at once. */
const DEFAULT_PORT = 4322;

const HELP = `Usage: ${TOOL} start

Shows every custom field and metafield in a BigCommerce catalog, and the
products that have each one, on a page in your browser.

  start                       open the page (http://localhost:${DEFAULT_PORT})
    --port <number>           use another port
    --no-open                 start without opening a browser

Stores
  setup <environment...>      save store credentials
  env use <environment>       choose the store the page reads
  env                         list environments; * marks the selected one
  env add <environment>       save one more store
  --env <environment>         use another store, this once

Every option: docs/REFERENCE.md
`;

const VALUE_FLAGS = new Set(['env', 'port', 'store-hash', 'token']);
const BOOLEAN_FLAGS = new Set(['force', 'help', 'version', 'no-open']);
const SHORT_FLAGS: Record<string, string> = { '-h': '--help', '-v': '--version' };

/** The options each command takes, besides --env, which they all do. Anything else stops the command. */
const COMMAND_FLAGS: Record<string, string[]> = {
  start: ['port', 'no-open'],
  setup: ['store-hash', 'token', 'force'],
  env: ['store-hash', 'token', 'force'],
};

const EXAMPLES: Record<string, string> = { env: 'staging', port: '4323', 'store-hash': 'abc123', token: '<token>' };

function parseArgs(argv: string[]): { flags: Flags; positional: string[] } {
  const flags: Flags = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = SHORT_FLAGS[argv[i] ?? ''] ?? argv[i] ?? '';
    if (!arg.startsWith('-')) { positional.push(arg); continue; }
    // A short option this tool does not have, such as -n, is kept as it was typed and refused with the rest.
    if (!arg.startsWith('--')) { flags[arg] = true; continue; }
    const [, key = '', inline] = /^--([^=]*)(?:=(.*))?$/s.exec(arg) ?? [];
    if (VALUE_FLAGS.has(key)) {
      const value = inline ?? argv[i + 1];
      if (value === undefined || (inline === undefined && value.startsWith('--'))) {
        throw new Error(`--${key} needs a value, for example --${key} ${EXAMPLES[key] ?? '...'}.`);
      }
      if (inline === undefined) i++;
      flags[key] = value;
    } else if (BOOLEAN_FLAGS.has(key)) {
      if (inline !== undefined) throw new Error(`--${key} does not take a value.`);
      flags[key] = true;
    } else {
      flags[key] = inline ?? true; // unknown: refused by refuseUnknownOptions
    }
  }
  return { flags, positional };
}

/** Stops before anything runs if the command was given an option it does not take. */
function refuseUnknownOptions(command: string, flags: Flags): void {
  const takes = COMMAND_FLAGS[command] ?? [];
  const unknown = Object.keys(flags).filter((flag) => !['env', 'help', 'version'].includes(flag) && !takes.includes(flag));
  if (!unknown.length) return;
  const spell = (flag: string): string => (flag.startsWith('-') ? flag : `--${flag}`);
  const options = new Intl.ListFormat('en-GB').format([...takes, 'env'].map(spell));
  throw new Error(`Unknown option${unknown.length > 1 ? 's' : ''} ${unknown.map(spell).join(', ')}. "${command}" takes ${options}. Nothing was run.`);
}

/** Opens a page in the default browser. If that cannot be done, the address printed is enough. */
function openBrowser(url: string): void {
  const [command, args, options] =
    process.platform === 'darwin' ? ['open', [url], {}]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url], { windowsVerbatimArguments: true }]
    : ['xdg-open', [url], {}];
  try {
    spawn(command, args, { stdio: 'ignore', detached: true, ...options }).on('error', () => undefined).unref();
  } catch { /* no browser to open */ }
}

async function start(flags: Flags, args: string[]): Promise<void> {
  if (args.length) throw new Error(`"start" takes no name. Choose the store with --env, for example: ${TOOL} start --env staging`);
  const config = loadConfig(flags);
  requireCredentials(config);
  const typed = text(flags.port);
  const port = typed === undefined ? DEFAULT_PORT : Number(typed);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`The port must be a whole number from 1 to 65535, for example: ${TOOL} start --port 4323`);
  }
  const { url } = await startServer(config, port);
  console.log(success(`The page is running at ${url}`));
  console.log(`Environment ${config.envName}: store ${config.storeHash}. Press Ctrl+C to stop.`);
  // A person at a terminal gets the page opened for them; a script or a test does not.
  if (!flags['no-open'] && process.stdout.isTTY) openBrowser(url);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { flags, positional } = parseArgs(rest);
  if (command === '-v' || command === '--version' || flags.version) return console.log(version());
  if (!command || command === 'help' || command === '-h' || command === '--help' || flags.help) return console.log(HELP);
  if (!COMMAND_FLAGS[command]) {
    throw new Error(`Unknown command "${command}". The commands are start, setup and env. To open the page:\n\n  ${TOOL} start`);
  }
  refuseUnknownOptions(command, flags);
  switch (command) {
    case 'setup': return setup(flags, positional);
    case 'env': return env(flags, positional);
    default: return start(flags, positional);
  }
}

main().catch((err: unknown) => {
  console.error(`\n${failure(err instanceof Error ? err.message : String(err), process.stderr)}`);
  process.exitCode = 1;
});
