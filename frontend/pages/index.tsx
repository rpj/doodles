'use client';

import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { Post, getCustomUsers, PaginatedPosts, WatchStats, getWatchStats } from '../lib/redis';
import WatchCard from '../components/WatchCard';
import Pagination from '../components/Pagination';
import Stats from '../components/Stats';
import { useTheme } from '../contexts/ThemeContext';
import styles from '../styles/Home.module.css';
import Link from 'next/link';

interface HomeProps {
  serverHashtag: string;
  serverHashtagWithoutPrefix: string;
  serverSiteTitle: string | null;
  serverPrimaryHandle: string | null;
  serverStats: WatchStats;
}

export default function Home({
  serverHashtag,
  serverHashtagWithoutPrefix,
  serverSiteTitle,
  serverPrimaryHandle,
  serverStats,
}: HomeProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customUsers, setCustomUsers] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [hashtag, setHashtag] = useState(serverHashtag);
  const [hashtagWithoutPrefix, setHashtagWithoutPrefix] = useState(serverHashtagWithoutPrefix);
  const [hasHandlesToWatch, setHasHandlesToWatch] = useState(false);
  const [siteTitle, setSiteTitle] = useState<string | null>(serverSiteTitle);
  const [primaryHandle, setPrimaryHandle] = useState<string | null>(serverPrimaryHandle);
  const [stats, setStats] = useState<WatchStats>(serverStats);
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const activeBrand = (router.query.brand as string | undefined) || null;

  // Update current page from URL query parameter
  useEffect(() => {
    if (router.isReady) {
      const page = parseInt(router.query.page as string) || 1;
      setCurrentPage(page);
    }
  }, [router.isReady, router.query.page]);

  // Fetch configuration on mount
  useEffect(() => {
    if (router.isReady) {
      fetchConfig();
    }
  }, [router.isReady]);

  // Fetch posts when page / brand filter / config changes
  useEffect(() => {
    if (router.isReady) {
      fetchPosts(currentPage, activeBrand);
      fetchCustomUsers();
    }
  }, [router.isReady, currentPage, hasHandlesToWatch, activeBrand]);

  useEffect(() => {
    if (router.isReady) {
      // Refresh every 5 minutes (current page + filter, plus stats)
      const interval = setInterval(() => {
        fetchPosts(currentPage, activeBrand);
        fetchStats();
      }, 5 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [router.isReady, currentPage, hasHandlesToWatch, activeBrand]);

  async function fetchPosts(page: number = 1, brand?: string | null) {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        paginate: 'true',
        page: String(page),
        pageSize: '50',
      });
      if (brand) params.set('brand', brand);
      const response = await fetch(`/api/posts?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch posts');
      }
      const data: PaginatedPosts = await response.json();

      // Grouping is now handled server-side in the API when HANDLES_TO_WATCH is set
      setPosts(data.posts);
      setHasMore(data.hasMore);
      setTotalPages(Math.ceil(data.totalCount / data.pageSize));
      setError(null);
    } catch (err) {
      setError('Unable to load posts');
      console.error('Error fetching posts:', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchStats() {
    try {
      const response = await fetch('/api/watch-stats');
      if (response.ok) {
        const data: WatchStats = await response.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Error fetching watch stats:', err);
    }
  }

  async function fetchCustomUsers() {
    try {
      const response = await fetch('/api/custom-users');
      if (response.ok) {
        const users = await response.json();
        setCustomUsers(users);
      }
    } catch (err) {
      console.error('Error fetching custom users:', err);
    }
  }

  async function fetchConfig() {
    try {
      const response = await fetch('/api/config');
      if (response.ok) {
        const config = await response.json();
        setHashtag(config.hashtag);
        setHashtagWithoutPrefix(config.hashtagWithoutPrefix);
        setHasHandlesToWatch(config.hasHandlesToWatch || false);
        setSiteTitle(config.siteTitle ?? null);
        setPrimaryHandle(config.primaryHandle ?? null);
      }
    } catch (err) {
      console.error('Error fetching config:', err);
      // Keep default values on error
    }
  }

  const displayTitle = siteTitle || hashtag;

  return (
    <>
      <Head>
        <title>{displayTitle}</title>
        <meta name="description" content={`All ${hashtag}s on Bluesky`} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      
      <main className={styles.main}>
        <div className={styles.topButtons}>
          <a 
            href="https://github.com/rpj/watches"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.githubButton}
            aria-label="View source on GitHub"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.30.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
          </a>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a 
            href="/rss.xml"
            className={styles.rssButton}
            aria-label="RSS Feed"
          >
            <svg viewBox="-271 273 256 256" fill="currentColor" width="18" height="18">
              <path d="M-271,360v48.9c31.9,0,62.1,12.6,84.7,35.2c22.6,22.6,35.1,52.8,35.1,84.8v0.1h49.1c0-46.6-19-88.7-49.6-119.4C-182.2,379-224.4,360.1-271,360z"/>
              <path d="M-237,460.9c-9.4,0-17.8,3.8-24,10s-10,14.6-10,24c0,9.3,3.8,17.7,10,23.9c6.2,6.1,14.6,9.9,24,9.9s17.8-3.7,24-9.9s10-14.6,10-23.9c0-9.4-3.8-17.8-10-24C-219.2,464.7-227.6,460.9-237,460.9z"/>
              <path d="M-90.1,348.1c-46.3-46.4-110.2-75.1-180.8-75.1v48.9C-156.8,322-64.1,414.9-64,529h49C-15,458.4-43.7,394.5-90.1,348.1z"/>
            </svg>
          </a>
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
        
        <header className={styles.header}>
          <h1 className={styles.title}>
            <Link href="/">{displayTitle}</Link>
          </h1>
          <Stats stats={stats} activeBrand={activeBrand} basePath="/" />
        </header>

        {loading && (
          <div className={styles.loading}>Loading...</div>
        )}

        {error && (
          <div className={styles.error}>{error}</div>
        )}

        {!loading && !error && posts.length === 0 && (
          <div className={styles.empty}>
            No posts found yet. Post with {hashtag} on Bluesky!
          </div>
        )}

        {!loading && !error && posts.length > 0 && (
          <>
            <div className={styles.grid}>
              {posts.map((post, index) => (
                <WatchCard
                  key={post.uri}
                  post={post}
                  customUsers={customUsers}
                  serverHashtag={serverHashtag}
                  // First-row LCP: a 3-column desktop grid paints all three
                  // first-row images near-simultaneously, so any of them can
                  // win the LCP race. Mark all three so whichever the
                  // browser picks already has high priority.
                  priority={index < 3}
                />
              ))}
            </div>
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
            />
          </>
        )}
      </main>
    </>
  );
}

// Force server-side rendering to avoid static generation issues with window access
export async function getServerSideProps() {
  if (!process.env.HASHTAG_TO_WATCH || !process.env.HASHTAG_TO_WATCH.trim()) {
    throw new Error('HASHTAG_TO_WATCH must be set');
  }
  let hashtag = process.env.HASHTAG_TO_WATCH.trim();
  if (!hashtag.startsWith('#')) {
    hashtag = '#' + hashtag;
  }
  const hashtagWithoutPrefix = hashtag.substring(1);

  const handles = (process.env.HANDLES_TO_WATCH || '')
    .split(',')
    .map(h => h.trim())
    .filter(Boolean);
  const primaryHandle = handles[0] || null;
  const siteTitle = (process.env.SITE_TITLE && process.env.SITE_TITLE.trim()) || null;

  let serverStats: WatchStats = {
    uniqueCount: 0,
    brandCount: 0,
    postCount: 0,
    byBrand: [],
  };
  try {
    serverStats = await getWatchStats();
  } catch (e) {
    console.error('SSR getWatchStats failed:', e);
  }

  return {
    props: {
      serverHashtag: hashtag,
      serverHashtagWithoutPrefix: hashtagWithoutPrefix,
      serverSiteTitle: siteTitle,
      serverPrimaryHandle: primaryHandle,
      serverStats,
    },
  };
}
