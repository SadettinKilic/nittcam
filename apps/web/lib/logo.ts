/**
 * Company logo upload limits (T182, db-multitenancy "Uploads: size and type limits"). PNG, JPEG
 * and WebP only: SVG can carry scripts, so it is not accepted. The type is read from the file's
 * first bytes, never trusted from the name or the browser.
 */
export const LOGO_MAX_BYTES = 512 * 1024;
export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp';

export type LogoType = 'png' | 'jpeg' | 'webp';

export const LOGO_CONTENT_TYPE: Record<LogoType, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** The image type from the magic bytes, or `null` for anything else. */
export function sniffLogo(bytes: Uint8Array): LogoType | null {
  const at = (i: number, ...v: number[]) => v.every((b, k) => bytes[i + k] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpeg';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp';
  return null;
}

export type LogoProblem = 'empty' | 'size' | 'type';

/** Why a file cannot be the logo, or `null` when it can. */
export function logoProblem(bytes: Uint8Array): LogoProblem | null {
  if (bytes.length === 0) return 'empty';
  if (bytes.length > LOGO_MAX_BYTES) return 'size';
  return sniffLogo(bytes) ? null : 'type';
}

/** Storage key of the logo (inside the company's storage prefix). */
export function logoKey(type: LogoType): string {
  return `branding/logo.${type === 'jpeg' ? 'jpg' : type}`;
}
