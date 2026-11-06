import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config, Flags } from './types.js';

/** Package root, where docs/ lives (one level above dist/). */
export const PACKAGE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The folder whose node_modules this tool is installed in, or null for a checkout of the tool itself. */
export function installProject(): string | null {
  const at = PACKAGE_ROOT.lastIndexOf(`${path.sep}node_modules${path.sep}`);
  return at === -1 ? null : PACKAGE_ROOT.slice(0, at);
}

/**
 * How to type the command from here, for the hints this tool prints. Installed
 * in the project you are standing in, as a dev dependency is, it is not on the
 * PATH and needs npx in front. Installed globally or linked, it runs by name.
 */
function typedAs(): string {
  try {
    const project = installProject();
    if (!project) return 'field-explorer';
    const here = fs.realpathSync(process.cwd());
    return here === project || here.startsWith(project + path.sep) ? 'npx field-explorer' : 'field-explorer';
  } catch {
    return 'field-explorer';
  }
}
export const TOOL = typedAs();

export function parseEnvFile(file: string): Record<string, string> | null {
  if (!fs.existsSync(file)) return null;
  const vars: Record<string, string> = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    let value = line.slice(eq + 1).trim();
    if (/^(".*"|'.*')$/.test(value)) value = value.slice(1, -1);
    vars[line.slice(0, eq).trim()] = value;
  }
  return vars;
}

/** Everything the tool reads and writes lives in this folder inside your project. */
const WORKSPACE_DIR = 'field-explorer';

export const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/**
 * The workspace is always ./field-explorer under the folder you run the
 * command from. Running from inside it works too.
 */
export function resolveWorkspace(): string {
  const cwd = process.cwd();
  return path.basename(cwd) === WORKSPACE_DIR ? cwd : path.join(cwd, WORKSPACE_DIR);
}

/** A folder above this one, in the same project, that holds the workspace. Looking stops at the project's top folder. */
function projectRootAbove(cwd: string): string | null {
  const isTop = (dir: string): boolean => ['package.json', '.git'].some((mark) => fs.existsSync(path.join(dir, mark)));
  for (let dir = cwd; !isTop(dir);) {
    const parent = path.dirname(dir);
    if (parent === dir) return null; // the top of the disk
    dir = parent;
    if (fs.existsSync(path.join(dir, WORKSPACE_DIR))) return dir;
  }
  return null;
}

/**
 * The workspace, for a command that needs one to be there already. Run from a
 * folder further down the project, such a command would find nothing beside it
 * and go on to blame the credentials, so this says where the workspace is instead.
 */
export function existingWorkspace(): string {
  const root = resolveWorkspace();
  if (fs.existsSync(root)) return root;
  const above = projectRootAbove(process.cwd());
  if (!above) return root; // a new project: the command reports what it is missing
  const up = path.relative(process.cwd(), above);
  throw new Error(`No ${WORKSPACE_DIR} folder here; this project's is ${path.join(up, WORKSPACE_DIR)}. Run the command from the project root:\n\n  cd ${up}`);
}

/** A path as the user would type it from where they are standing. */
export const display = (target: string): string => path.relative(process.cwd(), target) || '.';

/** Nothing in the workspace is shared through git: credentials for every environment, and the per-developer "active" pointer. */
const IGNORE_LINES = ['.env', '.env.*', '.active-env'];

/** Adds whatever is missing to the workspace's .gitignore. Returns the lines it added. */
export function ensureIgnored(root: string): string[] {
  const file = path.join(root, '.gitignore');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const present = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const missing = IGNORE_LINES.filter((line) => !present.has(line));
  if (missing.length) {
    fs.mkdirSync(root, { recursive: true });
    const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(file, `${existing}${prefix}${missing.join('\n')}\n`);
  }
  return missing;
}

// ---- Environments ----------------------------------------------------------
// An environment is one store: a store hash and a token. "default" lives in
// .env, any other in .env.<name>, and the file .active-env remembers which one
// the page uses.

export const DEFAULT_ENV = 'default';
const ACTIVE_FILE = '.active-env';

