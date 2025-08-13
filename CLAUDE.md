# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Daily Doodles is a full-stack application that collects and displays art posts from Bluesky tagged with #DailyDoodle. The system consists of a Node.js listener service that monitors Bluesky, a Next.js frontend for display, and Redis for data storage, all orchestrated with Docker Compose.

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
npm run backfill       # Import existing doodle posts (run once)
```

### Frontend (./frontend/)
```bash
npm run dev           # Development server on port 30069
npm run build         # Production build  
npm run start         # Production server
npm run lint          # ESLint
```

### Initial Setup Workflow
1. `cp .env.example .env` and configure Bluesky credentials
2. `cd listener && REDIS_URL=redis://localhost:6379 npm run backfill`
3. `docker-compose up -d` OR run services individually for development

## Architecture

### Service Architecture
- **Listener**: Unified service that polls Bluesky every ~5 minutes for #DailyDoodle posts and fans them out to multiple Redis prefixes based on configurable filters. Supports unlimited handle-based filtering via environment variables.
- **Frontend**: Next.js app with path-based routing: `/` shows all doodles, `/[handle]` shows user-specific doodles. Server-side rendering with auto-refresh gallery.
- **Redis**: Stores processed posts using configurable prefixes (`all-doodles:*` for all posts, `doodles:*` for ryanjoseph.dev, `user-[handle]:*` for additional users)

### Key Data Structure
```typescript
type DoodlePost = {
  uri: string,           // "at://did/app.bsky.feed.post/id#imageN"
  authorHandle: string,
  authorDisplayName: string,
  text: string,
  imageUrls: string[],
  createdAt: string,
  postUrl: string,
}
```

### Multi-Image Handling
Posts with multiple images are split into separate `DoodlePost` entries with URIs like `at://...#image0`, `at://...#image1`. This enables individual image routing and display.

### Frontend Routing
- `/` - All doodles gallery (server-rendered, client auto-refresh every 5 minutes)
- `/[handle]` - User-specific doodles (e.g., `/ryanjoseph.dev` for personal posts)
- `/post/[id]` - Individual post pages using extracted post ID + image index
- `/rss.xml` - RSS feed endpoint (server-generated, 1-hour cache, supports `?handle=` parameter)

### Styling System
Art Deco-inspired black/white design with metallic silver accents. Uses CSS custom properties for theming and CSS Modules for component scoping. Fonts: 'Limelight' for headings, 'Fascinate' for body.

## Environment Variables
- `BLUESKY_IDENT` - Bluesky username/handle (required)
- `BLUESKY_PASS` - Bluesky app password (required)  
- `REDIS_URL` - Redis connection string (defaults to redis://localhost:6379)
- `DOODLE_POLLING_FREQ_SECONDS` - Listener polling interval (default: 300)
- `DOODLE_FILTERS` - Additional user filters in format `handle1:prefix1,handle2:prefix2` (optional)

### Filter Configuration
The listener now supports multiple filter modes simultaneously:
- **All Doodles** (`all-doodles:*` prefix): Collects all #DailyDoodle posts, filters NSFW content
- **Personal Posts** (`doodles:*` prefix): Only ryanjoseph.dev posts (hardcoded)  
- **Custom Users** (`user-[handle]:*` prefix): Additional users via `DOODLE_FILTERS` environment variable

Example: `DOODLE_FILTERS=artist.bsky.social:artist-doodles,creative.bsky.social:creative-doodles`

## Docker Configuration
Uses `network_mode: 'host'` for both services. Services auto-restart unless manually stopped. Environment variables sourced from host `.env` file.

## Testing Policy
**IMPORTANT**: Do not run tests, builds, or any validation commands unless explicitly requested in the prompt. The user will handle all testing and provide feedback on any errors or changes needed.