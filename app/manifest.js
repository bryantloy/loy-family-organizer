export default function manifest() {
  return {
    name: 'Loy Family',
    short_name: 'Loy Family',
    start_url: '/',
    display: 'standalone',
    background_color: '#f6f7fb',
    theme_color: '#1e3a8a',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
