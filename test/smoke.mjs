// End-to-end check of the built CLI and page against a mock of the BigCommerce API. Run with: npm test
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const cli = path.join(dist, 'cli.js');
const { tablePdf } = await import(path.join(dist, 'pdf.js'));
const { PDFDocument } = await import('pdf-lib');

// ---- The PDF, without a store -------------------------------------------------------
{
  // Many rows run over several pages, and characters the PDF fonts lack do not stop it.
  const rows = Array.from({ length: 160 }, (_, i) => [[String(i + 1)], [`Product ${i + 1} 漢字 😀 café £5`], ['SKU-' + i], ['20.00'], ['Cotton']]);
  const pdf = await tablePdf({ title: 'Products', details: ['Store abc (staging)'], summary: '160 of 200 products', headers: ['ID', 'Name', 'SKU', 'Price', 'Material'], rows });
  assert.equal(Buffer.from(pdf.slice(0, 5)).toString(), '%PDF-');
  assert.ok((await PDFDocument.load(pdf)).getPageCount() > 2, 'long tables carry on over several pages');
  const tall = await tablePdf({ title: 'T', details: [], summary: '1', headers: ['ID', 'Values'], rows: [[['1'], Array.from({ length: 400 }, (_, i) => `value ${i}`)]] });
  assert.ok((await PDFDocument.load(tall)).getPageCount() >= 1, 'a row taller than a page is cut to fit');
}

// ---- A mock store ----------------------------------------------------------------
const cf = (name, value) => ({ id: Math.floor(Math.random() * 1e6), name, value });
const catalog = [
  { id: 1, name: 'Organic Tote', sku: 'OTL-TOTE', price: 20, sale_price: 18.5, is_visible: true, custom_url: { url: '/organic-tote/' }, custom_fields: [cf('Material', 'Cotton'), cf('Care', 'Machine wash')] },
  { id: 2, name: 'Linen Shirt', sku: 'LS', price: 45, sale_price: 0, is_visible: true, custom_url: { url: '/linen-shirt/' }, custom_fields: [cf('Material', 'Linen')] },
  { id: 3, name: 'Wool Scarf', sku: 'WS-1', price: 30.125, sale_price: 0, is_visible: true, custom_url: { url: '/wool-scarf/' }, custom_fields: [cf('material', ' wool ')] },
  { id: 4, name: 'Gift Card', sku: '', price: 0, sale_price: 0, is_visible: true, custom_url: { url: '/gift-card/' }, custom_fields: [] },
  { id: 5, name: 'Otl Bag, Large', sku: 'otl-bag', price: 1250, sale_price: 0, is_visible: false, custom_url: { url: '/otl-bag/' }, custom_fields: [cf('Colour', 'Red, White')] },
  { id: 6, name: 'Sample Pack', sku: 'SP-SAMPLE', price: 5, sale_price: 0, is_visible: true, custom_url: { url: '/sample-pack/' }, custom_fields: [cf('Material', 'Cotton'), cf('Material', 'Polyester')] },
  { id: 7, name: 'Cotton Sample', sku: 'OTL-SAMPLE', price: 2.5, sale_price: 0, is_visible: true, custom_url: { url: '/cotton-sample/' }, custom_fields: [cf('Material', 'cotton')] },
];
const stageCatalog = [{ id: 90, name: 'Stage Only', sku: 'STAGE', price: 9, sale_price: 0, is_visible: true, custom_url: { url: '/stage/' }, custom_fields: [cf('Material', 'Bamboo')] }];
let mfId = 0;
const mf = (resource_id, namespace, key, value) => ({ id: ++mfId, resource_id, resource_type: 'product', namespace, key, value, permission_set: 'read' });
const metafields = [
  mf(1, 'erp', 'season', 'AW26'),
  mf(1, 'erp', 'supplier', 'Acme'),
  mf(2, 'erp', 'season', 'SS25'),
  mf(2, 'feeds', 'season', 'AW26'),
  mf(3, 'ERP', 'Season', 'aw26'),
  mf(5, 'erp', 'season', 'AW26'),
  mf(6, 'app', 'notes', `${'Line one\n'}${'x'.repeat(300)}`),
];

