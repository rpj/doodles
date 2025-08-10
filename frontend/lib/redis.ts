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

export async function getDoodles(): Promise<DoodlePost[]> {
  const client = getRedisClient();
  const rawDoodles = await client.lrange('doodles:posts', 0, -1);
  
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