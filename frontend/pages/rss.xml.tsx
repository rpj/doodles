import { GetServerSideProps } from 'next';
import { getPosts } from '../lib/redis';
import { getPostIdFromUri } from '../lib/utils';

// XML escape function to prevent injection attacks
function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export default function RssXml() {
  // This component will never be rendered, as we handle the response in getServerSideProps
  return null;
}

export const getServerSideProps: GetServerSideProps = async ({ res, query }) => {
  try {
    let handle = query.handle as string | undefined;

    // Sanitize handle to prevent injection attacks
    if (handle) {
      // Only allow alphanumeric, dots, hyphens, and underscores in handles
      if (!/^[a-zA-Z0-9._-]+$/.test(handle)) {
        res.statusCode = 400;
        res.end('Invalid handle parameter');
        return { props: {} };
      }
    }

    const postsData = await getPosts(handle);
    const isAllPosts = !handle;

    if (!process.env.HASHTAG_TO_WATCH || !process.env.HASHTAG_TO_WATCH.trim()) {
      res.statusCode = 500;
      res.end('HASHTAG_TO_WATCH must be set');
      return { props: {} };
    }
    let HASHTAG_TO_WATCH = process.env.HASHTAG_TO_WATCH.trim();
    if (!HASHTAG_TO_WATCH.startsWith('#')) {
      HASHTAG_TO_WATCH = '#' + HASHTAG_TO_WATCH;
    }
    
    const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${isAllPosts ? 'All The Watches' : `${escapeXml(handle!)}'s posts`}</title>
    <description>${isAllPosts ? `All ${HASHTAG_TO_WATCH} posts from Bluesky` : `@${escapeXml(handle!)}'s ${HASHTAG_TO_WATCH} posts from Bluesky`}</description>
    <link>https://${handle === 'ryanjoseph.dev' ? 'rj.' : ''}doodsky.xyz${handle && handle !== 'ryanjoseph.dev' ? `/${escapeXml(handle)}` : ''}</link>
    <atom:link href="https://${handle === 'ryanjoseph.dev' ? 'rj.' : ''}doodsky.xyz/rss.xml${handle && handle !== 'ryanjoseph.dev' ? `?handle=${escapeXml(handle)}` : ''}" rel="self" type="application/rss+xml" />
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>${isAllPosts ? 'All The Watches' : 'Watches'} RSS Generator</generator>
    <managingEditor>hello@doodsky.xyz (Ryan Joseph)</managingEditor>
    <webMaster>hello@doodsky.xyz (Ryan Joseph)</webMaster>
${postsData.posts.slice(0, 50).map(post => {
  const cleanText = post.text.replace(/#\w+/g, '').trim();
  const titlePrefix = isAllPosts ? `Post by @${escapeXml(post.authorHandle)}` : 'Watch';
  return `    <item>
      <title>${titlePrefix} - ${new Date(post.createdAt).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })}</title>
      <description><![CDATA[${cleanText ? escapeXml(cleanText) + '<br/><br/>' : ''}${post.imageUrls.map(url => 
        `<img src="${escapeXml(url)}" alt="Watch" />`
      ).join('<br/>')}]]></description>
      <link>https://doodsky.xyz/${handle === 'ryanjoseph.dev' ? `${escapeXml(handle)}/` : ''}post/${encodeURIComponent(getPostIdFromUri(post.uri))}</link>
      <guid isPermaLink="false">${post.uri}</guid>
      <pubDate>${new Date(post.createdAt).toUTCString()}</pubDate>
    </item>`;
}).join('\n')}
  </channel>
</rss>`;

    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    res.write(rssXml);
    res.end();

    return {
      props: {},
    };
  } catch (error) {
    console.error('Error generating RSS feed:', error);
    
    res.statusCode = 500;
    res.end('Error generating RSS feed');
    
    return {
      props: {},
    };
  }
};
