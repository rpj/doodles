import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { DoodlePost } from '../lib/redis';
import DoodleCard from '../components/DoodleCard';
import { useTheme } from '../contexts/ThemeContext';
import styles from '../styles/Home.module.css';

export default function Home() {
  const [doodles, setDoodles] = useState<DoodlePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    fetchDoodles();
    
    // Refresh every 5 minutes
    const interval = setInterval(fetchDoodles, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  async function fetchDoodles() {
    try {
      const response = await fetch('/api/doodles');
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

  return (
    <>
      <Head>
        <title>Daily Doodles</title>
        <meta name="description" content="@ryanjoseph.dev's collection of daily doodles from Bluesky" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      
      <main className={styles.main}>
        <button 
          onClick={toggleTheme}
          className={styles.themeToggle}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
        
        <header className={styles.header}>
          <h1 className={styles.title}>Daily Doodles</h1>
          <p className={styles.subtitle}>
 <a href="https://ryanjoseph.dev" target="_blank">I</a> have started trying to do a "doodle a day" both as a respite and to improve my skills.<br/><br/>If they're not awful <a href="https://ryanjoseph.dev" target="_blank">I</a> will post them to Bluesky and they'll end up here.
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
            No doodles found yet. Post with #DailyDoodle on Bluesky!
          </div>
        )}

        {!loading && !error && doodles.length > 0 && (
          <div className={styles.grid}>
            {doodles.map((doodle) => (
              <DoodleCard key={doodle.uri} doodle={doodle} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
