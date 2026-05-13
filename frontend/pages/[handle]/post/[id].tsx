import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';
import { format } from 'date-fns';
import { GetServerSideProps } from 'next';
import { getPostById, getFullPostById, getWatchMeta, Post, WatchMeta } from '../../../lib/redis';
import { useTheme } from '../../../contexts/ThemeContext';
import styles from '../../../styles/Post.module.css';
import { getPostIdFromUri } from '../../../lib/utils';
import RichText, { sliceRichText, findFirstNewlineByte, byteLength, stripTriggerHashtag } from '../../../components/RichText';
import Pricing from '../../../components/Pricing';

interface PostPageProps {
  post: Post | null;
  handle: string;
  hashtagWithoutPrefix: string;
  numHandlesToWatch: number;
  watchMeta: WatchMeta | null;
}

export default function HandlePostPage({ post, handle, hashtagWithoutPrefix, numHandlesToWatch, watchMeta }: PostPageProps) {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

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
            <Link href={`/${handle}`} className={styles.backLink}>
              ← Back to @{handle}&apos;s posts
            </Link>
          </div>
        </main>
      </>
    );
  }

  // First line of the post text with the trigger hashtag stripped — used as
  // the back-link label on single-image post views.
  const firstLine = stripTriggerHashtag(post.text, post.facets, hashtagWithoutPrefix)
    .text.split('\n')[0]
    .trim();

  const hasBrandModel = !!(watchMeta?.brand && watchMeta?.model);

  function title() {
    const headingText = hasBrandModel
      ? `${watchMeta!.brand} ${watchMeta!.model}`
      : (post?.text.split('\n')[0] || format(new Date(post?.createdAt ?? Date.now()), 'MMM d, yyyy'));
    return headingText + (hashtagWithoutPrefix ? ` - #${hashtagWithoutPrefix}` : '');
  }

  function cleanedText() {
    // Strip the trigger hashtag (and any preceding whitespace); it's redundant
    // on the post page since every post here matched it.
    const stripped = stripTriggerHashtag(post!.text, post!.facets, hashtagWithoutPrefix);

    // Split byte-correctly so facet offsets remain valid against each segment.
    const nlByte = findFirstNewlineByte(stripped.text);

    if (hasBrandModel) {
      // h2 comes from watchMeta (more reliable than the post's first
      // line, which is often a parenthetical aside like "(Last of the
      // backlog!)"). Body keeps the full original text so nothing gets
      // dropped — the brand+model heading is additive, not a replacement
      // for any post content.
      return <>
        <h2>{watchMeta!.brand} {watchMeta!.model}</h2>
        <RichText text={stripped.text} facets={stripped.facets} />
      </>;
    }

    // No brand/model — fall back to the editorial first-line-as-h2 style.
    if (nlByte < 0) {
      return <h2><RichText text={stripped.text} facets={stripped.facets} /></h2>;
    }
    const head = sliceRichText(stripped.text, stripped.facets, 0, nlByte);
    const tail = sliceRichText(stripped.text, stripped.facets, nlByte + 1, byteLength(stripped.text));
    return <>
      <h2><RichText text={head.text} facets={head.facets} /></h2>
      <RichText text={tail.text} facets={tail.facets} />
    </>;
  }

  function backToContainer() {
    if (hasMultipleImages) {
      return (
        <Link href={`/${numHandlesToWatch === 1 ? handle : ''}`} className={styles.backLink}>
          ← Back to {numHandlesToWatch === 1 ? `@${handle}'s posts` : `#${hashtagWithoutPrefix}`}
        </Link>
      );
    }

    return (
      <Link href={`/${handle}/post/${encodeURIComponent(basePostId)}`} className={styles.backLink}>
        ← {firstLine}
      </Link>
    );
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
          {backToContainer()}
          
          <article className={styles.post}>
            {(
              hasMultipleImages ? <div className={styles.text}>{cleanedText()}</div> : null
            )}

            {watchMeta?.brand && watchMeta.model &&
              (watchMeta.kind === 'unique-watch' || watchMeta.kind === 'follow-on') && (
                <Pricing
                  postId={
                    watchMeta.kind === 'follow-on' && watchMeta.references_post_id
                      ? watchMeta.references_post_id
                      : basePostId
                  }
                />
              )}

            <div className={styles.imageContainer}>
              {post.imageUrls.map((url, index) => {
                const imageLink = `/${handle}/post/${encodeURIComponent(basePostId + '#image' + index)}`;
                const ImageContent = (
                  <Image
                    src={url}
                    alt={`Post by @${post.authorHandle}`}
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
                !hasMultipleImages ? <div className={styles.text}>{cleanedText()}</div> : null
              )}
              
              <div className={styles.meta}>
                <time className={styles.date}>
                  {mounted ? format(new Date(post.createdAt), 'EEEE, MMMM d, yyyy') : ''}
                </time>
                {watchMeta?.kind === 'follow-on' && watchMeta.references_post_id && (
                  <Link
                    href={`/${handle}/post/${encodeURIComponent(watchMeta.references_post_id)}`}
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
  const { handle, id } = context.params!;

  if (!process.env.HASHTAG_TO_WATCH || !process.env.HASHTAG_TO_WATCH.trim()) {
    throw new Error('HASHTAG_TO_WATCH must be set');
  }
  let hashtag = process.env.HASHTAG_TO_WATCH.trim();
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

    const basePostId = decodedId.split('#')[0];
    const watchMeta = post ? await getWatchMeta(basePostId) : null;

    return {
      props: {
        post: post || null,
        handle: handle as string,
        hashtagWithoutPrefix,
        numHandlesToWatch,
        watchMeta,
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
        watchMeta: null,
      },
    };
  }
};