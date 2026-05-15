#!/usr/bin/env ts-node
/**
 * CLI: run a Reddit search through exactly the same path the per-post
 * Reddit card uses internally. Useful when prototyping a `reddit_query`
 * override before committing it — you can compare different phrasings
 * and see what the widget would actually display.
 *
 * Usage (note the `--` so npm forwards args to the script):
 *   npm run reddit-query -- "depancel autosport"
 *   npm run reddit-query -- "Brew Metric HP-1"
 *
 * Imports searchPosts() from frontend/lib/reddit.ts so backend order,
 * filtering, sort, and result-cap stay in lockstep with the live API.
 * The cross-project import goes through ts-node with --transpile-only
 * to skip the listener tsconfig's rootDir check (the script in the
 * listener npm script handles this).
 */

import { searchPosts } from '../frontend/lib/reddit';

function relativeAge(iso: string): string {
  if (!iso) return '';
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (isNaN(sec)) return '';
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 30 * 86400) return `${Math.floor(sec / 86400)}d ago`;
  if (sec < 365 * 86400) return `${Math.floor(sec / (30 * 86400))}mo ago`;
  return `${Math.floor(sec / (365 * 86400))}y ago`;
}

async function main() {
  const query = process.argv.slice(2).join(' ').trim();
  if (!query) {
    console.error('Usage: npm run reddit-query -- "<query>"');
    console.error('Example: npm run reddit-query -- "Depancel Autosport Green"');
    process.exit(1);
  }

  let result;
  try {
    result = await searchPosts(query);
  } catch (e) {
    console.error(`Reddit search failed: ${(e as Error).message}`);
    process.exit(1);
  }

  console.log(`# query:   ${result.query}`);
  console.log(`# backend: ${result.backend}`);
  console.log(`# posts:   ${result.posts.length}  (post-filter, capped at 3)`);
  console.log('');

  if (result.posts.length === 0) {
    console.log('(no posts matched after filtering)');
    return;
  }

  for (const p of result.posts) {
    const age = relativeAge(p.createdAt);
    console.log(`r/${p.subreddit}  ${age}  ${p.score}↑`);
    console.log(`  ${p.title}`);
    console.log(`  ${p.permalink}`);
    console.log('');
  }
}

// process.exit on success because the lib's module-scope Redis client
// keeps the event loop alive (the subreddit-list lookup opens a
// connection that has no graceful-close hook from this side). The CLI is
// one-shot, so exit forcibly once we've printed results.
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
