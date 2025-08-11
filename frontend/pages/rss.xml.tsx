import { GetServerSideProps } from 'next';
import { getDoodles } from '../lib/redis';

export default function RssXml() {
  // This component will never be rendered, as we handle the response in getServerSideProps
  return null;
}

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  try {
    const doodles = await getDoodles();
    
    const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Daily Doodles</title>
    <description>@ryanjoseph.dev's collection of daily doodles from Bluesky</description>
    <link>https://doodles.ryanj.xyz</link>
    <atom:link href="https://doodles.ryanj.xyz/rss.xml" rel="self" type="application/rss+xml" />
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>Daily Doodles RSS Generator</generator>
    <managingEditor>hello@ryanj.xyz (Ryan Joseph)</managingEditor>
    <webMaster>hello@ryanj.xyz (Ryan Joseph)</webMaster>
${doodles.slice(0, 50).map(doodle => {
  const cleanText = doodle.text.replace(/#\w+/g, '').trim();
  return `    <item>
      <title>Daily Doodle - ${new Date(doodle.createdAt).toLocaleDateString('en-US', { 
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
