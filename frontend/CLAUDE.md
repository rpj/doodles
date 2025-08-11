# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Next.js frontend for "Daily Doodles" - a web application that displays art posted to Bluesky with the #DailyDoodle hashtag. The app features a gallery view and individual post pages with a sophisticated Art Deco-inspired black/white design with metallic silver accents.

## Development Commands

- `npm run dev` - Start development server on port 30069
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

## Architecture & Data Flow

### Core Data Structure
The application centers around the `DoodlePost` type (defined in `lib/redis.ts`) which represents a Bluesky post with associated metadata. Each post can have multiple images, and the system creates separate entries for each image (identified by URI + image index).

### Data Sources
- **Redis**: Primary data store containing pre-processed Bluesky posts in `doodles:posts` list
- **External Images**: Served from `cdn.bsky.app` and `bsky.social` (configured in `next.config.js`)

### Key Architecture Patterns

**Multi-Image Post Handling**: When a Bluesky post contains multiple images, each gets a separate `DoodlePost` entry with URIs like `at://...post/ID#image0`, `at://...post/ID#image1`. The `lib/utils.ts` functions handle parsing these URIs for routing.

**Theme System**: CSS custom properties in `styles/globals.css` define light/dark themes applied via `data-theme` attribute. The `ThemeContext` manages state and localStorage persistence.

**RSS Generation**: Dynamic RSS feed at `/rss.xml` route using Next.js `getServerSideProps` to fetch and format data server-side.

## Routing Structure

- `/` - Main gallery (server-rendered with client-side refresh)
- `/post/[id]` - Individual post pages where `[id]` is the extracted post ID + optional image index
- `/rss.xml` - RSS feed endpoint (server-generated XML)

## Styling Approach

**Design System**: Art Deco-inspired with strict black/white contrast and metallic silver accents. Uses CSS custom properties for theme-aware colors.

**Component Styling**: CSS Modules for scoped styles. Key modules:
- `Home.module.css` - Main page with dramatic title effects
- `DoodleCard.module.css` - Gallery cards with hover animations
- `Post.module.css` - Individual post pages

**Typography**: Google Fonts 'Limelight' for headings, 'Fascinate' for body text.

## Important Implementation Details

**Hydration Safety**: Individual post pages use client-side mounting detection to avoid server/client date formatting mismatches.

**Image Optimization**: Next.js Image component with remote patterns configured for Bluesky CDN domains.

**Error Handling**: Redis connection errors gracefully handled in API routes with appropriate HTTP status codes.

**Performance**: RSS feed cached for 1 hour, gallery auto-refreshes every 5 minutes on the client.

## Testing Policy
**IMPORTANT**: Do not run tests, builds, or any validation commands unless explicitly requested in the prompt. The user will handle all testing and provide feedback on any errors or changes needed.