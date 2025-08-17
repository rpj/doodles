import type { NextApiRequest, NextApiResponse } from 'next';
import { getCustomUsers } from '../../lib/redis';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<string[] | { error: string }>
) {
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