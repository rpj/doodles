#!/usr/bin/env npx ts-node

import { AtpAgent, ComAtprotoServerCreateSession } from '@atproto/api';
import { input } from '@inquirer/prompts';
import { writeFile } from 'fs/promises';

async function login(agent: AtpAgent): Promise<void> {
  async function loginImpl(): Promise<ComAtprotoServerCreateSession.Response> {
    const params = {
      identifier: process.env.BLUESKY_IDENT as string,
      password: process.env.BLUESKY_PASS as string,
      authFactorToken: undefined
    };

    try {
      return await agent.login(params);
    } catch (e: any) {
      if (e.status === 401 && e.error === 'AuthFactorTokenRequired') {
        // Check if running in non-interactive mode
        if (!process.stdin.isTTY) {
          throw new Error('2FA token required but running in non-interactive mode');
        }
        const token = await input({ message: 'Enter the auth code sent to you via email:' });
        return agent.login({
          ...params,
          authFactorToken: token
        });
      }
      throw e;
    }
  }

  await loginImpl();
}

async function queryPost(profile: string, postId: string): Promise<void> {
  const agent = new AtpAgent({
    service: 'https://bsky.social',
  });

  try {
    await login(agent);

    // Resolve the handle to get the DID
    const { data: { did } } = await agent.resolveHandle({ handle: profile });
    
    const uri = `at://${did}/app.bsky.feed.post/${postId}`;
    
    // Fetch the post
    const postsResponse = await agent.getPosts({ uris: [uri] });
    
    if (!postsResponse.data.posts || postsResponse.data.posts.length === 0) {
      console.error(`Could not fetch post: ${profile}/post/${postId}`);
      process.exit(1);
    }
    
    const post = postsResponse.data.posts[0];
    
    // Write the post data to a file named <postId>.json
    const filename = `${postId}.json`;
    await writeFile(filename, JSON.stringify(post, null, 2));
    console.log(`Post data written to ${filename}`);
    
  } catch (error) {
    console.error('Error querying post:', error);
    process.exit(1);
  }
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.length !== 2) {
    console.error('Usage: npx ts-node query-post.ts <profile> <postId>');
    console.error('Example: npx ts-node query-post.ts brineb.bsky.social 3lwk7nrzdzs2b');
    process.exit(1);
  }
  
  const [profile, postId] = args;
  
  if (!process.env.BLUESKY_IDENT || !process.env.BLUESKY_PASS) {
    console.error('BLUESKY_IDENT and BLUESKY_PASS environment variables are required');
    process.exit(1);
  }
  
  queryPost(profile, postId);
}

if (require.main === module) {
  main();
}