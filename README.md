# Daily Doodles

A full-stack application that collects and displays art posts from Bluesky tagged with a configurable hashtag (defaults to #DailyDoodle). Features real-time monitoring, multi-user support, RSS feeds, and an Art Deco-inspired gallery interface.

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
   redis-cli HSET __doodles:users artist.bsky.social artist-doodles
   redis-cli HSET __doodles:users creative.bsky.social creative-doodles
   
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
npm install           # Install dependencies
npm run start         # Start listener service
npm run backfill      # Import hardcoded historical posts
npm run backfill-facets  # Re-fetch facets (rich-text URIs/tags/mentions) for legacy posts
```

**Backfilling rich text on legacy posts:**

The listener captures Bluesky's rich-text `facets` array on every new post,
which the post page uses to render full inline URLs / clickable hashtags /
mentions. Posts ingested before this feature was added store a truncated
text without facets. Run `npm run backfill-facets` once to re-fetch every
known post from Bluesky's public API and stamp the original facets onto
the stored DoodlePost record. Idempotent (only fetches posts missing the
field); add `--force` to re-fetch unconditionally; add `--dry-run` to
preview without writing.

**Watch classifier (`watch-classifier/SKILL.md`):**

Each post the listener stores is also fed through a Claude-powered
classifier that decides whether the post is a unique watch, a follow-on
("band upgrade", "wearing it again"), a family/collection shot, an event
post, or other; and extracts brand + model. Used to deduplicate fuzzy
plain-text descriptions for the upcoming stats / by-brand filter UI.

The skill lives at `listener/watch-classifier/SKILL.md` (version-controlled
in this repo) and is also symlinked from `~/.claude/skills/watch-classifier`
for interactive use. The listener calls `claude -p` non-interactively at
post-processing time and stores results in three Redis keys:

- `__doodles:watch-meta` — Hash, basePostId → JSON `{kind, brand, model, references_post_id, confidence, classified_at}`.
- `__doodles:watch-canonical` — List, oldest first, JSON `{post_id, brand, model}` for each unique watch. Drives the canonical-list context the classifier sees on subsequent posts (so post N+1 can be matched against post N's identified watches).
- `__doodles:watch-overrides` — Hash, basePostId → JSON (same shape as `watch-meta`). See the "Watch classification overrides" section below.

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
  "classified_at": "2026-04-25T00:00:00Z"
}
```

`brand` and `model` are required when `kind` is `unique-watch` or
`follow-on`; null otherwise. `references_post_id` is required when `kind`
is `follow-on` (the base post ID of the canonical entry it follows up on);
null otherwise. `confidence` and `classified_at` are stamped by the
classifier; for hand-written overrides set `confidence: 1.0` and any
ISO-8601 timestamp.

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

`apply-overrides` does two things, both pure-Redis (no Claude calls):

1. Copies every entry in `__doodles:watch-overrides` into
   `__doodles:watch-meta`, overwriting the classifier's prior output for
   those posts.
2. Rebuilds `__doodles:watch-canonical` from scratch — walks
   `all-doodles:posts` chronologically and re-derives the canonical list
   from the (now-overridden) meta. So a post previously classified as a
   canonical that's been overridden to `event` no longer appears in the
   canonical list, and a post overridden to `unique-watch` now does.

Run `npm run apply-overrides -- --dry-run` first if you want to preview.

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

**Optional:**
- `REDIS_URL` - Redis connection string (default: `redis://localhost:6379`)
- `DOODLE_POLLING_FREQ_SECONDS` - Listener polling interval (default: 300)
- `HASHTAG_TO_WATCH` - Hashtag to monitor (default: `#DailyDoodle`). Include the # prefix.
- `HANDLES_TO_WATCH` - Comma-separated list of Bluesky handles to limit the collection to. Used to drive the "Generated automatically from @handle" subtitle on the gallery (the first handle in the list).
- `SITE_TITLE` - Human-readable wordmark for the gallery masthead (e.g. `Ryan's Watches`). Falls back to the hashtag itself when unset.
- `PORT` - Frontend server port (default: 3000)

### User Filter Management

User filters are managed at runtime via Redis hash `__doodles:users`:

```bash
# Add new user
redis-cli HSET __doodles:users artist.bsky.social artist-doodles

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

type DoodlePost = {
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
Posts with multiple images are split into separate `DoodlePost` entries:
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
- `posts` - List of serialized DoodlePost objects (chronological)
- `processed-uris` - Set of processed post/image URIs (deduplication)
- `saved-session` - Bluesky session data (authentication persistence)
- `last-seen-post` - Most recent post URI (search optimization)

**Special keys:**
- `__doodles:users` - Hash mapping handles to Redis prefixes (runtime config)
- `__doodles:hero-overrides` - Hash mapping base post IDs to a zero-based image index used as the gallery card preview (see [Hero Image Overrides](#hero-image-overrides))

## Frontend Features

### Routing
- `/` - All doodles gallery with 5-minute auto-refresh
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
- **Hashtag Detection**: Searches for the configured hashtag in post text (defaults to #DailyDoodle)
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
- `GET /api/doodles` - All doodles
- `GET /api/doodles?handle=ryanjoseph.dev` - User-specific doodles
- `GET /rss.xml` - RSS feed (all doodles)
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
The hashtag to monitor is configured via the `HASHTAG_TO_WATCH` environment variable (defaults to `#DailyDoodle`). This allows you to track any hashtag on Bluesky:

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
redis-cli KEYS "*doodles*"

# Monitor listener logs
docker-compose logs -f listener

# Check frontend build
cd frontend && npm run build
```

## License

This project is for educational and personal use. Bluesky content belongs to respective authors.