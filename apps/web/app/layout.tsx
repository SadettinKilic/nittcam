import type { Metadata } from 'next';
import type { ReactNode } from 'react';
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
      <body>{children}</body>
    </html>
  );
}
