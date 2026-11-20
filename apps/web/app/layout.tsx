import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@nittcam/ui';
import { AppShell } from '../components/shell/app-shell';
import { DEFAULT_COMPANY_NAME } from '../lib/company-defaults';
import { defaultLocale, getMessages } from '../lib/messages';
import { PREFERENCES_INIT_SCRIPT } from '../lib/preferences';
import { SIDEBAR_INIT_SCRIPT } from '../lib/sidebar-state';
import './globals.css';

const messages = getMessages();
const shellText = {
  nav: messages.nav,
  shell: messages.shell,
  palette: messages.palette,
  shortcuts: messages.shortcuts,
  steps: messages.wizard.steps,
};

// Inter (OFL-1.1, D-032), downloaded and self-hosted at build time by next/font.
const inter = Inter({ subsets: ['latin', 'latin-ext'], display: 'swap', variable: '--font-inter' });
// JetBrains Mono (OFL-1.1, T195): numbers, coordinates, G-code and file names; latin-ext
// carries the Turkish İ ı Ş ş Ğ ğ. Self-hosted, so Windows never falls back to Consolas.
const mono = JetBrains_Mono({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

export const metadata: Metadata = {
  title: messages.meta.title,
  description: messages.meta.description,
  applicationName: messages.meta.title,
};

// Browser chrome follows the page background of each theme (tokens bg: neutral-25 / neutral-1000).
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fcfcfd' },
    { media: '(prefers-color-scheme: dark)', color: '#08090b' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // next-themes and the sidebar script set <html> attributes before hydration (no flash);
    // the mismatch is expected.
    <html
      lang={defaultLocale}
      className={`${inter.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: PREFERENCES_INIT_SCRIPT }} />
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
