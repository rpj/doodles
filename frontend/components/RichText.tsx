import React from 'react';
import type { Facet } from '../lib/redis';

interface RichTextProps {
  text: string;
  facets?: Facet[];
}

// Bluesky byte offsets are over UTF-8 representation of `text`, not JS char
// indices. We encode once, slice on bytes, and decode each segment.
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Renders Bluesky post text with rich-text facets resolved to clickable links.
 * Falls back to plain text when facets are absent or empty.
 */
export default function RichText({ text, facets }: RichTextProps) {
  if (!facets || facets.length === 0) {
    return <>{text}</>;
  }

  const bytes = encoder.encode(text);
  const sorted = [...facets].sort((a, b) => a.index.byteStart - b.index.byteStart);

  const segments: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  for (const facet of sorted) {
    const { byteStart, byteEnd } = facet.index;
    // Skip overlapping or out-of-range facets defensively.
    if (byteStart < cursor || byteStart >= bytes.length) continue;
    const safeEnd = Math.min(byteEnd, bytes.length);
    if (safeEnd <= byteStart) continue;

    if (byteStart > cursor) {
      segments.push(<React.Fragment key={`t${key++}`}>{decoder.decode(bytes.slice(cursor, byteStart))}</React.Fragment>);
    }

    const segText = decoder.decode(bytes.slice(byteStart, safeEnd));
    const feature = facet.features?.find(f =>
      f.$type === 'app.bsky.richtext.facet#link' ||
      f.$type === 'app.bsky.richtext.facet#tag' ||
      f.$type === 'app.bsky.richtext.facet#mention'
    );

    if (feature?.$type === 'app.bsky.richtext.facet#link') {
      segments.push(
        <a key={`f${key++}`} href={feature.uri} target="_blank" rel="noopener noreferrer">
          {segText}
        </a>
      );
    } else if (feature?.$type === 'app.bsky.richtext.facet#tag') {
      segments.push(
        <a
          key={`f${key++}`}
          href={`https://bsky.app/hashtag/${encodeURIComponent(feature.tag)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {segText}
        </a>
      );
    } else if (feature?.$type === 'app.bsky.richtext.facet#mention') {
      segments.push(
        <a
          key={`f${key++}`}
          href={`https://bsky.app/profile/${encodeURIComponent(feature.did)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {segText}
        </a>
      );
    } else {
      segments.push(<React.Fragment key={`u${key++}`}>{segText}</React.Fragment>);
    }

    cursor = safeEnd;
  }

  if (cursor < bytes.length) {
    segments.push(<React.Fragment key={`t${key++}`}>{decoder.decode(bytes.slice(cursor))}</React.Fragment>);
  }

  return <>{segments}</>;
}

/**
 * Slice text + facets to a byte range, renormalizing facet offsets to the
 * slice. Used to split a post's text into "first line" and "rest" while
 * keeping facets aligned.
 */
export function sliceRichText(
  text: string,
  facets: Facet[] | undefined,
  byteStart: number,
  byteEnd: number
): { text: string; facets: Facet[] } {
  const bytes = encoder.encode(text);
  const start = Math.max(0, byteStart);
  const end = Math.min(byteEnd, bytes.length);
  const slicedText = decoder.decode(bytes.slice(start, end));
  const slicedFacets: Facet[] = (facets ?? [])
    .filter(f => f.index.byteStart >= start && f.index.byteEnd <= end)
    .map(f => ({
      ...f,
      index: {
        byteStart: f.index.byteStart - start,
        byteEnd: f.index.byteEnd - start,
      },
    }));
  return { text: slicedText, facets: slicedFacets };
}

/** Find the byte offset of the first '\n' (0x0A) in `text`, or -1 if none. */
export function findFirstNewlineByte(text: string): number {
  const bytes = encoder.encode(text);
  return bytes.indexOf(0x0A);
}

/** Total UTF-8 byte length of `text`. */
export function byteLength(text: string): number {
  return encoder.encode(text).length;
}

const WHITESPACE_BYTES = new Set([0x20, 0x09, 0x0A, 0x0D]);

/**
 * Remove every occurrence of the trigger hashtag (e.g. "RyansWatches") from
 * the post text along with any leading whitespace, keeping facet offsets
 * coherent. Used on post pages where the trigger hashtag is redundant.
 *
 * Handles facet-tracked hashtags first (the precise case); falls back to a
 * regex pass over the text when facets are missing (legacy posts).
 */
export function stripTriggerHashtag(
  text: string,
  facets: Facet[] | undefined,
  hashtag: string
): { text: string; facets: Facet[] } {
  if (!facets || facets.length === 0) {
    const re = new RegExp(`\\s*#${hashtag.replace(/[^a-zA-Z0-9_]/g, '')}\\b`, 'gi');
    return { text: text.replace(re, '').replace(/\s+$/, ''), facets: [] };
  }

  const matchedFacets = facets.filter(f =>
    f.features?.some(
      feat => feat.$type === 'app.bsky.richtext.facet#tag' && feat.tag.toLowerCase() === hashtag.toLowerCase()
    )
  );
  if (matchedFacets.length === 0) {
    return { text, facets };
  }

  // Process matched facets in reverse byte order so earlier offsets stay valid.
  const sortedMatches = [...matchedFacets].sort((a, b) => b.index.byteStart - a.index.byteStart);
  let bytes = encoder.encode(text);
  let workingFacets = [...facets];

  for (const match of sortedMatches) {
    let removeStart = match.index.byteStart;
    while (removeStart > 0 && WHITESPACE_BYTES.has(bytes[removeStart - 1])) {
      removeStart--;
    }
    const removeEnd = match.index.byteEnd;
    const removedSpan = removeEnd - removeStart;
    if (removedSpan <= 0) continue;

    const next = new Uint8Array(bytes.length - removedSpan);
    next.set(bytes.slice(0, removeStart), 0);
    next.set(bytes.slice(removeEnd), removeStart);
    bytes = next;

    workingFacets = workingFacets
      .filter(f => f !== match)
      .map(f => {
        if (f.index.byteEnd <= removeStart) return f;
        if (f.index.byteStart >= removeEnd) {
          return {
            ...f,
            index: {
              byteStart: f.index.byteStart - removedSpan,
              byteEnd: f.index.byteEnd - removedSpan,
            },
          };
        }
        return null; // facet sat inside the removed range
      })
      .filter((f): f is Facet => f !== null);
  }

  // Trim trailing whitespace bytes.
  let endIdx = bytes.length;
  while (endIdx > 0 && WHITESPACE_BYTES.has(bytes[endIdx - 1])) {
    endIdx--;
  }
  if (endIdx < bytes.length) {
    bytes = bytes.slice(0, endIdx);
  }

  return { text: decoder.decode(bytes), facets: workingFacets };
}