// Variants: the base variant of most products, and a shirt with sizes.
const variants = [
  { id: 11, product_id: 1, sku: 'OTL-TOTE', price: null, sale_price: null, purchasing_disabled: false, option_values: [] },
  { id: 21, product_id: 2, sku: 'LS-S', price: 45, sale_price: null, purchasing_disabled: false, option_values: [{ option_display_name: 'Size', label: 'S' }] },
  { id: 22, product_id: 2, sku: 'LS-M', price: 47.5, sale_price: 40, purchasing_disabled: false, option_values: [{ option_display_name: 'Size', label: 'M' }] },
  { id: 23, product_id: 2, sku: 'LS-SAMPLE', price: null, sale_price: null, purchasing_disabled: true, option_values: [{ option_display_name: 'Size', label: 'Sample' }] },
  { id: 31, product_id: 3, sku: 'WS-1', price: null, sale_price: null, purchasing_disabled: false, option_values: [] },
  { id: 51, product_id: 5, sku: 'otl-bag', price: null, sale_price: null, purchasing_disabled: false, option_values: [] },
];
const vmf = (resource_id, namespace, key, value) => ({ id: ++mfId, resource_id, resource_type: 'variant', namespace, key, value, permission_set: 'read' });
const variantMetafields = [
  vmf(21, 'erp', 'barcode', '5012345000011'),
  vmf(22, 'erp', 'barcode', '5012345000028'),
  vmf(22, 'erp', 'colour_hex', '#FFFFFF'),
  vmf(23, 'erp', 'Barcode', ''),
  vmf(51, 'feeds', 'gtin', '0001'),
];
// Categories in two trees, as a store with two storefronts has.
const categories = [
  { category_id: 100, parent_id: 0, tree_id: 1, name: 'Bags', is_visible: true, url: { path: '/bags/' } },
  { category_id: 101, parent_id: 0, tree_id: 1, name: 'Shirts', is_visible: true, url: { path: '/shirts/' } },
  { category_id: 102, parent_id: 101, tree_id: 1, name: 'Linen', is_visible: false, url: { path: '/shirts/linen/' } },
  { category_id: 200, parent_id: 0, tree_id: 2, name: 'Sale', is_visible: true, url: { path: '/sale/' } },
];
const trees = [{ id: 1, name: 'UK store', channels: [1] }, { id: 2, name: 'EU store', channels: [2] }];
// The older categories endpoint, for a store without category trees.
const stageCategories = [{ id: 900, parent_id: 0, name: 'Everything', is_visible: true, custom_url: { url: '/everything/' } }];
const cmf = (resource_id, namespace, key, value) => ({ id: ++mfId, resource_id, resource_type: 'category', namespace, key, value, permission_set: 'read' });
const categoryMetafields = [
  cmf(100, 'theme', 'banner', 'bags.jpg'),
  cmf(101, 'theme', 'banner', 'shirts.jpg'),
  cmf(102, 'theme', 'layout', 'grid'),
  cmf(200, 'theme', 'banner', 'sale.jpg'),
  cmf(999, 'theme', 'banner', 'deleted.jpg'), // on a category that no longer exists
];
const brands = [
  { id: 300, name: 'Acme', custom_url: { url: '/brands/acme/' } },
  { id: 301, name: 'Highland', custom_url: { url: '/brands/highland/' } },
];
const bmf = (resource_id, namespace, key, value) => ({ id: ++mfId, resource_id, resource_type: 'brand', namespace, key, value, permission_set: 'read' });
const brandMetafields = [
  bmf(300, 'pim', 'country', 'UK'),
  // JSON, as apps often store it: each key gets a column of its own.
  bmf(300, 'pim', 'specs', '{"founded":1990,"origin":{"country":"UK"},"tags":["eco"]}'),
  bmf(301, 'pim', 'specs', '{"founded":205,"note":"Family run, since 205"}'),
];

const requests = []; // every API request, as "store/path?query"
let throttled = false;

/** A page of a list, the way the v3 API pages: a fixed page size here, so a small catalog still spans several pages. */
function pageOf(items, url, perPage) {
  const page = Number(url.searchParams.get('page') || 1);
  return {
    data: items.slice((page - 1) * perPage, page * perPage),
    meta: { pagination: { total: items.length, count: 0, per_page: perPage, current_page: page, total_pages: Math.ceil(items.length / perPage) } },
  };
}

