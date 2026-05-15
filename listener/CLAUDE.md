# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"Watches" is a full-stack application for collecting and displaying art posts from Bluesky with the #YourTag hashtag. The system consists of:

1. **Listener Service** (Node.js/TypeScript) - Monitors Bluesky for #YourTag posts
2. **Frontend** (Next.js/React) - Web interface for displaying collected posts 
3. **Redis** - Data storage for posts and session management
4. **Docker Compose** - Orchestrates all services

## Development Commands

### Listener Service
- `npm run start` - Start the main listener service
- `npm run backfill` - Import hardcoded list of existing posts
- `npm run backfill-facets` - Re-fetch Bluesky `facets` for legacy posts so the post page can render full URLs / clickable hashtags / mentions. Idempotent; supports `--dry-run` and `--force`.
- `npm run classify-existing` - Walk every stored post chronologically and run the watch classifier (see `watch-classifier/`) to populate `__doodles:watch-meta` and `__doodles:watch-canonical`. Idempotent; supports `--dry-run` and `--force`. Requires the `claude` CLI on PATH.
- `npm run apply-overrides` - Apply manual classification overrides from `__doodles:watch-overrides` and rebuild the canonical list. Pure Redis + (if any override carries `product_url`) immediate fetches against those manufacturer pages to refresh `__doodles:product-prices`. No Claude calls. Supports `--dry-run`.
- `npm run set-override -- <postId> <field> <value>` - Set a single partial-override field (`search_query` or `product_url`) on one post and apply it inline (writes to `__doodles:watch-meta` + fetches the product price). Skips canonical rebuild — only safe for the partial-override allow-list. Empty value clears the field.
- `npm run fetch-prices` - Refresh `__doodles:product-prices` by re-fetching every `product_url` in `watch-meta` and extracting JSON-LD `Product.offers.price`. Supports `--post=<basePostId>`. Listener also runs this on its own cadence (`PRICE_REFRESH_FREQ_SECONDS`, default 6h).
- `npm run reddit-query -- "<query>"` - Print the same filtered Reddit results the per-post Reddit card would show for a given query. Cross-imports `frontend/lib/reddit.ts` so backend/sort/filter match the live API exactly. Use it to prototype a `reddit_query` override before setting it.
- `npm run watch-stats` - Read-only summary of classifier output (totals, by-brand counts, low-confidence list with `--low-confidence`, "other" entries with `--list-other`).

### Frontend
- `npm run dev` - Development server (default port 3000, configurable via PORT)
- `npm run build` - Production build
- `npm run start` - Production server (respects PORT env var)
- `npm run lint` - ESLint

### Full Stack
- `docker-compose up -d` - Start all services in production
- `cd listener && REDIS_URL=redis://localhost:6379 npm run backfill` - Backfill existing posts

## Architecture & Data Flow

### Core Components

**Listener Service Architecture:**
- Uses `@atproto/api` to interact with Bluesky's AT Protocol
- Polls Bluesky search API every ~5 minutes (configurable via `POLLING_FREQ_SECONDS`)
- Maintains session persistence in Redis to avoid re-authentication
- Supports multiple simultaneous filters including all users and specific handles
- Creates separate `Post` entries for each image in multi-image posts
- Uses Redis sets to track processed URIs and avoid duplicates
- Uses separate Redis prefixes for each mode to keep data isolated

**Data Structure:**
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
  uri: string,           // Format: "at://did/app.bsky.feed.post/id#imageN"
  authorHandle: string,
  authorDisplayName: string,
  text: string,          // Bluesky's display form (URLs may be truncated to ~30 chars + …)
  imageUrls: string[],   // Single image per post in listener
  createdAt: string,
  postUrl: string,       // Bluesky web URL
  facets?: Facet[],      // Bluesky rich-text facets — full URIs for inline links, etc.
}
```

**Redis Prefixes:**
- `all-doodles:*` - All #YourTag posts from any user (filters NSFW)
- `doodles:*` - Only posts from ryanjoseph.dev
- `doodles-kaciecamilli:*` - Posts from kaciecamilli.bsky.social

Each prefix maintains:
- `posts` - List of serialized Post objects
- `processed-uris` - Set of processed post/image URIs  
- `saved-session` - Bluesky session data for persistence
- `last-seen-post` - URI of most recent processed post (search optimization)

### Key Processing Logic

**Multi-Image Handling:** Posts with multiple images get split into separate entries with URIs like `at://...#image0`, `at://...#image1`. This allows individual images to be displayed and referenced independently.

**Image Extraction:** Supports multiple Bluesky embed types:
- `app.bsky.embed.images#view` - Direct image embeds
- `app.bsky.embed.recordWithMedia#view` - Quote posts with media
- `app.bsky.embed.video#view` - Video thumbnails

**Backfill Process:** The `backfill.ts` script processes hardcoded post URLs to import pre-hashtag posts. It clears existing data and rebuilds from scratch.

**Polling Strategy:** Searches in batches until finding the last seen post, with safety limits to prevent infinite loops. On first run, only processes the latest batch.

## Environment Variables

Required:
- `BLUESKY_IDENT` - Bluesky username/handle
- `BLUESKY_PASS` - Bluesky app password
- `REDIS_URL` - Redis connection string (defaults to `redis://localhost:6379`)

Optional:
- `POLLING_FREQ_SECONDS` - Polling interval (default: 300)
- `PRICE_REFRESH_FREQ_SECONDS` - Manufacturer product-page price-refresh cadence (default: 21600 = 6h). The listener calls `refreshAllProductPrices` from inside the polling loop, throttled via `__doodles:product-prices:last-refresh`. Only does work if any `__doodles:watch-overrides` entries carry a `product_url`.

## Development Workflow

1. Set up `.env` file with Bluesky credentials
2. Start Redis (via Docker Compose or standalone)
3. Run backfill to import existing posts: `cd listener && REDIS_URL=redis://localhost:6379 npm run backfill`
4. Start listener service: `npm run start` 
5. Start frontend in development mode: `cd ../frontend && npm run dev`

## Docker Deployment

The `docker-compose.yml` uses `network_mode: 'host'` for both services, with environment variables passed from the host `.env` file. Services restart automatically unless stopped manually.

## Testing Policy
**IMPORTANT**: Do not run tests, builds, or any validation commands unless explicitly requested in the prompt. The user will handle all testing and provide feedback on any errors or changes needed.