/**
 * Watch-classifier wrapper. Reads the colocated SKILL.md instructions, calls
 * `claude -p` non-interactively to extract brand/model/kind for a post, and
 * persists results in Redis.
 *
 * Storage layout:
 *   __doodles:watch-meta        Hash:  basePostId -> WatchMeta JSON
 *   __doodles:watch-canonical   List:  CanonicalEntry JSON, oldest first
 *   __doodles:watch-overrides   Hash:  basePostId -> WatchMeta JSON (manual overrides)
 *
 * Failure mode is fail-soft: any classification failure (claude not on PATH,
 * timeout, malformed JSON, etc.) logs a warning and returns null. The listener
 * keeps storing posts either way.
 */

import { Redis } from 'ioredis';
import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import * as path from 'path';

type FacetFeature =
  | { $type: 'app.bsky.richtext.facet#link'; uri: string }
  | { $type: 'app.bsky.richtext.facet#tag'; tag: string }
  | { $type: 'app.bsky.richtext.facet#mention'; did: string };

type Facet = {
  index: { byteStart: number; byteEnd: number };
  features: FacetFeature[];
};

export type WatchKind = 'unique-watch' | 'follow-on' | 'family' | 'event' | 'other';

export interface WatchMeta {
  kind: WatchKind;
  brand: string | null;
  model: string | null;
  references_post_id: string | null;
  confidence: number;
  classified_at: string;
  // Optional overrides set via __doodles:watch-overrides. Both are
  // non-destructive — pre-existing records without these fields are valid.
  //   search_query: replaces `${brand} ${model}` as the eBay search query
  //     for the pricing widget. Lets you correct imprecise model names
  //     without touching classifier output.
  //   product_url: manufacturer's product page URL. The listener
  //     periodically fetches the page and extracts JSON-LD
  //     Product.offers.price into __doodles:product-prices.
  search_query?: string | null;
  product_url?: string | null;
}

export interface CanonicalEntry {
  post_id: string;
  brand: string;
  model: string;
}

export interface ClassifyInput {
  basePostId: string;
  text: string;
  facets?: Facet[];
}

export const META_KEY = '__doodles:watch-meta';
export const CANONICAL_KEY = '__doodles:watch-canonical';
export const OVERRIDES_KEY = '__doodles:watch-overrides';

const DEFAULT_MODEL = 'sonnet';
const DEFAULT_TIMEOUT_MS = 60_000;
const VALID_KINDS: ReadonlySet<WatchKind> = new Set([
  'unique-watch',
  'follow-on',
  'family',
  'event',
  'other',
]);

const SKILL_PATH = path.join(__dirname, 'watch-classifier', 'SKILL.md');
let cachedSkillBody: string | null = null;

async function loadSkillBody(): Promise<string> {
  if (cachedSkillBody) return cachedSkillBody;
  const raw = await readFile(SKILL_PATH, 'utf-8');
  // Strip YAML frontmatter (--- ... --- at the top)
  const m = raw.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
  cachedSkillBody = (m ? m[1] : raw).trim();
  return cachedSkillBody;
}

