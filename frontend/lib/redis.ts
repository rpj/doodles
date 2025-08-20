import Redis from 'ioredis';

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
  pageSize: number = 50
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
  
  // Apply pagination to sorted results
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