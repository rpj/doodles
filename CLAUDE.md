# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Watches is a full-stack Bluesky-tag aggregator. Originally built as "Daily Doodles" for daily-art aggregation; the codebase still uses `all-doodles:` Redis key prefixes as a historical artifact. Posts are tagged with a configurable hashtag set via `HASHTAG_TO_WATCH`. The system consists of a Node.js listener service that monitors Bluesky, a Next.js frontend for display, and Redis for data storage, all orchestrated with Docker Compose.

## Development Commands

### Root Level
```bash
# Start all services in production
docker-compose up -d

# Setup environment
cp .env.example .env
# Edit .env with your Bluesky credentials
```

### Listener Service (./listener/)
```bash
npm run start          # Start the unified listener service (handles all modes)
npm run backfill       # Import existing posts (run once)
```

### Frontend (./frontend/)
```bash
npm run dev           # Development server (default port 3000, configurable via PORT env var)
npm run build         # Production build
npm run start         # Production server (respects PORT env var)
npm run lint          # ESLint
```

### Initial Setup Workflow
1. `cp .env.example .env` and configure Bluesky credentials
2. `cd listener && REDIS_URL=redis://localhost:6379 npm run backfill`
3. `docker-compose up -d` OR run services individually for development

## Architecture

### Service Architecture
- **Listener**: Unified service that polls Bluesky every ~5 minutes for posts with the configured hashtag and fans them out to multiple Redis prefixes based on configurable filters. Supports handle-based filtering via shared configuration.
- **Frontend**: Next.js app with path-based routing: `/` shows all posts, `/[handle]` shows user-specific posts. Server-side rendering with auto-refresh gallery. Dynamically displays the configured hashtag.
- **Redis**: Stores processed posts using configurable prefixes (`all-doodles:*` for all posts, `doodles:*` for ryanjoseph.dev, `doodles-kaciecamilli:*` for kaciecamilli.bsky.social)

### Key Data Structure
```typescript
type Post = {
  uri: string,           // "at://did/app.bsky.feed.post/id#imageN"
  authorHandle: string,
  authorDisplayName: string,
  text: string,          // Bluesky display text (inline URLs may be truncated)
  imageUrls: string[],
  createdAt: string,
  postUrl: string,
  facets?: Facet[],      // Bluesky rich-text facets — used by the post page to render full inline URLs / hashtags / mentions as clickable links
}
```

### Multi-Image Handling
Posts with multiple images are split into separate `Post` entries with URIs like `at://...#image0`, `at://...#image1`. This enables individual image routing and display.

### Frontend Routing
- `/` - All posts gallery (server-rendered, client auto-refresh every 5 minutes)
- `/[handle]` - User-specific posts (e.g., `/ryanjoseph.dev` for personal posts)
- `/post/[id]` - Individual post pages using extracted post ID + image index
- `/rss.xml` - RSS feed endpoint (server-generated, 1-hour cache, supports `?handle=` parameter)

### Styling System
Art Deco-inspired black/white design with metallic silver accents. Uses CSS custom properties for theming and CSS Modules for component scoping. Fonts: 'Limelight' for headings, 'Fascinate' for body.

## Environment Variables
- `BLUESKY_IDENT` - Bluesky username/handle (required)
- `BLUESKY_PASS` - Bluesky app password (required)
- `REDIS_URL` - Redis connection string (defaults to redis://localhost:6379)
- `POLLING_FREQ_SECONDS` - Listener polling interval (default: 300)
- `HASHTAG_TO_WATCH` - The hashtag to monitor (default: #YourTag). Include the # prefix.
- `HANDLES_TO_WATCH` - Comma-separated list of Bluesky handles to limit collection.
- `SITE_TITLE` - Human-readable wordmark for the gallery masthead. Falls back to the hashtag when unset.
- `PORT` - Frontend server port (default: 3000)

### Filter Configuration
The listener supports multiple filter modes simultaneously:
- **All posts** (`all-doodles:*` prefix): Collects all posts with the configured hashtag, filters NSFW content
- **Personal Posts** (`doodles:*` prefix): Only ryanjoseph.dev posts
- **Specific Users**: Additional users configured in `shared/config.js`

Filter mappings are centrally managed in `shared/config.js` to avoid duplication between frontend and listener.

### Hashtag Configuration
The hashtag to watch is configured via the `HASHTAG_TO_WATCH` environment variable, managed through `shared/config.js`. This allows the application to monitor any hashtag on Bluesky. The frontend fetches the configuration via the `/api/config` endpoint to dynamically display the correct hashtag throughout the interface.

## Docker Configuration
Uses `network_mode: 'host'` for both services. Services auto-restart unless manually stopped. Environment variables sourced from host `.env` file.

## Testing Policy
**IMPORTANT**: Do not run tests, builds, or any validation commands unless explicitly requested in the prompt. The user will handle all testing and provide feedback on any errors or changes needed.