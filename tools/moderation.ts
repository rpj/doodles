#!/usr/bin/env npx ts-node

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

async function getAllPrefixes(redis: Redis): Promise<string[]> {
  const prefixes = ['all-doodles'];
  
  // Get all user prefixes from the Redis hash
  const userPrefixes = await redis.hvals('__doodles:users');
  for (const prefix of userPrefixes) {
    if (!prefixes.includes(prefix)) {
      prefixes.push(prefix);
    }
  }
  
  return prefixes;
}

async function findPostInRedis(redis: Redis, postId: string): Promise<{ prefix: string, posts: DoodlePost[] }[]> {
  const prefixes = await getAllPrefixes(redis);
  const results: { prefix: string, posts: DoodlePost[] }[] = [];
  
  for (const prefix of prefixes) {
    const postsKey = `${prefix}:posts`;
    const postsList = await redis.lrange(postsKey, 0, -1);
    
    const matchingPosts: DoodlePost[] = [];
    
    for (const postJson of postsList) {
      try {
        const post: DoodlePost = JSON.parse(postJson);
        
        // Check if this post's URI contains the postId
        // Handle both regular URIs and multi-image URIs (#image0, #image1, etc)
        if (post.uri.includes(`/${postId}`) || post.uri.includes(`/${postId}#`)) {
          matchingPosts.push(post);
        }
      } catch (e) {
        // Skip malformed JSON
        continue;
      }
    }
    
    if (matchingPosts.length > 0) {
      results.push({ prefix, posts: matchingPosts });
    }
  }
  
  return results;
}

async function deletePostFromRedis(redis: Redis, postId: string): Promise<void> {
  const prefixes = await getAllPrefixes(redis);
  let totalDeleted = 0;
  
  for (const prefix of prefixes) {
    const postsKey = `${prefix}:posts`;
    const processedUrisKey = `${prefix}:processed-uris`;
    
    // Get all posts
    const postsList = await redis.lrange(postsKey, 0, -1);
    const postsToKeep: string[] = [];
    const urisToRemove: string[] = [];
    
    for (const postJson of postsList) {
      try {
        const post: DoodlePost = JSON.parse(postJson);
        
        // Check if this post's URI contains the postId
        if (post.uri.includes(`/${postId}`) || post.uri.includes(`/${postId}#`)) {
          urisToRemove.push(post.uri);
          totalDeleted++;
          console.log(`Found matching post in ${prefix}: ${post.uri}`);
        } else {
          postsToKeep.push(postJson);
        }
      } catch (e) {
        // Keep malformed JSON as-is
        postsToKeep.push(postJson);
      }
    }
    
    if (urisToRemove.length > 0) {
      // Replace the entire list with posts that don't match
      await redis.del(postsKey);
      if (postsToKeep.length > 0) {
        await redis.rpush(postsKey, ...postsToKeep);
      }
      
      // Remove from processed URIs set
      for (const uri of urisToRemove) {
        await redis.srem(processedUrisKey, uri);
        // Also remove the base URI (without #image suffix)
        const baseUri = uri.split('#')[0];
        await redis.srem(processedUrisKey, baseUri);
      }
      
      console.log(`Removed ${urisToRemove.length} posts from ${prefix}`);
    }
  }
  
  console.log(`Total posts deleted: ${totalDeleted}`);
}

async function main() {
  const args = process.argv.slice(2);
  const deleteMode = args.includes('--delete');
  const postId = args.find(arg => !arg.startsWith('--'));
  
  if (!postId) {
    console.error('Usage: npx ts-node moderation.ts <postId> [--delete]');
    console.error('Example: npx ts-node moderation.ts 3lwk7nrzdzs2b');
    console.error('Example: npx ts-node moderation.ts 3lwk7nrzdzs2b --delete');
    process.exit(1);
  }
  
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  
  try {
    if (deleteMode) {
      console.log(`Deleting post ${postId} from all prefixes...`);
      await deletePostFromRedis(redis, postId);
    } else {
      console.log(`Searching for post ${postId} in all prefixes...`);
      const results = await findPostInRedis(redis, postId);
      
      if (results.length === 0) {
        console.log('Post not found in any prefix');
      } else {
        for (const { prefix, posts } of results) {
          console.log(`\nFound in ${prefix}:`);
          for (const post of posts) {
            console.log(`  URI: ${post.uri}`);
            console.log(`  Author: @${post.authorHandle} (${post.authorDisplayName})`);
            console.log(`  Text: ${post.text.substring(0, 100)}${post.text.length > 100 ? '...' : ''}`);
            console.log(`  Images: ${post.imageUrls.length}`);
            console.log(`  Created: ${post.createdAt}`);
            console.log(`  URL: ${post.postUrl}`);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    redis.disconnect();
  }
}

if (require.main === module) {
  main();
}