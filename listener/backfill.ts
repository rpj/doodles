import { AtpAgent } from '@atproto/api';
import { Redis } from 'ioredis';

const REDIS_SET_NAME = `doodles:processed-uris`;
const REDIS_DOODLE_LIST = `doodles:posts`;

type DoodlePost = {
  uri: string,
  authorHandle: string,
  authorDisplayName: string,
  text: string,
  imageUrls: string[],
  createdAt: string,
  postUrl: string,
};

// Hardcoded list of posts to backfill (in chronological order)
const BACKFILL_POSTS = [
  'https://bsky.app/profile/ryanjoseph.dev/post/3lv2tcvqans2a',
  'https://bsky.app/profile/ryanjoseph.dev/post/3lvizc7azw22q',
  'https://bsky.app/profile/ryanjoseph.dev/post/3lvjveozfms2k',
  'https://bsky.app/profile/ryanjoseph.dev/post/3lvz2tcmq5k2k',
  'https://bsky.app/profile/ryanjoseph.dev/post/3lw2u3izcmc2t'
];

function extractImagesFromPost(post: any): string[] {
  const images: string[] = [];
  const embed = post.value?.embed || post.embed;
  
  if (!embed) return images;
  
  const embedType = embed['$type'];
  
  // Direct image embeds
  if (embedType === 'app.bsky.embed.images' && embed.images) {
    images.push(...embed.images.map(({ image }: any) => image.ref.$link));
  }
  
  // For view objects
  if (post.embeds && post.embeds[0]) {
    const viewEmbed = post.embeds[0];
    if (viewEmbed['$type'] === 'app.bsky.embed.images#view' && viewEmbed.images) {
      images.push(...viewEmbed.images.map(({ fullsize }: any) => fullsize));
    }
  }
  
  return images;
}

async function backfillPost(agent: AtpAgent, redis: Redis, postUrl: string): Promise<void> {
  try {
    // Extract handle and post ID from URL
    const match = postUrl.match(/profile\/([^\/]+)\/post\/([^\/]+)/);
    if (!match) {
      console.error(`Invalid post URL format: ${postUrl}`);
      return;
    }
    
    const [, handle, postId] = match;
    const uri = `at://${handle}/app.bsky.feed.post/${postId}`;
    
    // Check if already processed
    if (await redis.sismember(REDIS_SET_NAME, uri)) {
      console.log(`Post already processed: ${postUrl}`);
      return;
    }
    
    // Get the post thread to extract all information
    const threadResponse = await agent.getPostThread({ uri });
    const threadData = threadResponse.data.thread;
    
    if (!threadData || !('post' in threadData)) {
      console.error(`Could not fetch post: ${postUrl}`);
      return;
    }
    
    const post = threadData.post;
    
    // Extract images
    const imageUrls = extractImagesFromPost(post);
    
    if (imageUrls.length === 0) {
      console.log(`No images found in post: ${postUrl}`);
      return;
    }
    
    // Create doodle post object
    const doodlePost: DoodlePost = {
      uri,
      authorHandle: post.author.handle,
      authorDisplayName: post.author.displayName || post.author.handle,
      text: (post.record as any)?.text || '',
      imageUrls,
      createdAt: (post.record as any)?.createdAt || new Date().toISOString(),
      postUrl
    };
    
    // Store in Redis (using RPUSH to maintain chronological order)
    await redis.rpush(REDIS_DOODLE_LIST, JSON.stringify(doodlePost));
    await redis.sadd(REDIS_SET_NAME, uri);
    
    console.log(`Backfilled doodle from @${post.author.handle}: "${doodlePost.text.substring(0, 50)}..."`);
  } catch (error) {
    console.error(`Error backfilling post ${postUrl}:`, error);
  }
}

async function main() {
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  const agent = new AtpAgent({
    service: 'https://bsky.social',
  });
  
  console.log('Starting backfill process...');
  console.log(`Processing ${BACKFILL_POSTS.length} posts`);
  
  // Process posts in order
  for (const postUrl of BACKFILL_POSTS) {
    await backfillPost(agent, redis, postUrl);
    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('Backfill complete!');
  redis.disconnect();
}

if (require.main === module) {
  main().catch(console.error);
}