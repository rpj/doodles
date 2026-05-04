import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { format } from 'date-fns';
import { Post } from '../lib/redis';
import { getPostIdFromUri } from '../lib/utils';
import styles from '../styles/WatchCard.module.css';

interface WatchCardProps {
  post: Post;
  isHero?: boolean;
  userHandle?: string; // The handle context for routing (undefined for main page)
  customUsers?: string[]; // List of custom users for routing decisions on main page
  serverHashtag: string; // The server-configured hashtag (with # prefix)
  priority?: boolean; // Mark the first image as LCP-priority for above-the-fold cards
}

export default function WatchCard({
  post,
  isHero = false,
  userHandle,
  customUsers = [],
  serverHashtag,
  priority = false,
}: WatchCardProps) {
  const postId = getPostIdFromUri(post.uri);
  const isMainPage = !userHandle;
  const basePostId = postId.split('#')[0];

  const getFullPostLink = (): string => {
    if (userHandle) {
      return `/${userHandle}/post/${encodeURIComponent(basePostId)}`;
    } else if (isMainPage && customUsers.includes(post.authorHandle)) {
      return `/${post.authorHandle}/post/${encodeURIComponent(basePostId)}`;
    } else {
      return `/post/${encodeURIComponent(basePostId)}?ref=${encodeURIComponent('/')}`;
    }
  };

  const getImageLink = (imageIndex: number): string => {
    const fullPostId = `${basePostId}#image${imageIndex}`;
    if (userHandle) {
      return `/${userHandle}/post/${encodeURIComponent(fullPostId)}`;
    } else if (isMainPage && customUsers.includes(post.authorHandle)) {
      return `/${post.authorHandle}/post/${encodeURIComponent(fullPostId)}`;
    } else {
      return `/post/${encodeURIComponent(fullPostId)}?ref=${encodeURIComponent('/')}`;
    }
  };

  const hasMultipleImages = post.imageUrls.length > 1;
  // On non-hero cards with multiple images we show a single preview image
  // (the first) with a "+N" badge. The whole image links to the full post,
  // not the per-image page, so the user lands somewhere they can actually
  // see the rest of the gallery.
  const showPreviewOnly = !isHero && hasMultipleImages;
  const visibleImages = showPreviewOnly
    ? post.imageUrls.slice(0, 1)
    : post.imageUrls;
  const extraCount = showPreviewOnly ? post.imageUrls.length - 1 : 0;

  const cleanedText = isMainPage && post.text
    ? post.text
        .replaceAll('\n', ' / ')
        .replaceAll(new RegExp(`\\s*${serverHashtag}`, 'g'), '')
        .trim()
    : '';

  return (
    <article className={`${styles.card} ${isHero ? styles.heroCard : ''}`}>
      <div className={`${styles.imageContainer} ${hasMultipleImages && !showPreviewOnly ? styles.multiImageContainer : ''}`}>
        {visibleImages.map((url, index) => {
          const loadingMode = priority && index === 0
            ? { priority: true as const }
            : { loading: 'lazy' as const };
          const linkHref = showPreviewOnly ? getFullPostLink() : getImageLink(index);
          return (
            <Link
              key={index}
              href={linkHref}
              className={styles.imageLink}
            >
              <div className={`${styles.imageWrapper} ${hasMultipleImages && !showPreviewOnly ? styles.multiImageWrapper : ''}`}>
                {isHero ? (
                  <Image
                    src={url}
                    alt={`Post by @${post.authorHandle}`}
                    width={1200}
                    height={900}
                    className={styles.image}
                    sizes="(max-width: 768px) 100vw, 880px"
                    {...loadingMode}
                  />
                ) : (
                  <Image
                    src={url}
                    alt={`Post by @${post.authorHandle}`}
                    width={600}
                    height={600}
                    className={styles.image}
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 380px"
                    {...loadingMode}
                  />
                )}
              </div>
              {extraCount > 0 && (
                <span className={styles.imageCount} aria-label={`${post.imageUrls.length} images in this post`}>
                  +{extraCount}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className={styles.meta}>
        <Link href={getFullPostLink()} className={styles.titleLink}>
          {cleanedText && (
            <h3 className={styles.title}>{cleanedText}</h3>
          )}
          <time className={styles.date}>
            {format(new Date(post.createdAt), 'MMM d, yyyy')}
          </time>
        </Link>
      </div>
    </article>
  );
}
