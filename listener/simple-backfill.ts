import { Redis } from 'ioredis';

const REDIS_SET_NAME = `doodles:processed-uris`;
const REDIS_DOODLE_LIST = `doodles:posts`;

type DoodlePost = {
  uri: string,
  authorHandle: string,
  authorDisplayName: string,
  text: string,
  imageUrls: string[],
  createdAt: string,
  postUrl: string,
};

// Manually created doodle posts with sample image URLs
const MANUAL_DOODLES: DoodlePost[] = [
  {
    uri: 'at://ryanjoseph.dev/app.bsky.feed.post/3lv2tcvqans2a',
    authorHandle: 'ryanjoseph.dev',
    authorDisplayName: 'Ryan Joseph',
    text: 'First daily doodle',
    imageUrls: ['https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:your-did/sample1.jpg'],
    createdAt: '2024-01-01T00:00:00Z',
    postUrl: 'https://bsky.app/profile/ryanjoseph.dev/post/3lv2tcvqans2a'
  },
  {
    uri: 'at://ryanjoseph.dev/app.bsky.feed.post/3lvizc7azw22q',
    authorHandle: 'ryanjoseph.dev',
    authorDisplayName: 'Ryan Joseph',
    text: 'Second daily doodle',
    imageUrls: ['https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:your-did/sample2.jpg'],
    createdAt: '2024-01-02T00:00:00Z',
    postUrl: 'https://bsky.app/profile/ryanjoseph.dev/post/3lvizc7azw22q'
  },
  {
    uri: 'at://ryanjoseph.dev/app.bsky.feed.post/3lvjveozfms2k',
    authorHandle: 'ryanjoseph.dev',
    authorDisplayName: 'Ryan Joseph',
    text: 'Third daily doodle',
    imageUrls: ['https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:your-did/sample3.jpg'],
    createdAt: '2024-01-03T00:00:00Z',
    postUrl: 'https://bsky.app/profile/ryanjoseph.dev/post/3lvjveozfms2k'
  },
  {
    uri: 'at://ryanjoseph.dev/app.bsky.feed.post/3lvz2tcmq5k2k',
    authorHandle: 'ryanjoseph.dev',
    authorDisplayName: 'Ryan Joseph',
    text: 'Fourth daily doodle',
    imageUrls: ['https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:your-did/sample4.jpg'],
    createdAt: '2024-01-04T00:00:00Z',
    postUrl: 'https://bsky.app/profile/ryanjoseph.dev/post/3lvz2tcmq5k2k'
  },
  {
    uri: 'at://ryanjoseph.dev/app.bsky.feed.post/3lw2u3izcmc2t',
    authorHandle: 'ryanjoseph.dev',
    authorDisplayName: 'Ryan Joseph',
    text: 'Fifth daily doodle',
    imageUrls: ['https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:your-did/sample5.jpg'],
    createdAt: '2024-01-05T00:00:00Z',
    postUrl: 'https://bsky.app/profile/ryanjoseph.dev/post/3lw2u3izcmc2t'
  }
];

async function main() {
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  
  console.log('Starting simple backfill process...');
  console.log(`Processing ${MANUAL_DOODLES.length} posts`);
  
  for (const doodle of MANUAL_DOODLES) {
    // Check if already processed
    if (await redis.sismember(REDIS_SET_NAME, doodle.uri)) {
      console.log(`Post already processed: ${doodle.postUrl}`);
      continue;
    }
    
    // Store in Redis (using RPUSH to maintain chronological order)
    await redis.rpush(REDIS_DOODLE_LIST, JSON.stringify(doodle));
    await redis.sadd(REDIS_SET_NAME, doodle.uri);
    
    console.log(`Backfilled doodle: "${doodle.text}"`);
  }
  
  console.log('Simple backfill complete!');
  redis.disconnect();
}

if (require.main === module) {
  main().catch(console.error);
}