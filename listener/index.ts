import { AtpAgent, ComAtprotoServerCreateSession, AtpSessionEvent, AtpSessionData } from '@atproto/api';
import { input } from '@inquirer/prompts';
import { Redis } from 'ioredis';
import { writeFile } from 'fs/promises';

const IDENT = process.env.BLUESKY_IDENT;
const START_TS = Date.now();

const POLLING_FREQ_SECONDS = Number.parseInt(process.env.DOODLE_POLLING_FREQ_SECONDS ?? '300'); // 5 minutes default

async function getFilterConfig(redis: Redis): Promise<Record<string, string | null>> {
  const config: Record<string, string | null> = {
    'all-doodles': null, // null means no handle filtering (all users)
  };
  
  // Get handle-to-prefix mappings from Redis
  const mappings = await redis.hgetall('__doodles:users');
  for (const [handle, prefix] of Object.entries(mappings)) {
    config[prefix] = handle;
  }
  
  return config;
}

const HASHTAG_TO_WATCH = '#DailyDoodle';
const SEARCH_BATCH_SIZE = 100;
const maxBatches = 20; // Safety limit to prevent infinite loops

type DoodlePost = {
  uri: string,
  authorHandle: string,
  authorDisplayName: string,
  text: string,
  imageUrls: string[],
  createdAt: string,
  postUrl: string,
};

async function login(agent: AtpAgent, redis: Redis, sessionPrefix: string): Promise<string> {
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
  const savedSession = await redis.get(`${sessionPrefix}:saved-session`);
  if (savedSession) {
    try {
      console.log('Reusing saved session...');
      const { data: { handle } } = await agent.resumeSession(JSON.parse(savedSession));
      return handle;
    } catch (e) {
      console.error('resumeSession failed!', e);
      await redis.del(`${sessionPrefix}:saved-session`);
    }
  }

  const response = await loginImpl();
  console.log(`${response.headers['ratelimit-remaining']} logins remain`);
  await redis.set(`${sessionPrefix}:saved-session`, JSON.stringify(response.data));
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
  
  // Record with media (only process images, skip videos)
  if (embedType === 'app.bsky.embed.recordWithMedia#view' && embed.media) {
    if (embed.media['$type'] === 'app.bsky.embed.images#view' && embed.media.images) {
      images.push(...embed.media.images.map(({ fullsize }: any) => fullsize));
    }
    // Skip videos - we don't want video thumbnails
  }
  
  return images;
}

function hasHashtag(text: string, hashtag: string): boolean {
  return text.toLowerCase().includes(hashtag.toLowerCase());
}

function hasSkipTag(text: string, post?: any): boolean {
  // Check text-based skip tags
  if (['#nsfw', '#noindex', '#no-index'].some(check => text.toLowerCase().includes(check))) {
    return true;
  }
  
  // Check for sexual content labels
  if (post?.labels) {
    return post.labels.some((label: any) => label.val === 'sexual');
  }
  
  return false;
}

async function searchForDoodles(agent: AtpAgent, redis: Redis): Promise<void> {
  console.log(`Searching for posts with ${HASHTAG_TO_WATCH}...`);
  
  // Get current filter configuration from Redis
  const FILTER_CONFIG = await getFilterConfig(redis);
  
  try {
    // Get the most recently seen post URI
    const lastSeenPostUri = await redis.get('all-doodles:last-seen-post');
    console.log(`Last seen post: ${lastSeenPostUri || 'none (first run)'}`);
    
    let allNewPosts: any[] = [];
    let cursor: string | undefined;
    let foundLastSeenPost = false;
    let batchCount = 0;
    let allPostsCount = 0;
    
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

      allPostsCount += posts.length;
      
      // Check if we've found the last seen post in this batch
      for (const post of posts) {
        if (lastSeenPostUri && post.uri === lastSeenPostUri) {
          console.log(`Found last seen post at batch ${batchCount}. Stopping search.`);
          foundLastSeenPost = true;
          break;
        }
        
        // Collect all posts - we'll filter them later when processing
        allNewPosts.push(post);
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
    
    console.log(`Found ${allNewPosts.length} new posts to process (of ${allPostsCount} total)`);
    
    let mostRecentPostUri: string | null = null;
    let processedCount = 0;
    
    // Process posts in reverse order (oldest to newest) to maintain chronological order
    for (const post of allNewPosts.reverse()) {
      // Track the most recent post URI (last in chronological order)
      if (!mostRecentPostUri) {
        mostRecentPostUri = post.uri;
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
      
      // Fan out to all configured filters
      await processPostForAllFilters(redis, post, postText, imageUrls, postUrl, FILTER_CONFIG);
      
      processedCount++;
    }
    
    // Update the most recently seen post URI if we processed any new posts
    if (mostRecentPostUri) {
      await redis.set('all-doodles:last-seen-post', mostRecentPostUri);
      console.log(`Updated last seen post to: ${mostRecentPostUri}`);
    }
    
    console.log(`Processed ${processedCount} new posts in ${batchCount} batches`);
    
  } catch (error) {
    console.error('Error searching for doodles:', error);
  }
}

async function processPostForAllFilters(
  redis: Redis,
  post: any,
  postText: string,
  imageUrls: string[],
  postUrl: string,
  filterConfig: Record<string, string | null>
): Promise<void> {
  // Process post for each configured filter
  for (const [prefix, handleFilter] of Object.entries(filterConfig)) {
    // Skip if this filter doesn't match the post's author
    if (handleFilter !== null && post.author.handle !== handleFilter) {
      continue;
    }
    
    if (hasSkipTag(postText, post)) {
      continue;
    }
    
    const processedUrisKey = `${prefix}:processed-uris`;
    const doodleListKey = `${prefix}:posts`;
    
    // Check if already processed for this filter
    if (await redis.sismember(processedUrisKey, post.uri)) {
      continue;
    }
    
    // Create separate doodle post for each image
    for (let i = 0; i < imageUrls.length; i++) {
      const imageUri = `${post.uri}#image${i}`;
      
      // Check if this specific image was already processed for this filter
      if (await redis.sismember(processedUrisKey, imageUri)) {
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
      
      // Store in Redis for this filter
      await redis.lpush(doodleListKey, JSON.stringify(doodlePost));
      await redis.sadd(processedUrisKey, imageUri);
      
      console.log(`Added doodle ${i + 1}/${imageUrls.length} to ${prefix} from @${post.author.handle}: "${postText.substring(0, 50)}..."`);
    }
    
    // Also mark the original post URI as processed for this filter
    await redis.sadd(processedUrisKey, post.uri);
  }
}

async function agentSessionWasRefreshed(redis: Redis, sessionPrefix: string, event: AtpSessionEvent, session: AtpSessionData | undefined) {
  if (event === 'update') {
    if (!session) {
      console.error(`Update event but no session!`);
      return;
    }

    await redis.set(`${sessionPrefix}:saved-session`, JSON.stringify(session));
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
    // Use 'all-doodles' prefix for session management (shared session)
    persistSession: agentSessionWasRefreshed.bind(null, redis, 'all-doodles'),
  });

  const FILTER_CONFIG = await getFilterConfig(redis);
  console.log('Filter configuration:');
  for (const [prefix, handleFilter] of Object.entries(FILTER_CONFIG)) {
    console.log(`  ${prefix}: ${handleFilter || 'all users (no filter)'}`);
  }
  console.log('');

  try {
    handle = await login(agent, redis, 'all-doodles');
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
      console.debug(`Waking up at ${new Date()}...`);
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
