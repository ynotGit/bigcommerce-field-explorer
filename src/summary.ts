// What the catalog carries: every metafield key and custom field name, on
// products, variants, categories and brands, how many of each have it, and its
// most common values. This is what the page opens on: choose a field to see
// what has it.
//
// Names, keys, namespaces and values are grouped ignoring case and spaces at
// either end, the same way a field's items are found, so each count is exactly
// the number of items shown for it. A field spelt more than one way says so,
// since that is usually worth knowing about.
import type { Catalog } from './cache.js';
import type { Metafield } from './types.js';

/** What a field is on: product metafields, product custom fields, or variant, category or brand metafields. */
export type Kind = 'mf' | 'cf' | 'variant' | 'category' | 'brand';

export const KINDS: Record<Kind, { title: string; one: string; many: string }> = {
  mf: { title: 'Product metafields', one: 'product', many: 'products' },
  cf: { title: 'Product custom fields', one: 'product', many: 'products' },
  variant: { title: 'Variant metafields', one: 'variant', many: 'variants' },
  category: { title: 'Category metafields', one: 'category', many: 'categories' },
  brand: { title: 'Brand metafields', one: 'brand', many: 'brands' },
};

export const isKind = (value: unknown): value is Kind => typeof value === 'string' && value in KINDS;

export interface FieldSummary {
  /** The metafield's namespace; custom fields have none. */
  namespace?: string;
  /** The metafield key or custom field name, in its most common spelling. */
  name: string;
  /** Every spelling of the name, most common first, when there is more than one. */
  spellings?: string[];
  /** How many products, variants, categories or brands have this field. */
  count: number;
  /** How many different values it has across them. */
  values: number;
  /** Its most common values, each with how many have it. */
  top: { value: string; count: number }[];
}

/** One section of the field list: every field of one kind. */
export interface Group {
  kind: Kind;
  title: string;
  /** What the counts count, as "product" and "products". */
  one: string;
  many: string;
  /** How many products, variants, categories or brands there are in all. */
  total: number;
  /** How many have at least one field of this kind. */
  withAny: number;
  fields: FieldSummary[];
}

export interface CatalogSummary {
  groups: Group[];
  metafieldsRead: number;
}

const TOP = 8;

/** Values longer than this are cut short in the summary, and matched by how they start when chosen. */
export const LONGEST_VALUE = 200;

/** How names and values are compared everywhere: ignoring case and spaces at either end. */
export const fold = (text: string): string => text.trim().toLowerCase();

/** Counts how often each spelling of something turns up, to show the most common. */
class Spellings {
  private readonly counts = new Map<string, number>();
  add(text: string): void {
    this.counts.set(text, (this.counts.get(text) ?? 0) + 1);
  }
  /** Most common first; ties in alphabetical order. */
  list(): string[] {
    return [...this.counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en')).map(([text]) => text);
  }
}

interface Field {
  namespace?: Spellings;
  name: Spellings;
  holders: Set<number>;
  values: Map<string, { spellings: Spellings; holders: Set<number> }>;
}

/** Collects values per field: field, then value, then what has it. */
class Tally {
  private readonly fields = new Map<string, Field>();
  /** Everything that has at least one field. */
  readonly holders = new Set<number>();

  add(holder: number, name: string, value: string, namespace?: string): void {
    const id = `${namespace === undefined ? '' : fold(namespace)}\u0000${fold(name)}`;
    let field = this.fields.get(id);
    if (!field) {
      field = { ...(namespace !== undefined ? { namespace: new Spellings() } : {}), name: new Spellings(), holders: new Set(), values: new Map() };
      this.fields.set(id, field);
    }
    if (namespace !== undefined) field.namespace?.add(namespace.trim());
    field.name.add(name.trim());
    field.holders.add(holder);
    this.holders.add(holder);
    const shown = value.trim();
    let entry = field.values.get(fold(shown));
    if (!entry) {
      entry = { spellings: new Spellings(), holders: new Set() };
      field.values.set(fold(shown), entry);
    }
    entry.spellings.add(shown.length > LONGEST_VALUE ? `${shown.slice(0, LONGEST_VALUE - 1)}…` : shown);
    entry.holders.add(holder);
  }

  addMetafields(holder: number, metafields: Metafield[] | undefined): void {
    for (const m of metafields ?? []) this.add(holder, m.key, String(m.value ?? ''), m.namespace);
  }

  /** The most widely used fields first, then by namespace and name. */
  list(): FieldSummary[] {
    return [...this.fields.values()]
      .map((f): FieldSummary => {
        const spellings = f.name.list();
        return {
          ...(f.namespace ? { namespace: f.namespace.list()[0] ?? '' } : {}),
          name: spellings[0] ?? '',
          ...(spellings.length > 1 ? { spellings } : {}),
          count: f.holders.size,
          values: f.values.size,
          top: [...f.values.values()]
            .map((v) => ({ value: v.spellings.list()[0] ?? '', count: v.holders.size }))
            .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'en', { numeric: true }))
            .slice(0, TOP),
        };
      })
      .sort((a, b) =>
        b.count - a.count ||
        (a.namespace ?? '').localeCompare(b.namespace ?? '', 'en') ||
        a.name.localeCompare(b.name, 'en'));
  }
}

const group = (kind: Kind, total: number, tally: Tally): Group => ({
  kind,
  ...KINDS[kind],
  total,
  withAny: tally.holders.size,
  fields: tally.list(),
});

export function summariseCatalog(catalog: Catalog): CatalogSummary {
  const productMetafields = new Tally();
  const customFields = new Tally();
  for (const product of catalog.products) {
    productMetafields.addMetafields(product.id, catalog.metafields.product.get(product.id));
    for (const f of product.custom_fields ?? []) customFields.add(product.id, f.name, String(f.value ?? ''));
  }
  // Variants are not read until one is opened, so their metafields are counted as they come.
  const variantMetafields = new Tally();
  for (const [variantId, list] of catalog.metafields.variant) variantMetafields.addMetafields(variantId, list);
  const categoryMetafields = new Tally();
  for (const category of catalog.categories) categoryMetafields.addMetafields(category.id, catalog.metafields.category.get(category.id));
  const brandMetafields = new Tally();
  for (const brand of catalog.brands) brandMetafields.addMetafields(brand.id, catalog.metafields.brand.get(brand.id));

  return {
    groups: [
      group('cf', catalog.products.length, customFields),
      group('mf', catalog.products.length, productMetafields),
      group('variant', catalog.variantCount, variantMetafields),
      group('category', catalog.categories.length, categoryMetafields),
      group('brand', catalog.brands.length, brandMetafields),
    ],
    metafieldsRead: catalog.metafieldsRead,
  };
}
