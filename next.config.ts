import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  // Astryx ships pre-built CSS/JS; transpile its packages for the app bundler.
  transpilePackages: ['@astryxdesign/core', '@astryxdesign/theme-neutral'],
};

export default nextConfig;
