/**
 * GET /api/pricing?postId=<basePostId>
 *
 * Returns the pricing summary the per-post widget renders. Looks up the
 * post's WatchMeta and merges two data sources:
 *
 *   1. eBay Browse API search for recent listings (count + min/max range
 *      + sample). Cached 24h in Redis to stay well under the 5,000/day
 *      free-tier limit. Uses `watchMeta.search_query` when set, else
 *      falls back to `${brand} ${model}`.
 *
 *   2. Manufacturer product price scraped by the listener from
 *      `watchMeta.product_url` (JSON-LD `Product.offers.price`). Stored
 *      in __doodles:product-prices and refreshed on a cadence.
 *
 * Either source may be empty. The component renders nothing when both
 * are missing, so the API returns a 200 with empty fields rather than
 * 502 unless *both* fail and there is no cached prior data.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Redis } from 'ioredis';
import { searchListings, EbayPricingResult } from '../../lib/ebay';
import { rateLimit, cors, runMiddleware } from '../../lib/api-middleware';
import { WatchMeta } from '../../lib/redis';

const WATCH_META_KEY = '__doodles:watch-meta';
const PRODUCT_PRICES_KEY = '__doodles:product-prices';
const CACHE_KEY_PREFIX = '__doodles:ebay-pricing:';
const CACHE_TTL_SECONDS = 24 * 60 * 60;

interface ProductPrice {
  value: number;
  currency: string;
  productUrl: string;
  productDomain: string;
  fetchedAt: string;
}

export interface PricingResponse extends EbayPricingResult {
  productPrice: ProductPrice | null;
}

let redis: Redis | null = null;
function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  }
  return redis;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function emptyEbayResult(query: string): EbayPricingResult {
  // Synthetic "no listings" payload used when the eBay fetch fails but a
  // product price is available — lets the widget render the product half
  // without blocking on eBay being up.
  return {
    count: 0,
    minPrice: null,
    maxPrice: null,
    currency: 'USD',
    samples: [],
    searchUrl:
      'https://www.ebay.com/sch/i.html?_nkw=' +
      encodeURIComponent(query) +
      '&_sacat=14324',
    env: process.env.EBAY_ENV === 'production' ? 'production' : 'sandbox',
    query,
    fetchedAt: new Date().toISOString(),
  };
}

const rateLimiter = rateLimit({
  windowMs: 60 * 1000,
  maxRequests: 100,
});

const corsMiddleware = cors({
  origin:
    process.env.NODE_ENV === 'production'
      ? ['https://ryanswatches.com', 'https://dev.ryanswatches.com']
      : true,
  methods: ['GET', 'OPTIONS'],
  credentials: true,
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PricingResponse | { error: string }>
) {
  await runMiddleware(req, res, corsMiddleware);
  await runMiddleware(req, res, rateLimiter);

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const postId = (req.query.postId as string | undefined)?.trim();
  if (!postId) {
    return res.status(400).json({ error: 'postId required' });
  }
  if (!/^[a-z0-9]+$/i.test(postId) || postId.length > 64) {
    return res.status(400).json({ error: 'invalid postId' });
  }

  const r = getRedis();

  // Load watch-meta. No meta = nothing to price against.
  let meta: WatchMeta | null = null;
  try {
    const raw = await r.hget(WATCH_META_KEY, postId);
    if (raw) meta = JSON.parse(raw) as WatchMeta;
  } catch (e) {
    console.warn('pricing: watch-meta read failed:', (e as Error).message);
  }
  if (!meta || !meta.brand || !meta.model) {
    return res.status(404).json({ error: 'no watch-meta for postId' });
  }

  const effectiveQuery = (meta.search_query?.trim() || `${meta.brand} ${meta.model}`.trim());
  const cacheKey = CACHE_KEY_PREFIX + slugify(effectiveQuery);

  // ---- Product price (already cached server-side by the listener) ----
  let productPrice: ProductPrice | null = null;
  try {
    const raw = await r.hget(PRODUCT_PRICES_KEY, postId);
    if (raw) productPrice = JSON.parse(raw) as ProductPrice;
  } catch (e) {
    console.warn('pricing: product-price read failed:', (e as Error).message);
  }

  // ---- eBay (24h Redis-cached) ----
  let ebay: EbayPricingResult | null = null;
  let cacheStatus = 'MISS';
  try {
    const cached = await r.get(cacheKey);
    if (cached) {
      try {
        ebay = JSON.parse(cached) as EbayPricingResult;
        cacheStatus = 'HIT';
      } catch {
        // Bad JSON in cache — fall through and re-fetch.
      }
    }
  } catch (e) {
    console.warn('pricing: cache read failed:', (e as Error).message);
  }

  if (!ebay) {
    try {
      ebay = await searchListings(meta.brand, meta.model, effectiveQuery);
      try {
        await r.set(cacheKey, JSON.stringify(ebay), 'EX', CACHE_TTL_SECONDS);
      } catch (e) {
        console.warn('pricing: cache write failed:', (e as Error).message);
      }
    } catch (e) {
      console.warn('pricing: eBay fetch failed:', (e as Error).message);
    }
  }

  // If both sources are empty, the widget would render nothing anyway —
  // signal upstream failure so the component shows nothing.
  if (!ebay && !productPrice) {
    return res.status(502).json({ error: 'pricing unavailable' });
  }

  res.setHeader('X-Cache', cacheStatus);
  return res.status(200).json({
    ...(ebay ?? emptyEbayResult(effectiveQuery)),
    productPrice,
  });
}
