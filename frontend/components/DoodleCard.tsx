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
  const isMainPage = !userHandle; // If no userHandle context, we're on the main page
  const basePostId = postId.split('#')[0]; // Base ID without #imageN suffix

  // Generate the full post link (all images, no #imageN)
  const getFullPostLink = (): string => {
    if (userHandle) {
      // User page: /[handle]/post/[id]
      return `/${userHandle}/post/${encodeURIComponent(basePostId)}`;
    } else if (isMainPage && customUsers.includes(doodle.authorHandle)) {
      // Main page but author is a custom user: route to their user page
      return `/${doodle.authorHandle}/post/${encodeURIComponent(basePostId)}`;
    } else {
      // Main page: /post/[id] with ref back to main
      return `/post/${encodeURIComponent(basePostId)}?ref=${encodeURIComponent('/')}`;
    }
  };

  // Generate the appropriate post link for a given image index
  const getImageLink = (imageIndex: number): string => {
    // Construct the full post ID with image index
    const fullPostId = `${basePostId}#image${imageIndex}`;

    if (userHandle) {
      // User page: /[handle]/post/[id]
      return `/${userHandle}/post/${encodeURIComponent(fullPostId)}`;
    } else if (isMainPage && customUsers.includes(doodle.authorHandle)) {
      // Main page but author is a custom user: route to their user page
      return `/${doodle.authorHandle}/post/${encodeURIComponent(fullPostId)}`;
    } else {
      // Main page: /post/[id] with ref back to main
      return `/post/${encodeURIComponent(fullPostId)}?ref=${encodeURIComponent('/')}`;
    }
  };

  const hasMultipleImages = doodle.imageUrls.length > 1;

  return (
    <div className={`${styles.card} ${isHero ? styles.heroCard : ''}`}>
      <div className={`${styles.imageContainer} ${isHero ? styles.heroImageContainer : ''} ${hasMultipleImages ? styles.multiImageContainer : ''}`}>
        {doodle.imageUrls.map((url, index) => {
          const loadingMode = priority && index === 0
            ? { priority: true as const }
            : { loading: 'lazy' as const };
          return (
            <Link
              key={index}
              href={getImageLink(index)}
              className={styles.imageLink}
            >
              <div className={`${styles.imageWrapper} ${hasMultipleImages ? styles.multiImageWrapper : ''}`}>
                {isHero ? (
                  <Image
                    src={url}
                    alt={`Doodle by @${doodle.authorHandle}`}
                    width={700}
                    height={0}
                    style={{
                      width: '100%',
                      height: 'auto',
                    }}
                    className={styles.image}
                    {...loadingMode}
                  />
                ) : (
                  <Image
                    src={url}
                    alt={`${isHashtagDoodle ? 'Doodle' : 'Post'} by @${doodle.authorHandle}`}
                    width={400}
                    height={400}
                    className={styles.image}
                    {...loadingMode}
                  />
                )}
              </div>
            </Link>
          );
        })}
      </div>

      {isMainPage && isHashtagDoodle && (
        <div className={styles.authorBlock}>
          <div className={styles.author}>
            <a href={doodle.postUrl} target="_blank" rel="noopener noreferrer">
              @{doodle.authorHandle}
            </a>
          </div>
        </div>
      )}

      <Link href={getFullPostLink()} className={styles.contentLink}>
        <div className={styles.content}>
          {isMainPage && doodle.text && (
            <div className={styles.text}>
              {doodle.text.replaceAll('\n', ' / ').replaceAll(new RegExp(`\\s*${serverHashtag}`, 'g'), '').trim()}
            </div>
          )}
          <time className={styles.date}>
            {format(new Date(doodle.createdAt), 'MMM d, yyyy')}
          </time>
        </div>
      </Link>
    </div>
  );
}