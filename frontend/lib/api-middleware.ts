import { NextApiRequest, NextApiResponse } from 'next';

// Simple in-memory rate limiter
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

export interface RateLimitOptions {
  windowMs?: number; // Time window in milliseconds (default: 1 minute)
  maxRequests?: number; // Max requests per window (default: 60)
}

export function rateLimit(options: RateLimitOptions = {}) {
  const windowMs = options.windowMs || 60 * 1000; // 1 minute default
  const maxRequests = options.maxRequests || 60; // 60 requests per minute default

  return (req: NextApiRequest, res: NextApiResponse, next: () => void) => {
    const now = Date.now();
    const identifier = req.headers['x-forwarded-for'] as string || 
                      req.socket.remoteAddress || 
                      'unknown';

    // Clean up old entries
    for (const [key, value] of rateLimitStore.entries()) {
      if (value.resetTime < now) {
        rateLimitStore.delete(key);
      }
    }

    const rateLimitInfo = rateLimitStore.get(identifier) || {
      count: 0,
      resetTime: now + windowMs
    };

    if (rateLimitInfo.resetTime < now) {
      // Reset the window
      rateLimitInfo.count = 0;
      rateLimitInfo.resetTime = now + windowMs;
    }

    rateLimitInfo.count++;
    rateLimitStore.set(identifier, rateLimitInfo);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests.toString());
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - rateLimitInfo.count).toString());
    res.setHeader('X-RateLimit-Reset', new Date(rateLimitInfo.resetTime).toISOString());

    if (rateLimitInfo.count > maxRequests) {
      res.setHeader('Retry-After', Math.ceil((rateLimitInfo.resetTime - now) / 1000).toString());
      return res.status(429).json({ 
        error: 'Too many requests. Please try again later.' 
      });
    }

    next();
  };
}

// CORS middleware
export interface CorsOptions {
  origin?: string | string[] | boolean;
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

export function cors(options: CorsOptions = {}) {
  const defaults: CorsOptions = {
    origin: false, // By default, don't allow any origin
    methods: ['GET', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: [],
    credentials: false,
    maxAge: 86400 // 24 hours
  };

  const config = { ...defaults, ...options };

  return (req: NextApiRequest, res: NextApiResponse, next: () => void) => {
    const origin = req.headers.origin;

    // Handle origin
    if (config.origin === true) {
      // Allow any origin
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (config.origin === false) {
      // Don't set CORS headers (same-origin only)
    } else if (typeof config.origin === 'string') {
      // Allow specific origin
      res.setHeader('Access-Control-Allow-Origin', config.origin);
    } else if (Array.isArray(config.origin)) {
      // Allow multiple specific origins
      if (origin && config.origin.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
    }

    // Handle credentials
    if (config.credentials) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', config.methods!.join(', '));
      res.setHeader('Access-Control-Allow-Headers', config.allowedHeaders!.join(', '));
      res.setHeader('Access-Control-Max-Age', config.maxAge!.toString());
      return res.status(204).end();
    }

    // Set exposed headers
    if (config.exposedHeaders && config.exposedHeaders.length > 0) {
      res.setHeader('Access-Control-Expose-Headers', config.exposedHeaders.join(', '));
    }

    next();
  };
}

// Input validation helpers
export function validateHandle(handle: string | undefined): string | null {
  if (!handle) {
    return null; // Handle is optional
  }

  // Only allow alphanumeric, dots, hyphens, and underscores
  if (!/^[a-zA-Z0-9._-]+$/.test(handle)) {
    throw new Error('Invalid handle format. Only alphanumeric characters, dots, hyphens, and underscores are allowed.');
  }

  // Additional length check
  if (handle.length > 100) {
    throw new Error('Handle is too long. Maximum 100 characters allowed.');
  }

  return handle;
}

// Middleware runner helper
export function runMiddleware(
  req: NextApiRequest,
  res: NextApiResponse,
  fn: (req: NextApiRequest, res: NextApiResponse, next: () => void) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    fn(req, res, (result?: any) => {
      if (result instanceof Error) {
        return reject(result);
      }
      return resolve(result);
    });
  });
}