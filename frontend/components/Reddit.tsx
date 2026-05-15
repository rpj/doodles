import { useEffect, useState } from 'react';
import styles from '../styles/Reddit.module.css';

interface RedditPost {
  id: string;
  subreddit: string;
  author: string;
  title: string;
  permalink: string;
  score: number;
  numComments: number;
  createdAt: string;
}

interface RedditSearchResult {
  query: string;
  backend: 'arctic' | 'pullpush';
  posts: RedditPost[];
  fetchedAt: string;
  // Non-null when the post has a reddit_query override set on its
  // watch-meta — the card surfaces it so the viewer knows the search
  // was steered. Falls back to null when query was the default brand+model.
  queryOverride: string | null;
}

interface RedditProps {
  postId: string;
}

function relativeAge(iso: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '';
  const sec = Math.max(0, (Date.now() - then) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 30 * 86400) return `${Math.floor(sec / 86400)}d ago`;
  if (sec < 365 * 86400) return `${Math.floor(sec / (30 * 86400))}mo ago`;
  return `${Math.floor(sec / (365 * 86400))}y ago`;
}

export default function Reddit({ postId }: RedditProps) {
  const [data, setData] = useState<RedditSearchResult | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setFailed(false);
    (async () => {
      try {
        const params = new URLSearchParams({ postId });
        const res = await fetch(`/api/reddit?${params.toString()}`);
        if (!res.ok) {
          if (!cancelled) setFailed(true);
          return;
        }
        const body = (await res.json()) as RedditSearchResult;
        if (!cancelled) setData(body);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [postId]);

  if (failed || !data || data.posts.length === 0) return null;

  const countLabel = data.posts.length === 1 ? 'selected reddit post' : 'selected reddit posts';

  return (
    <aside className={styles.reddit} aria-label="Recent Reddit posts">
      <div className={styles.eyebrow}>
        <span className={styles.count}>{data.posts.length}</span>
        {' '}
        {countLabel}
        {data.queryOverride && (
          <>
            {' for '}
            <span className={styles.queryOverride}>&ldquo;{data.queryOverride}&rdquo;</span>
          </>
        )}
      </div>
      <ul className={styles.list}>
        {data.posts.map((p) => (
          <li key={p.id || p.permalink} className={styles.row}>
            <a
              href={p.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.titleLink}
            >
              {p.title}
            </a>
            <div className={styles.meta}>
              <span className={styles.sub}>r/{p.subreddit}</span>
              <span className={styles.dot} aria-hidden="true">·</span>
              <span className={styles.age}>{relativeAge(p.createdAt)}</span>
              <span className={styles.dot} aria-hidden="true">·</span>
              <span className={styles.score}>{p.score.toLocaleString('en-US')}↑</span>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
