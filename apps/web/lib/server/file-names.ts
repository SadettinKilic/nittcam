/**
 * File names of generated documents (D-025: ASCII only), in one place: PDF, labels, DXF and zip
 * bundles (T176). NC file names come from the post config.
 */
import { transliterateTurkish } from '@nittcam/core';

/** ASCII file stem of a project name (Turkish letters transliterated, others dropped). */
export function asciiStem(name: string, fallback = 'proje'): string {
  const s = transliterateTurkish(name)
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || fallback;
}

/** `<project>-r<revision>-<suffix>.<ext>`, e.g. `Mutfak-r3-a4.pdf`. */
export function documentFileName(
  projectName: string,
  revision: number,
  suffix: string,
  ext: string,
): string {
  return `${asciiStem(projectName)}-r${revision}-${suffix}.${ext}`;
}
