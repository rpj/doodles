#!/usr/bin/env ts-node
/**
 * One-shot: walk every base post in `all-doodles:posts` chronologically
 * (oldest first) and run the watch classifier on each. The chronological
 * order is what makes follow-on detection work — the classifier sees the
 * canonical list as it grew historically, so post N+1 can be matched
 * against canonicals from post N's classification.
 *
 * Usage:
 *   REDIS_URL=redis://localhost:6379 npx ts-node classify-existing.ts [--dry-run] [--force]
 *
 * Flags:
 *   --dry-run   List what would be classified, don't call Claude or write.
 *   --force     Re-classify posts that already have a watch-meta entry.
 *
 * Idempotent by default: only classifies posts missing from
 * `__doodles:watch-meta`. Manual overrides at `__doodles:watch-overrides`
 * are honored regardless of --force.
 */

import { Redis } from 'ioredis';
import {
  classifyAndRecord,
  getBasePostId,
  META_KEY,
  CANONICAL_KEY,
} from './classify-post';

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

async function main() {
  console.log(`classify-existing ${DRY_RUN ? '(dry-run)' : ''} ${FORCE ? '(force)' : ''}`.trim());
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

  // --force re-classifies every post from scratch. The canonical list must
  // be cleared first or stale entries (including each post's own canonical
  // from the prior run) leak into the new prompt context, causing posts to
  // match themselves as follow-ons.
  if (FORCE && !DRY_RUN) {
    const cleared = await redis.del('__doodles:watch-canonical');
    if (cleared) console.log('Cleared __doodles:watch-canonical (force mode)');
  }

  const total = await redis.llen('all-doodles:posts');
  console.log(`Walking ${total} entries from all-doodles:posts (oldest first)`);

  // The list is LPUSH'd, so head=newest. Iterate end to start for chronological.
  const seenBase = new Set<string>();
  let classified = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = total - 1; i >= 0; i--) {
    const raw = await redis.lindex('all-doodles:posts', i);
    if (!raw) continue;
    let post: any;
    try {
      post = JSON.parse(raw);
    } catch {
      continue;
    }

    const basePostId = getBasePostId(post.uri);
    if (!basePostId || seenBase.has(basePostId)) continue;
    seenBase.add(basePostId);

    if (!FORCE) {
      const existing = await redis.hexists(META_KEY, basePostId);
      if (existing) {
        skipped++;
        continue;
      }
    }

    if (DRY_RUN) {
      console.log(`[would classify] ${basePostId}: "${(post.text || '').slice(0, 80).replace(/\s+/g, ' ')}"`);
      continue;
    }

    process.stdout.write(`[${seenBase.size}] ${basePostId}: `);
    const meta = await classifyAndRecord(redis, {
      basePostId,
      text: post.text || '',
      facets: post.facets,
    });
    if (!meta) {
      console.log('FAILED');
      failed++;
      continue;
    }
    classified++;
    const tag = meta.brand ? `${meta.brand} ${meta.model ?? ''}`.trim() : '—';
    console.log(`${meta.kind.padEnd(13)} ${tag}${meta.references_post_id ? ` -> ${meta.references_post_id}` : ''} (conf ${meta.confidence.toFixed(2)})`);
  }

  console.log('');
  console.log(`Done. classified=${classified}, skipped=${skipped}, failed=${failed}`);
  const canonicalCount = await redis.llen(CANONICAL_KEY);
  console.log(`Canonical list size: ${canonicalCount}`);

  redis.disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
