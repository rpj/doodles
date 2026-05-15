import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';
import { format } from 'date-fns';
import { GetServerSideProps } from 'next';
import { getPostById, getFullPostById, getWatchMeta, getHeroImageIndex, Post, WatchMeta } from '../../lib/redis';
import { useTheme } from '../../contexts/ThemeContext';
import styles from '../../styles/Post.module.css';
import { getPostIdFromUri } from '../../lib/utils';
import RichText, { stripTriggerHashtag } from '../../components/RichText';
import Pricing from '../../components/Pricing';
import Reddit from '../../components/Reddit';

interface PostPageProps {
  post: Post | null;
  backUrl: string;
  hashtagWithoutPrefix: string;
  watchMeta: WatchMeta | null;
  // True iff the URL was `/post/<basePostId>` rather than `/post/<basePostId>#imageN`.
  // post.uri is unreliable here — see the handle page for the explanation.
  isOverview: boolean;
  // See the handle page; same semantics.
  heroImageIndex: number;
}

export default function PostPage({ post, backUrl, hashtagWithoutPrefix, watchMeta, isOverview, heroImageIndex }: PostPageProps) {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Determine back link text based on URL
  const isMainPage = backUrl === '/';
  const backLinkText = (isMainPage ? 'Back to all posts' : 'Back to post');

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
          <title>Post Not Found</title>
        </Head>
        <main className={styles.main}>
          <div className={styles.notFound}>
            <h1>Post Not Found</h1>
            <Link href={backUrl} className={styles.backLink}>
              ← {backLinkText}
            </Link>
          </div>
        </main>
      </>
    );
  }

  const stripped = stripTriggerHashtag(post.text, post.facets, hashtagWithoutPrefix);
  const cleanText = stripped.text;

  function title() {
    if (watchMeta?.brand && watchMeta?.model) {
      return `${watchMeta.brand} ${watchMeta.model}`;
    }
    const date = format(new Date(post?.createdAt ?? Date.now()), 'MMM d, yyyy');
    return post?.text.split('\n')[0] || date;
  }

  return (
    <>
      <Head>
        <title>{title()}</title>
        <meta name="description" content={`A #${hashtagWithoutPrefix} post from ${post.authorDisplayName}`} />
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
          <Link href={backUrl} className={styles.backLink}>
            ← {backLinkText}
          </Link>
          
          <article className={styles.post}>
            {(() => {
              const renderImage = (url: string, index: number) => {
                const imageLink = `/post/${encodeURIComponent(basePostId + '#image' + index)}?ref=${encodeURIComponent(backUrl)}`;
                const ImageContent = (
                  <Image
                    src={url}
                    alt={`Post by @${post.authorHandle}`}
                    width={800}
                    height={800}
                    className={styles.image}
                    priority={index === heroImageIndex}
                  />
                );
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
              };

              const heroIdx = Math.min(heroImageIndex, post.imageUrls.length - 1);
              const cards = watchMeta?.brand && watchMeta.model &&
                watchMeta.kind === 'unique-watch' &&
                isOverview && (
                  <>
                    <Pricing postId={basePostId} />
                    <Reddit postId={basePostId} />
                  </>
                );

              return (
                <>
                  <div className={styles.imageContainer}>
                    {renderImage(post.imageUrls[heroIdx], heroIdx)}
                  </div>
                  {cards}
                  {hasMultipleImages && (
                    <div className={styles.imageContainer}>
                      {post.imageUrls.map((url, index) =>
                        index === heroIdx ? null : renderImage(url, index),
                      )}
                    </div>
                  )}
                </>
              );
            })()}

            <div className={styles.content}>
              {cleanText && (
                <p className={styles.text}><RichText text={cleanText} facets={stripped.facets} /></p>
              )}
              
              <div className={styles.meta}>
                <time className={styles.date}>
                  {mounted ? format(new Date(post.createdAt), 'EEEE, MMMM d, yyyy') : ''}
                </time>
                {watchMeta?.kind === 'follow-on' && watchMeta.references_post_id && (
                  <Link
                    href={`/post/${encodeURIComponent(watchMeta.references_post_id)}?ref=${encodeURIComponent(backUrl)}`}
                    className={styles.originalLink}
                  >
                    First appeared →
                  </Link>
                )}
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
  const { id } = context.params!;
  const { ref } = context.query;

  if (!process.env.HASHTAG_TO_WATCH || !process.env.HASHTAG_TO_WATCH.trim()) {
    throw new Error('HASHTAG_TO_WATCH must be set');
  }
  let hashtag = process.env.HASHTAG_TO_WATCH.trim();
  if (!hashtag.startsWith('#')) {
    hashtag = '#' + hashtag;
  }
  const hashtagWithoutPrefix = hashtag.substring(1);
  
  try {
    // Decode the ID (e.g., "3m2uyrrsec22m%23image0" -> "3m2uyrrsec22m#image0")
    const decodedId = decodeURIComponent(id as string);

    // Determine which function to use based on whether ID contains #image
    // If it has #image, fetch specific image post; otherwise fetch full post with all images
    const hasImageSuffix = decodedId.includes('#image');
    const post = hasImageSuffix
      ? await getPostById(decodedId)
      : await getFullPostById(decodedId);

    const basePostId = decodedId.split('#')[0];
    const watchMeta = post ? await getWatchMeta(basePostId) : null;
    const heroImageIndex = post ? await getHeroImageIndex(basePostId) : 0;

    return {
      props: {
        post: post || null,
        backUrl: ref ? decodeURIComponent(ref as string) : '/',
        hashtagWithoutPrefix,
        watchMeta,
        isOverview: !hasImageSuffix,
        heroImageIndex,
      },
    };
  } catch (error) {
    console.error('Error fetching post:', error);
    return {
      props: {
        post: null,
        backUrl: '/',
        hashtagWithoutPrefix,
        watchMeta: null,
        isOverview: false,
        heroImageIndex: 0,
      },
    };
  }
};
