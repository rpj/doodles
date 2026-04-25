import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { format } from 'date-fns';
import { DoodlePost } from '../lib/redis';
import { getPostIdFromUri } from '../lib/utils';
import styles from '../styles/DoodleCard.module.css';

interface DoodleCardProps {
  doodle: DoodlePost;
  isHero?: boolean;
  userHandle?: string; // The handle context for routing (undefined for main page)
  customUsers?: string[]; // List of custom users for routing decisions on main page
  isHashtagDoodle?: boolean; // Whether this post is part of the "doodle" hashtag feed or a custom one
  serverHashtag: string; // The server-configured hashtag (with # prefix)
  priority?: boolean; // Mark the first image as LCP-priority for above-the-fold cards
}

export default function DoodleCard({
  doodle,
  isHero = false,
  userHandle,
  customUsers = [],
  isHashtagDoodle = false,
  serverHashtag,
  priority = false,
}: DoodleCardProps) {
  const postId = getPostIdFromUri(doodle.uri);
  const isMainPage = !userHandle;
  const basePostId = postId.split('#')[0];

  const getFullPostLink = (): string => {
    if (userHandle) {
      return `/${userHandle}/post/${encodeURIComponent(basePostId)}`;
    } else if (isMainPage && customUsers.includes(doodle.authorHandle)) {
      return `/${doodle.authorHandle}/post/${encodeURIComponent(basePostId)}`;
    } else {
      return `/post/${encodeURIComponent(basePostId)}?ref=${encodeURIComponent('/')}`;
    }
  };

  const getImageLink = (imageIndex: number): string => {
    const fullPostId = `${basePostId}#image${imageIndex}`;
    if (userHandle) {
      return `/${userHandle}/post/${encodeURIComponent(fullPostId)}`;
    } else if (isMainPage && customUsers.includes(doodle.authorHandle)) {
      return `/${doodle.authorHandle}/post/${encodeURIComponent(fullPostId)}`;
    } else {
      return `/post/${encodeURIComponent(fullPostId)}?ref=${encodeURIComponent('/')}`;
    }
  };

  const hasMultipleImages = doodle.imageUrls.length > 1;
  // On non-hero cards with multiple images we show a single preview image
  // (the first) with a "+N" badge. The whole image links to the full post,
  // not the per-image page, so the user lands somewhere they can actually
  // see the rest of the gallery.
  const showPreviewOnly = !isHero && hasMultipleImages;
  const visibleImages = showPreviewOnly
    ? doodle.imageUrls.slice(0, 1)
    : doodle.imageUrls;
  const extraCount = showPreviewOnly ? doodle.imageUrls.length - 1 : 0;

  const cleanedText = isMainPage && doodle.text
    ? doodle.text
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
                    alt={`Post by @${doodle.authorHandle}`}
                    width={1200}
                    height={900}
                    className={styles.image}
                    sizes="(max-width: 768px) 100vw, 880px"
                    {...loadingMode}
                  />
                ) : (
                  <Image
                    src={url}
                    alt={`${isHashtagDoodle ? 'Doodle' : 'Post'} by @${doodle.authorHandle}`}
                    width={600}
                    height={600}
                    className={styles.image}
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 380px"
                    {...loadingMode}
                  />
                )}
              </div>
              {extraCount > 0 && (
                <span className={styles.imageCount} aria-label={`${doodle.imageUrls.length} images in this post`}>
                  +{extraCount}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className={styles.meta}>
        {isMainPage && isHashtagDoodle && (
          <div className={styles.author}>
            <a href={doodle.postUrl} target="_blank" rel="noopener noreferrer">
              @{doodle.authorHandle}
            </a>
          </div>
        )}
        <Link href={getFullPostLink()} className={styles.titleLink}>
          {cleanedText && (
            <h3 className={styles.title}>{cleanedText}</h3>
          )}
          <time className={styles.date}>
            {format(new Date(doodle.createdAt), 'MMM d, yyyy')}
          </time>
        </Link>
      </div>
    </article>
  );
}
