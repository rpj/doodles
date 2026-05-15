/**
 * Reddit search wrapper for the per-post "Recent Reddit posts" card.
 *
 * Primary backend: Arctic Shift (https://arctic-shift.photon-reddit.com)
 *   — newer archive with explicit X-RateLimit-Remaining /
 *     X-RateLimit-Reset headers (docs:
 *     github.com/ArthurHeitmann/arctic_shift/tree/master/api). Its
 *     `title` search REQUIRES pairing with a subreddit or author, so we
 *     fan out across the operator-configured list at
 *     __doodles:reddit-subreddits (see README "Reddit Card"). Picked
 *     primary because (a) its score values are kept current (PullPush
 *     freezes scores at index time, which makes a `sort_type=score`
 *     selection systematically prefer 2-3-year-old posts over recent
 *     ones), and (b) it serves more-recent indexed posts in general.
 *     We track its rate-limit headers and proactively skip a sub query
 *     when remaining drops below a small floor.
 *
 * Fallback backend: PullPush (https://api.pullpush.io) — Pushshift-
 *   derived; supports site-wide title search via `q` (no subreddit
 *   constraint needed). Slower and its scores lag, but it's a solid
 *   safety net when Arctic Shift is down or rate-limit-exhausted.
 *
 * Posts only (`kind=post`), not comments — comments are noisier and the
 * widget shows titles for scannability.
 *
 * `searchPosts(query)` is the only exported entry point. It throws when
 * BOTH backends fail; the caller (the /api/reddit route) treats that as
 * "card unavailable" and the component renders nothing.
 */

import { Redis } from 'ioredis';

const ARCTIC_BASE = 'https://arctic-shift.photon-reddit.com/api';
const PULLPUSH_BASE = 'https://api.pullpush.io/reddit/search';
const USER_AGENT =
  'ryanswatches-reddit-card/1.0 (+https://ryanswatches.com)';

// Operator-configurable list of subreddits to query when Arctic Shift is
// the active backend. See README "Reddit Card" section.
const REDDIT_SUBREDDITS_KEY = '__doodles:reddit-subreddits';
const DEFAULT_FALLBACK_SUBREDDITS = [
  'Watches',
  'MicrobrandWatches',
  'VintageWatches',
  'JapaneseWatches',
];

const FETCH_LIMIT = 25;   // pull a bit of headroom; we filter + cap to 3 for display
const RETURN_LIMIT = 3;
const MIN_SCORE = 1;      // drop downvoted-into-the-ground posts
const FETCH_TIMEOUT_MS = 15_000;

// When Arctic Shift returns < this many remaining tokens AND the reset is
// still in the future, skip it and go straight to PullPush. Buys us a
// cushion against parallel requests racing past the cliff. Tuned for the
// modest traffic this site sees (cache misses for ~40 watches, not bursts).
const ARCTIC_RATE_LIMIT_FLOOR = 3;

export interface RedditPost {
  id: string;
  subreddit: string;
  author: string;
  title: string;
  permalink: string;       // absolute https://reddit.com/... URL
  score: number;
  numComments: number;
  createdAt: string;       // ISO 8601 string, '' if upstream lacked timestamp
}

export interface RedditSearchResult {
  query: string;
  backend: 'arctic' | 'pullpush';
  posts: RedditPost[];
  fetchedAt: string;
}

interface RawPost {
  id?: string;
  subreddit?: string;
  author?: string;
  title?: string;
  permalink?: string;
  score?: number;
  num_comments?: number;
  created_utc?: number | string;
}

// ---- Rate-limit tracking (Arctic Shift) ----
//
// Module-scope state survives across requests within one Node process.
// Two instances behind a load balancer would each have their own view —
// fine for a personal site, but worth noting before scaling.
let arcticRateLimit = {
  remaining: Number.POSITIVE_INFINITY, // unknown until first response
  resetEpochSec: 0,                    // 0 = no known reset window
};

function shouldSkipArctic(): boolean {
  const nowSec = Math.floor(Date.now() / 1000);
  // Reset time has passed → window rolled over, treat as fresh.
  if (arcticRateLimit.resetEpochSec <= nowSec) return false;
  return arcticRateLimit.remaining <= ARCTIC_RATE_LIMIT_FLOOR;
}

