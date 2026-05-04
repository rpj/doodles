import { AtpAgent, ComAtprotoServerCreateSession, AtpSessionEvent, AtpSessionData } from '@atproto/api';
import { input } from '@inquirer/prompts';
import { Redis } from 'ioredis';
import { writeFile } from 'fs/promises';
import { classifyAndRecord, getBasePostId } from './classify-post';

const IDENT = process.env.BLUESKY_IDENT;
const START_TS = Date.now();

const POLLING_FREQ_SECONDS = Number.parseInt(process.env.DOODLE_POLLING_FREQ_SECONDS ?? '300'); // 5 minutes default

// Hashtag to watch is required — no default. The listener has nothing to do
// without one. Exit cleanly so the operator notices in container logs.
if (!process.env.HASHTAG_TO_WATCH || !process.env.HASHTAG_TO_WATCH.trim()) {
  console.error('FATAL: HASHTAG_TO_WATCH must be set (e.g. HASHTAG_TO_WATCH=#YourTag).');
  process.exit(1);
}
let HASHTAG_TO_WATCH = process.env.HASHTAG_TO_WATCH.trim();
if (!HASHTAG_TO_WATCH.startsWith('#')) {
  HASHTAG_TO_WATCH = '#' + HASHTAG_TO_WATCH;
}

// Parse handles to watch (comma-separated list)
const HANDLES_TO_WATCH = process.env.HANDLES_TO_WATCH
  ? process.env.HANDLES_TO_WATCH.split(',').map(h => h.trim().toLowerCase()).filter(h => h.length > 0)
  : null;

// Removed getFilterConfig - no longer needed with unified storage
const SEARCH_BATCH_SIZE = 100;
const maxBatches = 20; // Safety limit to prevent infinite loops

type FacetFeature =
  | { $type: 'app.bsky.richtext.facet#link'; uri: string }
  | { $type: 'app.bsky.richtext.facet#tag'; tag: string }
  | { $type: 'app.bsky.richtext.facet#mention'; did: string };

type Facet = {
  index: { byteStart: number; byteEnd: number };
  features: FacetFeature[];
};

type DoodlePost = {
  uri: string,
  authorHandle: string,
  authorDisplayName: string,
  text: string,
  imageUrls: string[],
  createdAt: string,
  postUrl: string,
  facets?: Facet[],
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

      // Filter by handle if HANDLES_TO_WATCH is set
      if (HANDLES_TO_WATCH && HANDLES_TO_WATCH.length > 0) {
        const postHandle = post.author.handle.toLowerCase();
        if (!HANDLES_TO_WATCH.includes(postHandle)) {
          continue;
        }
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
      
      // Process and store the post
      await processPost(redis, post, postText, imageUrls, postUrl);
      
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

async function processPost(
  redis: Redis,
  post: any,
  postText: string,
  imageUrls: string[],
  postUrl: string
): Promise<void> {
  // Skip NSFW/noindex content
  if (hasSkipTag(postText, post)) {
    return;
  }
  
  const processedUrisKey = 'all-doodles:processed-uris';
  const doodleListKey = 'all-doodles:posts';
  
  // Check if already processed
  if (await redis.sismember(processedUrisKey, post.uri)) {
    return;
  }
  
  // Create separate doodle post for each image
  for (let i = 0; i < imageUrls.length; i++) {
    const imageUri = `${post.uri}#image${i}`;
    
    // Check if this specific image was already processed
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
      postUrl,
      facets: (post.record as any).facets,
    };
    
    // Store in Redis - main list for backwards compatibility
    await redis.lpush(doodleListKey, JSON.stringify(doodlePost));
    await redis.sadd(processedUrisKey, imageUri);
    
    // Store the full post data with URI as key
    await redis.set(`post:${imageUri}`, JSON.stringify(doodlePost));
    
    // Update handle list with URI instead of index
    const handleKey = `handle:${post.author.handle}:posts`;
    await redis.lpush(handleKey, imageUri);
    
    // Add handle to the set of all handles
    await redis.sadd('handles:all', post.author.handle);
    
    console.log(`Added doodle ${i + 1}/${imageUrls.length} from @${post.author.handle}: "${postText.substring(0, 50)}..."`);
  }

  // Also mark the original post URI as processed
  await redis.sadd(processedUrisKey, post.uri);

  // Run the watch classifier inline. Fail-soft: if claude is unavailable,
  // logs a warning and continues without blocking the listener.
  const basePostId = getBasePostId(post.uri);
  if (basePostId) {
    try {
      const meta = await classifyAndRecord(redis, {
        basePostId,
        text: postText,
        facets: (post.record as any)?.facets,
      });
      if (meta) {
        const tag = meta.brand ? ` ${meta.brand} ${meta.model ?? ''}`.trim() : '';
        console.log(`Classified ${basePostId} as ${meta.kind}${tag ? ' —' + tag : ''} (conf ${meta.confidence.toFixed(2)})`);
      }
    } catch (e) {
      console.warn(`Watch classification failed for ${basePostId}: ${(e as Error).message}`);
    }
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

  console.log('Starting unified listener (all posts stored in all-doodles:*)');
  console.log(`Watching hashtag: ${HASHTAG_TO_WATCH}`);
  if (HANDLES_TO_WATCH && HANDLES_TO_WATCH.length > 0) {
    console.log(`Filtering by handles: ${HANDLES_TO_WATCH.join(', ')}`);
  } else {
    console.log('Watching ALL handles');
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
