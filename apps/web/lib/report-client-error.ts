'use client';

// Browser side of the client error log (T187): sends a report to `POST /api/client-log`, at most
// MAX_REPORTS_PER_PAGE per page load and each distinct message once. Never throws.

import { MAX_REPORTS_PER_PAGE, reportFromError, type ClientLogKind } from './client-log';

const sent = new Set<string>();

export function reportClientError(kind: ClientLogKind, err: unknown, digest?: string): void {
  try {
    if (typeof window === 'undefined' || sent.size >= MAX_REPORTS_PER_PAGE) return;
    const url = `${window.location.pathname}${window.location.search}`;
    const report = reportFromError(kind, err, url, digest);
    const key = `${kind}|${report.message}`;
    if (sent.has(key)) return;
    sent.add(key);
    void fetch('/api/client-log', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
      keepalive: true,
    }).catch(() => {
      // offline or server down: the report is lost, the page goes on
    });
  } catch {
    // reporting must never break the page
  }
}
