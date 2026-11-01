// ---- Catalog API -----------------------------------------------------------

/** A custom field as /v3/catalog/products?include=custom_fields returns it. */
export interface CustomField {
  id?: number;
  name: string;
  value: string;
}

/** The part of a product this tool reads. The sub-resources are there only when asked for. */
export interface Product {
  id: number;
  name: string;
  sku?: string;
  /** The default price, in the store's default currency. */
  price?: number;
  /** The sale price; 0 when the product is not on sale. */
  sale_price?: number;
  is_visible?: boolean;
  custom_url?: { url?: string };
  custom_fields?: CustomField[];
}

/** The part of a variant this tool reads. Every product has at least one: its base variant, with no options. */
export interface Variant {
  id: number;
  product_id: number;
  sku?: string;
  /** Null when the variant takes the product's price. */
  price?: number | null;
  /** Null when the variant takes the product's sale price. */
  sale_price?: number | null;
  purchasing_disabled?: boolean;
  option_values?: { label?: string; option_display_name?: string }[];
}

/**
 * A category, as /v3/catalog/trees/categories returns it (category_id, tree_id
 * and url.path) or as the older /v3/catalog/categories does (id and custom_url).
 */
export interface Category {
  category_id?: number;
  id?: number;
  parent_id?: number;
  tree_id?: number;
  name: string;
  is_visible?: boolean;
  url?: { path?: string };
  custom_url?: { url?: string };
}

/** A category tree. A store with one storefront has one; Multi-Storefront stores can have several. */
export interface Tree {
  id: number;
  name: string;
}

/** The part of a brand this tool reads. */
export interface Brand {
  id: number;
  name: string;
  custom_url?: { url?: string };
}

/** A metafield as the catalog's batch endpoints return it. resource_id is the product, variant, category or brand it is on. */
export interface Metafield {
  id: number;
  namespace: string;
  key: string;
  value: string;
  resource_id: number;
  permission_set?: string;
}

/** A page of a collection, as the v3 catalog endpoints return it. */
export interface PageOf<T> {
  data?: T[];
  meta?: { pagination?: { total?: number; total_pages?: number } };
}

// ---- Tool configuration ----------------------------------------------------

/** Options as typed. */
export type Flags = Record<string, string | boolean | undefined>;

export interface Config {
  /** The field-explorer folder in the project. */
  root: string;
  /** Which saved store this run talks to: "default", "staging", ... */
  envName: string;
  storeHash: string | undefined;
  token: string | undefined;
  apiBase: string;
}
