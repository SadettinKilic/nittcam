import { NextResponse } from 'next/server';
import { MAX_BODY_BYTES, formatClientLogLine, parseClientLog } from '../../../lib/client-log';
import { allowClientLog, appendClientLog } from '../../../lib/server/client-log';
import { DEFAULT_COMPANY_ID } from '../../../lib/server/company';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/client-log `{ kind, message, stack?, url?, digest? }` → 204. A browser error goes to
 * the local server log (T187, spec §8.2). 400 for a bad report, 413 above 16 KB, 429 when the
 * server-wide limit is reached. The body is data only: it is trimmed and written as one JSON line.
 */
export async function POST(request: Request) {
  const raw = await request.text().catch(() => '');
  // P4 (tester B43): the limit is in bytes, so a body of 2-byte Turkish letters is measured right.
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES)
    return NextResponse.json({ error: 'too_large' }, { status: 413 });
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    // falls through to 400
  }
  const report = parseClientLog(body);
  if (!report) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  if (!allowClientLog(Date.now())) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  try {
    await appendClientLog(
      formatClientLogLine(report, {
        at: new Date().toISOString(),
        // Single company until auth (T023); the session's company replaces it then.
        companyId: DEFAULT_COMPANY_ID,
        userAgent: request.headers.get('user-agent'),
      }),
    );
  } catch (err) {
    console.error('client log write failed', err);
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
