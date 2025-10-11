import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';
import { format } from 'date-fns';
import { GetServerSideProps } from 'next';
import { getPostById, getFullPostById, DoodlePost } from '../../../lib/redis';
import { useTheme } from '../../../contexts/ThemeContext';
import styles from '../../../styles/Post.module.css';
import { getPostIdFromUri } from '../../../lib/utils';

interface PostPageProps {
  post: DoodlePost | null;
  handle: string;
  hashtagWithoutPrefix: string;
  numHandlesToWatch: number;
}

export default function HandlePostPage({ post, handle, hashtagWithoutPrefix, numHandlesToWatch }: PostPageProps) {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const isHashtagDoodle = hashtagWithoutPrefix?.indexOf('DailyDoodle') !== -1;
  const postTypeStr = isHashtagDoodle ? 'doodle' : 'post';

  // Check if this is a multi-image view (no #image suffix in URI)
  const hasMultipleImages = post && post.imageUrls.length > 1;
  const postId = post ? getPostIdFromUri(post.uri) : '';
  const basePostId = postId.split('#')[0];

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
              ← Back to @{handle}&apos;s ${postTypeStr}s
            </Link>
          </div>
        </main>
      </>
    );
  }

  const cleanText = post.text.replaceAll(new RegExp(`\\s*#${hashtagWithoutPrefix}`, 'g'), '').trim();
  let [firstLine, ...rest] = cleanText.split('\n');
  firstLine = firstLine.trim();
  const isRyan = handle === 'ryanjoseph.dev';

  function title() {
    const date = format(new Date(post?.createdAt ?? Date.now()), 'MMM d, yyyy');

    if (isHashtagDoodle) {
      return `${isRyan ? 'Daily Doodle' : `@${handle}'s Doodle`} - ${date}`;
    }

    return (post?.text.split('\n')[0] || date) + (hashtagWithoutPrefix ? ` - #${hashtagWithoutPrefix}` : '');
  }

  function cleanedText() {
    if (isHashtagDoodle) {
      return cleanText;
    }

    return <>
      <h2>{firstLine}</h2>
      {rest.join('\n')}
    </>;
  }

  function backToContainer() {
    if (isHashtagDoodle || hasMultipleImages) {
      return <>
        <Link href={`/${numHandlesToWatch === 1 ? handle : ''}`} className={styles.backLink}>
          ← Back to {
            numHandlesToWatch === 1 ?
              `@${handle}&apos;s ${postTypeStr}s`
            :
              `#${hashtagWithoutPrefix}`
          }
        </Link>
      </>;
    }

    return <>
        <Link href={`/${handle}/post/${encodeURIComponent(basePostId)}`} className={styles.backLink}>
          ← {firstLine}
        </Link>
      </>;
  }

  return (
    <>
      <Head>
        <title>{title()}</title>
        <meta name="description" content={`A daily ${isHashtagDoodle ? 'doodle' : `#${hashtagWithoutPrefix} post`} from ${post.authorDisplayName}`} />
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
          {backToContainer()}
          
          <article className={styles.post}>
            {(
              hasMultipleImages ? <p className={styles.text}>{cleanedText()}</p> : null
            )}

            <div className={styles.imageContainer}>
              {post.imageUrls.map((url, index) => {
                const imageLink = `/${handle}/post/${encodeURIComponent(basePostId + '#image' + index)}`;
                const ImageContent = (
                  <Image
                    src={url}
                    alt={`${postTypeStr.charAt(0).toUpperCase() + postTypeStr.slice(1)} by @${post.authorHandle}`}
                    width={800}
                    height={800}
                    className={styles.image}
                    priority
                  />
                );

                // If multi-image view, make each image clickable to its individual page
                return (
                  <div key={index} className={styles.imageWrapper}>
                    {hasMultipleImages ? (
                      <Link href={imageLink} className={styles.imageLink}>
                        {ImageContent}
                      </Link>
                    ) : (
                      ImageContent
                    )}
                  </div>
                );
              })}
            </div>
            
            <div className={styles.content}>
              {(
                !hasMultipleImages ? <p className={styles.text}>{cleanedText()}</p> : null
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

  // Get hashtag from env var, ensure it has # prefix
  let hashtag = process.env.HASHTAG_TO_WATCH || '#DailyDoodle';
  if (!hashtag.startsWith('#')) {
    hashtag = '#' + hashtag;
  }
  const hashtagWithoutPrefix = hashtag.substring(1);

  const numHandlesToWatch = process.env.HANDLES_TO_WATCH?.trim().length ?? 0;

  try {
    // Decode the ID (e.g., "3m2uyrrsec22m%23image0" -> "3m2uyrrsec22m#image0")
    const decodedId = decodeURIComponent(id as string);

    // Determine which function to use based on whether ID contains #image
    // If it has #image, fetch specific image post; otherwise fetch full post with all images
    const hasImageSuffix = decodedId.includes('#image');
    const post = hasImageSuffix
      ? await getPostById(decodedId, handle as string)
      : await getFullPostById(decodedId, handle as string);

    return {
      props: {
        post: post || null,
        handle: handle as string,
        hashtagWithoutPrefix,
        numHandlesToWatch,
      },
    };
  } catch (error) {
    console.error('Error fetching post:', error);
    return {
      props: {
        post: null,
        handle: handle as string,
        hashtagWithoutPrefix: null,
        numHandlesToWatch: 0,
      },
    };
  }
};