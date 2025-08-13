import { GetServerSideProps } from 'next';
import { getDoodles } from '../lib/redis';

export default function RssXml() {
  // This component will never be rendered, as we handle the response in getServerSideProps
  return null;
}

export const getServerSideProps: GetServerSideProps = async ({ res, query }) => {
  try {
    const handle = query.handle as string | undefined;
    const doodles = await getDoodles(handle);
    const isAllTheDoodles = !handle;
    
    const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${isAllTheDoodles ? 'All The Doodles' : `${handle}'s Daily Doodles`}</title>
    <description>${isAllTheDoodles ? 'All #DailyDoodle posts from Bluesky' : `@${handle}'s #DailyDoodle posts from Bluesky`}</description>
    <link>https://${handle === 'ryanjoseph.dev' ? 'rj.' : ''}doosky.xyz${handle && handle !== 'ryanjoseph.dev' ? `/${handle}` : ''}</link>
    <atom:link href="https://${handle === 'ryanjoseph.dev' ? 'rj.' : ''}doosky.xyz/rss.xml${handle && handle !== 'ryanjoseph.dev' ? `?handle=${handle}` : ''}" rel="self" type="application/rss+xml" />
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>${isAllTheDoodles ? 'All The Doodles' : 'Daily Doodles'} RSS Generator</generator>
    <managingEditor>hello@doosky.xyz (Ryan Joseph)</managingEditor>
    <webMaster>hello@doosky.xyz (Ryan Joseph)</webMaster>
${doodles.slice(0, 50).map(doodle => {
  const cleanText = doodle.text.replace(/#\w+/g, '').trim();
  const titlePrefix = isAllTheDoodles ? `Doodle by @${doodle.authorHandle}` : 'Daily Doodle';
  return `    <item>
      <title>${titlePrefix} - ${new Date(doodle.createdAt).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })}</title>
      <description><![CDATA[${cleanText ? cleanText + '<br/><br/>' : ''}${doodle.imageUrls.map(url => 
        `<img src="${url}" alt="Daily Doodle" />`
      ).join('<br/>')}]]></description>
      <link>${doodle.postUrl}</link>
      <guid isPermaLink="false">${doodle.uri}</guid>
      <pubDate>${new Date(doodle.createdAt).toUTCString()}</pubDate>
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
