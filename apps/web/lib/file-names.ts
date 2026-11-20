/**
 * One file-name pattern for every export (T295, D-073; D-025: ASCII only):
 * `<project>_r<revision>_<kind>.<ext>`, fields separated by `_`.
 *
 * - NC: `<project>_r<revision>_S<sheet>[_T<tool>][_P<part>].<ext>`; the post generator adds the
 *   sheet/tool/part markers and the revision (`revisionInFileName`), and shortens only the project
 *   part when a controller limits the name length.
 * - Documents: kind `dizilim`, `parcalar`, `a4`, `a3`, `etiket`.
 * - Zip bundle of one export: kind `nc` or the document kind.
 */
import { transliterateTurkish } from '@nittcam/core';
import type { DocumentType } from './server/documents';

/** Separator between the fields of a file name. */
export const FILE_NAME_SEPARATOR = '_';

/** ASCII project part of a file name (Turkish letters transliterated, others become `_`). */
export function asciiStem(name: string, fallback = 'proje'): string {
  const s = transliterateTurkish(name.normalize('NFC'))
    .replace(/[^A-Za-z0-9]+/g, FILE_NAME_SEPARATOR)
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
    .replace(/_+$/g, '');
  return s || fallback;
}

/** `<project>_r<revision>_<kind>.<ext>`, e.g. `Mutfak_r3_a4.pdf`. */
export function exportFileName(
  projectName: string,
  revision: number,
  kind: string,
  ext: string,
): string {
  const sep = FILE_NAME_SEPARATOR;
  return `${asciiStem(projectName)}${sep}r${revision}${sep}${kind}.${ext}`;
}

/** The kind field of a document type. */
export function documentKind(type: DocumentType): string {
  switch (type) {
    case 'dxf-dizilim':
      return 'dizilim';
    case 'dxf-parcalar':
      return 'parcalar';
    case 'pdf-a4':
      return 'a4';
    case 'pdf-a3':
      return 'a3';
    case 'etiket':
      return 'etiket';
  }
}

/**
 * `exportNc` / `simulateProject` name options for the same pattern: the project part as stem and
 * the revision after it; the post adds `_S<sheet>`. The header keeps the real project name.
 */
export function ncNameOptions(
  projectName: string,
  revision: number,
): { projectName: string; revision: number; fileStem: string; revisionInFileName: true } {
  return { projectName, revision, fileStem: asciiStem(projectName), revisionInFileName: true };
}
