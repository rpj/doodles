import { Redis } from 'ioredis';

type DoodlePost = {
  uri: string,
  authorHandle: string,
  authorDisplayName: string,
  text: string,
  imageUrls: string[],
  createdAt: string,
  postUrl: string,
};

async function buildReverseIndex() {
  const redis = new Redis({
    host: 'localhost',
    port: 6379,
    password: '4dd2c6dc97174864b5d55d98ca18c084e416b1d53aaf453e8de176be19fa50e72e234e6c21ea4f1fab5e4c237a5715b5'
  });

  console.log('Building reverse index from all-doodles:posts...');

  try {
    // Get all posts from the main list
    const allPosts = await redis.lrange('all-doodles:posts', 0, -1);
    console.log(`Found ${allPosts.length} posts to process`);

    // Clear existing reverse index (if any)
    const existingHandleKeys = await redis.keys('handle:*:posts');
    if (existingHandleKeys.length > 0) {
      console.log(`Clearing ${existingHandleKeys.length} existing handle keys...`);
      await redis.del(...existingHandleKeys);
    }

    // Build handle-to-indices mapping
    const handleToIndices: Record<string, number[]> = {};
    
    allPosts.forEach((postJson, index) => {
      try {
        const post: DoodlePost = JSON.parse(postJson);
        if (!handleToIndices[post.authorHandle]) {
          handleToIndices[post.authorHandle] = [];
        }
        // Store the index (position in the list)
        handleToIndices[post.authorHandle].push(index);
      } catch (e) {
        console.error(`Failed to parse post at index ${index}:`, e);
      }
    });

    // Store the reverse index in Redis
    for (const [handle, indices] of Object.entries(handleToIndices)) {
      const key = `handle:${handle}:posts`;
      // Store indices as strings in a list
      await redis.del(key); // Clear first
      if (indices.length > 0) {
        await redis.rpush(key, ...indices.map(i => i.toString()));
        console.log(`Stored ${indices.length} post indices for ${handle}`);
      }
    }

    // Also store a set of all handles that have posts
    await redis.del('handles:all');
    if (Object.keys(handleToIndices).length > 0) {
      await redis.sadd('handles:all', ...Object.keys(handleToIndices));
      console.log(`Stored ${Object.keys(handleToIndices).length} unique handles`);
    }

    console.log('Reverse index built successfully!');
    
    // Display summary
    console.log('\nSummary:');
    console.log(`Total posts: ${allPosts.length}`);
    console.log(`Unique handles: ${Object.keys(handleToIndices).length}`);
    console.log('\nTop contributors:');
    const sorted = Object.entries(handleToIndices)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 10);
    sorted.forEach(([handle, indices]) => {
      console.log(`  ${handle}: ${indices.length} posts`);
    });

  } catch (error) {
    console.error('Error building reverse index:', error);
  } finally {
    redis.disconnect();
  }
}

if (require.main === module) {
  buildReverseIndex();
}