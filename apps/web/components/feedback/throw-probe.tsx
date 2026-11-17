'use client';

import { useEffect, useState } from 'react';

export type ThrowTarget = 'canvas' | 'page';

/** The requested crash: `?__throw=<target>` or sessionStorage `__throw` (survives wizard steps). */
export function requestedThrow(search: string, stored: string | null): string | null {
  return new URLSearchParams(search).get('__throw') ?? stored;
}

/**
 * Test-only crash for the e2e tests of CanvasBoundary and the app error page (T105). Renders
 * nothing; it only throws when the URL asks for it AND the server allows test hooks
 * (/api/dev/test-hooks answers 404 in a normal production server), so users can never trigger it.
 */
export function ThrowProbe({ target }: { target: ThrowTarget }) {
  const [boom, setBoom] = useState(false);
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.sessionStorage.getItem('__throw');
    } catch {
      // storage blocked: only the query works
    }
    if (requestedThrow(window.location.search, stored) !== target) return;
    let live = true;
    fetch('/api/dev/test-hooks')
      .then((res) => {
        if (live && res.ok) setBoom(true);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [target]);
  if (boom) throw new Error(`test crash (${target})`);
  return null;
}
