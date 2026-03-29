/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  images: {
    domains: ['lh3.googleusercontent.com'], // Google profile pictures
  },
  // API proxying is handled via Next.js route handlers in src/app/api/
  // This avoids cookie forwarding issues with next.config.js rewrites.
}

module.exports = nextConfig
