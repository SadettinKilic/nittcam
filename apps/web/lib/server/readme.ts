/**
 * `OKU.txt` of a zip bundle (T176, CTO #10 E4): which file belongs to which sheet, with each file's
 * sha256 so the shop can compare it with the history. No date (D-025: the date lives in the export
 * record, never in a file), so the same export gives the same text. CRLF for Windows Notepad.
 */
import type { ExportRow } from '@nittcam/db';
import { fill } from '../fill';
import { getMessages } from '../messages';

const t = getMessages().exportReadme;

export function exportReadme(
  row: Pick<
    ExportRow,
    'kind' | 'projectRevision' | 'postId' | 'postVersion' | 'verificationState' | 'files'
  >,
  projectName: string,
): string {
  const lines = [
    fill(t.title, { project: projectName || t.noName, revision: row.projectRevision }),
    fill(t.generator, { id: row.postId, version: row.postVersion }),
    ...(row.kind === 'nc' ? [fill(t.verification, { state: row.verificationState })] : []),
    '',
    row.kind === 'nc' ? t.sheetsTitle : t.filesTitle,
    ...row.files.map((f) =>
      row.kind === 'nc'
        ? fill(t.sheetLine, { n: f.sheet + 1, name: f.name, hash: f.sha256 })
        : fill(t.fileLine, { name: f.name, hash: f.sha256 }),
    ),
    '',
    t.note,
  ];
  return lines.join('\r\n') + '\r\n';
}
