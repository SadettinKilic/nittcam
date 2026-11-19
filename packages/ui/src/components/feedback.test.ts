import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<[string, string, Record<string, unknown>]> = [];
vi.mock('sonner', () => {
  const make = (kind: string) => (title: string, opts: Record<string, unknown>) => {
    calls.push([kind, title, opts]);
    return kind;
  };
  return {
    toast: Object.assign(make('default'), {
      success: make('success'),
      info: make('info'),
      error: make('error'),
      dismiss: vi.fn(),
    }),
  };
});

const { notify } = await import('./feedback');

describe('notify', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('maps to sonner with the house durations', () => {
    notify.success('Kaydedildi');
    notify.info('Bilgi');
    notify.error('Olmadı');
    expect(calls.map(([k, , o]) => [k, o.duration])).toEqual([
      ['success', 4000],
      ['info', 4000],
      ['error', 8000],
    ]);
  });

  it('passes description, action and id only when given', () => {
    const onClick = () => undefined;
    notify.error('Dışa aktarma başarısız', {
      description: 'Tekrar deneyin',
      action: { label: 'Tekrar dene', onClick },
      id: 'export-error',
      duration: 1000,
    });
    notify.success('Tamam');
    expect(calls[0]?.[2]).toEqual({
      duration: 1000,
      description: 'Tekrar deneyin',
      action: { label: 'Tekrar dene', onClick },
      id: 'export-error',
    });
    expect(calls[1]?.[2]).toEqual({ duration: 4000 });
  });

  it('T266: a toast can show bottom-center, off the right-hand inspector', () => {
    notify.success('Taşma açıldı', { position: 'bottom-center' });
    expect(calls[0]?.[2]).toEqual({ duration: 4000, position: 'bottom-center' });
  });
});
