#!/usr/bin/env ts-node
/**
 * Apply manual classification overrides and rebuild the canonical list.
 *
 * Override semantics:
 *   - Full override (JSON includes `kind`): replaces the entry in
 *     `__doodles:watch-meta` wholesale.
 *   - Partial override (no `kind`, just patchable fields like
 *     `search_query` / `product_url`): merged on top of the existing
 *     meta. Skipped with a warning if no meta exists yet for that post
 *     (classify the post first, then apply the partial override).
 *
 * 1. For every entry in `__doodles:watch-overrides`, write the merged
 *    result into `__doodles:watch-meta`. Same loop also refreshes
 *    `__doodles:product-prices` for any entry whose merged meta carries
 *    a `product_url`.
 * 2. Walk `all-doodles:posts` chronologically (oldest first) and rebuild
 *    `__doodles:watch-canonical` from scratch using the (now-overridden)
 *    meta. Any meta with kind=unique-watch + brand + model + no
 *    references_post_id contributes one canonical entry.
 *
 * No Claude calls. Run after setting / removing overrides.
 *
 * Usage:
 *   REDIS_URL=redis://localhost:6379 npx ts-node apply-overrides.ts [--dry-run]
 */

import { Redis } from 'ioredis';
import {
  CANONICAL_KEY,
  META_KEY,
  OVERRIDES_KEY,
  WatchMeta,
  CanonicalEntry,
  getBasePostId,
  partialOverrideFields,
  validateMeta,
} from './classify-post';
import { fetchAndStoreProductPrice } from './fetch-product-prices';

const DRY_RUN = process.argv.includes('--dry-run');

function parseMeta(raw: string): WatchMeta | null {
  try {
    return JSON.parse(raw) as WatchMeta;
  } catch {
    return null;
  }
}

async function loadExistingMeta(redis: Redis, postId: string): Promise<WatchMeta | null> {
  const raw = await redis.hget(META_KEY, postId);
  return raw ? parseMeta(raw) : null;
}

async function main() {
  console.log(`apply-overrides ${DRY_RUN ? '(dry-run)' : ''}`.trim());
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

  // ---- Step 1: apply overrides into meta, refresh prices inline ----
  const overrides = await redis.hgetall(OVERRIDES_KEY);
  const overrideIds = Object.keys(overrides);
  console.log(`Found ${overrideIds.length} override(s) in ${OVERRIDES_KEY}`);

  let applied = 0;
  let pricesFetched = 0;
  for (const [postId, raw] of Object.entries(overrides)) {
    let overrideObj: any;
    try {
      overrideObj = JSON.parse(raw);
    } catch {
      console.warn(`  [skip] ${postId}: malformed override JSON`);
      continue;
    }

    let merged: WatchMeta;
    let mode: 'replace' | 'merge';

    if (overrideObj && typeof overrideObj.kind === 'string') {
      // Full override — replace existing meta wholesale.
      const validated = validateMeta(overrideObj);
      if (!validated) {
        console.warn(`  [skip] ${postId}: override has kind but failed validation`);
        continue;
      }
      merged = validated;
      mode = 'replace';
    } else {
      // Partial override — merge patchable fields onto existing meta.
      const existing = await loadExistingMeta(redis, postId);
      if (!existing) {
        console.warn(`  [skip] ${postId}: partial override but no existing meta to patch — run \`classify-existing\` on this post first`);
        continue;
      }
      merged = { ...existing, ...partialOverrideFields(overrideObj) };
      mode = 'merge';
    }

    // Stamp classified_at so the operator can see when the override last touched the record.
    merged.classified_at = new Date().toISOString();

    if (!DRY_RUN) {
      await redis.hset(META_KEY, postId, JSON.stringify(merged));
    }
    applied++;
    const tag = merged.brand ? `${merged.brand} ${merged.model ?? ''}`.trim() : '—';
    const kindLabel = (merged.kind || '?').padEnd(13);
    console.log(`  [${DRY_RUN ? 'would ' : ''}${mode}]  ${postId} -> ${kindLabel} ${tag}${merged.references_post_id ? ' -> ' + merged.references_post_id : ''}`);

    // Immediate price fetch when product_url is set (whether from this
    // override or already present in the merged-in existing meta).
    if (!DRY_RUN && merged.product_url) {
      const result = await fetchAndStoreProductPrice(redis, postId, merged.product_url);
      if (result) {
        console.log(`  [price]   ${postId} -> ${result.currency} ${result.value} from ${result.productDomain}`);
        pricesFetched++;
      }
    }
  }

  // ---- Step 2: rebuild canonical list ----
  const total = await redis.llen('all-doodles:posts');
  const seen = new Set<string>();
  const newCanonical: CanonicalEntry[] = [];

  // List was LPUSH'd, so head is newest. Walk end -> start for chronological order.
  for (let i = total - 1; i >= 0; i--) {
    const raw = await redis.lindex('all-doodles:posts', i);
    if (!raw) continue;
    let post: any;
    try { post = JSON.parse(raw); } catch { continue; }
    const basePostId = getBasePostId(post.uri);
    if (!basePostId || seen.has(basePostId)) continue;
    seen.add(basePostId);

    const metaRaw = await redis.hget(META_KEY, basePostId);
    if (!metaRaw) continue;
    const meta = parseMeta(metaRaw);
    if (!meta) continue;

    if (
      meta.kind === 'unique-watch' &&
      meta.brand &&
      meta.model &&
      !meta.references_post_id
    ) {
      newCanonical.push({
        post_id: basePostId,
        brand: meta.brand,
        model: meta.model,
      });
    }
  }

  console.log(`Canonical rebuild: ${newCanonical.length} unique watch(es) (was ${await redis.llen(CANONICAL_KEY)})`);
  if (!DRY_RUN) {
    const pipe = redis.pipeline();
    pipe.del(CANONICAL_KEY);
    for (const entry of newCanonical) {
      pipe.rpush(CANONICAL_KEY, JSON.stringify(entry));
    }
    await pipe.exec();
  }

  console.log(`Done. ${DRY_RUN ? '(dry-run, no writes)' : `applied=${applied}, canonical=${newCanonical.length}, prices=${pricesFetched}`}`);
  redis.disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
