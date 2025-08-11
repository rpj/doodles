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
}

export default function DoodleCard({ doodle, isHero = false }: DoodleCardProps) {
  const postId = getPostIdFromUri(doodle.uri);
  
  return (
    <div className={`${styles.card} ${isHero ? styles.heroCard : ''}`}>
      <Link href={`/post/${encodeURIComponent(postId)}`} className={styles.imageLink}>
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
        <time className={styles.date}>
          {format(new Date(doodle.createdAt), 'MMM d, yyyy')}
        </time>
      </div>
    </div>
  );
}