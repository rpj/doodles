import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { GetServerSideProps } from 'next';
import { DoodlePost } from '../lib/redis';
import DoodleCard from '../components/DoodleCard';
import { useTheme } from '../contexts/ThemeContext';
import styles from '../styles/Home.module.css';

interface HandlePageProps {
  handle: string;
}

export default function HandlePage({ handle: serverHandle }: HandlePageProps) {
  const [doodles, setDoodles] = useState<DoodlePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const { handle } = router.query;
  const handleStr = serverHandle || (Array.isArray(handle) ? handle[0] : handle);

  useEffect(() => {
    if (!handle) return;
    
    fetchDoodles();
    
    // Refresh every 5 minutes
    const interval = setInterval(fetchDoodles, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [handle]);

  async function fetchDoodles() {
    if (!handle) return;
    
    try {
      const response = await fetch(`/api/doodles?handle=${handle}`);
      if (!response.ok) {
        throw new Error('Failed to fetch doodles');
      }
      const data = await response.json();
      setDoodles(data);
      setError(null);
    } catch (err) {
      setError('Unable to load doodles');
      console.error('Error fetching doodles:', err);
    } finally {
      setLoading(false);
    }
  }

  const isRyan = handleStr === 'ryanjoseph.dev';
  const handleShort = handleStr.replace('.bsky.social', '');

  return (
    <>
      <Head>
        <title>{isRyan ? 'Daily Doodles' : (handleStr ? `${handleShort}'s Daily Doodles` : 'Daily Doodles')}</title>
        <meta name="description" content={isRyan ? "@ryanjoseph.dev's collection of daily doodles from Bluesky" : handleStr ? `${handleShort}'s #DailyDoodle posts from Bluesky` : 'Daily doodles from Bluesky'} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      
      <main className={styles.main}>
        <div className={styles.topButtons}>
          <a 
            href="/"
            className={styles.backButton}
            aria-label="Back to All The Doodles"
          >
            ← All Doodles
          </a>
          <a 
            href="https://github.com/rpj/doodles"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.githubButton}
            aria-label="View source on GitHub"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.30.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
          </a>
          <a 
            href={`/rss.xml?handle=${handleStr}`}
            className={styles.rssButton}
            aria-label="RSS Feed"
          >
            <svg viewBox="-271 273 256 256" fill="currentColor" width="18" height="18">
              <path d="M-271,360v48.9c31.9,0,62.1,12.6,84.7,35.2c22.6,22.6,35.1,52.8,35.1,84.8v0.1h49.1c0-46.6-19-88.7-49.6-119.4C-182.2,379-224.4,360.1-271,360z"/>
              <path d="M-237,460.9c-9.4,0-17.8,3.8-24,10s-10,14.6-10,24c0,9.3,3.8,17.7,10,23.9c6.2,6.1,14.6,9.9,24,9.9s17.8-3.7,24-9.9s10-14.6-10-23.9c0-9.4-3.8-17.8-10-24C-219.2,464.7-227.6,460.9-237,460.9z"/>
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
          <h1 className={styles.title}>{isRyan ? 'Daily Doodles' : `${handleShort}'s Doodles`}</h1>
          <p className={styles.subtitle}>
            {isRyan ? (
              <>
                <a href="https://ryanjoseph.dev" target="_blank">I've</a> been trying to draw a "doodle a day" both as a respite and to improve my skills.<br/><br/>
                If they're not awful, I'll <a href="https://bsky.app/hashtag/DailyDoodle?author=ryanjoseph.dev" target="_blank">post them</a> and they'll automatically end up here.
              </>
            ) : (
              <>
                <a href={`https://bsky.app/profile/${handleStr}`} target="_blank">@{handleStr}</a>'s&nbsp; 
                <a href={`https://bsky.app/hashtag/dailydoodle?author=${handleStr}`} target="_blank">#DailyDoodle</a>s
              </>
            )}
          </p>
        </header>

        {loading && (
          <div className={styles.loading}>Loading doodles...</div>
        )}

        {error && (
          <div className={styles.error}>{error}</div>
        )}

        {!loading && !error && doodles.length === 0 && (
          <div className={styles.empty}>
            No doodles found yet from @{handleStr}. Post with #DailyDoodle on Bluesky!
          </div>
        )}

        {!loading && !error && doodles.length > 0 && (
          <>
            {doodles.length > 0 && (
              <div className={styles.heroSection}>
                <DoodleCard key={doodles[0].uri} doodle={doodles[0]} isHero={true} userHandle={handleStr} />
              </div>
            )}
            
            {doodles.length > 1 && (
              <div className={styles.grid}>
                {doodles.slice(1).map((doodle) => (
                  <DoodleCard key={doodle.uri} doodle={doodle} userHandle={handleStr} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { handle } = context.params!;
  
  return {
    props: {
      handle: handle as string,
    },
  };
};