const api = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const [, store = '', p = ''] = /^\/stores\/(\w+)(\/.*)$/.exec(url.pathname) ?? [];
  const send = (data, status = 200, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(data)); };
  if (!['testhash', 'stagehash', 'noscope'].includes(store)) { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end('<html><body><h1>404 Not Found</h1></body></html>'); }
  requests.push(`${store}${p}${url.search}`);
  if (req.headers['x-auth-token'] !== 'tok') return send({ status: 401, title: 'Unauthorized' }, 401);
  if (store === 'noscope' && url.searchParams.get('limit') !== '1') return send({ status: 403, title: 'You do not have permission' }, 403);
  if (p === '/v3/catalog/products') {
    const products = store === 'stagehash' ? stageCatalog : catalog;
    if (url.searchParams.get('limit') === '1') return send({ data: [{ id: products[0].id }], meta: { pagination: { total: products.length, total_pages: products.length } } });
    // The first request for page 2 is told to slow down, once.
    if (url.searchParams.get('page') === '2' && !throttled) {
      throttled = true;
      return send({ status: 429, title: 'Too many requests' }, 429, { 'X-Rate-Limit-Time-Reset-Ms': '20' });
    }
    const include = (url.searchParams.get('include') ?? '').split(',');
    const exclude = (url.searchParams.get('exclude_fields') ?? '').split(',');
    const shaped = products.map(({ custom_fields, ...rest }) => ({
      ...rest,
      ...(exclude.includes('description') ? {} : { description: '<p>A long description</p>'.repeat(50) }),
      ...(include.includes('custom_fields') ? { custom_fields } : {}),
    }));
    return send(pageOf(shaped, url, 2));
  }
  if (p === '/v3/catalog/products/metafields') return send(pageOf(store === 'stagehash' ? [] : metafields, url, 3));
  const stage = store === 'stagehash';
  if (p === '/v3/catalog/variants') {
    const list = stage ? [{ id: 901, product_id: 90, sku: 'STAGE', price: null, sale_price: null, option_values: [] }] : variants;
    if (url.searchParams.get('limit') === '1') return send({ data: list.slice(0, 1), meta: { pagination: { total: list.length, total_pages: list.length } } });
    return send(pageOf(list, url, 4));
  }
  if (p === '/v3/catalog/variants/metafields') return send(pageOf(stage ? [] : variantMetafields, url, 3));
  if (p === '/v3/catalog/trees/categories') return stage ? send({ title: 'Not found' }, 404) : send(pageOf(categories, url, 3));
  if (p === '/v3/catalog/trees') return send(pageOf(trees, url, 50));
  if (p === '/v3/catalog/categories') return send(pageOf(stage ? stageCategories : [], url, 50));
  if (p === '/v3/catalog/categories/metafields') return send(pageOf(stage ? [] : categoryMetafields, url, 3));
  if (p === '/v3/catalog/brands') return send(pageOf(stage ? [] : brands, url, 50));
  if (p === '/v3/catalog/brands/metafields') return send(pageOf(stage ? [] : brandMetafields, url, 50));
  return send({ title: 'not found' }, 404);
});

await new Promise((r) => api.listen(0, '127.0.0.1', r));
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'field-explorer-'));
fs.writeFileSync(path.join(project, 'package.json'), '{}'); // a project's top folder
const ws = path.join(project, 'field-explorer');
const env = { ...process.env, BC_API_URL: `http://127.0.0.1:${api.address().port}` };
for (const key of ['BC_STORE_HASH', 'BC_ACCESS_TOKEN', 'FIELD_EXPLORER_ENV', 'FORCE_COLOR', 'NO_COLOR']) delete env[key];

// Async on purpose: the mock API lives in this process and must stay responsive.
const exec = promisify(execFile);
const call = async (args, cwd = project) => {
  const child = exec('node', [cli, ...args], { cwd, env, timeout: 20000 });
  child.child.stdin.end(); // no terminal attached, like CI
  const { stdout, stderr } = await child;
  return { stdout, stderr };
};
const run = async (...args) => (await call(args)).stdout;
const fails = async (...args) => {
  try { await call(args); } catch (e) { return `${e.stdout}${e.stderr}`; }
  throw new Error(`expected "${args.join(' ')}" to fail`);
};
const since = (n) => requests.slice(n);

