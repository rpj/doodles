/**
 * eBay Browse API wrapper. OAuth2 client-credentials flow + a single
 * search endpoint scoped to the Wristwatches category. Token cached in
 * module scope (valid ~2h on eBay's side; we re-fetch at 1h55m).
 *
 * Env:
 *   EBAY_CLIENT_ID       (required)  — App ID from developer.ebay.com
 *   EBAY_CLIENT_SECRET   (required)  — Cert ID
 *   EBAY_ENV             (optional)  — "sandbox" (default) | "production"
 *
 * Sandbox returns synthetic data; production has real listings + the
 * 5,000-call/day rate limit on the default tier.
 */

const SANDBOX_BASE = 'https://api.sandbox.ebay.com';
const PRODUCTION_BASE = 'https://api.ebay.com';
const WRISTWATCH_CATEGORY = '14324';
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 minutes before expiry

export interface EbayListing {
  title: string;
  price: number;
  currency: string;
  url: string;
  condition?: string;
  imageUrl?: string;
}

export interface EbayPricingResult {
  count: number;
  minPrice: number | null;
  maxPrice: number | null;
  currency: string;
  samples: EbayListing[];
  searchUrl: string;
  env: 'sandbox' | 'production';
  query: string;
  fetchedAt: string;
}

function ebayEnv(): 'sandbox' | 'production' {
  return process.env.EBAY_ENV === 'production' ? 'production' : 'sandbox';
}

/**
 * Wrap each bare token in double quotes to enable eBay's "exact words"
 * mode — disables the default keyword expansion (plurals / synonyms /
 * stemming). This mirrors what the eBay.com Advanced Search UI does when
 * "Exact words, any order" is selected (it rewrites the search box from
 * `Brew Metric PVD Black` to `"Brew" "Metric" "PVD" "Black"`), so the
 * API call and the click-through `_nkw=` URL produce matching counts.
 *
 * Tokens that already carry a special leading char (`"` for an existing
 * phrase, `+` / `-` for explicit modifiers, `(` for OR groups) pass
 * through untouched.
 *
 * See: https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search
 */
function tightenQuery(q: string): string {
  const tokens: string[] = [];
  const re = /"[^"]+"|\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q)) !== null) {
    const token = m[0];
    if (/^["+\-()]/.test(token)) {
      tokens.push(token);
    } else {
      tokens.push('"' + token + '"');
    }
  }
  return tokens.join(' ');
}

function apiBase(): string {
  return ebayEnv() === 'production' ? PRODUCTION_BASE : SANDBOX_BASE;
}

function getCreds(): { clientId: string; clientSecret: string } {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('EBAY_CLIENT_ID and EBAY_CLIENT_SECRET must be set');
  }
  return { clientId, clientSecret };
}

interface CachedToken {
  value: string;
  expiresAt: number;
  env: 'sandbox' | 'production';
}
let cachedToken: CachedToken | null = null;

async function fetchToken(): Promise<{ access_token: string; expires_in: number }> {
  const { clientId, clientSecret } = getCreds();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const url = `${apiBase()}/identity/v1/oauth2/token`;
  const body =
    'grant_type=client_credentials&scope=' +
    encodeURIComponent('https://api.ebay.com/oauth/api_scope');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay OAuth failed: ${res.status} ${text.slice(0, 200)}`);
  }

  return res.json();
}

async function getToken(): Promise<string> {
  const env = ebayEnv();
  if (
    cachedToken &&
    cachedToken.env === env &&
    cachedToken.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS
  ) {
    return cachedToken.value;
  }
  const tok = await fetchToken();
  cachedToken = {
    value: tok.access_token,
    expiresAt: Date.now() + tok.expires_in * 1000,
    env,
  };
  return tok.access_token;
}

/**
 * Search the Wristwatches category for listings matching brand+model.
 * Returns a small representative sample plus a count and the user-facing
 * search URL. Fails by throwing — callers should treat any error as
 * "pricing unavailable" and not render the widget.
 *
 * `queryOverride`, when set, replaces `${brand} ${model}` as the eBay
 * search query. Used to honor the per-post `search_query` override for
 * cases where the classifier's brand/model is imprecise.
 */
export async function searchListings(
  brand: string,
  model: string,
  queryOverride?: string
): Promise<EbayPricingResult> {
  const token = await getToken();
  const query = (queryOverride?.trim() || `${brand} ${model}`.trim());
  // Same `+keyword` form used for both the API call and the user-facing
  // ebay.com link, so the widget's count matches what the click-through
  // search returns.
  const tightenedQuery = tightenQuery(query);

  const params = new URLSearchParams({
    q: tightenedQuery,
    category_ids: WRISTWATCH_CATEGORY,
    limit: '20',
  });

  const url = `${apiBase()}/buy/browse/v1/item_summary/search?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay Browse search failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const itemSummaries: any[] = data.itemSummaries ?? [];

  // Collect prices for min/max. Filter out missing/zero prices.
  const prices: number[] = [];
  for (const item of itemSummaries) {
    const p = parseFloat(item?.price?.value ?? '');
    if (!isNaN(p) && p > 0) prices.push(p);
  }

  const samples: EbayListing[] = itemSummaries.slice(0, 3).map((item: any) => ({
    title: item.title ?? '',
    price: parseFloat(item?.price?.value ?? '0') || 0,
    currency: item?.price?.currency ?? 'USD',
    url: item.itemWebUrl ?? '',
    condition: item.condition,
    imageUrl: item?.image?.imageUrl,
  }));

  const currency = samples[0]?.currency ?? 'USD';

  // Front-end uses the standard ebay.com search URL (works in both envs);
  // pointing sandbox users at sandbox listings via web UI is awkward and
  // the listings are synthetic anyway.
  const searchUrl =
    `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(tightenedQuery)}` +
    `&_sacat=${WRISTWATCH_CATEGORY}`;

  return {
    count: data.total ?? itemSummaries.length,
    minPrice: prices.length > 0 ? Math.min(...prices) : null,
    maxPrice: prices.length > 0 ? Math.max(...prices) : null,
    currency,
    samples,
    searchUrl,
    env: ebayEnv(),
    query,
    fetchedAt: new Date().toISOString(),
  };
}
