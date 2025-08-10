import { AtpAgent, ComAtprotoServerCreateSession, AtpSessionEvent, AtpSessionData } from '@atproto/api';
import { input } from '@inquirer/prompts';
import { Redis } from 'ioredis';
import { writeFile } from 'fs/promises';

const IDENT = process.env.BLUESKY_IDENT;
const START_TS = Date.now();

const POLLING_FREQ_SECONDS = Number.parseInt(process.env.DOODLE_POLLING_FREQ_SECONDS ?? '300'); // 5 minutes default
const REDIS_SET_NAME = `doodles:processed-uris`;
const REDIS_SESSION_NAME = `doodles:saved-session`;
const REDIS_DOODLE_LIST = `doodles:posts`;
const REDIS_LAST_SEEN_POST = `doodles:last-seen-post`;
const HASHTAG_TO_WATCH = '#DailyDoodle';
const SEARCH_BATCH_SIZE = 25;

type DoodlePost = {
  uri: string,
  authorHandle: string,
  authorDisplayName: string,
  text: string,
  imageUrls: string[],
  createdAt: string,
  postUrl: string,
};

async function login(agent: AtpAgent, redis: Redis): Promise<string> {
  async function loginImpl(): Promise<ComAtprotoServerCreateSession.Response> {
    const params = {
      identifier: IDENT as string,
      password: process.env.BLUESKY_PASS as string,
      authFactorToken: undefined
    };

    try {
      return await agent.login(params);
    } catch (e: any) {
      if (e.status === 401 && e.error === 'AuthFactorTokenRequired') {
        params.authFactorToken = await input({ message: 'Enter the auth code sent to you via email:' }) as any;
        return agent.login(params);
      }

      throw e;
    }
  }

  console.log(`Authenticating as @${IDENT}...`);
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
  console.log(`${response.headers['ratelimit-remaining']} logins remain`);
  await redis.set(REDIS_SESSION_NAME, JSON.stringify(response.data));
  return response.data.handle;
}

function extractImagesFromPost(post: any): string[] {
  const images: string[] = [];
  const embed = post.embed;
  const record = post.record;
  
  if (!embed) return images;
  
  const embedType = embed['$type'];
  const recordEmbedType = record?.embed?.['$type'];
  
  // Direct image embeds
  if (embedType === 'app.bsky.embed.images#view' && embed.images) {
    images.push(...embed.images.map(({ fullsize }: any) => fullsize));
  }
  
  // Record with media
  if (embedType === 'app.bsky.embed.recordWithMedia#view' && embed.media) {
    if (embed.media['$type'] === 'app.bsky.embed.images#view' && embed.media.images) {
      images.push(...embed.media.images.map(({ fullsize }: any) => fullsize));
    }
  }
  
  // Video thumbnails
  if (embedType === 'app.bsky.embed.video#view' && embed.thumbnail) {
    images.push(embed.thumbnail);
  }
  
  return images;
}

function hasHashtag(text: string, hashtag: string): boolean {
  return text.toLowerCase().includes(hashtag.toLowerCase());
}

