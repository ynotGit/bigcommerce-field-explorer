// What a field's page lists: the products, variants, categories or brands
// with the field, with one of its values, or without it, and the columns to
// show them in on the page, in the CSV and in the PDF. Fields and values are
// compared the way the summary groups them, so every count in the summary is
// exactly what is listed.
import type { Catalog } from './cache.js';
import { JsonKeys, KINDS, LONGEST_VALUE, fold, jsonObject, type Kind } from './summary.js';
import type { Metafield, Variant } from './types.js';

/** A custom field (by name) or a metafield (by namespace and key) on one kind of thing. */
export interface FieldRef {
  kind: Kind;
  namespace?: string;
  name: string;
}

/** What a field's page shows. */
export type Show = { set: true } | { value: string } | { missing: true };

/**
 * How a column's values look and sort. A status holds badges, such as "Hidden"; none means all is well.
 * JSON is a field whose every value is a JSON object, shown a key at a time.
 */
export type ColumnType = 'id' | 'text' | 'mono' | 'price' | 'values' | 'json' | 'status';

export interface Column {
  key: string;
  heading: string;
  type: ColumnType;
  /** The line a phone's card leads with (the name), and what goes beside it (the price). */
  role?: 'title' | 'price';
  /** Written before the value on a phone's card, where there are no headings: "ID 21", "Sale 18.50". */
  prefix?: string;
}

export type Cell = string | number | null | string[];

export interface Row {
  id: number;
  cells: Record<string, Cell>;
}

export interface Table {
  columns: Column[];
  rows: Row[];
  /** How many products, variants, categories or brands there are in all. */
  total: number;
  csvHeaders: string[];
  csvRows: (string | number | boolean)[][];
}

/** "season (erp)" for a metafield, the name alone for a custom field. */
const fieldLabel = (field: FieldRef): string => (field.kind === 'cf' ? field.name : `${field.name} (${field.namespace ?? ''})`);

/** What a field's page is showing, in words: "Products with season (erp)", "Variants where colour (erp) is Red". */
export function describeShow(field: FieldRef, show: Show): string {
  const things = KINDS[field.kind].many;
  const label = fieldLabel(field);
  const what = 'missing' in show ? `without ${label}` : 'value' in show ? `where ${label} is ${show.value}` : `with ${label}`;
  return `${things[0]?.toUpperCase()}${things.slice(1)} ${what}`;
}

/** Whether a value is the one chosen. A value cut short in the summary is matched by how it starts. */
function sameValue(value: string, chosen: string): boolean {
  const a = fold(value);
  const b = fold(chosen);
  if (chosen.length === LONGEST_VALUE && chosen.endsWith('…')) return a.startsWith(b.slice(0, -1));
  return a === b;
}

/** One key's value as text: a string as it is, anything else as JSON (null, numbers, anything nested), nothing for a missing key. */
const partText = (value: unknown): string =>
  value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);

/** A JSON field's keys, in the order they first appear; none for a field that is not JSON. */
function jsonKeys(items: Item[]): string[] {
  const keys = new JsonKeys();
  for (const item of items) for (const value of item.values) keys.add(item.id, value);
  return keys.list().map((k) => k.key);
}

const amount = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null);
/** BigCommerce gives 0 for something that is not on sale. */
const saleAmount = (n: unknown): number | null => amount(n) || null;

/** The values of a metafield on one thing. */
function metafieldValues(list: Metafield[] | undefined, field: FieldRef): string[] {
  const namespace = fold(field.namespace ?? '');
  const key = fold(field.name);
  return (list ?? []).filter((m) => fold(m.namespace) === namespace && fold(m.key) === key).map((m) => String(m.value ?? ''));
}

/** Everything of one kind, with the field's values on each. Variants have to be read first. */
interface Item {
  id: number;
  /** For sorting by name. */
  name: string;
  values: string[];
  cells: Record<string, Cell>;
  csv: (string | number | boolean)[];
}

interface KindTable {
  columns: Column[];
  csvHeaders: string[];
  items: Item[];
}

