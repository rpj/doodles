import type { NextApiRequest, NextApiResponse } from 'next';
import { getDoodles, DoodlePost, PaginatedDoodles } from '../../lib/redis';
import { rateLimit, cors, validateHandle, runMiddleware } from '../../lib/api-middleware';

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
  res: NextApiResponse<DoodlePost[] | PaginatedDoodles | { error: string }>
) {
  // Apply CORS middleware
  await runMiddleware(req, res, corsMiddleware);

  // Apply rate limiting
  await runMiddleware(req, res, rateLimiter);

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Validate and sanitize the handle parameter
    const rawHandle = req.query.handle as string | undefined;
    const handle = validateHandle(rawHandle);
    
    // Parse pagination parameters
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 50;
    const paginate = req.query.paginate === 'true';
    
    if (paginate) {
      const result = await getDoodles(handle || undefined, page, pageSize);
      res.status(200).json(result);
    } else {
      // Backward compatibility - return all doodles as array
      const result = await getDoodles(handle || undefined, 1, -1);
      res.status(200).json(result.doodles);
    }
  } catch (error) {
    // Check if it's a validation error
    if (error instanceof Error && error.message.includes('Invalid handle')) {
      return res.status(400).json({ error: error.message });
    }
    
    console.error('Error fetching doodles:', error);
    res.status(500).json({ error: 'Failed to fetch doodles' });
  }
}