import { describe, expect, it } from 'vitest';
import { changedAfterProduced, currentControlOf, isOldRevision } from './export-current';

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

describe('changed after üretildi (T303)', () => {
  it('names both revisions only for a produced / completed project with an older NC', () => {
    expect(changedAfterProduced('produced', 2, 1)).toEqual({ current: 2, nc: 1 });
    expect(changedAfterProduced('completed', 5, 3)).toEqual({ current: 5, nc: 3 });
    expect(changedAfterProduced('produced', 2, 2)).toBeNull();
    expect(changedAfterProduced('draft', 2, 1)).toBeNull();
    expect(changedAfterProduced('produced', 2, null)).toBeNull();
    expect(changedAfterProduced('produced', 2, undefined)).toBeNull();
  });
});
