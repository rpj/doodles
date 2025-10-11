export function getPostIdFromUri(uri: string): string {
  // Extract the full identifier from at://did:plc:xxx/app.bsky.feed.post/POST_ID#imageN
  const match = uri.match(/\/app\.bsky\.feed\.post\/(.+)/);
  if (match) {
    // Return POST_ID#imageN (or just POST_ID if no image index)
    return match[1];
  }
  return uri;
}

export function getPostIdAndImageIndex(uri: string): { postId: string; imageIndex?: string } {
  const fullId = getPostIdFromUri(uri);
  const parts = fullId.split('#');
  return {
    postId: parts[0],
    imageIndex: parts[1] || undefined
  };
}

/**
 * Groups DoodlePosts by base URI, combining multi-image posts into single entries.
 * Used when both HANDLES_TO_WATCH and HASHTAG_TO_WATCH are set to reduce text duplication.
 */
export function groupPostsByBaseUri<T extends { uri: string; imageUrls: string[]; createdAt: string }>(posts: T[]): T[] {
  const grouped = new Map<string, T>();

  for (const post of posts) {
    // Get base URI without the #imageN suffix
    const baseUri = post.uri.split('#')[0];

    if (!grouped.has(baseUri)) {
      // First time seeing this post - use it as base with a fresh imageUrls array
      grouped.set(baseUri, {
        ...post,
        imageUrls: [...post.imageUrls]
      });
    } else {
      // Add images from this entry to the existing one
      const existing = grouped.get(baseUri)!;
      existing.imageUrls.push(...post.imageUrls);
    }
  }

  // Sort by createdAt descending (newest first) to maintain chronological order
  return Array.from(grouped.values()).sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}