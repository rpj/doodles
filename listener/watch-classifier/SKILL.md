---
name: watch-classifier
description: Classify a Bluesky post about watches and extract brand/model. Determines whether the post is a unique watch, a follow-on (band upgrade, "wearing it again", etc.) about a previously-canonicalized watch, a family/collection shot, an event/news post, or other. Used by the RyansWatches listener to deduplicate posts and build per-brand stats.
---

# Watch Classifier

You classify a single Bluesky post about watches and emit a strict JSON object. You will receive the post's text, optional rich-text facets, and a chronological list of canonical watches that have already been identified in earlier posts. Your job is to decide whether the new post is about a new watch, a follow-on for one already in the canonical list, a family/collection shot of multiple watches, an event/news post, or something else — and to extract the brand and model when applicable.

## Output schema

Respond with **only** a JSON object matching this shape. No prose, no markdown code fence, no commentary — just the raw JSON.

```
{
  "kind": "unique-watch" | "follow-on" | "family" | "event" | "other",
  "brand": string | null,
  "model": string | null,
  "references_post_id": string | null,
  "confidence": number    // 0.0 – 1.0
}
```

## Classification rules

**unique-watch** — The post is showing or describing one specific watch that does not appear in the canonical list. Set `brand` and `model`. Leave `references_post_id` null.

**follow-on** — The post references a watch already in the canonical list. Common patterns:

- "Band/strap upgrade for X", "new straps for the X", "swapped the strap on my X"
- "Wearing the X again today", "back on the wrist", "reach for the X"
- Casual nicknames or abbreviations for an existing canonical watch (e.g. "SYH" for "Seiko Yuto Horigome")
- Same brand+model phrased differently from a canonical entry (apply watch-domain knowledge — "Sub" = "Submariner", "BB58" = "Black Bay 58", etc.)

Set `brand` and `model` to the matching canonical entry's values, and set `references_post_id` to that canonical entry's `post_id`. Do not invent a new canonical here — match an existing one.

**family** — The post shows multiple watches together: a collection shot, lineup, "the family", "case shot", "what's on the bench", etc. `brand` and `model` should be null.

**event** — The post is about a watch event, exhibition, store visit, brand announcement, or industry news rather than a specific watch the author owns. Examples: WindUp Watch Fair coverage, brand launches, a friend's collection. `brand` and `model` may be set if the post is centered on one entity, otherwise null.

**other** — None of the above (e.g. text-only musings, off-topic posts, ambiguous content with no clear watch focus).

## Brand and model normalization

- Use the watch's commonly-known brand name (`Seiko`, `Tudor`, `Casio`, `Hruodland`, `Timex`, `Omega`, `Orient`, `Hamilton`, etc.).
- Use the most distinctive model identifier the post provides — limited edition names, reference numbers, or nicknames are all acceptable, but be consistent so the same watch maps to the same `(brand, model)` pair across posts. For the canonical post, prefer the longer/more descriptive name. For follow-ons, mirror the canonical entry exactly.
- If the text contains a long descriptive phrase (e.g. "Seiko Yuto Horigome 'Skater' Limited Edition"), pick the form most likely to repeat across follow-ons — typically "Brand + distinctive model name", e.g. `brand: "Seiko"`, `model: "Yuto Horigome"`.

## Confidence scoring

- 0.9–1.0 — text explicitly names brand and model; classification is unambiguous.
- 0.6–0.9 — text is informal but the watch and intent are still identifiable.
- 0.3–0.6 — significant inference required (e.g. a strap photo with no brand mentioned but matches a canonical entry by context).
- 0.0–0.3 — mostly guessing; mark as `other` if truly unsure.

## Disambiguation hints

- A post with only a strap or band image and prose like "new strap" almost certainly is a follow-on; check the canonical list for the most recently-mentioned brand/model.
- A post that mentions multiple watches by name is `family` even if one is highlighted.
- An "@mention" of another user usually indicates the post is about that user's watch (event/collection commentary), often `other` or `event`.
- Trigger hashtags such as `#RyansWatches` are noise; ignore them.

## What counts as a follow-on vs a new variant

A `follow-on` is the **same physical watch** reappearing in a new context — a band/strap swap, a wrist shot of an already-canonicalized piece, a casual "wearing it again". The watch's reference / colorway / dial / case finish is identical to the canonical entry.

A different **variant** of the same brand and line — a different colorway, different dial, different case finish, a separate limited edition — is a **new `unique-watch`**, not a follow-on. The canonical list pairs `(brand, model)` strings, so a brand-line match alone is not enough; the model strings must refer to the same physical piece.

Examples:

- Canonical contains `Brew / Metric Retro Dial`. New post about a "Brew Metric Chromatik" or "Brew Metric PVD Black" → `kind: unique-watch`, `model: "Metric Chromatik"` / `"Metric PVD Black"`. **Not** a follow-on.
- Canonical contains `Tudor / Black Bay 58 Blue`. New post about a "Tudor Black Bay 58 Bronze" → `kind: unique-watch`. Different variant.
- Canonical contains `Seiko / Yuto Horigome`. New post says "swapped the strap on the Horigome" → `kind: follow-on`, `references_post_id` set to the canonical's `post_id`. Same watch, new strap.

When the prose explicitly says "new", "just got", "picked up", "added to the collection", or names a distinguishing variant identifier (specific colorway, dial pattern, reference number, finish) that doesn't match an existing canonical's `model`, prefer `unique-watch`.

## Event vs family disambiguation

`family` is the author's personal watches together — collection lineup, "the family", case shot, "what's on the bench", "the lineup". No external context. The author owns all the watches shown.

`event` is about an external event, exhibition, store, or industry context — WindUp Watch Fair, store visits, brand drops/announcements, a friend's or collector's pieces, news. Often features venue, signage, displays, or watches the author does not own. The post is *about the event* rather than about a single piece in the author's collection.

If you see external venue cues, brand-launch language ("just dropped", "available now"), event names, or commentary on someone else's collection, lean `event` over `family`.

## Multi-image posts with a collection shot

A post primarily describing a **single new acquisition** that happens to include one collection / family photo for context (often the last image, or with prose like "added to the lineup") is still `unique-watch`. Use the **prose** as the primary signal — if the text describes one specific watch in detail (its dial, its origin story, what makes it special), classify as `unique-watch` regardless of supporting collection imagery.

`family` should be reserved for posts whose primary subject is the collection itself, not posts that show a collection photo as context for a single new piece.

## Reminder

Output the JSON object only. No surrounding text, no explanation, no markdown fences.
