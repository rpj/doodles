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

async function rebuildIndices() {
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  
  console.log('Starting index rebuild...');
  
  // Get all posts
  const allPosts = await redis.lrange('all-doodles:posts', 0, -1);
  console.log(`Found ${allPosts.length} posts to index`);
  
  // Clear all existing handle indices
  const handles = await redis.smembers('handles:all');
  for (const handle of handles) {
    await redis.del(`handle:${handle}:posts`);
  }
  await redis.del('handles:all');
  console.log('Cleared existing indices');
  
  // Create a map of handle to post indices
  const handleMap = new Map<string, number[]>();
  
  // Process each post
  for (let i = 0; i < allPosts.length; i++) {
    try {
      const post: DoodlePost = JSON.parse(allPosts[i]);
      
      if (!handleMap.has(post.authorHandle)) {
        handleMap.set(post.authorHandle, []);
      }
      handleMap.get(post.authorHandle)!.push(i);
    } catch (e) {
      console.error(`Failed to parse post at index ${i}:`, e);
    }
  }
  
  console.log(`Found ${handleMap.size} unique handles`);
  
  // Store the indices for each handle
  for (const [handle, indices] of handleMap.entries()) {
    const handleKey = `handle:${handle}:posts`;
    
    // Add indices in reverse order (newest first) to match the list order
    for (const index of indices) {
      await redis.rpush(handleKey, index.toString());
    }
    
    // Add to the set of all handles
    await redis.sadd('handles:all', handle);
    
    console.log(`Indexed ${indices.length} posts for @${handle}`);
  }
  
  console.log('Index rebuild complete!');
  redis.disconnect();
}

if (require.main === module) {
  rebuildIndices().catch(console.error);
}