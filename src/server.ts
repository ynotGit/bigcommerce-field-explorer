// The page: a small server on localhost that serves one page, reads the
// catalog once, and answers it with the fields in the catalog and the
// products, variants, categories or brands that have each one.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { CatalogCache } from './cache.js';
import { PACKAGE_ROOT, TOOL } from './config.js';
import { cellLines, csv, describeShow, tableFor, type FieldRef, type Show } from './items.js';
import { tablePdf } from './pdf.js';
import { KINDS, isKind, summariseCatalog } from './summary.js';
import type { Config } from './types.js';
import { version } from './version.js';

const uiFile = path.join(PACKAGE_ROOT, 'assets', 'ui.html');
const MAX_BODY = 100_000;

export interface PageServer {
  url: string;
  close: () => void;
}

/** A mistake in what the page sent, answered with a 4xx and shown on the page as it is. */
class Refused extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) reject(new Refused('That request is too large.', 413));
      else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
        resolve(body as Record<string, unknown>);
      } catch {
        reject(new Refused('The request was not valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);

/** The field and what to show of it, as the page sends them. */
function fieldFrom(body: Record<string, unknown>): { field: FieldRef; show: Show } {
  const kind = body.kind;
  if (!isKind(kind)) throw new Refused(`Say which kind of field: ${Object.keys(KINDS).map((k) => `"${k}"`).join(', ')}.`);
  const name = text(body.name);
  if (!name) throw new Refused('Say which field.');
  const namespace = kind === 'cf' ? null : text(body.namespace);
  if (kind !== 'cf' && namespace === null) throw new Refused('Say which namespace the metafield is in.');
  const field: FieldRef = { kind, name, ...(namespace !== null ? { namespace } : {}) };
  const show: Show = body.missing === true ? { missing: true } : typeof body.value === 'string' ? { value: body.value } : { set: true };
  return { field, show };
}

const when = (date: Date): string =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date);

/** A file name for a download: what it shows, as "erp-season-aw26" or "variants-erp-season", and today's date. */
function fileName(field: FieldRef, show: Show, extension: string): string {
  const things = field.kind === 'mf' || field.kind === 'cf' ? '' : KINDS[field.kind].many;
  const parts = [things, field.namespace ?? '', field.name, 'missing' in show ? 'without' : 'value' in show ? show.value : ''];
  const base = parts.filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'products';
  return `${base}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

export function startServer(config: Config, port: number): Promise<PageServer> {
  const cache = new CatalogCache(config);

  const items = async (body: Record<string, unknown>) => {
    const { field, show } = fieldFrom(body);
    const catalog = await cache.read();
    const variants = field.kind === 'variant' ? await cache.variants() : null;
    return { field, show, catalog, table: tableFor(catalog, variants, field, show) };
  };

  const routes: Record<string, (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> | void> = {
    'GET /': (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(uiFile));
    },

    'GET /api/state': (_req, res) =>
      json(res, { version: version(), tool: TOOL, env: config.envName, storeHash: config.storeHash, readAt: cache.readAt?.toISOString() ?? null }),

    // Every custom field and metafield on the catalog's products.
    'POST /api/summary': async (_req, res) => {
      const catalog = await cache.read();
      json(res, { ...summariseCatalog(catalog), readAt: catalog.readAt.toISOString() });
    },

    // The products, variants, categories or brands with a field, with one of its values, or without it.
    'POST /api/items': async (req, res) => {
      const { catalog, table } = await items(await readBody(req));
      json(res, { columns: table.columns, rows: table.rows, total: table.total, readAt: catalog.readAt.toISOString() });
    },

    'POST /api/export': async (req, res) => {
      const body = await readBody(req);
      const format = body.format;
      if (format !== 'csv' && format !== 'pdf') throw new Refused('Choose a download format: csv or pdf.');
      const { field, show, catalog, table } = await items(body);
      if (format === 'csv') {
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${fileName(field, show, 'csv')}"`,
          'Cache-Control': 'no-store',
        });
        // A byte order mark, so Excel reads accented characters and £ signs correctly.
        return void res.end(`\uFEFF${csv(table)}\n`);
      }
      const prices = table.columns.some((c) => c.type === 'price') ? ' Prices in the store\'s default currency.' : '';
      const pdf = await tablePdf({
        title: describeShow(field, show),
        details: [`Store ${config.storeHash} (${config.envName}), catalog read ${when(catalog.readAt)}.${prices}`],
        summary: `${table.rows.length.toLocaleString('en-GB')} of ${table.total.toLocaleString('en-GB')} ${KINDS[field.kind].many}`,
        headers: table.columns.map((c) => c.heading),
        rows: table.rows.map((row) => table.columns.map((c) => cellLines(c, row.cells[c.key]))),
      });
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName(field, show, 'pdf')}"`,
        'Cache-Control': 'no-store',
      });
      res.end(Buffer.from(pdf));
    },

    'POST /api/refresh': (_req, res) => {
      cache.clear();
      json(res, { readAt: null });
    },
  };

  let origin = '';
  const server = http.createServer(async (req, res) => {
    // Only a browser on this machine, asking for localhost, is answered. A page elsewhere can point a
    // name of its own at 127.0.0.1 to get its requests here, but they then arrive under that name.
    if (!['localhost', '127.0.0.1'].includes((req.headers.host ?? '').replace(/:\d+$/, ''))) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('This page only answers requests for localhost.');
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    // Anything that reads the store must come from this page: another site open in the browser
    // could otherwise send requests here. A browser always says where such a request is from.
    if (req.method !== 'GET') {
      const from = req.headers.origin;
      const jsonBody = (req.headers['content-type'] ?? '').startsWith('application/json');
      if ((from && from !== origin && from !== origin.replace('localhost', '127.0.0.1')) || !jsonBody) {
        return json(res, { error: 'Requests are only accepted from the page itself.' }, 403);
      }
    }
    try {
      await route(req, res);
    } catch (err) {
      if (res.headersSent) return res.end();
      // Mistakes in a request, and failures reading the store, are both told to the page as they are.
      json(res, { error: (err as Error).message }, err instanceof Refused ? err.status : 502);
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'EADDRINUSE') return reject(err);
      reject(new Error(
        `Port ${port} is already in use, most likely by a page you started earlier. Stop that one first (Ctrl+C in its terminal), or use another port:\n\n  ${TOOL} start --port ${port + 1}`,
      ));
    });
    // Bound to localhost only: this is a development tool, not something to expose on a network.
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const actual = typeof address === 'object' && address ? address.port : port;
      origin = `http://localhost:${actual}`;
      resolve({ url: origin, close: () => server.close() });
    });
  });
}
