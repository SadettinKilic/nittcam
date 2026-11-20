'use client';

import { createContext, useContext } from 'react';
import type { Messages } from './messages';

/**
 * The page's translation texts for deep client components (T186). The wizard page already gets
 * every text as a server prop; components far down read it from here instead of importing
 * `tr.json`, which would put all UI text into the page's JavaScript a second time.
 */
export const MessagesContext = createContext<Messages | null>(null);

export function useMessages(): Messages {
  const m = useContext(MessagesContext);
  if (!m) throw new Error('useMessages() needs a MessagesContext provider');
  return m;
}
