import { TOOL, requireCredentials } from './config.js';
import type { Config, PageOf } from './types.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** How long the store gets to answer one request. BC_API_TIMEOUT_MS changes it, for a slow connection. */
const TIMEOUT_MS = Number(process.env.BC_API_TIMEOUT_MS) || 60_000;

/** Requests in flight at once, across everything read from the store. BigCommerce rate-limits per store. */
const MAX_IN_FLIGHT = 4;

/** The largest page the catalog endpoints return. */
export const PAGE_SIZE = 250;

/** fetch says only "fetch failed"; the reason (no network, a mistyped host, a refused connection) is tucked away in its cause. */
function unreachable(url: URL, err: unknown): Error {
  if ((err as Error).name === 'TimeoutError') {
    return new Error(`No answer from ${url.host} after ${TIMEOUT_MS / 1000} seconds. Check your internet connection and try again.`);
  }
  const cause = (err as { cause?: { message?: string; code?: string; errors?: { message?: string }[] } }).cause;
  const why = cause?.message || cause?.errors?.[0]?.message || cause?.code || (err as Error).message;
  return new Error(`Could not reach ${url.host} (${why}). Check your internet connection and try again.`);
}

// A small gate so pages of products and pages of metafields, fetched side by
// side, never add up to more requests at once than the store is happy with.
let inFlight = 0;
const waiting: (() => void)[] = [];
async function gate<T>(work: () => Promise<T>): Promise<T> {
  // A request that finishes hands its place straight to the next in line, so none can slip in between.
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((resolve) => waiting.push(resolve));
  else inFlight++;
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else inFlight--;
  }
}

export type Query = Record<string, string | number | null | undefined>;

/** A request the store answered with an error, keeping its status so callers can tell a missing endpoint from the rest. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Minimal read-only BigCommerce REST client. `path` starts with /v2 or /v3. Resolves to null on an empty response. */
export async function bc<T>(config: Config, path: string, query: Query = {}): Promise<T | null> {
  requireCredentials(config);
  const url = new URL(`${config.apiBase}/stores/${config.storeHash}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  // The time limit covers the whole exchange, the body included, so a connection that stalls halfway ends too.
  const send = (): Promise<{ res: Response; text: string }> =>
    gate(async () => {
      const res = await fetch(url, {
        headers: { 'X-Auth-Token': config.token, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return { res, text: await res.text() };
    });
  for (let attempt = 0; ; attempt++) {
    const { res, text } = await send().catch((err: unknown) => { throw unreachable(url, err); });
    // Over the rate limit: BigCommerce says how long until the window resets.
    if (res.status === 429 && attempt < 5) {
      await sleep(Number(res.headers.get('x-rate-limit-time-reset-ms')) || 1500);
      continue;
    }
    // A busy or restarting server usually answers on a second try.
    if ([502, 503, 504].includes(res.status) && attempt < 2) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (!res.ok) {
      const hint =
        res.status === 401 ? ` The access token was not accepted. Save it again with: ${TOOL} env add ${config.envName} --force`
        : res.status === 403 ? ' The API account needs the Products scope (read-only is enough).'
        : res.status === 404 ? ' Check the store hash.'
        : '';
      // An unknown store gets BigCommerce's 404 web page, which says nothing a person can use.
      const detail = /^\s*</.test(text) ? '' : `\n${text.slice(0, 500)}`;
      throw new ApiError(`GET ${url.pathname} failed with ${res.status}.${hint}${detail}`, res.status);
    }
    if (!text) return null; // an empty answer, as a 204 is
    return JSON.parse(text) as T;
  }
}

/** Called after each page with how many items have arrived and how many there are in all (0 when the store does not say). */
export type Progress = (done: number, total: number) => void;

/**
 * Every item of a paginated v3 collection. The first page says how many pages
 * there are; the rest are then fetched side by side and put back in order.
 */
export async function fetchAll<T>(config: Config, path: string, query: Query = {}, progress?: Progress): Promise<T[]> {
  const page = (n: number) => bc<PageOf<T>>(config, path, { ...query, limit: PAGE_SIZE, page: n });
  const first = await page(1);
  const items = [...(first?.data ?? [])];
  const pagination = first?.meta?.pagination;
  const total = pagination?.total ?? 0;
  progress?.(items.length, total);

  if (pagination?.total_pages) {
    const rest = Array.from({ length: Math.max(0, pagination.total_pages - 1) }, (_, i) => i + 2);
    const pages: T[][] = [];
    let done = items.length;
    await Promise.all(
      rest.map(async (n) => {
        const data = (await page(n))?.data ?? [];
        pages[n] = data;
        done += data.length;
        progress?.(done, total);
      }),
    );
    for (const n of rest) items.push(...(pages[n] ?? []));
    return items;
  }

  // No page count: keep going while pages come back full.
  for (let n = 2, last = items.length; last >= PAGE_SIZE; n++) {
    const data = (await page(n))?.data ?? [];
    items.push(...data);
    last = data.length;
    progress?.(items.length, total);
  }
  return items;
}
