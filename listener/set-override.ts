#!/usr/bin/env ts-node
/**
 * Set a single override field on a single post and apply it immediately.
 * Saves a round of edit-JSON-by-hand + `apply-overrides` for the common
 * partial-override cases (search_query / product_url).
 *
 * Usage (note the `--` — npm forwards args after it to the script):
 *   npm run set-override -- <postId> <field> <value>
 *
 * Supported fields: search_query, product_url
 *
 * Examples:
 *   npm run set-override -- 3mkxumxswdk2j search_query "Brew Metric HP-1 PVD"
 *   npm run set-override -- 3mkxumxswdk2j product_url "https://brewwatches.com/products/metric-hp-1"
 *   npm run set-override -- 3mkxumxswdk2j product_url ""    # clear the field
 *
 * Behavior:
 *   1. Reads any existing override JSON, merges the new field on top, writes back.
 *      Empty value clears the field (writes null in the override JSON).
 *   2. Applies the merged override to __doodles:watch-meta. Partial overrides
 *      (no `kind`) merge onto existing meta; full overrides replace it.
 *      Canonical rebuild is intentionally skipped — partial overrides can't
 *      change kind/brand/model. If you set a full override via this CLI,
 *      run `npm run apply-overrides` separately to refresh canonical.
 *   3. If the resulting meta has product_url set, fetches the manufacturer
 *      price immediately. If product_url was cleared, drops the cached price.
 */

import { Redis } from 'ioredis';
import {
  OVERRIDES_KEY,
  META_KEY,
  WatchMeta,
  partialOverrideFields,
  validateMeta,
} from './classify-post';
import {
  fetchAndStoreProductPrice,
  PRODUCT_PRICES_KEY,
} from './fetch-product-prices';

const SUPPORTED_FIELDS = ['search_query', 'product_url', 'reddit_query'] as const;

function usage(extra?: string): never {
  if (extra) console.error(extra);
  console.error('Usage: npm run set-override -- <postId> <field> <value>');
  console.error(`Supported fields: ${SUPPORTED_FIELDS.join(', ')}`);
  console.error('Pass "" as the value to clear a field. Quote multi-word values.');
  process.exit(1);
}

async function main() {
  const [postId, field, ...valueArgs] = process.argv.slice(2);

  if (!postId || !field || valueArgs.length === 0) {
    usage();
  }
  if (!/^[a-z0-9]+$/.test(postId)) {
    usage(`Invalid postId "${postId}" — expected lowercase alphanumeric (e.g. 3mkxumxswdk2j)`);
  }
  if (!(SUPPORTED_FIELDS as readonly string[]).includes(field)) {
    usage(`Unsupported field "${field}".`);
  }

  // Re-join so unquoted multi-word values still work end-to-end.
  const value = valueArgs.join(' ').trim();
  const newValue: string | null = value.length > 0 ? value : null;

  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

  // ---- 1. Update the override JSON ----
  const existingRaw = await redis.hget(OVERRIDES_KEY, postId);
  let existingOverride: Record<string, any> = {};
  if (existingRaw) {
    try {
      existingOverride = JSON.parse(existingRaw);
    } catch {
      console.warn(`Existing override for ${postId} was malformed — overwriting.`);
    }
  }
  const updatedOverride = { ...existingOverride, [field]: newValue };
  await redis.hset(OVERRIDES_KEY, postId, JSON.stringify(updatedOverride));
  console.log(`Override updated: ${postId}.${field} = ${JSON.stringify(newValue)}`);

  // ---- 2. Apply the merged override to watch-meta ----
  let merged: WatchMeta;

  if (typeof updatedOverride.kind === 'string') {
    const validated = validateMeta(updatedOverride);
    if (!validated) {
      console.error('Override has `kind` but failed validation. Inspect the JSON; run apply-overrides for full diagnostics.');
      redis.disconnect();
      process.exit(1);
    }
    merged = validated;
    console.warn('Override carries `kind` (full replace). Canonical not rebuilt — run `npm run apply-overrides` if kind/brand/model/references_post_id changed.');
  } else {
    const existingMetaRaw = await redis.hget(META_KEY, postId);
    if (!existingMetaRaw) {
      console.error(`No existing watch-meta for ${postId}. Run \`npm run classify-existing\` (or HDEL the override) first.`);
      redis.disconnect();
      process.exit(1);
    }
    let existingMeta: WatchMeta;
    try {
      existingMeta = JSON.parse(existingMetaRaw);
    } catch {
      console.error(`watch-meta for ${postId} is malformed. Inspect manually.`);
      redis.disconnect();
      process.exit(1);
    }
    merged = { ...existingMeta, ...partialOverrideFields(updatedOverride) };
  }

  merged.classified_at = new Date().toISOString();
  await redis.hset(META_KEY, postId, JSON.stringify(merged));

  const tag = merged.brand ? `${merged.brand} ${merged.model ?? ''}`.trim() : '—';
  console.log(`Wrote ${META_KEY}: ${merged.kind} ${tag}`);
  if (merged.search_query) console.log(`  search_query: ${JSON.stringify(merged.search_query)}`);
  if (merged.product_url) console.log(`  product_url:  ${merged.product_url}`);

  // ---- 3. Product-price side effects ----
  if (merged.product_url) {
    console.log(`Fetching product price from ${merged.product_url}...`);
    const result = await fetchAndStoreProductPrice(redis, postId, merged.product_url);
    if (result) {
      console.log(`  [price] ${result.currency} ${result.value} from ${result.productDomain}`);
    }
  } else if (field === 'product_url' && newValue === null) {
    const removed = await redis.hdel(PRODUCT_PRICES_KEY, postId);
    if (removed) console.log(`Cleared product-price cache entry for ${postId}`);
  }

  redis.disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
