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

// No longer need multiple prefixes - everything is in all-doodles
function getPrefix(): string {
  return 'all-doodles';
}

async function findPostInRedis(redis: Redis, postId: string): Promise<DoodlePost[]> {
  const prefix = getPrefix();
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
  
  return matchingPosts;
}

async function deletePostFromRedis(redis: Redis, postId: string, imageNumber?: number): Promise<void> {
  const prefix = getPrefix();
  const postsKey = `${prefix}:posts`;
  const processedUrisKey = `${prefix}:processed-uris`;
  
  // Get all posts
  const postsList = await redis.lrange(postsKey, 0, -1);
  const postsToKeep: string[] = [];
  const urisToRemove: string[] = [];
  const handleUrisToRemove: Map<string, string[]> = new Map();
  let totalDeleted = 0;
  
  postsList.forEach((postJson) => {
    try {
      const post: DoodlePost = JSON.parse(postJson);
      
      // Check if this post's URI contains the postId
      if (post.uri.includes(`/${postId}`) || post.uri.includes(`/${postId}#`)) {
        // If imageNumber is specified, only delete that specific image
        if (imageNumber !== undefined) {
          const expectedUri = `at://${post.uri.split('//')[1].split('#')[0]}#image${imageNumber}`;
          if (post.uri === expectedUri) {
            urisToRemove.push(post.uri);
            totalDeleted++;
            console.log(`Found matching image ${imageNumber}: ${post.uri}`);
            
            // Track URIs to remove from handle lists
            if (!handleUrisToRemove.has(post.authorHandle)) {
              handleUrisToRemove.set(post.authorHandle, []);
            }
            handleUrisToRemove.get(post.authorHandle)!.push(post.uri);
          } else {
            postsToKeep.push(postJson);
          }
        } else {
          // Delete all images for this post
          urisToRemove.push(post.uri);
          totalDeleted++;
          console.log(`Found matching post: ${post.uri}`);
          
          // Track URIs to remove from handle lists
          if (!handleUrisToRemove.has(post.authorHandle)) {
            handleUrisToRemove.set(post.authorHandle, []);
          }
          handleUrisToRemove.get(post.authorHandle)!.push(post.uri);
        }
      } else {
        postsToKeep.push(postJson);
      }
    } catch (e) {
      // Keep malformed JSON as-is
      postsToKeep.push(postJson);
    }
  });
  
  if (urisToRemove.length > 0) {
    // Replace the entire list with posts that don't match
    await redis.del(postsKey);
    if (postsToKeep.length > 0) {
      await redis.rpush(postsKey, ...postsToKeep);
    }
    
    // Remove from processed URIs set and delete individual post keys
    for (const uri of urisToRemove) {
      await redis.srem(processedUrisKey, uri);
      // Also remove the base URI (without #image suffix)
      const baseUri = uri.split('#')[0];
      await redis.srem(processedUrisKey, baseUri);
      
      // Delete the individual post key (new architecture)
      await redis.del(`post:${uri}`);
      console.log(`Deleted post key: post:${uri}`);
    }
    
    // Update handle lists for affected handles (new architecture)
    console.log('Updating handle lists for affected handles...');
    for (const [handle, uris] of handleUrisToRemove) {
      const handleKey = `handle:${handle}:posts`;
      
      // Get current URIs for this handle
      const currentUris = await redis.lrange(handleKey, 0, -1);
      
      // Filter out the URIs we're removing
      const remainingUris = currentUris.filter(uri => !uris.includes(uri));
      
      // Update the handle list
      await redis.del(handleKey);
      if (remainingUris.length > 0) {
        await redis.rpush(handleKey, ...remainingUris);
        console.log(`Updated ${handle}: ${remainingUris.length} posts remaining`);
      } else {
        // Remove handle from all handles set if they have no posts
        await redis.srem('handles:all', handle);
        console.log(`Removed ${handle} from handles (no posts remaining)`);
      }
    }
    
    console.log(`Removed ${urisToRemove.length} posts`);
  }
  
  console.log(`Total posts deleted: ${totalDeleted}`);
}

async function main() {
  const args = process.argv.slice(2);
  const deleteMode = args.includes('--delete');
  const imageNumberIndex = args.indexOf('--imageNumber');
  let imageNumber: number | undefined;
  
  if (imageNumberIndex !== -1 && imageNumberIndex + 1 < args.length) {
    const imageNumberStr = args[imageNumberIndex + 1];
    imageNumber = parseInt(imageNumberStr, 10);
    if (isNaN(imageNumber) || imageNumber < 0) {
      console.error('Error: --imageNumber must be a non-negative integer');
      process.exit(1);
    }
    if (!deleteMode) {
      console.error('Error: --imageNumber can only be used with --delete');
      process.exit(1);
    }
  }
  
  const postId = args.find((arg, index) => {
    return !arg.startsWith('--') && (imageNumberIndex === -1 || index !== imageNumberIndex + 1);
  });
  
  if (!postId) {
    console.error('Usage: npx ts-node moderation.ts <postId> [--delete] [--imageNumber <number>]');
    console.error('Example: npx ts-node moderation.ts 3lwk7nrzdzs2b');
    console.error('Example: npx ts-node moderation.ts 3lwk7nrzdzs2b --delete');
    console.error('Example: npx ts-node moderation.ts 3lwk7nrzdzs2b --delete --imageNumber 0');
    process.exit(1);
  }
  
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  
  try {
    if (deleteMode) {
      if (imageNumber !== undefined) {
        console.log(`Deleting image ${imageNumber} from post ${postId}...`);
      } else {
        console.log(`Deleting post ${postId}...`);
      }
      await deletePostFromRedis(redis, postId, imageNumber);
    } else {
      console.log(`Searching for post ${postId}...`);
      const posts = await findPostInRedis(redis, postId);
      
      if (posts.length === 0) {
        console.log('Post not found');
      } else {
        console.log(`\nFound ${posts.length} matching post(s):`);
        for (const post of posts) {
          console.log(`  URI: ${post.uri}`);
          console.log(`  Author: @${post.authorHandle} (${post.authorDisplayName})`);
          console.log(`  Text: ${post.text.substring(0, 100)}${post.text.length > 100 ? '...' : ''}`);
          console.log(`  Images: ${post.imageUrls.length}`);
          console.log(`  Created: ${post.createdAt}`);
          console.log(`  URL: ${post.postUrl}`);
          
          // Add Doodsky link for individual image
          const uriParts = post.uri.split('/');
          const postIdWithImage = uriParts[uriParts.length - 1];
          const doodskyUrl = `https://doodsky.xyz/${post.authorHandle}/post/${encodeURIComponent(postIdWithImage)}`;
          console.log(`  Doodsky: ${doodskyUrl}`);
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