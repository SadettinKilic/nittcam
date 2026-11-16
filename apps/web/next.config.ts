import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@nittcam/core', '@nittcam/ui', '@nittcam/db'],
  // Database drivers stay plain Node modules on the server (PGlite loads its own WASM files).
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
};

export default nextConfig;
