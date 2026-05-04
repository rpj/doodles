#!/usr/bin/env ts-node
/**
 * One-shot migration: re-fetch every stored post from Bluesky's public
 * getRecord API and stamp the original `facets` array onto our Post
 * records. Brings legacy posts up to par with what the listener now stores
 * going forward (URLs no longer truncated, hashtags/mentions clickable).
 *
 * Usage:
 *   REDIS_URL=redis://localhost:6379 npx ts-node backfill-facets.ts [--dry-run] [--force]
 *
 * Flags:
 *   --dry-run   Print what would change, don't write to Redis.
 *   --force     Re-fetch every post even if a `facets` field is already set.
 *
 * Idempotent by default — re-running only fetches posts that don't yet have
 * a `facets` field. Throttled to ~1 req/sec against the public Bluesky API.
 */

import { Redis } from 'ioredis';
import { setTimeout as sleep } from 'timers/promises';

type FacetFeature =
  | { $type: 'app.bsky.richtext.facet#link'; uri: string }
  | { $type: 'app.bsky.richtext.facet#tag'; tag: string }
  | { $type: 'app.bsky.richtext.facet#mention'; did: string };

type Facet = {
  index: { byteStart: number; byteEnd: number };
  features: FacetFeature[];
};

type Post = {
  uri: string;
  authorHandle: string;
  authorDisplayName: string;
  text: string;
  imageUrls: string[];
  createdAt: string;
  postUrl: string;
  facets?: Facet[];
};

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const RATE_LIMIT_MS = 1000;
const BLUESKY_API = 'https://public.api.bsky.app/xrpc/com.atproto.repo.getRecord';

async function fetchRecord(did: string, postId: string): Promise<{ facets?: Facet[] } | null> {
  const url = `${BLUESKY_API}?repo=${encodeURIComponent(did)}&collection=app.bsky.feed.post&rkey=${encodeURIComponent(postId)}`;
  try {
    const res = await fetch(url);
    if (res.status === 404 || res.status === 400) return null; // post deleted or unknown
    if (!res.ok) {
      console.warn(`  fetch ${res.status}: ${url}`);
      return null;
    }
    const data: any = await res.json();
    return { facets: data?.value?.facets };
  } catch (e) {
    console.warn(`  fetch error: ${(e as Error).message}`);
    return null;
  }
}

function parseAtUri(uri: string): { did: string; postId: string } | null {
  const m = uri.match(/^at:\/\/(did:[^\/]+)\/app\.bsky\.feed\.post\/(.+)$/);
  if (!m) return null;
  return { did: m[1], postId: m[2] };
}

async function main() {
  console.log(`Backfill-facets ${DRY_RUN ? '(dry-run)' : ''} ${FORCE ? '(force)' : ''}`.trim());
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

  // ---------- Discover unique base posts via per-key entries ----------
  const postKeys = await redis.keys('post:at://*');
  console.log(`Found ${postKeys.length} per-key post entries`);

  const baseUriToVariants = new Map<string, string[]>();
  for (const key of postKeys) {
    const uri = key.replace(/^post:/, '');
    const baseUri = uri.split('#')[0];
    const list = baseUriToVariants.get(baseUri);
    if (list) list.push(uri);
    else baseUriToVariants.set(baseUri, [uri]);
  }
  console.log(`Grouped into ${baseUriToVariants.size} unique base posts`);

  // ---------- Discover JSON-bearing post lists (for second-pass list update) ----------
  const allListKeys = await redis.keys('*:posts');
  const jsonListKeys: string[] = [];
  for (const key of allListKeys) {
    if (key.startsWith('handle:')) continue; // these store URIs, not JSON
    const len = await redis.llen(key);
    if (len === 0) continue;
    const sample = await redis.lindex(key, 0);
    if (sample && sample.startsWith('{')) {
      jsonListKeys.push(key);
    }
  }
  console.log(`Found ${jsonListKeys.length} JSON post list(s): ${jsonListKeys.join(', ')}`);

  // ---------- For each unique base post, fetch facets ----------
  // facetCache value:
  //   Facet[] = facets array (possibly empty) confirmed by Bluesky
  //   null    = post deleted / fetch failed → leave alone
  const facetCache = new Map<string, Facet[] | null>();

  let fetched = 0;
  let skipped = 0;
  const baseUris = Array.from(baseUriToVariants.keys());
  for (let i = 0; i < baseUris.length; i++) {
    const baseUri = baseUris[i];
    const parsed = parseAtUri(baseUri);
    if (!parsed) {
      console.warn(`Could not parse: ${baseUri}`);
      continue;
    }

    if (!FORCE) {
      // Idempotency: if any variant already has `facets` field set, assume done
      const sampleVariant = baseUriToVariants.get(baseUri)![0];
      const sampleRaw = await redis.get(`post:${sampleVariant}`);
      if (sampleRaw) {
        try {
          const parsedPost = JSON.parse(sampleRaw) as Post;
          if ('facets' in parsedPost) {
            skipped++;
            continue;
          }
        } catch {
          // fall through and re-fetch
        }
      }
    }

    if (i > 0 || fetched > 0) await sleep(RATE_LIMIT_MS);
    const record = await fetchRecord(parsed.did, parsed.postId);
    if (record === null) {
      console.log(`[${i + 1}/${baseUris.length}] ${parsed.postId}: deleted/unfetchable, leaving alone`);
      continue;
    }
    fetched++;
    const facets = record.facets ?? [];
    facetCache.set(baseUri, facets);
    console.log(`[${i + 1}/${baseUris.length}] ${parsed.postId}: ${facets.length} facet(s)`);
  }
  console.log(`Fetched ${fetched}, skipped ${skipped} already-stamped`);

  // ---------- Apply facets to per-key entries ----------
  let perKeyUpdates = 0;
  for (const [baseUri, variants] of baseUriToVariants.entries()) {
    if (!facetCache.has(baseUri)) continue;
    const facets = facetCache.get(baseUri)!;
    for (const variant of variants) {
      const key = `post:${variant}`;
      const raw = await redis.get(key);
      if (!raw) continue;
      let post: Post;
      try {
        post = JSON.parse(raw);
      } catch {
        continue;
      }
      post.facets = facets;
      if (!DRY_RUN) {
        await redis.set(key, JSON.stringify(post));
      }
      perKeyUpdates++;
    }
  }
  console.log(`${DRY_RUN ? '[dry-run] would update' : 'Updated'} ${perKeyUpdates} per-key post:* entries`);

  // ---------- Apply facets to JSON list entries ----------
  for (const listKey of jsonListKeys) {
    const len = await redis.llen(listKey);
    let listUpdates = 0;
    for (let idx = 0; idx < len; idx++) {
      const raw = await redis.lindex(listKey, idx);
      if (!raw) continue;
      let post: Post;
      try {
        post = JSON.parse(raw);
      } catch {
        continue;
      }
      const baseUri = post.uri.split('#')[0];
      if (!facetCache.has(baseUri)) continue;
      const facets = facetCache.get(baseUri)!;
      post.facets = facets;
      if (!DRY_RUN) {
        await redis.lset(listKey, idx, JSON.stringify(post));
      }
      listUpdates++;
    }
    console.log(`${DRY_RUN ? '[dry-run]' : ''} ${listKey}: ${listUpdates} entries updated`);
  }

  redis.disconnect();
  console.log('Done.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
