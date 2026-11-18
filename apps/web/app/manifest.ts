import type { MetadataRoute } from 'next';
import { getMessages } from '../lib/messages';

// Web app manifest (T194): name and the generated brand icons (tools/brand/gen-icons.mjs).
export default function manifest(): MetadataRoute.Manifest {
  const { meta } = getMessages();
  return {
    name: meta.title,
    short_name: meta.title,
    description: meta.description,
    start_url: '/',
    display: 'standalone',
    background_color: '#fcfcfd',
    theme_color: '#2f56e3',
    icons: [
      { src: '/brand/icon-192-light.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/icon-512-light.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/brand/icon-512-light.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