/** Starts the page, and gives a way to talk to it and to stop it. */
async function startPage(...args) {
  const child = spawn('node', [cli, 'start', '--port', '0', ...args], { cwd: project, env });
  const base = await new Promise((resolve, reject) => {
    let text = '';
    child.stdout.on('data', (d) => { text += d; const m = /running at (http:\/\/localhost:\d+)/.exec(text); if (m) resolve(m[1]); });
    child.stderr.on('data', (d) => { text += d; });
    child.on('exit', () => reject(new Error(`start stopped: ${text}`)));
  });
  const send = (method, p, { body, headers = {}, raw } = {}) => fetch(base + p, {
    method,
    headers: { ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const post = async (p, body) => { const r = await send('POST', p, { body }); return { status: r.status, data: await r.json() }; };
  return { base, port: Number(new URL(base).port), send, post, stop: () => child.kill() };
}

try {
  // ---- Commands ----------------------------------------------------------------
  assert.match(await run('--help'), /Usage: field-explorer start/);
  assert.match(await run(), /every custom field and metafield/);
  assert.match(await run('--version'), /^0\.1\.0/);
  assert.match(await fails('start'), /Missing BC_STORE_HASH and BC_ACCESS_TOKEN.*field-explorer setup/s);
  assert.match(await fails('search'), /Unknown command "search"\. The commands are start, setup and env/);
  assert.match(await fails('start', '--custom-field', 'Material=Cotton'), /Unknown option --custom-field\. "start" takes --port, --no-open and --env\. Nothing was run\./);
  assert.match(await fails('start', '--port'), /--port needs a value/);
  assert.match(await fails('start', 'staging'), /"start" takes no name/);

  // ---- Setup and environments ---------------------------------------------------
  let out = await run('setup', 'staging', '--store-hash', 'testhash', '--token', 'tok');
  assert.match(out, /Connected\. The catalog has 7 product\(s\)\./);
  assert.match(out, /env use staging\n  field-explorer start/, 'setup leaves choosing an environment to you');
  assert.equal(fs.statSync(path.join(ws, '.env.staging')).mode & 0o777, 0o600);
  assert.deepEqual(fs.readFileSync(path.join(ws, '.gitignore'), 'utf8').trim().split('\n'), ['.env', '.env.*', '.active-env']);
  assert.match(await fails('start'), /No environment selected/);

  out = await run('setup', 'production', '--store-hash', 'https://api.bigcommerce.com/stores/stagehash/v3/', '--token', 'tok');
  assert.match(out, /The catalog has 1 product\(s\)/);
  assert.match(fs.readFileSync(path.join(ws, '.env.production'), 'utf8'), /BC_STORE_HASH=stagehash/);
  assert.match(await run('env', 'use', 'staging'), /Now using staging: store testhash\.\nThe page reads it until you switch again\./);
  assert.match(await run('env'), /\* staging\s+store testhash/);
  assert.match(await run('setup', 'staging'), /already saved/);

  out = await fails('setup', 'broken', '--store-hash', 'testhash', '--token', 'wrong');
  assert.match(out, /access token was not accepted/);
  assert.ok(!fs.existsSync(path.join(ws, '.env.broken')), 'failed credentials are not kept');

  fs.mkdirSync(path.join(project, 'sub'));
  await assert.rejects(call(['start'], path.join(project, 'sub')), (e) => /No field-explorer folder here; this project's is \.\.\/field-explorer/.test(e.stderr));

  // ---- The page ------------------------------------------------------------------
  const page = await startPage();
  try {
    const { send, post, port } = page;
    let r = await send('GET', '/');
    assert.equal(r.status, 200);
    assert.match(await r.text(), /<title>Field explorer<\/title>/);
    const state = await (await send('GET', '/api/state')).json();
    assert.deepEqual({ env: state.env, storeHash: state.storeHash, tool: state.tool, readAt: state.readAt }, { env: 'staging', storeHash: 'testhash', tool: 'field-explorer', readAt: null });

    // Only the page itself is answered.
    r = await new Promise((resolve) => http.get({ host: '127.0.0.1', port, path: '/api/state', headers: { Host: 'evil.example' } }, resolve));
    assert.equal(r.statusCode, 403, 'another host name is refused');
    r = await send('POST', '/api/summary', { body: {}, headers: { Origin: 'https://evil.example' } });
    assert.equal(r.status, 403, 'a request from another site is refused');
    r = await send('POST', '/api/summary', { raw: '{}', headers: { 'Content-Type': 'text/plain' } });
    assert.equal(r.status, 403, 'a form post from another site is refused');
    assert.equal((await send('GET', '/nope')).status, 404);
    assert.equal((await send('POST', '/api/search', { body: {} })).status, 404, 'there is no search any more');

    // Every field in the catalog, read once.
    let mark = requests.length;
    const summary = await post('/api/summary', {});
    assert.equal(summary.status, 200);
    const made = since(mark);
    for (const path of ['products/metafields', 'variants/metafields', 'categories/metafields', 'brands/metafields', 'trees/categories', 'trees', 'brands']) {
      assert.ok(made.some((req) => req.startsWith(`testhash/v3/catalog/${path}?`)), `${path} is read`);
    }
    assert.ok(made.filter((req) => req.startsWith('testhash/v3/catalog/products?')).every((req) => /include=custom_fields&exclude_fields=description&limit=250/.test(req)));
    assert.equal(made.filter((req) => /\/products\?.*page=2/.test(req)).length, 2, 'a page that hit the rate limit is asked for again');
    assert.ok(made.some((req) => /\/variants\?limit=1&/.test(req)), 'variants are counted');
    assert.ok(!made.some((req) => /\/variants\?limit=250/.test(req)), 'but not read until a variant field is opened');

    const groups = Object.fromEntries(summary.data.groups.map((g) => [g.kind, g]));
    assert.deepEqual(summary.data.groups.map((g) => g.kind), ['cf', 'mf', 'variant', 'category', 'brand']);
    assert.equal(summary.data.metafieldsRead, 20);
    const totals = Object.fromEntries(summary.data.groups.map((g) => [g.kind, [g.total, g.withAny, g.one, g.many]]));
    assert.deepEqual(totals, {
      mf: [7, 5, 'product', 'products'],
      cf: [7, 6, 'product', 'products'],
      variant: [6, 4, 'variant', 'variants'],
      category: [4, 4, 'category', 'categories'],
      brand: [2, 2, 'brand', 'brands'],
    }, 'a metafield on a category that no longer exists is not counted');
    const mfs = groups.mf.fields;
    const cfs = groups.cf.fields;
    assert.deepEqual(mfs.map((f) => `${f.namespace}/${f.name}:${f.count}`), ['erp/season:4', 'app/notes:1', 'erp/supplier:1', 'feeds/season:1'], 'most used first; case and spelling do not split a field');
    assert.deepEqual(mfs[0], { namespace: 'erp', name: 'season', spellings: ['season', 'Season'], count: 4, values: 2, top: [{ value: 'AW26', count: 3 }, { value: 'SS25', count: 1 }] });
    assert.equal(mfs[1].top[0].value.length, 200, 'long values are cut short in the summary');
    assert.deepEqual(cfs.map((f) => `${f.name}:${f.count}`), ['Material:5', 'Care:1', 'Colour:1']);
    assert.deepEqual(cfs[0], { name: 'Material', spellings: ['Material', 'material'], count: 5, values: 4, top: [{ value: 'Cotton', count: 3 }, { value: 'Linen', count: 1 }, { value: 'Polyester', count: 1 }, { value: 'wool', count: 1 }] });
    assert.ok(!('spellings' in cfs[1]), 'a field spelt one way lists no spellings');
    assert.deepEqual(groups.variant.fields.map((f) => `${f.namespace}/${f.name}:${f.count}`), ['erp/barcode:3', 'erp/colour_hex:1', 'feeds/gtin:1']);
    assert.deepEqual(groups.variant.fields[0].spellings, ['barcode', 'Barcode']);
    assert.deepEqual(groups.category.fields.map((f) => `${f.namespace}/${f.name}:${f.count}`), ['theme/banner:3', 'theme/layout:1']);
    assert.deepEqual(groups.brand.fields.map((f) => `${f.namespace}/${f.name}:${f.count}`), ['pim/specs:2', 'pim/country:1']);
    assert.deepEqual(groups.brand.fields[0].keys, [{ key: 'founded', count: 2 }, { key: 'origin', count: 1 }, { key: 'tags', count: 1 }, { key: 'note', count: 1 }], 'a JSON field lists its keys, most used first');
    assert.ok(!('keys' in groups.brand.fields[1]), 'a field that is not JSON has no keys');
    assert.ok(!('keys' in mfs[1]), 'a value that only looks like text is not JSON');

    const ids = (res) => res.data.rows.map((row) => row.id);
    const keys = (res) => res.data.columns.map((c) => c.key);

    // A field's products: every count in the summary is exactly what is shown.
    mark = requests.length;
    let found = await post('/api/items', { kind: 'mf', namespace: 'erp', name: 'season' });
    assert.equal(found.status, 200);
    assert.equal(since(mark).length, 0, 'the catalog already read is used');
    assert.deepEqual(ids(found), [2, 1, 5, 3], 'sorted by name');
    assert.equal(found.data.rows.length, mfs[0].count);
    assert.deepEqual(keys(found), ['id', 'name', 'sku', 'price', 'sale', 'field', 'visibility']);
    assert.deepEqual(found.data.columns.find((c) => c.key === 'field'), { key: 'field', heading: 'season (erp)', type: 'values' });
    assert.equal(found.data.total, 7);
    assert.deepEqual(found.data.rows[1], { id: 1, cells: { id: 1, name: 'Organic Tote', sku: 'OTL-TOTE', price: 20, sale: 18.5, visibility: [], field: ['AW26'] } });
    assert.deepEqual(found.data.rows[0].cells.field, ['SS25'], 'only the namespace asked for');
    assert.equal(found.data.rows[0].cells.sale, null, 'not on sale');
    assert.deepEqual(found.data.rows[2].cells.visibility, ['Hidden']);
    found = await post('/api/items', { kind: 'mf', namespace: 'erp', name: 'season', value: 'aw26' });
    assert.deepEqual(ids(found), [1, 5, 3]);
    assert.equal(found.data.rows.length, mfs[0].top[0].count);
    found = await post('/api/items', { kind: 'mf', namespace: 'erp', name: 'season', missing: true });
    assert.deepEqual(ids(found), [7, 4, 6]);
    assert.equal(found.data.rows.length, groups.mf.total - mfs[0].count);
    assert.ok(!keys(found).includes('field'), 'no field column for products without it');
    found = await post('/api/items', { kind: 'cf', name: 'material', value: 'COTTON' });
    assert.deepEqual(found.data.rows.map((row) => [row.id, row.cells.field]), [[7, ['cotton']], [1, ['Cotton']], [6, ['Cotton', 'Polyester']]]);
    assert.equal(found.data.rows.length, cfs[0].top[0].count);
    found = await post('/api/items', { kind: 'cf', name: 'Material', value: 'wool' });
    assert.deepEqual(ids(found), [3], 'spaces around a value do not matter');
    assert.deepEqual(keys(found), ['id', 'name', 'sku', 'price', 'field', 'visibility'], 'no sale price column when nothing listed is on sale');
    found = await post('/api/items', { kind: 'mf', namespace: 'app', name: 'notes', value: mfs[1].top[0].value });
    assert.deepEqual(ids(found), [6], 'a value cut short still finds its products');
    found = await post('/api/items', { kind: 'cf', name: 'Nothing like this' });
    assert.deepEqual(found.data.rows, []);

    // Variants: read the first time one is opened, and only then.
    mark = requests.length;
    found = await post('/api/items', { kind: 'variant', namespace: 'erp', name: 'barcode' });
    assert.ok(since(mark).some((req) => /\/variants\?limit=250&page=2/.test(req)), 'every page of variants is read');
    assert.deepEqual(ids(found), [21, 22, 23]);
    assert.equal(found.data.rows.length, groups.variant.fields[0].count);
    assert.equal(found.data.total, 6);
    assert.deepEqual(keys(found), ['id', 'product', 'sku', 'options', 'price', 'sale', 'field', 'status']);
    assert.deepEqual(found.data.rows[1].cells, { id: 22, product: 'Linen Shirt', sku: 'LS-M', options: 'Size: M', price: 47.5, sale: 40, status: [], field: ['5012345000028'] });
    assert.deepEqual(found.data.rows[2].cells, { id: 23, product: 'Linen Shirt', sku: 'LS-SAMPLE', options: 'Size: Sample', price: 45, sale: null, status: ['Purchasing disabled'], field: [''] }, 'a variant without a price takes its product\'s');
    mark = requests.length;
    found = await post('/api/items', { kind: 'variant', namespace: 'erp', name: 'barcode', missing: true });
    assert.equal(since(mark).length, 0, 'variants are read once');
    assert.deepEqual(ids(found), [11, 51, 31]);
    assert.equal(found.data.rows.length, groups.variant.total - groups.variant.fields[0].count);
    assert.equal(found.data.rows[0].cells.options, '', 'a base variant has no options');
    found = await post('/api/items', { kind: 'variant', namespace: 'erp', name: 'barcode', value: '' });
    assert.deepEqual(ids(found), [23], 'an empty value can be chosen too');
    found = await post('/api/items', { kind: 'variant', namespace: 'feeds', name: 'gtin' });
    assert.deepEqual(found.data.rows[0].cells.status, ['Hidden'], 'a variant of a hidden product is marked hidden');

    // Categories and brands.
    found = await post('/api/items', { kind: 'category', namespace: 'theme', name: 'banner' });
    assert.deepEqual(ids(found), [100, 200, 101]);
    assert.deepEqual(keys(found), ['id', 'name', 'path', 'tree', 'field', 'visibility'], 'a tree column, since there are two trees');
    assert.deepEqual(found.data.rows[1].cells, { id: 200, name: 'Sale', path: '/sale/', tree: 'EU store', visibility: [], field: ['sale.jpg'] });
    found = await post('/api/items', { kind: 'category', namespace: 'theme', name: 'banner', missing: true });
    assert.deepEqual(ids(found), [102]);
    assert.deepEqual(found.data.rows[0].cells.visibility, ['Hidden']);
    found = await post('/api/items', { kind: 'brand', namespace: 'pim', name: 'country' });
    assert.deepEqual(keys(found), ['id', 'name', 'path', 'field']);
    assert.deepEqual(found.data.rows, [{ id: 300, cells: { id: 300, name: 'Acme', path: '/brands/acme/', field: ['UK'] } }]);
    found = await post('/api/items', { kind: 'brand', namespace: 'pim', name: 'country', missing: true });
    assert.deepEqual(ids(found), [301]);
    found = await post('/api/items', { kind: 'brand', namespace: 'pim', name: 'specs' });
    assert.deepEqual(keys(found), ['id', 'name', 'path', 'field']);
    assert.deepEqual(found.data.columns.find((c) => c.key === 'field'), { key: 'field', heading: 'specs (pim)', type: 'json' }, 'JSON is shown a key at a time');
    assert.deepEqual(found.data.rows[0].cells.field, ['{"founded":1990,"origin":{"country":"UK"},"tags":["eco"]}']);
    found = await post('/api/items', { kind: 'brand', namespace: 'pim', name: 'country' });
    assert.equal(found.data.columns.find((c) => c.key === 'field').type, 'values', 'a field that is not JSON is shown as it is');

    // Mistakes in a request are explained.
    let wrong = await post('/api/items', { kind: 'sku', name: 'x' });
    assert.equal(wrong.status, 400);
    assert.match(wrong.data.error, /which kind of field: "mf", "cf", "variant", "category", "brand"/);
    wrong = await post('/api/items', { kind: 'variant', name: 'barcode' });
    assert.match(wrong.data.error, /which namespace/);
    wrong = await post('/api/items', { kind: 'cf', name: ' ' });
    assert.match(wrong.data.error, /which field/);
    r = await send('POST', '/api/items', { raw: '{nope' });
    assert.equal(r.status, 400);

    // Downloads.
    r = await send('POST', '/api/export', { body: { kind: 'mf', namespace: 'erp', name: 'season', value: 'AW26', format: 'csv' } });
    assert.match(r.headers.get('content-type'), /^text\/csv/);
    assert.match(r.headers.get('content-disposition'), /^attachment; filename="erp-season-aw26-\d{4}-\d{2}-\d{2}\.csv"$/);
    const csvBytes = Buffer.from(await r.arrayBuffer());
    assert.deepEqual([...csvBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'CSV with a byte order mark for Excel');
    assert.equal(csvBytes.toString('utf8', 3),
      'id,name,sku,price,sale_price,url,visible,season (erp)\n' +
      '1,Organic Tote,OTL-TOTE,20.00,18.50,/organic-tote/,true,AW26\n' +
      '5,"Otl Bag, Large",otl-bag,1250.00,,/otl-bag/,false,AW26\n' +
      '3,Wool Scarf,WS-1,30.125,,/wool-scarf/,true,aw26\n');
    r = await send('POST', '/api/export', { body: { kind: 'cf', name: 'Care', missing: true, format: 'csv' } });
    assert.match(r.headers.get('content-disposition'), /filename="care-without-/);
    assert.match(await r.text(), /^id,name,sku,price,sale_price,url,visible\n/, 'no field column for products without it'); // text() drops the byte order mark
    r = await send('POST', '/api/export', { body: { kind: 'variant', namespace: 'erp', name: 'barcode', format: 'csv' } });
    assert.match(r.headers.get('content-disposition'), /filename="variants-erp-barcode-\d{4}-\d{2}-\d{2}\.csv"/);
    assert.equal(await r.text(),
      'variant_id,product_id,product_name,sku,options,price,sale_price,purchasing_disabled,product_visible,barcode (erp)\n' +
      '21,2,Linen Shirt,LS-S,Size: S,45.00,,false,true,5012345000011\n' +
      '22,2,Linen Shirt,LS-M,Size: M,47.50,40.00,false,true,5012345000028\n' +
      '23,2,Linen Shirt,LS-SAMPLE,Size: Sample,45.00,,true,true,\n');
    r = await send('POST', '/api/export', { body: { kind: 'category', namespace: 'theme', name: 'banner', format: 'csv' } });
    assert.match(await r.text(), /^id,name,url,tree,visible,banner \(theme\)\n100,Bags,\/bags\/,UK store,true,bags\.jpg\n/);
    r = await send('POST', '/api/export', { body: { kind: 'brand', namespace: 'pim', name: 'specs', format: 'csv' } });
    assert.equal(await r.text(),
      'id,name,url,specs (pim),specs.founded,specs.origin,specs.tags,specs.note\n' +
      '300,Acme,/brands/acme/,"{""founded"":1990,""origin"":{""country"":""UK""},""tags"":[""eco""]}",1990,"{""country"":""UK""}","[""eco""]",\n' +
      '301,Highland,/brands/highland/,"{""founded"":205,""note"":""Family run, since 205""}",205,,,"Family run, since 205"\n');
    r = await send('POST', '/api/export', { body: { kind: 'brand', namespace: 'pim', name: 'specs', format: 'pdf' } });
    assert.equal((await PDFDocument.load(new Uint8Array(await r.arrayBuffer()))).getTitle(), 'Brands with specs (pim)');
    r = await send('POST', '/api/export', { body: { kind: 'mf', namespace: 'erp', name: 'season', format: 'pdf' } });
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.match(r.headers.get('content-disposition'), /filename="erp-season-\d{4}-\d{2}-\d{2}\.pdf"/);
    const pdfBytes = new Uint8Array(await r.arrayBuffer());
    assert.equal(Buffer.from(pdfBytes.slice(0, 5)).toString(), '%PDF-');
    assert.equal((await PDFDocument.load(pdfBytes)).getTitle(), 'Products with season (erp)');
    r = await send('POST', '/api/export', { body: { kind: 'brand', namespace: 'pim', name: 'country', value: 'UK', format: 'pdf' } });
    assert.equal((await PDFDocument.load(new Uint8Array(await r.arrayBuffer()))).getTitle(), 'Brands where country (pim) is UK');
    wrong = await post('/api/export', { kind: 'cf', name: 'Care', format: 'xlsx' });
    assert.match(wrong.data.error, /csv or pdf/);

    // Reading the catalog again.
    assert.ok((await (await send('GET', '/api/state')).json()).readAt, 'the page is told when the catalog was read');
    assert.equal((await post('/api/refresh', {})).status, 200);
    mark = requests.length;
    await post('/api/items', { kind: 'variant', namespace: 'erp', name: 'barcode' });
    assert.ok(since(mark).some((req) => req.includes('/products?')), 'after a refresh the store is read again');
    assert.ok(since(mark).some((req) => /\/variants\?limit=250/.test(req)), 'variants too');

    // A second page on the same port says what to do.
    assert.match(await fails('start', '--port', String(port)), /Port \d+ is already in use[\s\S]*--port \d+/);
  } finally {
    page.stop();
  }

  // ---- Another store, and a store the token cannot read ----------------------------
  const production = await startPage('--env', 'production');
  try {
    const { data } = await production.post('/api/summary', {});
    const groups = Object.fromEntries(data.groups.map((g) => [g.kind, g]));
    assert.deepEqual(groups.cf.fields.map((f) => f.name), ['Material']);
    assert.equal(groups.mf.fields.length, 0);
    assert.equal(groups.category.total, 1, 'a store without category trees is read through the older categories endpoint');
    assert.equal(groups.variant.total, 1);
  } finally {
    production.stop();
  }
  fs.writeFileSync(path.join(ws, '.env.noscope'), 'BC_STORE_HASH=noscope\nBC_ACCESS_TOKEN=tok\n');
  const noscope = await startPage('--env', 'noscope');
  try {
    const { status, data } = await noscope.post('/api/summary', {});
    assert.equal(status, 502);
    assert.match(data.error, /needs the Products scope/);
  } finally {
    noscope.stop();
  }

  console.log('All checks passed.');
} finally {
  api.close();
  fs.rmSync(project, { recursive: true, force: true });
}
