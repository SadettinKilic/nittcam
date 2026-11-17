import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@nittcam/ui';
import { SideNav } from '../components/side-nav';
import { defaultLocale, getMessages } from '../lib/messages';
import './globals.css';

const messages = getMessages();

// Inter (OFL-1.1, D-032), downloaded and self-hosted at build time by next/font.
const inter = Inter({ subsets: ['latin', 'latin-ext'], display: 'swap', variable: '--font-inter' });

export const metadata: Metadata = {
  title: messages.meta.title,
  description: messages.meta.description,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // next-themes sets the theme class before hydration (no flash); the mismatch is expected.
    <html lang={defaultLocale} className={inter.variable} suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <div className="flex min-h-screen flex-col md:flex-row">
            <SideNav t={messages.nav} />
            <div className="min-w-0 flex-1">{children}</div>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