function recordRateLimitHeaders(res: Response): void {
  const remaining = res.headers.get('x-ratelimit-remaining');
  const reset = res.headers.get('x-ratelimit-reset');
  if (remaining !== null) {
    const r = Number(remaining);
    if (!isNaN(r)) arcticRateLimit.remaining = r;
  }
  if (reset !== null) {
    const t = Number(reset);
    // Some APIs return reset as seconds-until-reset rather than epoch.
    // Heuristic: small values (< 10 years from now) treated as epoch;
    // very-small values (< 1 day) assumed to be a seconds-from-now hint.
    if (!isNaN(t)) {
      if (t > 0 && t < 86400) {
        // looks like a delta
        arcticRateLimit.resetEpochSec = Math.floor(Date.now() / 1000) + t;
      } else {
        arcticRateLimit.resetEpochSec = t;
      }
    }
  }
}

// Exposed for diagnostics / logging.
export function getArcticRateLimitState() {
  return { ...arcticRateLimit };
}

// ---- HTTP layer ----

async function fetchWithTimeout(url: URL): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// Local Redis client for reading the operator-configured subreddit list.
// Module-scope so we don't open a new connection per request.
let redisClient: Redis | null = null;
function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  }
  return redisClient;
}

/**
 * Read the configured Arctic Shift fallback subreddit list from
 * `__doodles:reddit-subreddits` (Redis list, oldest first). Strips
 * optional `r/` prefixes and blank entries. Falls back to a hardcoded
 * default if the key is empty or Redis is unreachable, so the card
 * still works on a fresh install.
 */
async function loadFallbackSubreddits(): Promise<string[]> {
  try {
    const items = await getRedis().lrange(REDDIT_SUBREDDITS_KEY, 0, -1);
    const cleaned = items
      .map((s) => s.trim().replace(/^r\//i, ''))
      .filter((s) => s.length > 0);
    if (cleaned.length > 0) return cleaned;
  } catch (e) {
    console.warn(`[reddit] subreddit-list Redis read failed: ${(e as Error).message}`);
  }
  return DEFAULT_FALLBACK_SUBREDDITS;
}

async function fetchArcticOneSub(query: string, subreddit: string): Promise<RawPost[]> {
  if (shouldSkipArctic()) {
    throw new Error(
      `Arctic Shift skipped: ${arcticRateLimit.remaining} tokens left, ` +
      `resets in ${Math.max(0, arcticRateLimit.resetEpochSec - Math.floor(Date.now() / 1000))}s`,
    );
  }
  const url = new URL(`${ARCTIC_BASE}/posts/search`);
  url.searchParams.set('title', query);
  url.searchParams.set('subreddit', subreddit);
  url.searchParams.set('limit', String(FETCH_LIMIT));
  url.searchParams.set('sort', 'desc');

  const res = await fetchWithTimeout(url);
  recordRateLimitHeaders(res);

  if (res.status === 429) {
    // Tripped the limit despite our floor — clamp local state shut so the
    // next caller falls back immediately, then propagate.
    if (arcticRateLimit.resetEpochSec === 0) {
      // No reset header — be generous and assume a 60s cooldown.
      arcticRateLimit.resetEpochSec = Math.floor(Date.now() / 1000) + 60;
    }
    arcticRateLimit.remaining = 0;
    const waitSec = arcticRateLimit.resetEpochSec - Math.floor(Date.now() / 1000);
    throw new Error(`Arctic Shift 429 (rate-limited); reset in ${waitSec}s`);
  }
  if (!res.ok) {
    throw new Error(`Arctic Shift HTTP ${res.status}`);
  }
  const payload = await res.json();
  return Array.isArray(payload?.data) ? payload.data : [];
}

/**
 * Query Arctic Shift across every operator-configured subreddit, then
 * merge + dedupe by post ID. Stops early if the rate-limit floor trips
 * mid-iteration. Throws if every subreddit call failed; an empty merged
 * result with at least one successful call is treated as "backend OK,
 * just no posts" so the caller doesn't fall back further.
 */
async function fetchArctic(query: string): Promise<RawPost[]> {
  const subs = await loadFallbackSubreddits();
  const merged: RawPost[] = [];
  const seenIds = new Set<string>();
  const errors: string[] = [];
  let anySucceeded = false;

  for (const sub of subs) {
    if (shouldSkipArctic()) {
      errors.push(`r/${sub}: rate-limit floor hit, stopping iteration`);
      break;
    }
    try {
      const posts = await fetchArcticOneSub(query, sub);
      anySucceeded = true;
      for (const p of posts) {
        if (p.id && !seenIds.has(p.id)) {
          seenIds.add(p.id);
          merged.push(p);
        }
      }
    } catch (e) {
      errors.push(`r/${sub}: ${(e as Error).message}`);
    }
  }

  if (!anySucceeded) {
    throw new Error(
      `Arctic Shift: all ${subs.length} subreddit queries failed (${errors.join('; ')})`,
    );
  }
  return merged;
}

async function fetchPullPush(query: string): Promise<RawPost[]> {
  const url = new URL(`${PULLPUSH_BASE}/submission/`);
  url.searchParams.set('q', query);
  url.searchParams.set('size', String(FETCH_LIMIT));
  // sort_type=score gives us the top-rated posts directly instead of just
  // the newest (which for a niche query tends to be a single poster's
  // burst of dupes). We still sort our own slice by score below.
  url.searchParams.set('sort_type', 'score');
  url.searchParams.set('sort', 'desc');

  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`PullPush HTTP ${res.status}`);
  }
  const payload = await res.json();
  return Array.isArray(payload?.data) ? payload.data : [];
}

