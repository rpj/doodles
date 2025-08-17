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

async function getRedisPrefix(handle?: string): Promise<string> {
  if (!handle) {
    return 'all-doodles'; // Default to all doodles
  }
  
  const mappings = await getHandleToPrefixMap();
  return mappings[handle] || `user-${handle}`;
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