function productTable(catalog: Catalog, field: FieldRef): KindTable {
  return {
    columns: [
      { key: 'id', heading: 'ID', type: 'id', prefix: 'ID ' },
      { key: 'name', heading: 'Name', type: 'text', role: 'title' },
      { key: 'sku', heading: 'SKU', type: 'mono' },
      { key: 'price', heading: 'Price', type: 'price', role: 'price' },
      { key: 'sale', heading: 'Sale price', type: 'price', prefix: 'Sale ' },
      { key: 'visibility', heading: 'Visibility', type: 'status' },
    ],
    csvHeaders: ['id', 'name', 'sku', 'price', 'sale_price', 'url', 'visible'],
    items: catalog.products.map((p) => {
      const values = field.kind === 'cf'
        ? (p.custom_fields ?? []).filter((f) => fold(f.name) === fold(field.name)).map((f) => String(f.value ?? ''))
        : metafieldValues(catalog.metafields.product.get(p.id), field);
      const price = amount(p.price);
      const sale = saleAmount(p.sale_price);
      return {
        id: p.id,
        name: p.name,
        values,
        cells: { id: p.id, name: p.name, sku: p.sku ?? '', price, sale, visibility: p.is_visible === false ? ['Hidden'] : [] },
        csv: [p.id, p.name, p.sku ?? '', formatPrice(price), formatPrice(sale), p.custom_url?.url ?? '', p.is_visible ?? ''],
      };
    }),
  };
}

/** "Colour: Red, Size: M"; nothing for a product's base variant. */
const optionsOf = (v: Variant): string =>
  (v.option_values ?? []).map((o) => [o.option_display_name, o.label].filter(Boolean).join(': ')).join(', ');

function variantTable(catalog: Catalog, variants: Variant[], field: FieldRef): KindTable {
  return {
    columns: [
      { key: 'id', heading: 'Variant ID', type: 'id', prefix: 'Variant ' },
      { key: 'product', heading: 'Product', type: 'text', role: 'title' },
      { key: 'sku', heading: 'SKU', type: 'mono' },
      { key: 'options', heading: 'Options', type: 'text' },
      { key: 'price', heading: 'Price', type: 'price', role: 'price' },
      { key: 'sale', heading: 'Sale price', type: 'price', prefix: 'Sale ' },
      { key: 'status', heading: 'Status', type: 'status' },
    ],
    csvHeaders: ['variant_id', 'product_id', 'product_name', 'sku', 'options', 'price', 'sale_price', 'purchasing_disabled', 'product_visible'],
    items: variants.map((v) => {
      const product = catalog.productsById.get(v.product_id);
      const name = product?.name ?? `Product ${v.product_id}`;
      // A variant without a price of its own takes its product's.
      const price = amount(v.price) ?? amount(product?.price);
      const sale = v.sale_price === null || v.sale_price === undefined ? saleAmount(product?.sale_price) : saleAmount(v.sale_price);
      const status = [...(product?.is_visible === false ? ['Hidden'] : []), ...(v.purchasing_disabled ? ['Purchasing disabled'] : [])];
      return {
        id: v.id,
        name,
        values: metafieldValues(catalog.metafields.variant.get(v.id), field),
        cells: { id: v.id, product: name, sku: v.sku ?? '', options: optionsOf(v), price, sale, status },
        csv: [v.id, v.product_id, name, v.sku ?? '', optionsOf(v), formatPrice(price), formatPrice(sale), Boolean(v.purchasing_disabled), product?.is_visible ?? ''],
      };
    }),
  };
}

function categoryTable(catalog: Catalog, field: FieldRef): KindTable {
  const trees = new Map(catalog.trees.map((t) => [t.id, t.name]));
  // The tree is only worth a column when there is more than one.
  const several = new Set(catalog.categories.map((c) => c.treeId)).size > 1;
  return {
    columns: [
      { key: 'id', heading: 'ID', type: 'id', prefix: 'ID ' },
      { key: 'name', heading: 'Name', type: 'text', role: 'title' },
      { key: 'path', heading: 'URL', type: 'mono' },
      ...(several ? [{ key: 'tree', heading: 'Tree', type: 'text', prefix: 'Tree ' } as Column] : []),
      { key: 'visibility', heading: 'Visibility', type: 'status' },
    ],
    csvHeaders: ['id', 'name', 'url', 'tree', 'visible'],
    items: catalog.categories.map((c) => {
      const tree = c.treeId === null ? '' : trees.get(c.treeId) ?? String(c.treeId);
      return {
        id: c.id,
        name: c.name,
        values: metafieldValues(catalog.metafields.category.get(c.id), field),
        cells: { id: c.id, name: c.name, path: c.path, tree, visibility: c.visible === false ? ['Hidden'] : [] },
        csv: [c.id, c.name, c.path, tree, c.visible ?? ''],
      };
    }),
  };
}

