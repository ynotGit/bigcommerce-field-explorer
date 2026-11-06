// Saving store credentials, and the setup and env commands.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { Writable } from 'node:stream';
import { countProducts } from './catalog.js';
import { failure, success, warning } from './color.js';
import {
  DEFAULT_ENV, TOOL, assertName, display, ensureIgnored, envFilePath, existingWorkspace, listEnvNames, loadConfig,
  noSuchEnv, parseEnvFile, resolveWorkspace, selectedEnvName, setActiveEnv, text,
} from './config.js';
import type { Flags } from './types.js';

/** Accepts a bare hash or the API path BigCommerce shows, e.g. https://api.bigcommerce.com/stores/abc123/v3/ */
function parseStoreHash(input: string): string {
  const trimmed = input.trim();
  return /stores\/([a-z0-9]+)/i.exec(trimmed)?.[1] ?? trimmed.replace(/^\/+|\/+$/g, '');
}

type Screen = NodeJS.WritableStream & { columns?: number };

/**
 * Asks questions in the terminal. An answer to askHidden never appears on
 * screen, typed or pasted: an access token is a password to the store, and a
 * terminal is often shared or recorded.
 */
function prompter(keyboard: NodeJS.ReadableStream = process.stdin, screen: Screen = process.stdout) {
  // Keys show up only because readline writes them back out, so everything it writes goes through here, where it can be dropped.
  let hidden = false;
  const output = new Writable({
    write(chunk: Buffer | string, _encoding, done) {
      if (!hidden) screen.write(chunk);
      done();
    },
  });
  Object.defineProperty(output, 'columns', { get: () => screen.columns }); // readline lays out long answers by the terminal's width
  // No history: the up arrow must not bring the token back at the next question.
  const rl = readline.createInterface({ input: keyboard, output, terminal: true, historySize: 0 });
  return {
    ask: (question: string): Promise<string> => rl.question(question),
    async askHidden(question: string): Promise<string> {
      screen.write(question);
      hidden = true;
      try {
        const answer = await rl.question('');
        // With nothing on screen, the length is how you can tell a paste landed.
        screen.write(answer.trim() ? `${answer.trim().length} characters entered\n` : 'nothing entered\n');
        return answer;
      } finally {
        hidden = false;
      }
    },
    close: (): void => rl.close(),
  };
}

/**
 * Asks for (or takes from flags) one store's credentials, saves them as the
 * named environment and tests the connection. Returns false if the user backed out.
 */
async function saveEnvironment(flags: Flags, name: string): Promise<boolean> {
  assertName(name);
  const root = resolveWorkspace();
  const envFile = envFilePath(root, name);
  const envLabel = display(envFile);
  let storeHash = text(flags['store-hash']);
  let token = text(flags.token);
  const interactive = !(storeHash && token);

  if (interactive && !process.stdin.isTTY) {
    throw new Error('No terminal to ask questions in. Pass --store-hash and --token instead.');
  }
  const terminal = interactive ? prompter() : null;
  try {
    if (fs.existsSync(envFile) && !flags.force) {
      if (!terminal) throw new Error(`${envLabel} already exists. Pass --force to replace it.`);
      const answer = await terminal.ask(`${envLabel} already exists. Replace it? [y/N] `);
      if (!/^y(es)?$/i.test(answer.trim())) {
        console.log(`Left ${envLabel} as it was.`);
        return false;
      }
    }
    if (terminal) {
      console.log(`Setting up the ${name} environment. Have that store's API account open (Settings > Store-level API accounts).\n`);
      storeHash ??= await terminal.ask('Store hash, or the API path it shows: ');
      token ??= await terminal.askHidden('Access token (hidden): ');
    }
  } finally {
    terminal?.close();
  }

  storeHash = parseStoreHash(storeHash ?? '');
  token = (token ?? '').trim();
  if (!storeHash || !token) throw new Error('Both a store hash and an access token are needed. Nothing was written.');

  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(envFile, `BC_STORE_HASH=${storeHash}\nBC_ACCESS_TOKEN=${token}\n`, { mode: 0o600 });
  console.log(success(`Wrote ${envLabel}`));
  if (ensureIgnored(root).length) {
    console.log(`Updated ${display(path.join(root, '.gitignore'))} so credentials stay out of git.`);
  }

  // Check the credentials straight away so a typo surfaces here, not on the page.
  try {
    const products = await countProducts(loadConfig({ env: name }));
    console.log(success(`Connected. The catalog has ${products.toLocaleString('en-GB')} product(s).`));
  } catch (err) {
    console.log(`\n${failure(`${envLabel} is saved, but the test request failed:\n${(err as Error).message}`)}`);
    process.exitCode = 1;
  }
  return true;
}

