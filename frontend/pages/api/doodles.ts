import type { NextApiRequest, NextApiResponse } from 'next';
import { getDoodles, DoodlePost } from '../../lib/redis';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DoodlePost[] | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const handle = req.query.handle as string | undefined;
    const doodles = await getDoodles(handle);
    res.status(200).json(doodles);
  } catch (error) {
    console.error('Error fetching doodles:', error);
    res.status(500).json({ error: 'Failed to fetch doodles' });
  }
}