async function searchForDoodles(agent: AtpAgent, redis: Redis): Promise<void> {
  console.log(`Searching for posts with ${HASHTAG_TO_WATCH}...`);
  
  try {
    // Get the most recently seen post URI
    const lastSeenPostUri = await redis.get(REDIS_LAST_SEEN_POST);
    console.log(`Last seen post: ${lastSeenPostUri || 'none (first run)'}`);
    
    let allNewPosts: any[] = [];
    let cursor: string | undefined;
    let foundLastSeenPost = false;
    let batchCount = 0;
    const maxBatches = 20; // Safety limit to prevent infinite loops
    
    // Search in batches until we find the last seen post or hit limits
    while (!foundLastSeenPost && batchCount < maxBatches) {
      batchCount++;
      console.log(`Fetching batch ${batchCount} (${SEARCH_BATCH_SIZE} posts)...`);
      
      const searchParams: any = {
        q: HASHTAG_TO_WATCH,
        limit: SEARCH_BATCH_SIZE,
        sort: 'latest'
      };
      
      if (cursor) {
        searchParams.cursor = cursor;
      }
      
      const searchResponse = await agent.app.bsky.feed.searchPosts(searchParams);
      const posts = searchResponse.data.posts || [];
      
      if (posts.length === 0) {
        console.log('No more posts found');
        break;
      }
      
      // Check if we've found the last seen post in this batch
      for (const post of posts) {
        if (lastSeenPostUri && post.uri === lastSeenPostUri) {
          console.log(`Found last seen post at batch ${batchCount}. Stopping search.`);
          foundLastSeenPost = true;
          break;
        }
        
        // Only collect posts from ryanjoseph.dev
        if (post.author.handle === 'ryanjoseph.dev') {
          allNewPosts.push(post);
        }
      }
      
      // Update cursor for next batch
      cursor = searchResponse.data.cursor;
      if (!cursor) {
        console.log('No more pages available');
        break;
      }
      
      // If this is the first run (no lastSeenPostUri), only get the first batch
      if (!lastSeenPostUri) {
        console.log('First run - processing only the latest batch');
        break;
      }
    }
    
    if (batchCount >= maxBatches && !foundLastSeenPost && lastSeenPostUri) {
      console.warn(`Reached maximum batch limit (${maxBatches}) without finding last seen post. Some posts may have been missed.`);
    }
    
    console.log(`Found ${allNewPosts.length} new posts to process`);
    
    let mostRecentPostUri: string | null = null;
    let processedCount = 0;
    
    // Process posts in reverse order (oldest to newest) to maintain chronological order
    for (const post of allNewPosts.reverse()) {
      // Track the most recent post URI (last in chronological order)
      if (!mostRecentPostUri) {
        mostRecentPostUri = post.uri;
      }
      
      // Check if already processed
      if (await redis.sismember(REDIS_SET_NAME, post.uri)) {
        continue;
      }
      
      // Verify the post actually contains the hashtag in the text
      const postText = (post.record as any)?.text || '';
      if (!hasHashtag(postText, HASHTAG_TO_WATCH)) {
        continue;
      }
      
      // Extract images
      const imageUrls = extractImagesFromPost(post);
      
      // Only process if there's at least one image
      if (imageUrls.length === 0) {
        continue;
      }
      
      // Create post URL
      const [, , , , urlId] = post.uri.split('/');
      const postUrl = `https://bsky.app/profile/${post.author.handle}/post/${urlId}`;
      
      // Create separate doodle post for each image
      for (let i = 0; i < imageUrls.length; i++) {
        const imageUri = `${post.uri}#image${i}`;
        
        // Check if this specific image was already processed
        if (await redis.sismember(REDIS_SET_NAME, imageUri)) {
          continue;
        }
        
        const doodlePost: DoodlePost = {
          uri: imageUri,
          authorHandle: post.author.handle,
          authorDisplayName: post.author.displayName || post.author.handle,
          text: postText,
          imageUrls: [imageUrls[i]], // Single image per post
          createdAt: (post.record as any).createdAt,
          postUrl
        };
        
        // Store in Redis
        await redis.lpush(REDIS_DOODLE_LIST, JSON.stringify(doodlePost));
        await redis.sadd(REDIS_SET_NAME, imageUri);
        
        console.log(`Added doodle ${i + 1}/${imageUrls.length} from @${post.author.handle}: "${postText.substring(0, 50)}..."`);
      }
      
      // Also mark the original post URI as processed
      await redis.sadd(REDIS_SET_NAME, post.uri);
      processedCount++;
    }
    
    // Update the most recently seen post URI if we processed any new posts
    if (mostRecentPostUri && processedCount > 0) {
      await redis.set(REDIS_LAST_SEEN_POST, mostRecentPostUri);
      console.log(`Updated last seen post to: ${mostRecentPostUri}`);
    }
    
    console.log(`Processed ${processedCount} new posts in ${batchCount} batches`);
    
  } catch (error) {
    console.error('Error searching for doodles:', error);
  }
}

async function agentSessionWasRefreshed(redis: Redis, event: AtpSessionEvent, session: AtpSessionData | undefined) {
  if (event === 'update') {
    if (!session) {
      console.error(`Update event but no session!`);
      return;
    }

    await redis.set(REDIS_SESSION_NAME, JSON.stringify(session));
    console.log(`Session updated & saved. Uptime: ~${Number((Date.now() - START_TS) / 1000 / 60).toFixed(0)} minutes.`);
  }
}

let pollHandle: NodeJS.Timeout;
let resolver = (_: any) => { };
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

function shutdown() {
  console.log('Ending...');
  redis.disconnect();
  clearTimeout(pollHandle);
  resolver((pollHandle = null as any));
  console.log('Done.');
}

async function main() {
  let handle: string;
  const agent = new AtpAgent({
    service: 'https://bsky.social',
    persistSession: agentSessionWasRefreshed.bind(null, redis),
  });

  try {
    handle = await login(agent, redis);
  } catch (e: any) {
    if (e.status === 429 && e.error === 'RateLimitExceeded') {
      console.error(`Login rate limit reached!`);
      return shutdown();
    }

    throw e;
  }

  console.log(`Logged in successfully as @${handle}`);

  ['SIGINT', 'SIGHUP', 'SIGTERM'].forEach((signal) => process.on(signal, shutdown));

  do {
    await new Promise((resolve, reject) => {
      resolver = resolve;
      console.debug('Waking up...');
      searchForDoodles(agent, redis)
        .then(() => setTimeout(() => resolve(true), POLLING_FREQ_SECONDS * 1000))
        .then(timeoutHandle => (pollHandle = timeoutHandle))
        .catch((error) => {
          console.error(`searchForDoodles errored: ${error}`);
          reject(error);
        })
    });
  } while (pollHandle);
}

if (require.main === module) {
  main();
}