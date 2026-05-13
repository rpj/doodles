/**
 * GET /api/pricing?brand=Seiko&model=Yuto%20Horigome
 *
 * Returns recent-listings summary for a (brand, model) pair via the
 * eBay Browse API. Results cached in Redis under
 * `__doodles:ebay-pricing:<slug>` for 24h to keep us well under eBay's
 * 5,000-call/day free-tier limit even at modest gallery traffic.
 *
 * Fails soft — any upstream error returns 502 + a small error body. The
 * frontend Pricing component just doesn't render in that case.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Redis } from 'ioredis';
import { searchListings, EbayPricingResult } from '../../lib/ebay';
import { rateLimit, cors, runMiddleware } from '../../lib/api-middleware';

const CACHE_KEY_PREFIX = '__doodles:ebay-pricing:';
const CACHE_TTL_SECONDS = 24 * 60 * 60;

let redis: Redis | null = null;
function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  }
  return redis;
}

function cacheKey(brand: string, model: string): string {
  const slug = `${brand} ${model}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return CACHE_KEY_PREFIX + slug;
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
  res: NextApiResponse<EbayPricingResult | { error: string }>
) {
  await runMiddleware(req, res, corsMiddleware);
  await runMiddleware(req, res, rateLimiter);

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const brand = (req.query.brand as string | undefined)?.trim();
  const model = (req.query.model as string | undefined)?.trim();

  if (!brand || !model) {
    return res.status(400).json({ error: 'brand and model required' });
  }
  if (brand.length > 64 || model.length > 128) {
    return res.status(400).json({ error: 'brand/model too long' });
  }
  // Light sanitization — eBay accepts most punctuation but we reject
  // control characters and angle brackets defensively.
  if (/[\x00-\x1f<>]/.test(brand + model)) {
    return res.status(400).json({ error: 'invalid characters' });
  }

  const r = getRedis();
  const key = cacheKey(brand, model);

  try {
    const cached = await r.get(key);
    if (cached) {
      try {
        const data = JSON.parse(cached) as EbayPricingResult;
        res.setHeader('X-Cache', 'HIT');
        return res.status(200).json(data);
      } catch {
        // Bad JSON in cache — fall through and re-fetch.
      }
    }
  } catch (e) {
    console.warn('pricing cache read failed:', (e as Error).message);
  }

  try {
    const result = await searchListings(brand, model);
    try {
      await r.set(key, JSON.stringify(result), 'EX', CACHE_TTL_SECONDS);
    } catch (e) {
      console.warn('pricing cache write failed:', (e as Error).message);
    }
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(result);
  } catch (e) {
    console.error('pricing fetch failed:', (e as Error).message);
    return res.status(502).json({ error: 'pricing unavailable' });
  }
}
