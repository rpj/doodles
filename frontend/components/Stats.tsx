import React, { useState } from 'react';
import Link from 'next/link';
import type { WatchStats } from '../lib/redis';
import styles from '../styles/Stats.module.css';

interface StatsProps {
  stats: WatchStats;
  activeBrand?: string | null;
  basePath?: string;
  initialVisible?: number;
}

const DEFAULT_VISIBLE = 8;

export default function Stats({
  stats,
  activeBrand,
  basePath = '/',
  initialVisible = DEFAULT_VISIBLE,
}: StatsProps) {
  const [showAll, setShowAll] = useState(false);

  if (stats.uniqueCount === 0) {
    return null;
  }

  const visible = showAll ? stats.byBrand : stats.byBrand.slice(0, initialVisible);
  const hidden = stats.byBrand.length - visible.length;
  const isFiltered = !!activeBrand;
  const activeLower = activeBrand?.toLowerCase();

  return (
    <section className={styles.stats} aria-label="Collection statistics">
      <div className={styles.numbers}>
        <span><strong>{stats.uniqueCount}</strong> Watches</span>
        <em className={styles.connector}>across</em>
        <span><strong>{stats.brandCount}</strong> Brands</span>
      </div>

      <div className={styles.brands}>
        <Link
          href={basePath}
          className={`${styles.brand} ${!isFiltered ? styles.active : ''}`}
          aria-current={!isFiltered ? 'true' : undefined}
        >
          All <span className={styles.count}>{stats.uniqueCount}</span>
        </Link>
        {visible.map(b => {
          const isActive = activeLower === b.brand.toLowerCase();
          return (
            <Link
              key={b.brand}
              href={`${basePath}?brand=${encodeURIComponent(b.brand)}`}
              className={`${styles.brand} ${isActive ? styles.active : ''}`}
              aria-current={isActive ? 'true' : undefined}
            >
              {b.brand} <span className={styles.count}>{b.count}</span>
            </Link>
          );
        })}
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className={styles.more}
          >
            +{hidden} more
          </button>
        )}
        {showAll && stats.byBrand.length > initialVisible && (
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className={styles.more}
          >
            Show less
          </button>
        )}
      </div>
    </section>
  );
}
