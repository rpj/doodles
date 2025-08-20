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

async function migrateToUris() {
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  
  console.log('Starting migration to URI-based storage...');
  
  // Get all posts from the main list
  const allPosts = await redis.lrange('all-doodles:posts', 0, -1);
  console.log(`Found ${allPosts.length} posts to migrate`);
  
  // Create post:uri entries for all posts
  let migratedCount = 0;
  for (let i = 0; i < allPosts.length; i++) {
    try {
      const post: DoodlePost = JSON.parse(allPosts[i]);
      
      // Store the post with its URI as key
      await redis.set(`post:${post.uri}`, allPosts[i]);
      migratedCount++;
      
      if (migratedCount % 50 === 0) {
        console.log(`Migrated ${migratedCount} posts...`);
      }
    } catch (e) {
      console.error(`Failed to migrate post at index ${i}:`, e);
    }
  }
  
  console.log(`Created ${migratedCount} post:uri entries`);
  
  // Get all handles
  const handles = await redis.smembers('handles:all');
  console.log(`Found ${handles.length} handles to migrate`);
  
  // For each handle, convert indices to URIs
  for (const handle of handles) {
    const handleKey = `handle:${handle}:posts`;
    const items = await redis.lrange(handleKey, 0, -1);
    
    if (items.length === 0) continue;
    
    // Check if already migrated (first item would be a URI)
    if (items[0].startsWith('at://')) {
      console.log(`Handle ${handle} already migrated, skipping...`);
      continue;
    }
    
    // Convert indices to URIs
    const uris: string[] = [];
    for (const indexStr of items) {
      const index = parseInt(indexStr);
      if (!isNaN(index) && index >= 0 && index < allPosts.length) {
        try {
          const post: DoodlePost = JSON.parse(allPosts[index]);
          uris.push(post.uri);
        } catch (e) {
          console.error(`Failed to parse post at index ${index} for handle ${handle}`);
        }
      }
    }
    
    if (uris.length > 0) {
      // Clear and repopulate the handle list with URIs
      await redis.del(handleKey);
      for (const uri of uris) {
        await redis.rpush(handleKey, uri);
      }
      console.log(`Migrated ${uris.length} posts for @${handle}`);
    }
  }
  
  console.log('Migration complete!');
  console.log('');
  console.log('Note: The all-doodles:posts list is kept for backwards compatibility.');
  console.log('New posts will be stored in both formats until you update all services.');
  
  redis.disconnect();
}

if (require.main === module) {
  migrateToUris().catch(console.error);
}