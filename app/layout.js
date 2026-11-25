import './globals.css';
import ServiceWorker from '@/components/ServiceWorker';

export const metadata = {
  title: 'Loy Family',
  description: 'Custody nights, school and sports for the Loy family.',
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: 'Loy Family', statusBarStyle: 'default' },
  icons: { icon: '/icon-192.png', apple: '/icon-192.png' },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7fb' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1218' },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
