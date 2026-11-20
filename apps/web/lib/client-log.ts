// Client error reports (T187, spec §8.2): what the browser sends to `POST /api/client-log` and how
// the server writes it to the local log. Pure: no DOM, no file system; both sides import it.

export const CLIENT_LOG_KINDS = ['error', 'rejection', 'boundary', 'canvas'] as const;
export type ClientLogKind = (typeof CLIENT_LOG_KINDS)[number];

export interface ClientLogReport {
  kind: ClientLogKind;
  message: string;
  stack?: string;
  /** Path + query of the page (no origin). */
  url?: string;
  /** Next.js error digest (server render errors). */
  digest?: string;
}

export const MAX_MESSAGE = 500;
export const MAX_STACK = 4000;
export const MAX_URL = 300;
/** Largest request body the endpoint reads, bytes. */
export const MAX_BODY_BYTES = 16 * 1024;
/** Reports one page load sends at most (an error loop must not flood the server). */
export const MAX_REPORTS_PER_PAGE = 20;

function text(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  // Control characters out (the log is one JSON line per report; JSON escapes the rest).
  // eslint-disable-next-line no-control-regex
  const clean = v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
  return clean ? clean.slice(0, max) : undefined;
}

/** A valid, trimmed report from an untrusted body, or null. */
export function parseClientLog(body: unknown): ClientLogReport | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const kind = b['kind'];
  if (typeof kind !== 'string' || !(CLIENT_LOG_KINDS as readonly string[]).includes(kind)) {
    return null;
  }
  const message = text(b['message'], MAX_MESSAGE);
  if (!message) return null;
  const report: ClientLogReport = { kind: kind as ClientLogKind, message };
  const stack = text(b['stack'], MAX_STACK);
  if (stack) report.stack = stack;
  const url = text(b['url'], MAX_URL);
  if (url?.startsWith('/')) report.url = url;
  const digest = text(b['digest'], 64);
  if (digest) report.digest = digest;
  return report;
}

/** One log line: JSON with the time, the company and the user agent (cut to 200 chars). */
export function formatClientLogLine(
  report: ClientLogReport,
  meta: { at: string; companyId: string; userAgent?: string | null },
): string {
  const line: Record<string, unknown> = { at: meta.at, company: meta.companyId, ...report };
  if (meta.userAgent) line['ua'] = meta.userAgent.slice(0, 200);
  return `${JSON.stringify(line)}\n`;
}

/** The report a thrown value becomes on the client. */
export function reportFromError(
  kind: ClientLogKind,
  err: unknown,
  url: string,
  digest?: string,
): ClientLogReport {
  const e = err instanceof Error ? err : null;
  const message = e ? `${e.name}: ${e.message}` : typeof err === 'string' ? err : String(err);
  const report: ClientLogReport = { kind, message: message.slice(0, MAX_MESSAGE), url };
  if (e?.stack) report.stack = e.stack.slice(0, MAX_STACK);
  if (digest) report.digest = digest;
  return report;
}

/**
 * Fixed-window limiter (per server process): at most `max` lines per `windowMs`, so a looping
 * client cannot fill the disk. `now` is injected for tests.
 */
export function createRateLimit(max: number, windowMs: number) {
  let start = 0;
  let count = 0;
  return (now: number): boolean => {
    if (now - start >= windowMs) {
      start = now;
      count = 0;
    }
    count += 1;
    return count <= max;
  };
}
