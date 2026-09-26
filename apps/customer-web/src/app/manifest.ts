import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Alliva',
    short_name: 'Alliva',
    description: 'Discover local businesses and order across Bahrain',
    start_url: '/',
    display: 'standalone',
    background_color: '#FFC400',
    theme_color: '#FFC400',
    icons: [{ src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' }],
  };
}
