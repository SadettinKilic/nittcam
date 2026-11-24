import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import tr from '../../messages/tr.json';
import { LeftDraftNotice } from './left-draft-notice';

const t = tr.projects.leftDraft;
const draft = { draftId: '11111111-1111-4111-8111-111111111111', name: 'Mutfak', changes: 2 };

describe('LeftDraftNotice (T326 rider): "Taslağı sil" asks first', () => {
  it('"Taslağı sil" opens a dialog instead of deleting; nothing is deleted on render', () => {
    const removed: string[] = [];
    const html = renderToStaticMarkup(
      <LeftDraftNotice draft={draft} href="/x" t={t} onDiscard={(id) => removed.push(id)} />,
    );
    expect(html).toContain('“Mutfak” kaydedilmeden kapandı (2 değişiklik');
    const discard = /<button[^>]*data-testid="left-draft-discard"[^>]*>/.exec(html)?.[0] ?? '';
    expect(discard).toContain('aria-haspopup="dialog"');
    expect(discard).toContain('data-state="closed"');
    expect(removed).toEqual([]);
  });

  it('confirm text is Turkish, in the translation file, and says it cannot be undone', () => {
    expect(t.discardBody).toBe(
      'Bu taslaktaki kaydedilmemiş değişiklikler silinecek. Geri alınamaz.',
    );
    expect(t.discardCancel).toBe('Vazgeç');
    expect(t.discard).toBe('Taslağı sil');
    expect(t.discardTitle).toContain('{name}');
  });
});
