import { Redis } from 'ioredis';
import { confirm } from '@inquirer/prompts';

async function clearAllData(redis: Redis): Promise<void> {
  console.log('🗑️  Clearing all watches data from Redis...\n');

  let totalDeleted = 0;

  // Clear main lists and sets
  const mainKeys = [
    'all-doodles:posts',
    'all-doodles:processed-uris',
    'all-doodles:saved-session',
    'all-doodles:last-seen-post',
    'handles:all'
  ];

  console.log('Deleting main keys...');
  for (const key of mainKeys) {
    const deleted = await redis.del(key);
    if (deleted > 0) {
      console.log(`  ✓ Deleted: ${key}`);
      totalDeleted += deleted;
    }
  }

  // Clear all post:* keys
  console.log('\nDeleting individual post data...');
  const postKeys = await redis.keys('post:*');
  if (postKeys.length > 0) {
    const deleted = await redis.del(...postKeys);
    console.log(`  ✓ Deleted ${deleted} post:* keys`);
    totalDeleted += deleted;
  } else {
    console.log('  No post:* keys found');
  }

  // Clear all handle:*:posts keys
  console.log('\nDeleting handle-specific lists...');
  const handleKeys = await redis.keys('handle:*:posts');
  if (handleKeys.length > 0) {
    const deleted = await redis.del(...handleKeys);
    console.log(`  ✓ Deleted ${deleted} handle:*:posts keys`);
    totalDeleted += deleted;
  } else {
    console.log('  No handle:*:posts keys found');
  }

  // Legacy keys that might exist from old versions
  console.log('\nChecking for legacy keys...');
  const legacyPrefixes = ['posts:', 'posts-kaciecamilli:'];
  for (const prefix of legacyPrefixes) {
    const legacyKeys = await redis.keys(`${prefix}*`);
    if (legacyKeys.length > 0) {
      const deleted = await redis.del(...legacyKeys);
      console.log(`  ✓ Deleted ${deleted} ${prefix}* keys`);
      totalDeleted += deleted;
    }
  }

  console.log(`\n✅ Done! Deleted ${totalDeleted} total keys.`);
}

async function main() {
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

  console.log('⚠️  Redis Data Cleanup Utility\n');
  console.log('This will DELETE ALL data related to watches from Redis, including:');
  console.log('  - All collected posts');
  console.log('  - Processed URIs tracking');
  console.log('  - Saved authentication sessions');
  console.log('  - Handle indices');
  console.log('  - Legacy data from previous versions\n');

  const confirmed = await confirm({
    message: 'Are you sure you want to proceed?',
    default: false
  });

  if (!confirmed) {
    console.log('\nCancelled. No data was deleted.');
    redis.disconnect();
    return;
  }

  console.log('');
  await clearAllData(redis);

  redis.disconnect();
}

if (require.main === module) {
  main().catch(console.error);
}
