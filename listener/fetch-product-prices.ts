#!/usr/bin/env ts-node
/**
 * Fetch current product prices for posts that have a `product_url` set on
 * their watch-meta (via __doodles:watch-overrides → __doodles:watch-meta).
 *
 * Prices are extracted from the page's JSON-LD `Product` / `Offer` schema
 * (schema.org structured data that most e-commerce platforms — Shopify,
 * WooCommerce, custom storefronts — emit for SEO). We treat that schema as
 * a sanctioned data contract rather than parsing rendered HTML.
 *
 * Storage:
 *   __doodles:product-prices   Hash: basePostId -> ProductPrice JSON
 *
 * Successful fetches overwrite the prior entry. Failures (network error,
 * missing JSON-LD, no parseable price) log a warning and leave any prior
 * successful value in place — operator can clear stale entries with
 * `HDEL __doodles:product-prices <basePostId>`.
 *
 * Usage:
 *   REDIS_URL=redis://localhost:6379 npm run fetch-prices              # all
 *   REDIS_URL=redis://localhost:6379 npm run fetch-prices -- --post=ID # one
 */

import { Redis } from 'ioredis';
import { META_KEY, WatchMeta } from './classify-post';

export const PRODUCT_PRICES_KEY = '__doodles:product-prices';
export const PRICES_LAST_REFRESH_KEY = '__doodles:product-prices:last-refresh';

const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT =
  'Mozilla/5.0 (compatible; RyansWatchesBot/1.0; +https://ryanswatches.com)';

export interface ProductPrice {
  value: number;
  currency: string;
  productUrl: string;
  productDomain: string;
  fetchedAt: string;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Walks a JSON-LD object (which may be a single node, an array, or a wrapper
// with `@graph`) and collects every Product-typed node it contains.
function collectProducts(node: any, out: any[]): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) collectProducts(item, out);
    return;
  }
  if (typeof node !== 'object') return;
  if (Array.isArray(node['@graph'])) {
    for (const item of node['@graph']) collectProducts(item, out);
  }
  const t = node['@type'];
  const isProduct = t === 'Product' || (Array.isArray(t) && t.includes('Product'));
  if (isProduct) out.push(node);
}

function parsePriceFromOffers(offers: any): { value: number; currency: string } | null {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const offer of list) {
    if (!offer || typeof offer !== 'object') continue;
    // AggregateOffer carries lowPrice/highPrice; Offer carries price.
    const candidates = [offer.price, offer.lowPrice, offer.highPrice];
    for (const raw of candidates) {
      const value =
        typeof raw === 'number' ? raw : raw != null ? parseFloat(String(raw)) : NaN;
      if (!isNaN(value) && value > 0) {
        const currency =
          typeof offer.priceCurrency === 'string' ? offer.priceCurrency : 'USD';
        return { value, currency };
      }
    }
  }
  return null;
}

export function extractJsonLdPrice(
  html: string,
): { value: number; currency: string } | null {
  const re =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  const products: any[] = [];
  while ((m = re.exec(html)) !== null) {
    let parsed: any;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    collectProducts(parsed, products);
  }
  for (const product of products) {
    const price = parsePriceFromOffers(product.offers);
    if (price) return price;
  }
  return null;
}

export async function fetchAndStoreProductPrice(
  redis: Redis,
  basePostId: string,
  productUrl: string,
): Promise<ProductPrice | null> {
  let html: string;
  try {
    html = await fetchHtml(productUrl);
  } catch (e) {
    console.warn(
      `[product-prices] fetch failed for ${productUrl}: ${(e as Error).message}`,
    );
    return null;
  }
  const extracted = extractJsonLdPrice(html);
  if (!extracted) {
    console.warn(`[product-prices] no JSON-LD product price at ${productUrl}`);
    return null;
  }
  const record: ProductPrice = {
    value: extracted.value,
    currency: extracted.currency,
    productUrl,
    productDomain: domainOf(productUrl),
    fetchedAt: new Date().toISOString(),
  };
  await redis.hset(PRODUCT_PRICES_KEY, basePostId, JSON.stringify(record));
  return record;
}

export async function refreshAllProductPrices(
  redis: Redis,
): Promise<{ updated: number; errors: number; total: number }> {
  const all = await redis.hgetall(META_KEY);
  let updated = 0;
  let errors = 0;
  let total = 0;
  for (const [postId, raw] of Object.entries(all)) {
    let meta: WatchMeta;
    try {
      meta = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!meta.product_url) continue;
    total++;
    const result = await fetchAndStoreProductPrice(redis, postId, meta.product_url);
    if (result) {
      console.log(
        `  [ok]   ${postId} -> ${result.currency} ${result.value} from ${result.productDomain}`,
      );
      updated++;
    } else {
      errors++;
    }
  }
  return { updated, errors, total };
}

async function main() {
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  const args = process.argv.slice(2);
  const postArg = args.find((a) => a.startsWith('--post='))?.slice('--post='.length);

  if (postArg) {
    const raw = await redis.hget(META_KEY, postArg);
    if (!raw) {
      console.error(`No watch-meta for ${postArg}`);
      redis.disconnect();
      process.exit(1);
    }
    const meta = JSON.parse(raw) as WatchMeta;
    if (!meta.product_url) {
      console.error(`No product_url set on ${postArg}`);
      redis.disconnect();
      process.exit(1);
    }
    const result = await fetchAndStoreProductPrice(redis, postArg, meta.product_url);
    if (result) {
      console.log(
        `Updated ${postArg}: ${result.currency} ${result.value} from ${result.productDomain}`,
      );
    } else {
      console.error(`Failed to fetch price for ${postArg}`);
      redis.disconnect();
      process.exit(1);
    }
  } else {
    console.log('Refreshing all product prices...');
    const { updated, errors, total } = await refreshAllProductPrices(redis);
    console.log(`Done. ${updated}/${total} updated, ${errors} errors`);
    await redis.set(PRICES_LAST_REFRESH_KEY, String(Date.now()));
  }

  redis.disconnect();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
