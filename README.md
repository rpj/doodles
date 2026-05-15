# Watches

A full-stack application that collects and displays art posts from Bluesky tagged with a configurable hashtag (defaults to #YourTag). Features real-time monitoring, multi-user support, RSS feeds, and an Art Deco-inspired gallery interface.

## Architecture

### Core Components
- **Listener Service** (Node.js/TypeScript) - Monitors Bluesky every ~5 minutes for posts with the configured hashtag
- **Frontend** (Next.js/React) - Gallery web interface with server-side rendering, auto-refresh, and dynamic hashtag display
- **Redis** - Data storage for posts, session management, and runtime configuration
- **Docker Compose** - Service orchestration and deployment

### Data Flow
1. Listener polls Bluesky search API for posts with the configured hashtag
2. Posts with images are processed and stored in Redis with multiple prefixes
3. Frontend serves galleries filtered by user handle via dynamic routing
4. RSS feeds generated server-side with handle-specific filtering and configured hashtag

## Quick Start

### Prerequisites
- Docker and Docker Compose
- Bluesky account with app password

### Setup
1. **Environment Configuration**
   ```bash
   cp .env.example .env
   # Edit .env with your Bluesky credentials:
   # BLUESKY_IDENT=your.handle.here
   # BLUESKY_PASS=your-app-password-here
   ```

2. **Configure User Filters** (Runtime - No Rebuild Required)
   ```bash
   # Add users to track (handle -> redis prefix mapping)
   redis-cli HSET __doodles:users artist.bsky.social artist-posts
   redis-cli HSET __doodles:users creative.bsky.social creative-posts
   
   # View current configuration
   redis-cli HGETALL __doodles:users
   ```

3. **Import Existing Posts**
   ```bash
   cd listener
   npm install
   REDIS_URL=redis://localhost:6379 npm run backfill
   ```

4. **Start Services**
   ```bash
   docker-compose up -d
   ```

5. **Access Application**
   - Frontend: http://localhost:3000 (or your configured PORT)
   - RSS Feed: http://localhost:3000/rss.xml

## Development

### Frontend (./frontend/)
```bash
npm install           # Install dependencies
npm run dev           # Development server (default port 3000, configurable via PORT)
npm run build         # Production build
npm run start         # Production server (respects PORT env var)
npm run lint          # ESLint
```

### Listener Service (./listener/)
```bash
npm install                 # Install dependencies
npm run start               # Start listener service
npm run backfill            # Import hardcoded historical posts
npm run backfill-facets     # Re-fetch facets (rich-text URIs/tags/mentions) for legacy posts
npm run classify-existing   # Run the watch classifier on un-classified posts (see below)
npm run apply-overrides     # Apply manual overrides + rebuild canonical + refresh product prices (no Claude calls)
npm run set-override        # Set a single partial-override field (search_query/product_url) on one post and apply it. `npm run set-override -- <postId> <field> <value>`
npm run fetch-prices        # Manually refresh manufacturer product prices for posts with `product_url` overrides
npm run watch-stats         # Read-only summary of classifier output
```

**Backfilling rich text on legacy posts:**

The listener captures Bluesky's rich-text `facets` array on every new post,
which the post page uses to render full inline URLs / clickable hashtags /
mentions. Posts ingested before this feature was added store a truncated
text without facets. Run `npm run backfill-facets` once to re-fetch every
known post from Bluesky's public API and stamp the original facets onto
the stored Post record. Idempotent (only fetches posts missing the
field); add `--force` to re-fetch unconditionally; add `--dry-run` to
preview without writing.

**Watch classifier (`watch-classifier/SKILL.md`):**

Each post the listener stores is also fed through a Claude-powered
classifier that decides whether the post is a unique watch, a follow-on
("band upgrade", "wearing it again"), a family/collection shot, an event
post, or other; and extracts brand + model. Used to deduplicate fuzzy
plain-text descriptions and drive the per-brand stats / filter UI on the
gallery, plus the "First appeared →" link from a follow-on post back to
its canonical.

The skill lives at `listener/watch-classifier/SKILL.md` (version-controlled
in this repo) and is also symlinked from `~/.claude/skills/watch-classifier`
for interactive use. The listener calls `claude -p` non-interactively at
post-processing time and stores results in three Redis keys:

- `__doodles:watch-meta` — Hash, basePostId → JSON `{kind, brand, model, references_post_id, confidence, classified_at, search_query?, product_url?}`. The two optional fields are pricing-widget overrides; see "Pricing Overrides".
- `__doodles:watch-canonical` — List, oldest first, JSON `{post_id, brand, model}` for each unique watch. Drives the canonical-list context the classifier sees on subsequent posts (so post N+1 can be matched against post N's identified watches).
- `__doodles:watch-overrides` — Hash, basePostId → JSON (same shape as `watch-meta`). See the "Watch classification overrides" section below.
- `__doodles:product-prices` — Hash, basePostId → JSON `{value, currency, productUrl, productDomain, fetchedAt}`. Populated by the listener from `product_url` overrides; consumed by the per-post pricing widget. See "Pricing Overrides".

Bootstrap the classification for legacy posts with `cd listener && npm run classify-existing`. Inspect the output with `npm run watch-stats` (add `--low-confidence` to spot-check entries that need manual review).

Failure mode is fail-soft: if the `claude` CLI isn't available in the listener's environment (e.g. the Docker container without Claude Code installed), classification logs a warning and the listener keeps storing posts as before.

### Watch Classification Overrides

The classifier is good but not perfect — it's classifying fuzzy plain-text
prose. When it gets a post wrong, set a manual override. Overrides take
precedence over the LLM's output and persist across re-classifications.

**Storage:** `__doodles:watch-overrides` — Redis hash. Field is the base
post ID (the last segment of a Bluesky post URL, no `#image` suffix).
Value is a JSON blob with the same shape as `__doodles:watch-meta`:

```json
{
  "kind": "unique-watch" | "follow-on" | "family" | "event" | "other",
  "brand": "Tudor" | null,
  "model": "Black Bay 58" | null,
  "references_post_id": "3mxxxxxx" | null,
  "confidence": 1.0,
  "classified_at": "2026-04-25T00:00:00Z",
  "search_query": "Tudor Black Bay 58 39mm",
  "product_url": "https://www.tudorwatch.com/.../m79030n-0001"
}
```

`brand` and `model` are required when `kind` is `unique-watch` or
`follow-on`; null otherwise. `references_post_id` is required when `kind`
is `follow-on` (the base post ID of the canonical entry it follows up on);
null otherwise. `confidence` and `classified_at` are stamped by the
classifier; for hand-written overrides set `confidence: 1.0` and any
ISO-8601 timestamp.

`search_query` and `product_url` are both optional pricing overrides — see
the "Pricing overrides" subsection below for what they do and how to set
them. Omit them entirely if you only need to correct the classifier output.

**Full vs. partial overrides.** An override JSON with `kind` set is a *full
override* — it replaces the classifier's meta wholesale. An override
JSON without `kind` (e.g. `{"search_query":"…"}`) is a *partial override*
— `apply-overrides` merges just the listed fields on top of the existing
meta. Partial overrides only patch the allow-listed fields (`search_query`,
`product_url`); unknown fields are ignored, and a partial override against
a post with no existing meta is skipped with a warning (classify the post
first via `classify-existing`).

Removing a partial override (`HDEL`) does *not* automatically clear the
fields it set in `__doodles:watch-meta`. To clear them, either set the
field explicitly to `null` (or empty string) and re-run `apply-overrides`,
or wipe the post's meta and re-classify.

**Set an override:**

```bash
# Mark a misclassified family post as event
redis-cli HSET __doodles:watch-overrides 3mkvhoxbbi22a '{
  "kind": "event",
  "brand": null,
  "model": null,
  "references_post_id": null,
  "confidence": 1.0,
  "classified_at": "2026-04-25T00:00:00Z"
}'

# Mark a misidentified follow-on as a new unique watch (variant of an
# existing canonical brand+line)
redis-cli HSET __doodles:watch-overrides 3mkxuccaxkc2j '{
  "kind": "unique-watch",
  "brand": "Brew",
  "model": "Metric PVD Black",
  "references_post_id": null,
  "confidence": 1.0,
  "classified_at": "2026-04-25T00:00:00Z"
}'
```

**Apply overrides:** an override sits dormant in Redis until the next
`classifyAndRecord` call — which only runs for new posts. To replay
overrides against the existing data:

```bash
cd listener
npm run apply-overrides
```

`apply-overrides` does three things — the first two are pure Redis (no
network), the third only runs if any override carries a `product_url`:

1. Copies every entry in `__doodles:watch-overrides` into
   `__doodles:watch-meta`, overwriting the classifier's prior output for
   those posts.
2. Rebuilds `__doodles:watch-canonical` from scratch — walks
   `all-doodles:posts` chronologically and re-derives the canonical list
   from the (now-overridden) meta. So a post previously classified as a
   canonical that's been overridden to `event` no longer appears in the
   canonical list, and a post overridden to `unique-watch` now does.
3. For every override carrying `product_url`, fetches the page and
   extracts the JSON-LD price into `__doodles:product-prices` so the
   per-post pricing widget renders immediately rather than waiting for
   the listener's next price-refresh tick (default 6h).

Run `npm run apply-overrides -- --dry-run` first if you want to preview.
Dry-run skips both the Redis writes *and* the product-page fetches.

**View, list, remove overrides:**

```bash
# All overrides
redis-cli HGETALL __doodles:watch-overrides

# A specific one
redis-cli HGET __doodles:watch-overrides 3mkvhoxbbi22a

# Remove (then re-run apply-overrides to revert that post to the
# classifier's output, OR run classify-existing -- --force to re-classify
# from scratch with the latest SKILL.md rules)
redis-cli HDEL __doodles:watch-overrides 3mkvhoxbbi22a
```

**When to override vs re-classify:** if it's a one-off the LLM got wrong,
override. If you've tightened the SKILL.md rules and want to see the new
output across the board, run `npm run classify-existing -- --force` — that
re-classifies every post from scratch (overrides remain in effect; they're
checked first on every classify call).

### Mental Model: Which Command, When?

| Command | What it does | Cost | When to use |
|---|---|---|---|
| `classify-existing` | Walks every post in `all-doodles:posts`, classifies any missing from `watch-meta`. Skips already-classified posts. | Tokens (Claude calls — Sonnet by default) | First-time bootstrap on a Redis with no prior classification, or after the listener was offline / running without `claude` and posts piled up un-classified. |
| `classify-existing -- --force` | Re-classifies **every** post from scratch. Clears the canonical list at start, rebuilds it incrementally. | Full corpus token cost | Only after editing `SKILL.md` and wanting a fresh corpus-wide pass. **Don't kill mid-run** — leaves canonical partial; recover with `apply-overrides`. |
| `apply-overrides` | Pure Redis + (if any override has `product_url`) network fetches to those manufacturer pages. Copies `watch-overrides` into `watch-meta`, rebuilds `watch-canonical` from existing meta by walking `all-doodles:posts` chronologically, and refreshes `__doodles:product-prices` for every override with a `product_url`. | Free in Redis-only mode; small egress when `product_url` is set | After setting / removing an override; also after any of the failure modes below. |
| `set-override` | One-shot per-post override setter. Merges a single field into the override JSON, applies it to `watch-meta`, and (for `product_url`) fetches the price inline. Skips the canonical rebuild — only supports the partial-override allow-list (`search_query`, `product_url`). | Free in Redis-only mode; one outbound HTTP request for `product_url` changes | The fastest path for the common pricing-override workflow (one field at a time). Use `apply-overrides` for full classification changes that need canonical rebuilt. |
| `fetch-prices` | Refreshes `__doodles:product-prices` by re-fetching every `product_url` in `watch-meta` and extracting JSON-LD `Product.offers.price`. Supports `--post=<basePostId>` to fetch one. | Free; just outbound HTTP | Manually re-fetch outside the listener's 6h cadence — e.g., after pasting a new product URL into an override and not wanting to wait. The listener does this automatically on its `PRICE_REFRESH_FREQ_SECONDS` schedule. |
| `reddit-query -- "<q>"` | Prints the same filtered Reddit posts the per-post Reddit card would show. Cross-imports `frontend/lib/reddit.ts` so backend / sort / filter stay in lockstep with the live API. | Free; one outbound HTTP per backend call | Prototyping a `reddit_query` override — try several phrasings, pick the one that returns the most relevant titles, then commit it via `set-override`. |
| `watch-stats` | Read-only summary of classifier output. Flags: `--low-confidence`, `--list-other`. | Free | Sanity-check classifier output and find entries that need a manual override. |

**Overrides persist across all of the above** — they're consulted first on every `classifyAndRecord` call, and `apply-overrides` always re-applies them on top of meta. Setting an override is "sticky"; you can re-classify or rebuild canonical as much as you want without losing your manual corrections.

**Inline classification** runs synchronously inside `processPost` for every new post the listener captures — no scheduling needed. New posts go from Bluesky → listener → classified + meta + canonical entry, all in one polling cycle.

### Troubleshooting

**Symptom: gallery shows no Stats strip; `/api/watch-stats` returns `{uniqueCount: 0, brandCount: 0, byBrand: []}` even though "First appeared" links work and `/api/posts?brand=...` filters work.**

Diagnosis: `__doodles:watch-meta` is populated but `__doodles:watch-canonical` is empty. The Stats component renders nothing when `uniqueCount === 0`. The two API paths that DO work read meta directly and bypass the canonical list.

Common cause: a `classify-existing -- --force` run that was killed before it finished. The start of `--force` clears the canonical list and rebuilds it incrementally as it processes each post; an early kill leaves canonical at zero (or nearly so) while meta still has the prior good entries.

Fix: `cd listener && npm run apply-overrides` rebuilds canonical from existing meta in seconds. No Claude calls.

**Symptom: listener log shows "Watch classification failed" for every new post.**

The `claude` CLI isn't on PATH inside the listener container, or `ANTHROPIC_API_KEY` didn't propagate. The listener fail-soft path keeps storing posts; classification just stays empty until the deploy is fixed. See "Claude Code in the listener container" below.

### Claude Code in the listener container

The inline classifier shells out to `claude -p`. The listener Dockerfile installs `@anthropic-ai/claude-code` globally (pinned version) and sets `DISABLE_AUTOUPDATER=1` so the daemon doesn't pay the auto-update check on every invocation. `docker-compose.yml` propagates two env vars from the host:

- `ANTHROPIC_API_KEY` (required) — headless auth path. With this set, `claude -p` skips the OAuth/onboarding flow that would otherwise block the daemon. Set it in your shell or `.env` before `docker compose up`.
- `WATCH_CLASSIFIER_MODEL` (optional, defaults to `sonnet`) — which Claude model to call. Lets you swap to `haiku` for cheaper-but-noisier classification without rebuilding.

To validate the in-container setup, shell in and run a smoke test:

```bash
docker compose run --rm --entrypoint /bin/bash listener
# Inside the container:
which claude && claude --version
echo "$ANTHROPIC_API_KEY" | head -c 8 ; echo "…"
claude -p --output-format json --model sonnet \
  'Output JSON only, no fences: {"hello":"world"}'
```

If the JSON envelope comes back with a `result` field, the listener will classify cleanly on every new post.

### Pricing Overrides

The per-post pricing widget (the small card between the post text and the
images on `/post/[id]`) merges two data sources: eBay Browse API search
results, and a manufacturer product price extracted from a JSON-LD
`Product.offers.price` blob on a product page. Both can be steered per
post via two optional fields on a `__doodles:watch-overrides` entry.

#### `search_query` — fix eBay search precision

When the classifier's `brand` + `model` produces a noisy or empty eBay
search (common for microbrands or imprecise model names), set
`search_query` on the canonical's override to replace the default
`${brand} ${model}` query. Affects the widget for the canonical post and
all of its follow-ons.

Since `search_query` doesn't change the classification, write it as a
partial override (no `kind`) so it patches the existing meta instead of
replacing it. The shortest path is the `set-override` CLI, which writes
the override JSON and applies it in one step:

```bash
cd listener && npm run set-override -- 3m2v2gfa7as2w search_query \
  "PHILIPPE STARCK FOSSIL PH-5029 WATCH"
# Override updated: 3m2v2gfa7as2w.search_query = "..."
# Wrote __doodles:watch-meta: unique-watch Fossil PH-5029
#   search_query: "PHILIPPE STARCK FOSSIL PH-5029 WATCH"
```

Equivalent raw form, for when you want to script multi-field changes:

```bash
redis-cli --raw HSET __doodles:watch-overrides 3m2v2gfa7as2w \
  '{"search_query":"PHILIPPE STARCK FOSSIL PH-5029 WATCH"}'

cd listener && npm run apply-overrides
```

Note: the eBay response is cached in Redis for 24h per *effective* search
query, so a `search_query` change creates a new cache entry and the next
widget render fetches fresh data. The old cache entry expires on its own.

#### `product_url` — show the current manufacturer price

For watches still sold by the brand (microbrands, current production
flagships), set `product_url` to the manufacturer's product page. The
listener fetches the page on a cadence (default every 6h, see
`PRICE_REFRESH_FREQ_SECONDS`), extracts the price from JSON-LD
`Product.offers.price`, and stores it in `__doodles:product-prices`.

The widget then renders the current price + a link to the manufacturer
page alongside (or instead of) the eBay listings row. Works on any
e-commerce platform that emits the schema.org `Product` structured data
— Shopify, WooCommerce, and most custom storefronts do; we treat that
schema as a sanctioned data contract rather than parsing rendered HTML.

```bash
# Brew is a microbrand with very few eBay listings — point at their
# product page so the widget shows the current MSRP. Partial override
# preserves the classifier's brand/model/kind; only product_url is patched.
cd listener && npm run set-override -- 3mkxuccaxkc2j product_url \
  "https://brewwatches.com/products/metric-hp-1"
# Output:
#   Override updated: 3mkxuccaxkc2j.product_url = "..."
#   Wrote __doodles:watch-meta: unique-watch Brew Metric HP-1
#     product_url:  https://brewwatches.com/products/metric-hp-1
#   Fetching product price from ...
#     [price] USD 750 from brewwatches.com
```

The price fetch happens inline so you don't wait for the listener's 6h
refresh tick. To clear a previously-set product_url and drop the cached
price, pass an empty value:

```bash
cd listener && npm run set-override -- 3mkxuccaxkc2j product_url ""
#   Override updated: 3mkxuccaxkc2j.product_url = null
#   Cleared product-price cache entry for 3mkxuccaxkc2j
```

You can also set both fields together via the raw form when you need to
write multiple keys at once — the widget then shows the manufacturer
price *and* the eBay listings row when both return data:

```bash
redis-cli --raw HSET __doodles:watch-overrides 3mkxuccaxkc2j \
  '{"search_query":"Brew Metric HP-1", "product_url":"https://brewwatches.com/products/metric-hp-1"}'
cd listener && npm run apply-overrides
```

**Manual fetch (debugging):**

```bash
# Fetch all configured product URLs and refresh __doodles:product-prices
cd listener && npm run fetch-prices

# Fetch a single post
cd listener && npm run fetch-prices -- --post=3mkxuccaxkc2j

# Inspect stored prices
redis-cli HGETALL __doodles:product-prices

# Clear a stale price (e.g., product discontinued — the URL still works
# but the listed price is no longer relevant)
redis-cli HDEL __doodles:product-prices 3mkxuccaxkc2j
```

If a page has no parseable JSON-LD `Product` block, `fetch-prices` logs a
warning and writes nothing — any prior successful price remains in place
until you manually `HDEL` it.

**For follow-ons:** set `product_url` and `search_query` on the
*canonical* post's override, not on the follow-on. The widget on a
follow-on page resolves to the canonical's `basePostId` before looking
up overrides and prices, so one override entry covers the whole family.

### Reddit Card

The per-post Reddit card surfaces 3 selected discussions about each watch.
Backend strategy: Arctic Shift primary (current scores and recent posts,
fanned out across an operator-configured subreddit list since its
`title` search requires pairing with a subreddit), PullPush fallback
(site-wide title search via `q`, used when Arctic Shift is down or
rate-limit-exhausted).

**Known limitation: archive staleness on deletion.** Both Arctic Shift
and PullPush freeze each post's metadata at the moment they index it.
Posts deleted *later* on Reddit's live site still surface as live in
both archives. The card layers two best-effort filters to compensate
(drop in-archive removals via `removed_by_category` / `is_robot_indexable`
/ `selftext=[removed]`; collapse same-author near-duplicate titles to
their highest-scoring entry, which catches the common mod-removed-as-
dupe pattern) — but isolated after-archive deletions will still slip
through. A full fix requires the Reddit Data API (OAuth) for live
status verification, not yet built. To toggle the whole card off in the
meantime, set `REDDIT_CARD_ENABLED=false`.

**Configured subreddit list** — `__doodles:reddit-subreddits` is a Redis
list (oldest first) of subreddit names to query when Arctic Shift is the
active backend (which is the primary path). Each entry is one subreddit
name, with or without an `r/` prefix. The lib iterates the list,
deduplicates by post ID across subreddits, and merges into a single
result set before filtering — broader coverage than any one sub for the
long-tail microbrand queries that benefit most from this card.

```bash
# Inspect
redis-cli LRANGE __doodles:reddit-subreddits 0 -1

# Append a sub
redis-cli RPUSH __doodles:reddit-subreddits AutomaticWatches

# Remove a sub (LREM count=0 means "remove all matching")
redis-cli LREM __doodles:reddit-subreddits 0 AutomaticWatches

# Reseed from scratch
redis-cli DEL __doodles:reddit-subreddits
redis-cli RPUSH __doodles:reddit-subreddits Watches MicrobrandWatches VintageWatches JapaneseWatches
```

If the key is missing or empty (e.g. fresh install), the lib falls back
to the same four defaults: `Watches`, `MicrobrandWatches`,
`VintageWatches`, `JapaneseWatches`. Changes take effect on the next
cache-miss fetch — to apply immediately, also flush the per-query cache:

```bash
redis-cli --scan --pattern '__doodles:reddit-search:*' | xargs -r redis-cli DEL
```

The `reddit_query` partial override (see "Watch Classification
Overrides") composes with this list — the override changes the *query*
sent to each subreddit; the list controls *which* subreddits get the
query.

### Tools (./tools/)
```bash
# Query specific post data
npx ts-node query-post.ts <profile> <postId>

# Search for posts across all Redis prefixes
npx ts-node moderation.ts <postId>

# Delete posts from all Redis prefixes
npx ts-node moderation.ts <postId> --delete
```

## Configuration

### Environment Variables

**Required:**
- `BLUESKY_IDENT` - Bluesky username/handle
- `BLUESKY_PASS` - Bluesky app password
- `ANTHROPIC_API_KEY` - Required for the inline watch classifier. The listener calls `claude -p` per post; without this var, classification fails-soft (post still stored, no `watch-meta` entry written).

**Optional:**
- `REDIS_URL` - Redis connection string (default: `redis://localhost:6379`)
- `POLLING_FREQ_SECONDS` - Listener polling interval (default: 300)
- `PRICE_REFRESH_FREQ_SECONDS` - Cadence for refreshing manufacturer product prices via `fetch-prices` from inside the listener loop (default: 21600 = 6h). Only relevant if any `__doodles:watch-overrides` entries carry a `product_url`. The refresh runs after each polling tick that crosses the threshold, throttled via `__doodles:product-prices:last-refresh`.
- `REDDIT_CARD_ENABLED` - Master kill-switch for the per-post Reddit card. Default `true`. Set to `false` to disable rendering everywhere (both the API endpoint and the post pages skip it). Useful while the underlying archives (Arctic Shift, PullPush) lack live deletion tracking — see README "Reddit Card".
- `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_ENV` - eBay Browse API credentials for the pricing widget. `EBAY_ENV` is `production` or `sandbox` (default sandbox; sandbox returns synthetic data unsuitable for live).
- `HASHTAG_TO_WATCH` - Hashtag to monitor (default: `#YourTag`). Include the # prefix.
- `HANDLES_TO_WATCH` - Comma-separated list of Bluesky handles to limit the collection to. First handle in the list is shown as the deployment owner on the gallery.
- `SITE_TITLE` - Human-readable wordmark for the gallery masthead (e.g. `Ryan's Watches`). Falls back to the hashtag itself when unset.
- `WATCH_CLASSIFIER_MODEL` - Claude model the watch classifier uses (default: `sonnet`). Set to `haiku` for cheaper / noisier classification.
- `DISABLE_AUTOUPDATER` - Set to `1` in the listener container so `claude` doesn't run the auto-update check on every invocation. Already set in `listener/Dockerfile`.
- `PORT` - Frontend server port (default: 3000)

### User Filter Management

User filters are managed at runtime via Redis hash `__doodles:users`:

```bash
# Add new user
redis-cli HSET __doodles:users artist.bsky.social artist-posts

# Remove user  
redis-cli HDEL __doodles:users artist.bsky.social

# List all configured users
redis-cli HGETALL __doodles:users

# Clear all user filters
redis-cli DEL __doodles:users
```

Changes take effect immediately - no service restart required.

### Hero Image Overrides

Multi-image posts default to showing the first image (`#image0`) as the gallery
card preview. To feature a different image without changing the underlying post,
add an entry to the `__doodles:hero-overrides` Redis hash. The field is the base
post ID (the part after `app.bsky.feed.post/` in the URI, also the last segment
of the post URL on Bluesky); the value is the zero-based image index to feature.

```bash
# Use image1 (the second image) as the gallery preview for post 3mjve4rdk7k2c
redis-cli HSET __doodles:hero-overrides 3mjve4rdk7k2c 1

# Remove the override (revert to image0)
redis-cli HDEL __doodles:hero-overrides 3mjve4rdk7k2c

# List all current overrides
redis-cli HGETALL __doodles:hero-overrides
```

Effects:
- Applies to the gallery `/` and `/[handle]` pages — both the small preview cards
  and the dominant hero card on `/[handle]` page 1.
- The post detail page (`/post/[id]` and `/[handle]/post/[id]`) preserves the
  original image order regardless of overrides.
- An override index `<= 0`, non-numeric, or beyond the post's image count is
  silently ignored.

Changes take effect on the next gallery refresh — no service restart required.

## Data Structure

### Core Type
```typescript
type Facet = {
  index: { byteStart: number; byteEnd: number };
  features: Array<
    | { $type: 'app.bsky.richtext.facet#link'; uri: string }
    | { $type: 'app.bsky.richtext.facet#tag'; tag: string }
    | { $type: 'app.bsky.richtext.facet#mention'; did: string }
  >;
};

type Post = {
  uri: string;           // "at://did/app.bsky.feed.post/id#imageN"
  authorHandle: string;
  authorDisplayName: string;
  text: string;          // Bluesky display text — inline URLs may be truncated to ~30 chars
  imageUrls: string[];   // Single image per post entry
  createdAt: string;
  postUrl: string;       // Bluesky web URL
  facets?: Facet[];      // Bluesky rich-text facets — full URIs for inline links / tags / mentions, byte-offset indexed against `text`
}
```

### Multi-Image Handling
Posts with multiple images are split into separate `Post` entries:
- Original post: `at://did/app.bsky.feed.post/abc123`
- Image 1: `at://did/app.bsky.feed.post/abc123#image0`
- Image 2: `at://did/app.bsky.feed.post/abc123#image1`

This enables individual image routing and display.

### Redis Structure

**Prefixes:**
- `all-doodles:*` - All posts with the configured hashtag (filters NSFW content)
- `doodles:*` - Posts from ryanjoseph.dev
- `doodles-kaciecamilli:*` - Posts from kaciecamilli.bsky.social
- `user-[handle]:*` - Posts from unconfigured users (fallback)

**Keys per prefix:**
- `posts` - List of serialized Post objects (chronological)
- `processed-uris` - Set of processed post/image URIs (deduplication)
- `saved-session` - Bluesky session data (authentication persistence)
- `last-seen-post` - Most recent post URI (search optimization)

**Special keys:**
- `__doodles:users` - Hash mapping handles to Redis prefixes (runtime config)
- `__doodles:hero-overrides` - Hash mapping base post IDs to a zero-based image index used as the gallery card preview (see [Hero Image Overrides](#hero-image-overrides))

## Frontend Features

### Routing
- `/` - All posts gallery with 5-minute auto-refresh
- `/[handle]` - User-specific galleries (e.g., `/ryanjoseph.dev`)
- `/post/[id]` - Individual post pages with back navigation
- `/[handle]/post/[id]` - User-scoped post pages
- `/rss.xml` - RSS feed (supports `?handle=` parameter)

### UI Features
- **Theme System**: Light/dark mode toggle with localStorage persistence
- **Responsive Design**: Mobile-optimized Art Deco styling
- **Auto-refresh**: Gallery updates every 5 minutes
- **Hero Display**: Latest post featured prominently on user pages
- **External Links**: GitHub source, RSS feeds, original Bluesky posts

### Styling
- **Design Language**: Art Deco-inspired black/white with metallic silver accents
- **Typography**: Google Fonts 'Limelight' (headings) and 'Fascinate' (body)
- **CSS Architecture**: CSS Modules with CSS custom properties for theming
- **Image Optimization**: Next.js Image component with Bluesky CDN support

## Listener Features

### Post Processing
- **Hashtag Detection**: Searches for the configured hashtag in post text (defaults to #YourTag)
- **Image Extraction**: Supports multiple Bluesky embed types
- **NSFW Filtering**: Skips posts with #nsfw, #noindex tags or sexual content labels
- **Multi-User Fanout**: Single post search fans out to multiple Redis prefixes
- **Deduplication**: Tracks processed URIs to prevent duplicates

### Session Management  
- **Authentication**: Bluesky login with 2FA support
- **Session Persistence**: Saves auth tokens in Redis to avoid re-login
- **Rate Limit Handling**: Graceful handling of API limits

### Search Strategy
- **Incremental**: Searches from latest posts until finding last seen post
- **Batch Processing**: Configurable batch size (default: 25 posts)
- **Safety Limits**: Maximum batch limits to prevent infinite loops
- **First Run**: Processes only latest batch on initial run

## Tools & Utilities

### Post Management
```bash
# Query post data and save to JSON file
npx ts-node tools/query-post.ts brineb.bsky.social 3lwk7nrzdzs2b

# Search for post across all Redis prefixes
npx ts-node tools/moderation.ts 3lwk7nrzdzs2b

# Delete post from all Redis prefixes (moderation)
npx ts-node tools/moderation.ts 3lwk7nrzdzs2b --delete
```

### User Management
```bash
# Add user to tracking (no restart required)
redis-cli HSET __doodles:users newuser.bsky.social new-user-prefix

# Remove user from tracking
redis-cli HDEL __doodles:users newuser.bsky.social

# List configured users
redis-cli HGETALL __doodles:users
```

## Deployment

### Docker Compose
```bash
# Production deployment
docker-compose up -d

# View logs
docker-compose logs -f listener
docker-compose logs -f frontend

# Stop services
docker-compose down
```

### Manual Development
```bash
# Terminal 1: Start Redis
docker run -d -p 6379:6379 redis:alpine

# Terminal 2: Start listener
cd listener
npm install
npm run start

# Terminal 3: Start frontend  
cd frontend
npm install
npm run dev
```

## API Reference

### Frontend API Endpoints
- `GET /api/posts` - All posts
- `GET /api/posts?handle=ryanjoseph.dev` - User-specific posts
- `GET /rss.xml` - RSS feed (all posts)
- `GET /rss.xml?handle=ryanjoseph.dev` - User-specific RSS feed

### Redis Commands
```bash
# View posts for a prefix
redis-cli LRANGE all-doodles:posts 0 -1

# Check processed URIs
redis-cli SMEMBERS all-doodles:processed-uris

# View session data
redis-cli GET all-doodles:saved-session

# User configuration
redis-cli HGETALL __doodles:users
```

## Content Filtering

### Automatic Filtering
- Posts without images are skipped
- NSFW content filtered via hashtags (#nsfw, #noindex) and Bluesky labels
- Only posts containing the configured hashtag are processed

### Multi-User Support
The system simultaneously tracks:
- **All Users**: Every post with the configured hashtag (stored in `all-doodles:*`)
- **Specific Users**: Individual user feeds (configured via `__doodles:users`)
- **Fallback**: Unconfigured users default to `user-[handle]:*` prefix

### Hashtag Configuration
The hashtag to monitor is configured via the `HASHTAG_TO_WATCH` environment variable (defaults to `#YourTag`). This allows you to track any hashtag on Bluesky:

```bash
# Watch a different hashtag
HASHTAG_TO_WATCH="#ArtDaily" docker-compose up -d

# Or add to your .env file
echo "HASHTAG_TO_WATCH=#WeeklySketch" >> .env
```

The frontend automatically fetches and displays the configured hashtag throughout the interface via the `/api/config` endpoint.

### Port Configuration
The frontend port is configurable via the `PORT` environment variable (defaults to 3000):

```bash
# Use a different port
PORT=8080 docker-compose up -d

# Or add to your .env file
echo "PORT=8080" >> .env

# Run development server on custom port
PORT=8080 npm run dev
```

## Troubleshooting

### Common Issues
- **Redis Connection**: Ensure Redis is running and `REDIS_URL` is correct
- **Bluesky Auth**: Verify `BLUESKY_IDENT` and `BLUESKY_PASS` are valid
- **2FA Required**: Listener will prompt for auth code during login
- **Missing Posts**: Run backfill script for historical posts
- **Image Loading**: Check Next.js remote patterns in `next.config.js`

### Debugging
```bash
# Check Redis connectivity
redis-cli ping

# View all Redis keys
redis-cli KEYS "*posts*"

# Monitor listener logs
docker-compose logs -f listener

# Check frontend build
cd frontend && npm run build
```

## License

This project is for educational and personal use. Bluesky content belongs to respective authors.