/** Environment names become file names, so they keep to safe characters. */
export function assertName(name: string, what = 'environment'): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) {
    throw new Error(`"${name}" is not a usable ${what} name. Use letters, numbers, dashes and underscores.`);
  }
  return name;
}

export const envFilePath = (root: string, name: string): string =>
  path.join(root, name === DEFAULT_ENV ? '.env' : `.env.${name}`);

export function listEnvNames(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const names = fs
    .readdirSync(root)
    .map((file) => (file === '.env' ? DEFAULT_ENV : /^\.env\.(.+)$/.exec(file)?.[1]))
    .filter((name): name is string => Boolean(name));
  return names.sort((a, b) => (a === DEFAULT_ENV ? -1 : b === DEFAULT_ENV ? 1 : a.localeCompare(b)));
}

export function setActiveEnv(root: string, name: string): void {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, ACTIVE_FILE), `${name}\n`);
}

/**
 * The environment someone has chosen, or null if nobody has.
 * --env wins, then FIELD_EXPLORER_ENV, then whatever "env use" last picked.
 * A project whose only environment is "default" needs no choosing.
 */
export function selectedEnvName(root: string, flags: Flags = {}): string | null {
  const explicit = text(flags.env) ?? text(process.env.FIELD_EXPLORER_ENV);
  if (explicit) return assertName(explicit);
  const pointer = path.join(root, ACTIVE_FILE);
  const saved = fs.existsSync(pointer) ? fs.readFileSync(pointer, 'utf8').trim() : '';
  if (saved) return saved;
  return listEnvNames(root).some((name) => name !== DEFAULT_ENV) ? null : DEFAULT_ENV;
}

/** The error for an environment that has not been saved. */
export function noSuchEnv(name: string, known: string[]): Error {
  return new Error(`No environment called "${name}".${known.length ? ` You have: ${known.join(', ')}.` : ''}\nCreate it with: ${TOOL} env add ${name}`);
}

/** The tool never guesses between stores: with named environments, one must be chosen first. */
function resolveEnvName(root: string, flags: Flags = {}): string {
  const selected = selectedEnvName(root, flags);
  if (selected) return selected;
  const names = listEnvNames(root);
  throw new Error(
    `No environment selected. Choose one first:\n\n  ${TOOL} env use ${names.find((n) => n !== DEFAULT_ENV) ?? '<name>'}\n\nYou have: ${names.join(', ')}.`,
  );
}

export function loadConfig(flags: Flags = {}): Config {
  const root = existingWorkspace();
  const envName = resolveEnvName(root, flags);
  let vars = parseEnvFile(envFilePath(root, envName));
  if (!vars && envName !== DEFAULT_ENV) throw noSuchEnv(envName, listEnvNames(root));
  // With no file for the default environment, fall back to a project-level .env
  // and then to real environment variables (useful in CI). When a file exists,
  // the store and token come only from it, so a stray shell variable can never
  // point the page at another store.
  const fromFile = Boolean(vars);
  vars ??= { ...(root !== process.cwd() ? parseEnvFile(path.join(process.cwd(), '.env')) : null) };
  const read = (key: string): string | undefined => text(vars[key]) ?? (fromFile ? undefined : text(process.env[key]));
  const setting = (key: string): string | undefined => text(vars[key]) ?? text(process.env[key]);
  return {
    root,
    envName,
    storeHash: read('BC_STORE_HASH'),
    token: read('BC_ACCESS_TOKEN'),
    apiBase: (setting('BC_API_URL') || 'https://api.bigcommerce.com').replace(/\/$/, ''),
  };
}

export function requireCredentials(config: Config): asserts config is Config & { storeHash: string; token: string } {
  const missing: string[] = [];
  if (!config.storeHash) missing.push('BC_STORE_HASH');
  if (!config.token) missing.push('BC_ACCESS_TOKEN');
  if (missing.length) {
    throw new Error(`Missing ${missing.join(' and ')} for the ${config.envName} environment. Run "${TOOL} setup" to save them.`);
  }
}
