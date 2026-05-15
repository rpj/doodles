/**
 * GET /api/reddit?postId=<basePostId>
 *
 * Returns up to 3 recent Reddit posts mentioning the watch in the title.
 * Looks up the post's WatchMeta to choose a query: `reddit_query` override
 * if set, else `${brand} ${model}`. Hits Arctic Shift first (with rate-
 * limit aware fallback to PullPush) and caches the result in Redis for
 * 24h to keep upstream traffic light — even at modest traffic, this means
 * one outbound call per (query, day).
 *
 * Fail-soft: any error returns 502. The frontend Reddit component just
 * doesn't render when the API doesn't succeed.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Redis } from 'ioredis';
import { searchPosts, RedditSearchResult } from '../../lib/reddit';
import { rateLimit, cors, runMiddleware } from '../../lib/api-middleware';
import { WatchMeta } from '../../lib/redis';

const WATCH_META_KEY = '__doodles:watch-meta';
const CACHE_KEY_PREFIX = '__doodles:reddit-search:';
const CACHE_TTL_SECONDS = 24 * 60 * 60;

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
  res: NextApiResponse<RedditSearchResult | { error: string }>,
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

  // Resolve query: reddit_query override > brand+model.
  let meta: WatchMeta | null = null;
  try {
    const raw = await r.hget(WATCH_META_KEY, postId);
    if (raw) meta = JSON.parse(raw) as WatchMeta;
  } catch (e) {
    console.warn('reddit: watch-meta read failed:', (e as Error).message);
  }
  if (!meta || !meta.brand || !meta.model) {
    return res.status(404).json({ error: 'no watch-meta for postId' });
  }

  const query = (meta.reddit_query?.trim() || `${meta.brand} ${meta.model}`.trim());
  const cacheKey = CACHE_KEY_PREFIX + slugify(query);

  // ---- Cache lookup ----
  try {
    const cached = await r.get(cacheKey);
    if (cached) {
      try {
        const data = JSON.parse(cached) as RedditSearchResult;
        res.setHeader('X-Cache', 'HIT');
        return res.status(200).json(data);
      } catch {
        // bad JSON in cache — fall through and re-fetch.
      }
    }
  } catch (e) {
    console.warn('reddit: cache read failed:', (e as Error).message);
  }

  // ---- Upstream fetch ----
  let result: RedditSearchResult;
  try {
    result = await searchPosts(query);
  } catch (e) {
    console.error('reddit fetch failed:', (e as Error).message);
    return res.status(502).json({ error: 'reddit unavailable' });
  }

  try {
    await r.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL_SECONDS);
  } catch (e) {
    console.warn('reddit: cache write failed:', (e as Error).message);
  }

  res.setHeader('X-Cache', 'MISS');
  return res.status(200).json(result);
}
