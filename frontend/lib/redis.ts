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

// Map handles to their redis prefixes
const HANDLE_TO_PREFIX_MAP: Record<string, string> = {
  'ryanjoseph.dev': 'doodles',
};

function getRedisPrefix(handle?: string): string {
  if (!handle) {
    return 'all-doodles'; // Default to all doodles
  }
  
  return HANDLE_TO_PREFIX_MAP[handle] || `user-${handle}`;
}

export async function getDoodles(handle?: string): Promise<DoodlePost[]> {
  const client = getRedisClient();
  
  const redisPrefix = getRedisPrefix(handle);
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