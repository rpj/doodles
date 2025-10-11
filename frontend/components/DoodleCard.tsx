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
}

export default function DoodleCard({ doodle, isHero = false, userHandle, customUsers = [], isHashtagDoodle = false }: DoodleCardProps) {
  const postId = getPostIdFromUri(doodle.uri);
  const isMainPage = !userHandle; // If no userHandle context, we're on the main page
  
  // Generate the appropriate post link based on context
  let postLink: string;
  
  if (userHandle) {
    // User page: /[handle]/post/[id]
    postLink = `/${userHandle}/post/${encodeURIComponent(postId)}`;
  } else if (isMainPage && customUsers.includes(doodle.authorHandle)) {
    // Main page but author is a custom user: route to their user page
    postLink = `/${doodle.authorHandle}/post/${encodeURIComponent(postId)}`;
  } else {
    // Main page: /post/[id] with ref back to main
    postLink = `/post/${encodeURIComponent(postId)}?ref=${encodeURIComponent('/')}`;
  }

  function mainpageCardHeader() {
    if (!isHashtagDoodle) {
      return <></>;
    }

    return <>
        <div className={styles.author}>
          <a href={doodle.postUrl} target="_blank" rel="noopener noreferrer">
            @{doodle.authorHandle}
          </a>
        </div>
      </>;
  }
  
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
                  alt={`${isHashtagDoodle ? 'Doodle' : 'Post'} by @${doodle.authorHandle}`}
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
            {mainpageCardHeader()}
            {doodle.text && (
              <div className={styles.text}>
                {doodle.text.replaceAll('\n', ' / ')}
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