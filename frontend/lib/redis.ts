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

async function getHandleToPrefixMap(): Promise<Record<string, string>> {
  const client = getRedisClient();
  const mappings = await client.hgetall('__doodles:users');
  return mappings;
}

export async function getCustomUsers(): Promise<string[]> {
  const mappings = await getHandleToPrefixMap();
  return Object.keys(mappings);
}

async function getRedisPrefix(handle?: string): Promise<string> {
  if (!handle) {
    return 'all-doodles'; // Default to all doodles
  }
  
  // Sanitize handle to prevent Redis command injection
  // Only allow alphanumeric, dots, hyphens, and underscores
  if (!/^[a-zA-Z0-9._-]+$/.test(handle)) {
    throw new Error('Invalid handle format');
  }
  
  const mappings = await getHandleToPrefixMap();
  // Use mapping if exists, otherwise construct safe key
  // The handle is now sanitized, safe to use in Redis key
  return mappings[handle] || `user-${handle.replace(/[^a-zA-Z0-9._-]/g, '')}`;
}

export async function getDoodles(handle?: string): Promise<DoodlePost[]> {
  const client = getRedisClient();
  
  const redisPrefix = await getRedisPrefix(handle);
  const rawDoodles = await client.lrange(`${redisPrefix}:posts`, 0, -1);
  
  return rawDoodles
    .map(raw => {
      try {
        return JSON.parse(raw) as DoodlePost;
      } catch (e) {
        console.error('Failed to parse doodle:', e);
        return null;
      }
    })
    .filter((doodle): doodle is DoodlePost => doodle !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}