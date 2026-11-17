import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@nittcam/ui';
import { AppShell } from '../components/shell/app-shell';
import { DEFAULT_COMPANY_NAME } from '../lib/company-defaults';
import { defaultLocale, getMessages } from '../lib/messages';
import { SIDEBAR_INIT_SCRIPT } from '../lib/sidebar-state';
import './globals.css';

const messages = getMessages();
const shellText = {
  nav: messages.nav,
  shell: messages.shell,
  palette: messages.palette,
  shortcuts: messages.shortcuts,
};

// Inter (OFL-1.1, D-032), downloaded and self-hosted at build time by next/font.
const inter = Inter({ subsets: ['latin', 'latin-ext'], display: 'swap', variable: '--font-inter' });

export const metadata: Metadata = {
  title: messages.meta.title,
  description: messages.meta.description,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // next-themes and the sidebar script set <html> attributes before hydration (no flash);
    // the mismatch is expected.
    <html lang={defaultLocale} className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_INIT_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          <AppShell t={shellText} company={DEFAULT_COMPANY_NAME}>
            {children}
          </AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
