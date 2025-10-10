import { NextApiRequest, NextApiResponse } from 'next';

/**
 * API endpoint that exposes configuration values to the frontend.
 * This allows the frontend to dynamically display the correct hashtag.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Get hashtag from env var, ensure it has # prefix
    let hashtag = process.env.HASHTAG_TO_WATCH || '#DailyDoodle';
    if (!hashtag.startsWith('#')) {
      hashtag = '#' + hashtag;
    }
    const hashtagWithoutPrefix = hashtag.substring(1);

    res.status(200).json({
      hashtag,
      hashtagWithoutPrefix,
    });
  } catch (error) {
    console.error('Error fetching config:', error);
    res.status(500).json({ error: 'Failed to fetch configuration' });
  }
}
