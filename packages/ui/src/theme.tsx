'use client';

import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes';
import type { ReactNode } from 'react';

export const THEME_STORAGE_KEY = 'nittcam-theme';
export const THEMES = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof THEMES)[number];

/**
 * System / light / dark theme (spec §3.7). Class strategy on <html>; next-themes injects a tiny
 * blocking script so the stored choice is applied before first paint (no flash). The root
 * layout must put `suppressHydrationWarning` on <html>.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey={THEME_STORAGE_KEY}
      themes={['light', 'dark']}
    >
      {children}
    </NextThemesProvider>
  );
}

export { useTheme };
