import type { NextApiRequest, NextApiResponse } from 'next';
import { getCustomUsers } from '../../lib/redis';
import { rateLimit, cors, runMiddleware } from '../../lib/api-middleware';

// Configure rate limiting: 100 requests per minute
const rateLimiter = rateLimit({
  windowMs: 60 * 1000,
  maxRequests: 100
});

// Configure CORS: Allow specific origins for production
const corsMiddleware = cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://doosky.xyz', 'https://www.doosky.xyz', 'https://doodsky.xyz', 'https://www.doodsky.xyz'] 
    : true, // Allow all origins in development
  methods: ['GET', 'OPTIONS'],
  credentials: true,
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<string[] | { error: string }>
) {
  // Apply CORS middleware
  await runMiddleware(req, res, corsMiddleware);

  // Apply rate limiting
  await runMiddleware(req, res, rateLimiter);

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const customUsers = await getCustomUsers();
    res.status(200).json(customUsers);
  } catch (error) {
    console.error('Error fetching custom users:', error);
    res.status(500).json({ error: 'Failed to fetch custom users' });
  }
}