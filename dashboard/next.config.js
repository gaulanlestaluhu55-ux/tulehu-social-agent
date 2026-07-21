/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {},
  // Allow importing from parent directory (src/agents, src/db, etc.)
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': `${__dirname}/..`,
    };
    return config;
  },
};

module.exports = nextConfig;
