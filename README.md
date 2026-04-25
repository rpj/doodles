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