# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"Daily Doodles" is a full-stack application for collecting and displaying art posts from Bluesky with the #DailyDoodle hashtag. The system consists of:

1. **Listener Service** (Node.js/TypeScript) - Monitors Bluesky for #DailyDoodle posts
2. **Frontend** (Next.js/React) - Web interface for displaying collected doodles 
3. **Redis** - Data storage for posts and session management
4. **Docker Compose** - Orchestrates all services

## Development Commands

### Listener Service
- `npm run start` - Start the main listener service
- `npm run backfill` - Import hardcoded list of existing doodle posts

### Frontend
- `npm run dev` - Development server on port 30069
- `npm run build` - Production build
- `npm run start` - Production server
- `npm run lint` - ESLint

### Full Stack
- `docker-compose up -d` - Start all services in production
- `cd listener && REDIS_URL=redis://localhost:6379 npm run backfill` - Backfill existing posts

## Architecture & Data Flow

### Core Components

**Listener Service Architecture:**
- Uses `@atproto/api` to interact with Bluesky's AT Protocol
- Polls Bluesky search API every ~5 minutes (configurable via `DOODLE_POLLING_FREQ_SECONDS`)
- Maintains session persistence in Redis to avoid re-authentication
- Supports multiple simultaneous filters including all users and specific handles
- Creates separate `DoodlePost` entries for each image in multi-image posts
- Uses Redis sets to track processed URIs and avoid duplicates
- Uses separate Redis prefixes for each mode to keep data isolated

**Data Structure:**
```typescript
type DoodlePost = {
  uri: string,           // Format: "at://did/app.bsky.feed.post/id#imageN"
  authorHandle: string,
  authorDisplayName: string,
  text: string,
  imageUrls: string[],   // Single image per post in listener
  createdAt: string,
  postUrl: string,       // Bluesky web URL
}
```

**Redis Prefixes:**
- `all-doodles:*` - All #DailyDoodle posts from any user (filters NSFW)
- `doodles:*` - Only posts from ryanjoseph.dev
- `user-[handle]:*` - Posts from additional specific users (configured via DOODLE_FILTERS)

Each prefix maintains:
- `posts` - List of serialized DoodlePost objects
- `processed-uris` - Set of processed post/image URIs  
- `saved-session` - Bluesky session data for persistence
- `last-seen-post` - URI of most recent processed post (search optimization)

### Key Processing Logic

**Multi-Image Handling:** Posts with multiple images get split into separate entries with URIs like `at://...#image0`, `at://...#image1`. This allows individual images to be displayed and referenced independently.

**Image Extraction:** Supports multiple Bluesky embed types:
- `app.bsky.embed.images#view` - Direct image embeds
- `app.bsky.embed.recordWithMedia#view` - Quote posts with media
- `app.bsky.embed.video#view` - Video thumbnails

**Backfill Process:** The `backfill.ts` script processes hardcoded post URLs to import pre-hashtag doodles. It clears existing data and rebuilds from scratch.

**Polling Strategy:** Searches in batches until finding the last seen post, with safety limits to prevent infinite loops. On first run, only processes the latest batch.

## Environment Variables

Required:
- `BLUESKY_IDENT` - Bluesky username/handle
- `BLUESKY_PASS` - Bluesky app password
- `REDIS_URL` - Redis connection string (defaults to `redis://localhost:6379`)

Optional:
- `DOODLE_POLLING_FREQ_SECONDS` - Polling interval (default: 300)
- `DOODLE_FILTERS` - Additional user filters in format `handle1:prefix1,handle2:prefix2`

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