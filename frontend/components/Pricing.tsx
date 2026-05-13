import { useEffect, useState } from 'react';
import styles from '../styles/Pricing.module.css';

interface Sample {
  title: string;
  price: number;
  currency: string;
  url: string;
  condition?: string;
}

interface ProductPrice {
  value: number;
  currency: string;
  productUrl: string;
  productDomain: string;
  fetchedAt: string;
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
  productPrice: ProductPrice | null;
}

interface PricingProps {
  // basePostId of the post being priced. For follow-ons the caller resolves
  // to the canonical's basePostId so overrides (search_query, product_url)
  // are looked up on the canonical, not the follow-on.
  postId: string;
}

function formatPrice(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export default function Pricing({ postId }: PricingProps) {
  const [data, setData] = useState<PricingData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setFailed(false);
    (async () => {
      try {
        const params = new URLSearchParams({ postId });
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
  }, [postId]);

  if (failed || !data) return null;

  const hasEbay = data.count > 0;
  const hasProduct = !!data.productPrice;
  // Silent failure mode — if neither data source has anything to show, render nothing.
  if (!hasEbay && !hasProduct) return null;

  const min = data.minPrice;
  const max = data.maxPrice;
  const hasRange = min !== null && max !== null;
  const sameValue = hasRange && min === max;

  const countLabel = data.count === 1 ? 'recent listing' : 'recent listings';

  return (
    <aside className={styles.pricing} aria-label="Pricing">
      {hasProduct && (
        <a
          href={data.productPrice!.productUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.productLink}
        >
          <span className={styles.productPrice}>
            {formatPrice(data.productPrice!.value, data.productPrice!.currency)}
          </span>
          <span className={styles.productAt}>
            at {data.productPrice!.productDomain} →
          </span>
        </a>
      )}
      {hasEbay && (
        <div className={styles.ebayRow}>
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
        </div>
      )}
    </aside>
  );
}
