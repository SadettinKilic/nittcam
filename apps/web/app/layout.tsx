import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SideNav } from '../components/side-nav';
import { defaultLocale, getMessages } from '../lib/messages';
import './globals.css';

const messages = getMessages();

export const metadata: Metadata = {
  title: messages.meta.title,
  description: messages.meta.description,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={defaultLocale}>
      <body>
        <div className="flex min-h-screen flex-col md:flex-row">
          <SideNav t={messages.nav} />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </body>
    </html>
  );
}
