/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Keep postgres and cheerio out of the client bundle.
    serverComponentsExternalPackages: ['postgres', 'cheerio'],
  },
};

module.exports = nextConfig;
