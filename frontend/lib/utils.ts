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