import { NextApiRequest, NextApiResponse } from 'next';

/**
 * API endpoint that exposes configuration values to the frontend so the
 * gallery can dynamically display the configured title, hashtag, and
 * primary tracked handle without rebuilding the bundle.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (!process.env.HASHTAG_TO_WATCH || !process.env.HASHTAG_TO_WATCH.trim()) {
      res.status(500).json({ error: 'HASHTAG_TO_WATCH must be set' });
      return;
    }
    let hashtag = process.env.HASHTAG_TO_WATCH.trim();
    if (!hashtag.startsWith('#')) {
      hashtag = '#' + hashtag;
    }
    const hashtagWithoutPrefix = hashtag.substring(1);

    const handlesRaw = process.env.HANDLES_TO_WATCH || '';
    const handles = handlesRaw.split(',').map(h => h.trim()).filter(Boolean);
    const hasHandlesToWatch = handles.length > 0;
    const primaryHandle = handles[0] || null;

    // Optional human-readable title for the masthead. Falls back at the
    // call site to the hashtag itself when unset.
    const siteTitle = (process.env.SITE_TITLE && process.env.SITE_TITLE.trim()) || null;

    res.status(200).json({
      hashtag,
      hashtagWithoutPrefix,
      hasHandlesToWatch,
      primaryHandle,
      siteTitle,
    });
  } catch (error) {
    console.error('Error fetching config:', error);
    res.status(500).json({ error: 'Failed to fetch configuration' });
  }
}
