import { ApiError, bc, fetchAll, type Progress } from './api.js';
import type { Brand, Category, Config, Metafield, PageOf, Product, Tree, Variant } from './types.js';

/**
 * Every product in the catalog, with its custom fields. The description is
 * left out, since it is often the largest thing on a product and nothing here
 * shows it.
 */
export function fetchProducts(config: Config, progress?: Progress): Promise<Product[]> {
  return fetchAll<Product>(config, '/v3/catalog/products', { include: 'custom_fields', exclude_fields: 'description' }, progress);
}

/** Where each kind of catalog metafield is listed, catalog-wide. */
export const METAFIELD_PATHS = {
  product: '/v3/catalog/products/metafields',
  variant: '/v3/catalog/variants/metafields',
  category: '/v3/catalog/categories/metafields',
  brand: '/v3/catalog/brands/metafields',
} as const;

/** Every metafield of one kind this token can read, grouped by the ID of what it is on. */
export async function fetchMetafields(config: Config, kind: keyof typeof METAFIELD_PATHS, progress?: Progress): Promise<Map<number, Metafield[]>> {
  const all = await fetchAll<Metafield>(config, METAFIELD_PATHS[kind], {}, progress);
  const byResource = new Map<number, Metafield[]>();
  for (const field of all) {
    const list = byResource.get(field.resource_id);
    if (list) list.push(field);
    else byResource.set(field.resource_id, [field]);
  }
  return byResource;
}

/** How many of something there are, from one small request. */
async function count(config: Config, path: string): Promise<number> {
  const page = await bc<PageOf<{ id: number }>>(config, path, { limit: 1, include_fields: 'id' });
  return page?.meta?.pagination?.total ?? page?.data?.length ?? 0;
}

/** How many products the catalog has. Used to check credentials when they are saved. */
export const countProducts = (config: Config): Promise<number> => count(config, '/v3/catalog/products');

/** How many variants the catalog has, without reading them all. */
export const countVariants = (config: Config): Promise<number> => count(config, '/v3/catalog/variants');

/** Every variant in the catalog. Read only when a variant field is opened, since there can be many. */
export function fetchVariants(config: Config, progress?: Progress): Promise<Variant[]> {
  return fetchAll<Variant>(config, '/v3/catalog/variants', {}, progress);
}

/**
 * Every category, in every category tree, with the trees' names. Stores with
 * more than one storefront can have a tree for each. A store that does not
 * have the category trees endpoint is read through the older categories one.
 */
export async function fetchCategories(config: Config): Promise<{ categories: Category[]; trees: Tree[] }> {
  try {
    const [categories, trees] = await Promise.all([
      fetchAll<Category>(config, '/v3/catalog/trees/categories'),
      fetchAll<Tree>(config, '/v3/catalog/trees'),
    ]);
    return { categories, trees };
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) throw err;
    return { categories: await fetchAll<Category>(config, '/v3/catalog/categories'), trees: [] };
  }
}

export function fetchBrands(config: Config): Promise<Brand[]> {
  return fetchAll<Brand>(config, '/v3/catalog/brands');
}
