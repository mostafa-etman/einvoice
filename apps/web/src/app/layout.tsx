import '../styles/tokens.css';
import { IBM_Plex_Sans_Arabic, Inter } from 'next/font/google';
import { AppProviders } from '@/components/providers';
import { THEME_BOOT_SCRIPT } from '@/lib/theme';

const ibmPlexSansArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-en',
  display: 'swap',
});

/**
 * Auth/query providers live above [locale] so switching ar↔en does not remount
 * AuthProvider (which would re-call /auth/refresh and bounce to login).
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ar"
      dir="rtl"
      suppressHydrationWarning
      className={`${ibmPlexSansArabic.variable} ${inter.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#2f6fed" />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
