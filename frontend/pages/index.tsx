import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { DoodlePost } from '../lib/redis';
import DoodleCard from '../components/DoodleCard';
import styles from '../styles/Home.module.css';

export default function Home() {
  const [doodles, setDoodles] = useState<DoodlePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        <meta name="description" content="A collection of daily doodles from Bluesky" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      
      <main className={styles.main}>
        <header className={styles.header}>
          <h1 className={styles.title}>Daily Doodles</h1>
          <p className={styles.subtitle}>
            A collection of art shared with #DailyDoodle on Bluesky
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