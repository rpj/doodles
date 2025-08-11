import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { format } from 'date-fns';
import { DoodlePost } from '../lib/redis';
import { getPostIdFromUri } from '../lib/utils';
import styles from '../styles/DoodleCard.module.css';

interface DoodleCardProps {
  doodle: DoodlePost;
}

export default function DoodleCard({ doodle }: DoodleCardProps) {
  const postId = getPostIdFromUri(doodle.uri);
  
  return (
    <div className={styles.card}>
      <Link href={`/post/${encodeURIComponent(postId)}`} className={styles.imageLink}>
        <div className={styles.imageContainer}>
          {doodle.imageUrls.map((url, index) => (
            <div key={index} className={styles.imageWrapper}>
              <Image
                src={url}
                alt={`Doodle by @${doodle.authorHandle}`}
                width={400}
                height={400}
                className={styles.image}
                loading="lazy"
              />
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