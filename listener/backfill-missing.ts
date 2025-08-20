#!/usr/bin/env ts-node

import { Redis } from 'ioredis';

type DoodlePost = {
  uri: string,
  authorHandle: string,
  authorDisplayName: string,
  text: string,
  imageUrls: string[],
  createdAt: string,
  postUrl: string,
};

async function backfillMissing() {
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  
  console.log('Backfilling missing ryanjoseph.dev posts...\n');
  
  // Get all posts from doodles:posts (which has the complete set)
  const doodlesPosts = await redis.lrange('doodles:posts', 0, -1);
  console.log(`Found ${doodlesPosts.length} total posts in doodles:posts`);
  
  // Get current posts in all-doodles:posts
  const allDoodlesPosts = await redis.lrange('all-doodles:posts', 0, -1);
  const existingUris = new Set<string>();
  
  for (const postStr of allDoodlesPosts) {
    try {
      const post: DoodlePost = JSON.parse(postStr);
      existingUris.add(post.uri);
    } catch (e) {
      // Skip invalid posts
    }
  }
  
  console.log(`Found ${allDoodlesPosts.length} posts in all-doodles:posts`);
  console.log(`Found ${existingUris.size} unique URIs in all-doodles:posts\n`);
  
  // Process each post from doodles:posts
  let addedCount = 0;
  const missingPosts: DoodlePost[] = [];
  
  for (const postStr of doodlesPosts) {
    try {
      const post: DoodlePost = JSON.parse(postStr);
      
      // Check if this post is missing from all-doodles:posts
      if (!existingUris.has(post.uri)) {
        missingPosts.push(post);
        console.log(`Found missing post: ${post.uri}`);
        console.log(`  Post URL: ${post.postUrl}`);
        console.log(`  Created: ${post.createdAt}`);
      }
    } catch (e) {
      console.error('Failed to parse post:', e);
    }
  }
  
  if (missingPosts.length === 0) {
    console.log('No missing posts found!');
    redis.disconnect();
    return;
  }
  
  console.log(`\nFound ${missingPosts.length} missing posts. Adding them now...\n`);
  
  // Sort missing posts by date (oldest first) to maintain chronological order
  missingPosts.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  
  for (const post of missingPosts) {
    // Add to all-doodles:posts (using RPUSH to add at the end, maintaining order)
    await redis.rpush('all-doodles:posts', JSON.stringify(post));
    
    // Add to processed URIs set
    await redis.sadd('all-doodles:processed-uris', post.uri);
    
    // Store the full post data with URI as key (new format)
    await redis.set(`post:${post.uri}`, JSON.stringify(post));
    
    // Add URI to handle list
    const handleKey = `handle:${post.authorHandle}:posts`;
    
    // Check if the URI is already in the handle list
    const handleUris = await redis.lrange(handleKey, 0, -1);
    if (!handleUris.includes(post.uri)) {
      // Add to handle list (RPUSH to maintain order)
      await redis.rpush(handleKey, post.uri);
      console.log(`Added ${post.uri} to ${handleKey}`);
    }
    
    // Ensure handle is in the all handles set
    await redis.sadd('handles:all', post.authorHandle);
    
    addedCount++;
  }
  
  console.log(`\nSuccessfully backfilled ${addedCount} posts!`);
  
  // Verify the results
  const newTotal = await redis.llen('all-doodles:posts');
  const handleTotal = await redis.llen('handle:ryanjoseph.dev:posts');
  
  console.log(`\nVerification:`);
  console.log(`  Total posts in all-doodles:posts: ${newTotal}`);
  console.log(`  Total posts in handle:ryanjoseph.dev:posts: ${handleTotal}`);
  
  redis.disconnect();
}

if (require.main === module) {
  backfillMissing().catch(console.error);
}