import React from 'react';
import Image from 'next/image';
import { format } from 'date-fns';
import { DoodlePost } from '../lib/redis';
import styles from '../styles/DoodleCard.module.css';

interface DoodleCardProps {
  doodle: DoodlePost;
}

export default function DoodleCard({ doodle }: DoodleCardProps) {
  return (
    <div className={styles.card}>
      <a 
        href={doodle.postUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.imageLink}
      >
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
      </a>
      
      <div className={styles.content}>
        <time className={styles.date}>
          {format(new Date(doodle.createdAt), 'MMM d, yyyy')}
        </time>
      </div>
    </div>
  );
}