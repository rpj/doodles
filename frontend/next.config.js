/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['dev.ryanswatches.com'],
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.bsky.app',
      },
      {
        protocol: 'https',
        hostname: 'bsky.social',
      },
      {
        protocol: 'https',
        hostname: 'video.bsky.app',
      },
    ],
  },
}

module.exports = nextConfig
