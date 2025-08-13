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
}

export default function DoodleCard({ doodle, isHero = false, userHandle }: DoodleCardProps) {
  const postId = getPostIdFromUri(doodle.uri);
  const isMainPage = !userHandle; // If no userHandle context, we're on the main page
  
  // Generate the appropriate post link based on context
  const postLink = userHandle 
    ? `/${userHandle}/post/${encodeURIComponent(postId)}` // User page: /[handle]/post/[id]
    : `/post/${encodeURIComponent(postId)}?ref=${encodeURIComponent('/')}`; // Main page: /post/[id] with ref back to main
  
  return (
    <div className={`${styles.card} ${isHero ? styles.heroCard : ''}`}>
      <Link href={postLink} className={styles.imageLink}>
        <div className={`${styles.imageContainer} ${isHero ? styles.heroImageContainer : ''}`}>
          {doodle.imageUrls.map((url, index) => (
            <div key={index} className={styles.imageWrapper}>
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
                  loading="lazy"
                />
              ) : (
                <Image
                  src={url}
                  alt={`Doodle by @${doodle.authorHandle}`}
                  width={400}
                  height={400}
                  className={styles.image}
                  loading="lazy"
                />
              )}
            </div>
          ))}
        </div>
      </Link>
      
      <div className={styles.content}>
        {isMainPage && (
          <>
            <div className={styles.author}>
              <a href={doodle.postUrl} target="_blank" rel="noopener noreferrer">
                @{doodle.authorHandle}
              </a>
            </div>
            {doodle.text && (
              <div className={styles.text}>
                {doodle.text}
              </div>
            )}
          </>
        )}
        <time className={styles.date}>
          {format(new Date(doodle.createdAt), 'MMM d, yyyy')}
        </time>
      </div>
    </div>
  );
}