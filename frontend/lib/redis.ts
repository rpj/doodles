import Redis from 'ioredis';
import { groupPostsByBaseUri } from './utils';

let redis: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  }
  return redis;
}

export type DoodlePost = {
  uri: string;
  authorHandle: string;
  authorDisplayName: string;
  text: string;
  imageUrls: string[];
  createdAt: string;
  postUrl: string;
};

export async function getCustomUsers(): Promise<string[]> {
  const client = getRedisClient();
  // Get all handles that have posted
  const handles = await client.smembers('handles:all');
  return handles.sort();
}

export interface PaginatedDoodles {
  doodles: DoodlePost[];
  totalCount: number;
  hasMore: boolean;
  page: number;
  pageSize: number;
}

export async function getDoodles(
  handle?: string,
  page: number = 1,
  pageSize: number = 50,
  shouldGroup: boolean = false
): Promise<PaginatedDoodles> {
  const client = getRedisClient();

  let allDoodles: DoodlePost[];
  
  if (handle) {
    // Sanitize handle to prevent Redis command injection
    if (!/^[a-zA-Z0-9._-]+$/.test(handle)) {
      throw new Error('Invalid handle format');
    }
    
    // Get post URIs for this handle
    const handleKey = `handle:${handle}:posts`;
    const uris = await client.lrange(handleKey, 0, -1);
    
    if (uris.length === 0) {
      // No posts for this handle
      return {
        doodles: [],
        totalCount: 0,
        hasMore: false,
        page,
        pageSize
      };
    }
    
    // Check if URIs are stored (new format) or indices (old format)
    const firstItem = uris[0];
    const isUriFormat = firstItem.startsWith('at://');
    
    if (isUriFormat) {
      // New format: Fetch posts by URIs
      const pipeline = client.pipeline();
      for (const uri of uris) {
        pipeline.get(`post:${uri}`);
      }
      const results = await pipeline.exec();
      
      // Parse the posts
      allDoodles = results
        ?.map(([err, data]) => {
          if (err || !data) return null;
          try {
            return JSON.parse(data as string) as DoodlePost;
          } catch (e) {
            console.error('Failed to parse doodle:', e);
            return null;
          }
        })
        .filter((doodle): doodle is DoodlePost => doodle !== null) || [];
    } else {
      // Old format: Fetch posts by indices (backwards compatibility)
      const pipeline = client.pipeline();
      for (const index of uris) {
        pipeline.lindex('all-doodles:posts', parseInt(index));
      }
      const results = await pipeline.exec();
      
      // Parse the posts
      allDoodles = results
        ?.map(([err, data]) => {
          if (err || !data) return null;
          try {
            return JSON.parse(data as string) as DoodlePost;
          } catch (e) {
            console.error('Failed to parse doodle:', e);
            return null;
          }
        })
        .filter((doodle): doodle is DoodlePost => doodle !== null) || [];
    }
  } else {
    // Get all posts
    const totalCount = await client.llen('all-doodles:posts');
    const rawDoodles = await client.lrange('all-doodles:posts', 0, totalCount - 1);
    
    // Parse all doodles
    allDoodles = rawDoodles
      .map(raw => {
        try {
          return JSON.parse(raw) as DoodlePost;
        } catch (e) {
          console.error('Failed to parse doodle:', e);
          return null;
        }
      })
      .filter((doodle): doodle is DoodlePost => doodle !== null);
  }
  
  // Sort by creation date (newest first)
  allDoodles.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Apply grouping if requested (combines multi-image posts into single entries)
  if (shouldGroup) {
    allDoodles = groupPostsByBaseUri(allDoodles);
  }

  // Apply pagination to sorted (and possibly grouped) results
  const startIndex = (page - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedDoodles = allDoodles.slice(startIndex, endIndex);

  return {
    doodles: paginatedDoodles,
    totalCount: allDoodles.length,
    hasMore: endIndex < allDoodles.length,
    page,
    pageSize
  };
}

// Keep backward compatibility function
export async function getAllDoodles(handle?: string): Promise<DoodlePost[]> {
  const result = await getDoodles(handle, 1, -1);
  return result.doodles;
}

// Fetch a single post by post ID, optionally filtered by handle
export async function getPostById(postId: string, handle?: string): Promise<DoodlePost | null> {
  const client = getRedisClient();

  // Sanitize handle if provided
  if (handle && !/^[a-zA-Z0-9._-]+$/.test(handle)) {
    throw new Error('Invalid handle format');
  }

  try {
    let did: string | null = null;

    if (handle) {
      // Get the handle's post list to extract the DID
      const handleKey = `handle:${handle}:posts`;
      const firstUri = await client.lindex(handleKey, 0);

      if (!firstUri || !firstUri.startsWith('at://')) {
        return null;
      }

      // Extract DID from the first URI: at://did:plc:xxx/app.bsky.feed.post/...
      const didMatch = firstUri.match(/at:\/\/(did:[^\/]+)\//);
      if (!didMatch) {
        return null;
      }
      did = didMatch[1];
    } else {
      // No handle provided - search through all-doodles:posts for matching post ID
      const totalCount = await client.llen('all-doodles:posts');
      const rawDoodles = await client.lrange('all-doodles:posts', 0, totalCount - 1);

      for (const raw of rawDoodles) {
        try {
          const doodle = JSON.parse(raw) as DoodlePost;
          // Extract post ID from URI and compare
          const match = doodle.uri.match(/\/app\.bsky\.feed\.post\/(.+)/);
          if (match && match[1] === postId) {
            return doodle;
          }
        } catch (e) {
          continue;
        }
      }
      return null;
    }

    // Construct the full URI for the target post
    const targetUri = `at://${did}/app.bsky.feed.post/${postId}`;

    // Try to fetch the post directly
    const postData = await client.get(`post:${targetUri}`);
    if (postData) {
      return JSON.parse(postData) as DoodlePost;
    }

    return null;
  } catch (error) {
    console.error('Error fetching post by ID:', error);
    return null;
  }
}

// Fetch a full post with all images by base post ID (strips #imageN suffix)
// This combines all images from a multi-image post into a single DoodlePost
export async function getFullPostById(postId: string, handle?: string): Promise<DoodlePost | null> {
  const client = getRedisClient();

  // Sanitize handle if provided
  if (handle && !/^[a-zA-Z0-9._-]+$/.test(handle)) {
    throw new Error('Invalid handle format');
  }

  try {
    // Strip any #imageN suffix to get base post ID
    const basePostId = postId.split('#')[0];

    // Search through all-doodles:posts for all matching posts
    const totalCount = await client.llen('all-doodles:posts');
    const rawDoodles = await client.lrange('all-doodles:posts', 0, totalCount - 1);

    const matchingPosts: DoodlePost[] = [];

    for (const raw of rawDoodles) {
      try {
        const doodle = JSON.parse(raw) as DoodlePost;
        // Extract base post ID from URI (strip #imageN if present)
        const match = doodle.uri.match(/\/app\.bsky\.feed\.post\/([^#]+)/);
        if (match && match[1] === basePostId) {
          // If handle filter is provided, check it matches
          if (!handle || doodle.authorHandle === handle) {
            matchingPosts.push(doodle);
          }
        }
      } catch (e) {
        continue;
      }
    }

    if (matchingPosts.length === 0) {
      return null;
    }

    // If we have multiple matching posts (multi-image), combine them
    if (matchingPosts.length > 1) {
      const grouped = groupPostsByBaseUri(matchingPosts);
      return grouped[0] || null;
    }

    // Single post
    return matchingPosts[0];
  } catch (error) {
    console.error('Error fetching full post by ID:', error);
    return null;
  }
}