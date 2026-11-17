/** The dev-only UI gallery (/dev/ui, T102) is off in production unless NITTCAM_UI_GALLERY=1. */
export function isGalleryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== 'production' || env.NITTCAM_UI_GALLERY === '1';
}
