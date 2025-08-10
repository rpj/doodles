# Daily Doodles

A project to collect and display daily doodle posts from Bluesky.

## Components

1. **Listener** - A Node.js service that watches for Bluesky posts tagged with #DailyDoodle
2. **Frontend** - A Next.js React application that displays the collected doodles
3. **Redis** - Storage for processed posts and session data

## Setup

1. Copy `.env.example` to `.env` and fill in your Bluesky credentials:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your Bluesky handle and app password

3. Run the backfill script to import existing doodles:
   ```bash
   cd listener
   npm install
   REDIS_URL=redis://localhost:6379 npm run backfill
   ```

4. Start the services:
   ```bash
   docker-compose up -d
   ```

## How it works

- The listener polls Bluesky every 5 minutes for posts containing #DailyDoodle and at least one image
- Posts are stored in Redis with their metadata and image URLs
- The frontend displays the doodles in chronological order
- The backfill script imports the pre-existing doodle posts that don't have the hashtag

## Ports

- Frontend: http://localhost:3000
- Redis: localhost:6379