function brandTable(catalog: Catalog, field: FieldRef): KindTable {
  return {
    columns: [
      { key: 'id', heading: 'ID', type: 'id', prefix: 'ID ' },
      { key: 'name', heading: 'Name', type: 'text', role: 'title' },
      { key: 'path', heading: 'URL', type: 'mono' },
    ],
    csvHeaders: ['id', 'name', 'url'],
    items: catalog.brands.map((b) => ({
      id: b.id,
      name: b.name,
      values: metafieldValues(catalog.metafields.brand.get(b.id), field),
      cells: { id: b.id, name: b.name, path: b.custom_url?.url ?? '' },
      csv: [b.id, b.name, b.custom_url?.url ?? ''],
    })),
  };
}

/**
 * The products, variants, categories or brands a field's page lists, sorted
 * by name, with the columns to show them in. Variants are passed in, since they
 * are read only when needed.
 */
export function tableFor(catalog: Catalog, variants: Variant[] | null, field: FieldRef, show: Show): Table {
  const kind =
    field.kind === 'variant' ? variantTable(catalog, variants ?? [], field)
    : field.kind === 'category' ? categoryTable(catalog, field)
    : field.kind === 'brand' ? brandTable(catalog, field)
    : productTable(catalog, field);

  const items = kind.items
    .filter(({ values }) =>
      'missing' in show ? values.length === 0
      : 'value' in show ? values.some((v) => sameValue(v, show.value))
      : values.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id - b.id);

  // The sale price only when something listed is on sale; the field's values only for things that have it.
  const onSale = items.some((item) => item.cells.sale !== null && item.cells.sale !== undefined);
  const withField = !('missing' in show);
  const columns = kind.columns.filter((c) => c.key !== 'sale' || onSale);
  // A field whose values are JSON objects is shown a key at a time, and gets a CSV column for each key.
  // The keys come from everything with the field, so the CSV's columns stay put whichever value is shown.
  const keys = withField ? jsonKeys(kind.items) : [];
  const fieldColumn: Column = { key: 'field', heading: fieldLabel(field), type: keys.length ? 'json' : 'values' };
  if (withField) {
    // The field's values go before the status, or last when there is none.
    const at = columns.findIndex((c) => c.type === 'status');
    columns.splice(at === -1 ? columns.length : at, 0, fieldColumn);
  }
  /** Each key's value, in each of an item's values. */
  const partsOf = (item: Item): string[][] => {
    const objects = item.values.map((v) => jsonObject(v) ?? {});
    return keys.map((key) => objects.map((o) => partText(o[key])));
  };

  return {
    columns,
    rows: items.map((item) => ({ id: item.id, cells: withField ? { ...item.cells, field: item.values } : item.cells })),
    total: kind.items.length,
    csvHeaders: [...kind.csvHeaders, ...(withField ? [fieldColumn.heading, ...keys.map((key) => `${field.name}.${key}`)] : [])],
    csvRows: items.map((item) => [...item.csv, ...(withField ? [item.values.join(' | '), ...partsOf(item).map((values) => values.join(' | '))] : [])]),
  };
}

// ---- Writing it out ---------------------------------------------------------------

/** A price as it is shown: at least two decimal places, as many as it has up to four. No thousands separators, so spreadsheets read it as a number. */
const formatPrice = (n: number | null): string =>
  n === null ? '' : n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: false });

/** A CSV cell, quoted when it holds a comma, a quote or a line break. */
const csvCell = (value: string | number | boolean): string => {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const csv = (table: Table): string =>
  [table.csvHeaders, ...table.csvRows].map((row) => row.map(csvCell).join(',')).join('\n');

/** A cell as lines of text, for the PDF. */
export function cellLines(column: Column, value: Cell | undefined): string[] {
  if (column.type === 'values') return Array.isArray(value) ? value.map((v) => (v === '' ? '(empty)' : v)) : [];
  // JSON is written out a key to a line.
  if (column.type === 'json') {
    return Array.isArray(value)
      ? value.flatMap((v) => Object.entries(jsonObject(v) ?? {}).map(([k, part]) => `${k}: ${partText(part)}`))
      : [];
  }
  if (column.type === 'status') return Array.isArray(value) && value.length ? value : [column.key === 'visibility' ? 'Visible' : ''];
  if (column.type === 'price') return [formatPrice(typeof value === 'number' ? value : null)];
  return [value === null || value === undefined ? '' : String(value)];
}
