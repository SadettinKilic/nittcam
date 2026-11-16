import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@nittcam/core', '@nittcam/ui'],
};

export default nextConfig;
