#!/usr/bin/env ts-node
/**
 * Print a quick summary of the watch classifier's output: total unique
 * watches, breakdown by brand, and any low-confidence / unclassified posts
 * worth reviewing. Read-only against Redis.
 *
 * Usage:
 *   REDIS_URL=redis://localhost:6379 npx ts-node watch-stats.ts [--low-confidence] [--list-other]
 *
 * Flags:
 *   --low-confidence   List entries with confidence < 0.6 so you can spot-check
 *                      and write manual overrides if needed.
 *   --list-other       List entries classified as "other" with their text
 *                      previews — sometimes worth reviewing.
 */

import { Redis } from 'ioredis';
import { META_KEY, CANONICAL_KEY, WatchMeta } from './classify-post';

const SHOW_LOW_CONF = process.argv.includes('--low-confidence');
const SHOW_OTHER = process.argv.includes('--list-other');

async function main() {
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

  const all = await redis.hgetall(META_KEY);
  const entries = Object.entries(all)
    .map(([id, raw]) => {
      try {
        return [id, JSON.parse(raw) as WatchMeta] as const;
      } catch {
        return null;
      }
    })
    .filter((x): x is readonly [string, WatchMeta] => x !== null);

  const byKind = new Map<string, number>();
  for (const [, meta] of entries) {
    byKind.set(meta.kind, (byKind.get(meta.kind) ?? 0) + 1);
  }

  const canonical = await redis.lrange(CANONICAL_KEY, 0, -1);
  const totalUnique = canonical.length;

  const brandCounts = new Map<string, number>();
  for (const raw of canonical) {
    try {
      const c = JSON.parse(raw) as { brand: string };
      brandCounts.set(c.brand, (brandCounts.get(c.brand) ?? 0) + 1);
    } catch {}
  }

  console.log(`Posts classified: ${entries.length}`);
  console.log('Kind breakdown:');
  for (const [k, n] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(13)} ${n}`);
  }
  console.log('');
  console.log(`Unique watches (canonical): ${totalUnique}`);
  console.log('By brand:');
  for (const [brand, n] of [...brandCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${brand.padEnd(20)} ${n}`);
  }

  if (SHOW_LOW_CONF) {
    console.log('');
    console.log('Low-confidence entries (< 0.6):');
    for (const [id, meta] of entries) {
      if (meta.confidence < 0.6) {
        console.log(`  ${id}  conf=${meta.confidence.toFixed(2)}  ${meta.kind}  ${meta.brand ?? ''} ${meta.model ?? ''}`.replace(/\s+/g, ' '));
      }
    }
  }

  if (SHOW_OTHER) {
    console.log('');
    console.log('Posts classified as "other":');
    for (const [id, meta] of entries) {
      if (meta.kind === 'other') {
        console.log(`  ${id}  conf=${meta.confidence.toFixed(2)}`);
      }
    }
  }

  redis.disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
