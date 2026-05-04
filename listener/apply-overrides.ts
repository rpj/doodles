#!/usr/bin/env ts-node
/**
 * Apply manual classification overrides and rebuild the canonical list.
 *
 * 1. For every entry in `__doodles:watch-overrides`, copy the JSON into
 *    `__doodles:watch-meta` (overwriting the classifier's prior output).
 * 2. Walk `all-doodles:posts` chronologically (oldest first) and rebuild
 *    `__doodles:watch-canonical` from scratch using the (now-overridden)
 *    meta. Any meta with kind=unique-watch + brand + model + no
 *    references_post_id contributes one canonical entry.
 *
 * No Claude calls, no token cost. Run after setting / removing overrides.
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
} from './classify-post';

const DRY_RUN = process.argv.includes('--dry-run');

function parseMeta(raw: string): WatchMeta | null {
  try {
    return JSON.parse(raw) as WatchMeta;
  } catch {
    return null;
  }
}

async function main() {
  console.log(`apply-overrides ${DRY_RUN ? '(dry-run)' : ''}`.trim());
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

  // ---- Step 1: copy overrides into meta ----
  const overrides = await redis.hgetall(OVERRIDES_KEY);
  const overrideIds = Object.keys(overrides);
  console.log(`Found ${overrideIds.length} override(s) in ${OVERRIDES_KEY}`);

  let applied = 0;
  for (const [postId, raw] of Object.entries(overrides)) {
    const meta = parseMeta(raw);
    if (!meta) {
      console.warn(`  [skip] ${postId}: malformed override JSON`);
      continue;
    }
    // Stamp a fresh classified_at so it's clear when overrides were applied
    meta.classified_at = new Date().toISOString();
    if (!DRY_RUN) {
      await redis.hset(META_KEY, postId, JSON.stringify(meta));
    }
    applied++;
    const tag = meta.brand ? `${meta.brand} ${meta.model ?? ''}`.trim() : '—';
    console.log(`  [${DRY_RUN ? 'would apply' : 'applied'}] ${postId} -> ${meta.kind.padEnd(13)} ${tag}${meta.references_post_id ? ' -> ' + meta.references_post_id : ''}`);
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

  console.log(`Done. ${DRY_RUN ? '(dry-run, no writes)' : `applied=${applied}, canonical=${newCanonical.length}`}`);
  redis.disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
