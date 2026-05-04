import type { NextApiRequest, NextApiResponse } from 'next';
import { getWatchStats, WatchStats } from '../../lib/redis';
import { rateLimit, cors, runMiddleware } from '../../lib/api-middleware';

const rateLimiter = rateLimit({
  windowMs: 60 * 1000,
  maxRequests: 100,
});

const corsMiddleware = cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://doosky.xyz', 'https://www.doosky.xyz', 'https://doodsky.xyz', 'https://www.doodsky.xyz']
    : true,
  methods: ['GET', 'OPTIONS'],
  credentials: true,
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WatchStats | { error: string }>
) {
  await runMiddleware(req, res, corsMiddleware);
  await runMiddleware(req, res, rateLimiter);

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const stats = await getWatchStats();
    res.status(200).json(stats);
  } catch (error) {
    console.error('Error fetching watch stats:', error);
    res.status(500).json({ error: 'Failed to fetch watch stats' });
  }
}
