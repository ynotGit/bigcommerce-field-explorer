// The catalog the page works from, read from the store once and kept in
// memory, so that moving between fields is instant: every product with its
// custom fields, every category and brand, and every metafield on products,
// variants, categories and brands. Variants themselves are read only when a
// variant field is first opened, since a catalog can have a great many.
import { countVariants, fetchBrands, fetchCategories, fetchMetafields, fetchProducts, fetchVariants } from './catalog.js';
import type { Brand, Config, Metafield, Product, Tree, Variant } from './types.js';

/** A category, whichever endpoint it came from. */
export interface CategoryItem {
  id: number;
  name: string;
  path: string;
  treeId: number | null;
  visible: boolean | null;
}

export interface Catalog {
  products: Product[];
  productsById: Map<number, Product>;
  categories: CategoryItem[];
  trees: Tree[];
  brands: Brand[];
  variantCount: number;
  /** Metafields by the ID of the product, variant, category or brand they are on. */
  metafields: {
    product: Map<number, Metafield[]>;
    variant: Map<number, Metafield[]>;
    category: Map<number, Metafield[]>;
    brand: Map<number, Metafield[]>;
  };
  metafieldsRead: number;
  /** When it was read from the store. */
  readAt: Date;
}

/**
 * The catalog, read when first asked for and then kept until it is cleared or
 * is older than `maxAgeMs`. Requests that arrive while it is being read wait
 * for that one read rather than starting another.
 */
export class CatalogCache {
  private catalog?: Catalog;
  private reading?: Promise<Catalog>;
  private variantList?: Promise<Variant[]>;

  constructor(private readonly config: Config, private readonly maxAgeMs = 15 * 60_000) {}

  /** When what is held was read, or null when nothing is. */
  get readAt(): Date | null {
    return this.catalog?.readAt ?? null;
  }

  clear(): void {
    this.catalog = undefined;
    this.variantList = undefined;
  }

  read(): Promise<Catalog> {
    if (this.catalog && Date.now() - this.catalog.readAt.getTime() < this.maxAgeMs) return Promise.resolve(this.catalog);
    this.reading ??= (async () => {
      try {
        this.variantList = undefined; // read again with the rest
        const readAt = new Date();
        const config = this.config;
        const [products, { categories, trees }, brands, variantCount, product, variant, category, brand] = await Promise.all([
          fetchProducts(config),
          fetchCategories(config),
          fetchBrands(config),
          countVariants(config),
          fetchMetafields(config, 'product'),
          fetchMetafields(config, 'variant'),
          fetchMetafields(config, 'category'),
          fetchMetafields(config, 'brand'),
        ]);
        let metafieldsRead = 0;
        for (const map of [product, variant, category, brand]) for (const list of map.values()) metafieldsRead += list.length;
        this.catalog = {
          products,
          productsById: new Map(products.map((p) => [p.id, p])),
          categories: categories.map((c) => ({
            id: c.category_id ?? c.id ?? 0,
            name: c.name,
            path: c.url?.path ?? c.custom_url?.url ?? '',
            treeId: c.tree_id ?? null,
            visible: c.is_visible ?? null,
          })),
          trees,
          brands,
          variantCount,
          metafields: { product, variant, category, brand },
          metafieldsRead,
          readAt,
        };
        return this.catalog;
      } finally {
        this.reading = undefined;
      }
    })();
    return this.reading;
  }

  /** Every variant, read the first time it is asked for and kept as long as the rest of the catalog. */
  variants(): Promise<Variant[]> {
    if (!this.variantList) {
      const reading = fetchVariants(this.config);
      this.variantList = reading;
      reading.catch(() => { if (this.variantList === reading) this.variantList = undefined; }); // a failed read is tried again next time
    }
    return this.variantList;
  }
}
