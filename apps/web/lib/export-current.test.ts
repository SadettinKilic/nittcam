import { describe, expect, it } from 'vitest';
import { currentControlOf, isOldRevision } from './export-current';

const rec = (kind: 'nc' | 'dxf' | 'pdf', id: string) => ({
  kind,
  post: { id, version: '1', name: id },
});

describe('old revision (T296)', () => {
  it('only an older revision is old', () => {
    expect(isOldRevision(1, 2)).toBe(true);
    expect(isOldRevision(2, 2)).toBe(false);
    expect(isOldRevision(3, 2)).toBe(false);
  });

  it('NC goes to the checklist, documents to their own download button', () => {
    expect(currentControlOf(rec('nc', 'mach3'))).toBe('export-checklist');
    expect(currentControlOf(rec('dxf', 'dxf-dizilim'))).toBe('export-doc-dxf-dizilim');
    expect(currentControlOf(rec('pdf', 'pdf-a3'))).toBe('export-doc-pdf-a3');
    expect(currentControlOf(rec('pdf', 'etiket'))).toBe('export-labels-download');
  });
});