// ---- Normalization + filtering ----

function absolutePermalink(p: string | undefined): string {
  if (!p) return '';
  if (p.startsWith('http')) return p;
  if (p.startsWith('/')) return `https://www.reddit.com${p}`;
  return `https://www.reddit.com/${p}`;
}

function normalize(raw: RawPost[]): RedditPost[] {
  const out: RedditPost[] = [];
  for (const r of raw) {
    if (typeof r.title !== 'string' || typeof r.permalink !== 'string') continue;
    const createdNum =
      typeof r.created_utc === 'string' ? Number(r.created_utc) : r.created_utc;
    out.push({
      id: r.id ?? '',
      subreddit: r.subreddit ?? '',
      author: r.author ?? '',
      title: r.title,
      permalink: absolutePermalink(r.permalink),
      score: typeof r.score === 'number' ? r.score : 0,
      numComments: typeof r.num_comments === 'number' ? r.num_comments : 0,
      createdAt:
        typeof createdNum === 'number' && createdNum > 0
          ? new Date(createdNum * 1000).toISOString()
          : '',
    });
  }
  return out;
}

function filterAndRank(posts: RedditPost[], query: string): RedditPost[] {
  // Tokenize the query for the relevance check below. Words shorter than 2
  // chars are dropped (eBay-style "5" tokens etc. — meaningless on Reddit).
  const queryWords = query
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/^["+\-()]+|["+\-()]+$/g, '')) // strip eBay-style modifiers if reused
    .filter((w) => w.length > 1);

  const filtered = posts
    .filter((p) => p.author && p.author !== '[deleted]' && p.author !== '[removed]')
    .filter((p) => p.score >= MIN_SCORE)
    .filter((p) => {
      if (queryWords.length === 0) return true;
      const titleLower = p.title.toLowerCase();
      // Require at least one query word in the title — drops Arctic's
      // looser "any-of" matches that surface noise.
      return queryWords.some((w) => titleLower.includes(w));
    });

  // Two-stage ordering: pick the top RETURN_LIMIT by *score* (so the card
  // surfaces high-signal posts, not whichever bot dropped a [WTS] yesterday),
  // then re-sort that small slice by *date* desc so the card reads
  // most-recent-first to the viewer.
  return filtered
    .sort((a, b) => b.score - a.score)
    .slice(0, RETURN_LIMIT)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

// ---- Public entry point ----

export async function searchPosts(query: string): Promise<RedditSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error('Reddit search: empty query');
  }

  let raw: RawPost[];
  let backend: 'arctic' | 'pullpush';
  let arcticErr: Error | null = null;

  try {
    raw = await fetchArctic(trimmed);
    backend = 'arctic';
  } catch (e) {
    arcticErr = e as Error;
    console.warn(`[reddit] Arctic Shift failed (${arcticErr.message}); falling back to PullPush (site-wide)`);
    try {
      raw = await fetchPullPush(trimmed);
      backend = 'pullpush';
    } catch (e2) {
      throw new Error(
        `Both Reddit backends failed (arctic: ${arcticErr.message}; pullpush: ${(e2 as Error).message})`,
      );
    }
  }

  const posts = filterAndRank(normalize(raw), trimmed);

  return {
    query: trimmed,
    backend,
    posts,
    fetchedAt: new Date().toISOString(),
  };
}
