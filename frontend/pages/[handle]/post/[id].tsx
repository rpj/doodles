import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';
import { format } from 'date-fns';
import { GetServerSideProps } from 'next';
import { getDoodles, DoodlePost } from '../../../lib/redis';
import { getPostIdFromUri } from '../../../lib/utils';
import { useTheme } from '../../../contexts/ThemeContext';
import styles from '../../../styles/Post.module.css';

interface PostPageProps {
  post: DoodlePost | null;
  handle: string;
}

export default function HandlePostPage({ post, handle }: PostPageProps) {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!post) {
    return (
      <>
        <Head>
          <title>Post Not Found - Daily Doodles</title>
        </Head>
        <main className={styles.main}>
          <div className={styles.notFound}>
            <h1>Post Not Found</h1>
            <Link href={`/${handle}`} className={styles.backLink}>
              ← Back to @{handle}'s doodles
            </Link>
          </div>
        </main>
      </>
    );
  }

  const cleanText = post.text.replace(/#\w+/g, '').trim();
  const isRyan = handle === 'ryanjoseph.dev';

  return (
    <>
      <Head>
        <title>{`${isRyan ? 'Daily Doodle' : `@${handle}'s Doodle`} - ${format(new Date(post.createdAt), 'MMM d, yyyy')}`}</title>
        <meta name="description" content={`A daily doodle from ${post.authorDisplayName}`} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      
      <main className={styles.main}>
        <div className={styles.themeToggleContainer}>
          <button 
            onClick={toggleTheme}
            className={styles.themeToggle}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            {theme === 'light' ? (
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <circle cx="12" cy="12" r="8" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2"/>
              </svg>
            )}
          </button>
        </div>
        
        <div className={styles.container}>
          <Link href={`/${handle}`} className={styles.backLink}>
            ← Back to @{handle}'s doodles
          </Link>
          
          <article className={styles.post}>
            <div className={styles.imageContainer}>
              {post.imageUrls.map((url, index) => (
                <div key={index} className={styles.imageWrapper}>
                  <Image
                    src={url}
                    alt={`Doodle by @${post.authorHandle}`}
                    width={800}
                    height={800}
                    className={styles.image}
                    priority
                  />
                </div>
              ))}
            </div>
            
            <div className={styles.content}>
              {cleanText && (
                <p className={styles.text}>{cleanText}</p>
              )}
              
              <div className={styles.meta}>
                <time className={styles.date}>
                  {mounted ? format(new Date(post.createdAt), 'EEEE, MMMM d, yyyy') : ''}
                </time>
                <a 
                  href={post.postUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.originalLink}
                >
                  View original on Bluesky →
                </a>
              </div>
            </div>
          </article>
        </div>
      </main>
    </>
  );
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { handle, id } = context.params!;
  
  try {
    const doodles = await getDoodles(handle as string);
    const post = doodles.find(doodle => getPostIdFromUri(doodle.uri) === decodeURIComponent(id as string));
    
    return {
      props: {
        post: post || null,
        handle: handle as string,
      },
    };
  } catch (error) {
    console.error('Error fetching post:', error);
    return {
      props: {
        post: null,
        handle: handle as string,
      },
    };
  }
};