import { isGalleryEnabled } from '../../../../lib/dev-gallery';

// Test-only switch for <ThrowProbe> (T105 e2e): 404 in a normal production server; on only in
// `next dev` or with NITTCAM_UI_GALLERY=1 (the e2e server). Read per request.
export const dynamic = 'force-dynamic';

export function GET(): Response {
  if (!isGalleryEnabled()) return new Response(null, { status: 404 });
  return Response.json({ enabled: true });
}