export function getBasePostId(uri: string): string | null {
  const m = uri.match(/\/app\.bsky\.feed\.post\/([^#]+)/);
  return m ? m[1] : null;
}

export async function loadCanonical(redis: Redis): Promise<CanonicalEntry[]> {
  const raw = await redis.lrange(CANONICAL_KEY, 0, -1);
  const out: CanonicalEntry[] = [];
  for (const entry of raw) {
    try {
      const parsed = JSON.parse(entry);
      if (parsed && typeof parsed.post_id === 'string' && typeof parsed.brand === 'string' && typeof parsed.model === 'string') {
        out.push(parsed);
      }
    } catch {
      // skip malformed entries
    }
  }
  return out;
}

export async function loadOverride(redis: Redis, basePostId: string): Promise<WatchMeta | null> {
  const raw = await redis.hget(OVERRIDES_KEY, basePostId);
  if (!raw) return null;
  try {
    return validateMeta(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Load the raw override JSON for a post (or null if absent / malformed).
 * Use this when you need to distinguish a full override (has `kind` set —
 * replaces meta wholesale) from a partial override (just patchable fields
 * like `search_query` / `product_url` — merges on top of existing meta).
 */
export async function loadRawOverride(redis: Redis, basePostId: string): Promise<any | null> {
  const raw = await redis.hget(OVERRIDES_KEY, basePostId);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Fields a *partial* override is allowed to patch onto existing meta.
// Restricting to an allow-list prevents typo'd or unknown keys from
// silently polluting watch-meta.
const PARTIAL_OVERRIDE_FIELDS = ['search_query', 'product_url'] as const;

/**
 * Extract the patchable fields from a raw override object. Empty-string
 * and explicit-null values are normalized to null (so the operator can
 * clear a previously-set override by writing either form). Unknown fields
 * are ignored.
 */
export function partialOverrideFields(raw: any): Partial<WatchMeta> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Partial<WatchMeta> = {};
  for (const field of PARTIAL_OVERRIDE_FIELDS) {
    if (!(field in raw)) continue;
    const v = raw[field];
    if (v === null) {
      out[field] = null;
    } else if (typeof v === 'string') {
      const trimmed = v.trim();
      out[field] = trimmed.length > 0 ? trimmed : null;
    }
  }
  return out;
}

export async function readMeta(redis: Redis, basePostId: string): Promise<WatchMeta | null> {
  const raw = await redis.hget(META_KEY, basePostId);
  if (!raw) return null;
  try {
    return validateMeta(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function validateMeta(input: any): WatchMeta | null {
  if (!input || !VALID_KINDS.has(input.kind)) return null;
  const meta: WatchMeta = {
    kind: input.kind,
    brand: typeof input.brand === 'string' ? input.brand : null,
    model: typeof input.model === 'string' ? input.model : null,
    references_post_id: typeof input.references_post_id === 'string' ? input.references_post_id : null,
    confidence: typeof input.confidence === 'number' ? Math.max(0, Math.min(1, input.confidence)) : 0,
    classified_at: typeof input.classified_at === 'string' ? input.classified_at : new Date().toISOString(),
  };
  if (typeof input.search_query === 'string' && input.search_query.trim()) {
    meta.search_query = input.search_query.trim();
  }
  if (typeof input.product_url === 'string' && input.product_url.trim()) {
    meta.product_url = input.product_url.trim();
  }
  return meta;
}

function callClaude(prompt: string, model: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      ['-p', '--output-format', 'json', '--model', model, prompt],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`claude -p timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude -p exited ${code}: ${stderr.trim().slice(0, 500)}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

function extractAssistantText(rawStdout: string): string {
  // claude -p --output-format json wraps the assistant text in a JSON envelope.
  // Try to peel that off; fall back to raw if it isn't JSON.
  try {
    const wrapper = JSON.parse(rawStdout);
    const candidates = [
      wrapper?.result,
      wrapper?.message,
      wrapper?.response,
      Array.isArray(wrapper?.content) ? wrapper.content.map((c: any) => c?.text ?? '').join('') : null,
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.length > 0) return c;
    }
  } catch {
    // not JSON, fall through
  }
  return rawStdout;
}

function parseClassifierOutput(rawStdout: string): WatchMeta | null {
  let text = extractAssistantText(rawStdout).trim();
  // Strip ```json ... ``` fences if Claude wrapped output despite the instructions.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  // Sometimes Claude adds prose around the JSON; grab the first {...} block.
  if (!text.startsWith('{')) {
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) text = objMatch[0];
  }
  try {
    const parsed = JSON.parse(text);
    return validateMeta({ ...parsed, classified_at: new Date().toISOString() });
  } catch (e) {
    console.warn(`[watch-classifier] could not parse JSON: ${(e as Error).message}; output preview: ${text.slice(0, 240)}`);
    return null;
  }
}

export interface ClassifyOptions {
  model?: string;
  timeoutMs?: number;
}

export async function classifyPost(
  input: ClassifyInput,
  canonical: CanonicalEntry[],
  options: ClassifyOptions = {}
): Promise<WatchMeta | null> {
  const skill = await loadSkillBody();
  const userPrompt = [
    skill,
    '',
    '---',
    '',
    'Now classify this post. Inputs:',
    '',
    'text: ' + JSON.stringify(input.text),
    'facets: ' + JSON.stringify(input.facets ?? []),
    'canonical: ' + JSON.stringify(canonical),
    '',
    'Respond with ONLY the JSON object described above.',
  ].join('\n');

  const model = options.model || process.env.WATCH_CLASSIFIER_MODEL || DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let stdout: string;
  try {
    stdout = await callClaude(userPrompt, model, timeoutMs);
  } catch (e) {
    console.warn(`[watch-classifier] claude -p failed: ${(e as Error).message}`);
    return null;
  }
  return parseClassifierOutput(stdout);
}

async function appendCanonicalIfNew(redis: Redis, postId: string, meta: WatchMeta): Promise<void> {
  if (meta.kind !== 'unique-watch') return;
  if (!meta.brand || !meta.model) return;
  if (meta.references_post_id) return;
  const existing = await loadCanonical(redis);
  if (existing.some(c => c.post_id === postId)) return;
  await redis.rpush(CANONICAL_KEY, JSON.stringify({
    post_id: postId,
    brand: meta.brand,
    model: meta.model,
  } as CanonicalEntry));
}

/**
 * Classify a post and persist the result. Honors manual overrides at
 * `__doodles:watch-overrides` first. Safe to call from the listener's
 * processPost path — failures are swallowed and logged.
 *
 * Override semantics:
 *   - Full override (has `kind`): replaces the classifier entirely. The
 *     classifier doesn't run.
 *   - Partial override (no `kind`, just `search_query` / `product_url`):
 *     classifier still runs; override fields are merged on top of the
 *     classifier's output before persisting.
 */
export async function classifyAndRecord(
  redis: Redis,
  input: ClassifyInput,
  options: ClassifyOptions = {}
): Promise<WatchMeta | null> {
  const rawOverride = await loadRawOverride(redis, input.basePostId);

  if (rawOverride && typeof rawOverride.kind === 'string') {
    const fullOverride = validateMeta(rawOverride);
    if (fullOverride) {
      await redis.hset(META_KEY, input.basePostId, JSON.stringify(fullOverride));
      await appendCanonicalIfNew(redis, input.basePostId, fullOverride);
      return fullOverride;
    }
    // Structurally broken — fall through and let the classifier run.
  }

  const canonical = await loadCanonical(redis);
  const meta = await classifyPost(input, canonical, options);
  if (!meta) return null;

  // Defensive guard: the classifier occasionally hallucinates a
  // `references_post_id` equal to the post being classified. Structurally
  // a post can't be a follow-on of itself, and writing the bad meta would
  // exclude the post from the canonical list (rebuild requires
  // !references_post_id) — exactly the failure mode we saw with the
  // Fossil PH-5029 re-classify. Clear the reference; demote `follow-on`
  // to `unique-watch` so brand+model still flow to canonical.
  if (meta.references_post_id && meta.references_post_id === input.basePostId) {
    console.warn(`[watch-classifier] ${input.basePostId} classified as follow-on of itself — clearing references_post_id, demoting kind to unique-watch`);
    meta.references_post_id = null;
    if (meta.kind === 'follow-on') meta.kind = 'unique-watch';
  }

  const merged: WatchMeta = rawOverride
    ? { ...meta, ...partialOverrideFields(rawOverride) }
    : meta;

  await redis.hset(META_KEY, input.basePostId, JSON.stringify(merged));
  await appendCanonicalIfNew(redis, input.basePostId, merged);
  return merged;
}
