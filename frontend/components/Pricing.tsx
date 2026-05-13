import { useEffect, useState } from 'react';
import styles from '../styles/Pricing.module.css';

interface Sample {
  title: string;
  price: number;
  currency: string;
  url: string;
  condition?: string;
}

interface PricingData {
  count: number;
  minPrice: number | null;
  maxPrice: number | null;
  currency: string;
  samples: Sample[];
  searchUrl: string;
  env: 'sandbox' | 'production';
  query: string;
  fetchedAt: string;
}

interface PricingProps {
  brand: string;
  model: string;
}

function formatPrice(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export default function Pricing({ brand, model }: PricingProps) {
  const [data, setData] = useState<PricingData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setFailed(false);
    (async () => {
      try {
        const params = new URLSearchParams({ brand, model });
        const res = await fetch(`/api/pricing?${params.toString()}`);
        if (!res.ok) {
          if (!cancelled) setFailed(true);
          return;
        }
        const body = (await res.json()) as PricingData;
        if (!cancelled) setData(body);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brand, model]);

  // Silent failure mode — no widget if no data, no listings, or upstream error.
  if (failed || !data || data.count === 0) return null;

  const min = data.minPrice;
  const max = data.maxPrice;
  const hasRange = min !== null && max !== null;
  const sameValue = hasRange && min === max;

  const countLabel = data.count === 1 ? 'recent listing' : 'recent listings';

  return (
    <aside className={styles.pricing} aria-label="Recent eBay listings">
      <div className={styles.eyebrow}>
        <span className={styles.count}>{data.count.toLocaleString('en-US')}</span>
        {' '}
        {countLabel}
      </div>
      {hasRange && (
        <div className={styles.summary}>
          <span className={styles.sep} aria-hidden="true">·</span>
          <span className={styles.range}>
            {sameValue
              ? formatPrice(min!, data.currency)
              : `${formatPrice(min!, data.currency)} – ${formatPrice(max!, data.currency)}`}
          </span>
        </div>
      )}
      <a
        href={data.searchUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.link}
      >
        View all on eBay →
      </a>
    </aside>
  );
}
