import { AtpAgent, ComAtprotoServerCreateSession, AtpSessionEvent, AtpSessionData } from '@atproto/api';
import { Redis } from 'ioredis';
import { input } from '@inquirer/prompts';

const REDIS_SET_NAME = `all-doodles:processed-uris`;
const REDIS_DOODLE_LIST = `all-doodles:posts`;
const REDIS_SESSION_NAME = `all-doodles:saved-session`;

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
  'https://bsky.app/profile/ryanjoseph.dev/post/3lw33akaxac2t',
  'https://bsky.app/profile/ryanjoseph.dev/post/3lw3w62m3jc26',
  'https://bsky.app/profile/ryanjoseph.dev/post/3lw62wru7ms2r',
  'https://bsky.app/profile/ryanjoseph.dev/post/3lwdkoeaknc2l',
  'https://bsky.app/profile/ryanjoseph.dev/post/3lwhcpqlhzs25',
];

async function login(agent: AtpAgent, redis: Redis): Promise<string> {
  async function loginImpl(): Promise<ComAtprotoServerCreateSession.Response> {
    const params = {
      identifier: process.env.BLUESKY_IDENT as string,
      password: process.env.BLUESKY_PASS as string,
      authFactorToken: undefined
    };

    try {
      return await agent.login(params);
    } catch (e: any) {
      if (e.status === 401 && e.error === 'AuthFactorTokenRequired') {
        const token = await input({ message: 'Enter the auth code sent to you via email:' });
        return agent.login({
          ...params,
          authFactorToken: token
        });
      }

      throw e;
    }
  }

  console.log(`Authenticating as @${process.env.BLUESKY_IDENT}...`);
  const savedSession = await redis.get(REDIS_SESSION_NAME);
  if (savedSession) {
    try {
      console.log('Reusing saved session...');
      const { data: { handle } } = await agent.resumeSession(JSON.parse(savedSession));
      return handle;
    } catch (e) {
      console.error('resumeSession failed!', e);
      await redis.del(REDIS_SESSION_NAME);
    }
  }

  const response = await loginImpl();
  await redis.set(REDIS_SESSION_NAME, JSON.stringify(response.data));
  return response.data.handle;
}

function extractImagesFromPost(post: any): string[] {
  const images: string[] = [];
  
  // Check embed in the post
  if (post.embed) {
    const embedType = post.embed['$type'];
    
    // Image view embeds
    if (embedType === 'app.bsky.embed.images#view' && post.embed.images) {
      images.push(...post.embed.images.map(({ fullsize }: any) => fullsize));
    }
    
    // Record with media (only process images, skip videos)
    if (embedType === 'app.bsky.embed.recordWithMedia#view' && post.embed.media) {
      if (post.embed.media['$type'] === 'app.bsky.embed.images#view' && post.embed.media.images) {
        images.push(...post.embed.media.images.map(({ fullsize }: any) => fullsize));
      }
      // Skip videos - we don't want video thumbnails
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
    
    // Resolve the handle to get the DID
    console.log(`Resolving handle: ${handle}`);
    const { data: { did } } = await agent.resolveHandle({ handle });
    console.log(`Resolved ${handle} to ${did}`);
    
    const uri = `at://${did}/app.bsky.feed.post/${postId}`;
    
    // Check if already processed
    if (await redis.sismember(REDIS_SET_NAME, uri)) {
      console.log(`Post already processed: ${postUrl}`);
      return;
    }
    
    // For public posts, we can use getPosts endpoint
    console.log(`Fetching post: ${uri}`);
    const postsResponse = await agent.getPosts({ uris: [uri] });
    
    if (!postsResponse.data.posts || postsResponse.data.posts.length === 0) {
      console.error(`Could not fetch post: ${postUrl}`);
      console.error('Response:', JSON.stringify(postsResponse.data, null, 2));
      return;
    }
    
    const post = postsResponse.data.posts[0] as any;
    
    // Extract images
    const imageUrls = extractImagesFromPost(post);
    
    if (imageUrls.length === 0) {
      console.log(`No images found in post: ${postUrl}`);
      return;
    }
    
    // Create separate doodle post for each image
    for (let i = 0; i < imageUrls.length; i++) {
      const imageUri = `${uri}#image${i}`;
      
      // Check if this specific image was already processed
      if (await redis.sismember(REDIS_SET_NAME, imageUri)) {
        console.log(`Image ${i + 1} already processed: ${postUrl}`);
        continue;
      }
      
      const doodlePost: DoodlePost = {
        uri: imageUri,
        authorHandle: post.author?.handle || handle,
        authorDisplayName: post.author?.displayName || post.author?.handle || handle,
        text: post.record?.text || '',
        imageUrls: [imageUrls[i]], // Single image per post
        createdAt: post.record?.createdAt || new Date().toISOString(),
        postUrl
      };
      
      // Store in Redis (using RPUSH to maintain chronological order)
      await redis.rpush(REDIS_DOODLE_LIST, JSON.stringify(doodlePost));
      await redis.sadd(REDIS_SET_NAME, imageUri);
      
      // Store the full post data with URI as key
      await redis.set(`post:${imageUri}`, JSON.stringify(doodlePost));
      
      // Update handle list with URI instead of index
      const handleKey = `handle:${post.author?.handle || handle}:posts`;
      await redis.rpush(handleKey, imageUri);
      
      // Add handle to the set of all handles
      await redis.sadd('handles:all', post.author?.handle || handle);
      
      console.log(`Backfilled doodle ${i + 1}/${imageUrls.length} from @${post.author?.handle || handle}: "${doodlePost.text.substring(0, 50)}..."`);
    }
    
    // Also mark the original post URI as processed
    await redis.sadd(REDIS_SET_NAME, uri);
  } catch (error) {
    console.error(`Error backfilling post ${postUrl}:`, error);
  }
}

async function main() {
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  const agent = new AtpAgent({
    service: 'https://bsky.social',
  });
  
  // Clear previously processed posts so we can re-process them
  console.log('Clearing processed posts...');
  await redis.del(REDIS_SET_NAME);
  await redis.del(REDIS_DOODLE_LIST);
  
  // Authenticate with 2FA support
  await login(agent, redis);
  
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