const OPEN_PAGE = `${TOOL} start`;

/** Saves credentials for each environment named. Safe to rerun: environments already saved are skipped. */
export async function setup(flags: Flags, args: string[]): Promise<void> {
  const names = args.length ? args : [text(flags.env) ?? DEFAULT_ENV];
  const root = resolveWorkspace();
  if (names.length > 1 && (flags['store-hash'] || flags.token)) {
    throw new Error('--store-hash and --token describe one store. With several environments, run setup without them and answer the questions for each.');
  }
  for (const name of names) {
    assertName(name);
    if (listEnvNames(root).includes(name) && !flags['store-hash'] && !flags.token && !flags.force) {
      console.log(`${name}: already saved. Rerun "${TOOL} env add ${name} --force" to replace it.`);
      continue;
    }
    if (!(await saveEnvironment(flags, name))) return console.log(`\n${failure('Setup stopped.')}`);
    if (process.exitCode) {
      // Do not keep credentials that failed, so the next run asks for them again.
      fs.rmSync(envFilePath(root, name), { force: true });
      return console.log(`\n${failure(`Setup stopped and the ${name} credentials were not kept.`)} Fix the problem above and run it again.`);
    }
    if (names.length > 1) console.log('');
  }
  // Setup never chooses an environment for you; that is left as an explicit step.
  const active = selectedEnvName(root);
  if (active) return console.log(`\n${success(`Setup complete. The page reads ${active}.`)} Open it with:\n\n  ${OPEN_PAGE}`);
  console.log(`\n${success('Setup complete.')} ${warning('Choose the store the page reads, then open it:')}\n\n  ${TOOL} env use ${names[0]}\n  ${OPEN_PAGE}`);
}

function describe(root: string, name: string): string {
  const vars = parseEnvFile(envFilePath(root, name)) ?? {};
  return `store ${vars.BC_STORE_HASH || '(not set)'}`;
}

function list(root: string, flags: Flags): void {
  const names = listEnvNames(root);
  if (!names.length) return console.log(warning(`No environments yet. Run "${TOOL} setup" to save the first one.`));
  const active = selectedEnvName(root, flags);
  const width = Math.max(...names.map((n) => n.length));
  for (const name of names) {
    console.log(`${name === active ? '*' : ' '} ${name.padEnd(width)}  ${describe(root, name)}`);
  }
  if (!active) console.log(`\n${warning('None selected.')} Choose one with: ${TOOL} env use ${names.find((n) => n !== DEFAULT_ENV) ?? names[0]}`);
  else if (!names.includes(active)) console.log(`\n${warning(`The active environment "${active}" has no saved credentials.`)}`);
}

function use(root: string, name: string | undefined): void {
  if (!name) throw new Error(`Name the environment to switch to, for example: ${TOOL} env use staging`);
  assertName(name);
  const names = listEnvNames(root);
  if (!names.includes(name)) throw noSuchEnv(name, names);
  setActiveEnv(root, name);
  console.log(`${success(`Now using ${name}: ${describe(root, name)}.`)}\nThe page reads it until you switch again.`);
}

async function add(flags: Flags, name: string | undefined): Promise<void> {
  if (!name) throw new Error(`Name the environment to add, for example: ${TOOL} env add staging`);
  if (!(await saveEnvironment(flags, name))) return;
  if (name !== DEFAULT_ENV && !process.exitCode) console.log(`Switch to it with: ${TOOL} env use ${name}`);
}

export async function env(flags: Flags, args: string[]): Promise<void> {
  const [action, name, ...extra] = args;
  if (extra.length) throw new Error(`"env ${action}" takes one environment name. Nothing was run.`);
  // Only "add" may start a workspace; the others need the one that is there.
  const root = action === 'add' ? resolveWorkspace() : existingWorkspace();
  switch (action) {
    case undefined:
    case 'list': return list(root, flags);
    case 'use': return use(root, name);
    case 'add': return add(flags, name);
    default: throw new Error(`Unknown env action "${action}". Use "env list", "env use <name>" or "env add <name>".`);
  }
}
