import { describe, expect, it } from 'vitest';
import tr from '../messages/tr.json' with { type: 'json' };
import { directionLabelOf } from './direction-context';
import { grainDialLabels } from './grain-labels';

describe('direction wording per material (T347)', () => {
  it('wood says Damar, aluminium Yüzey yönü, ACM Film oku', () => {
    expect(directionLabelOf('mdf')).toBe('grain');
    expect(directionLabelOf('alüminyum')).toBe('surface');
    expect(directionLabelOf('ACM')).toBe('film');
    expect(directionLabelOf('unknown-stuff')).toBe('grain');
  });

  it('the dial keeps today’s wood texts and renames for metal', () => {
    const today = grainDialLabels(tr.grainDial);
    const wood = grainDialLabels(tr.grainDial, { direction: tr.direction.grain });
    expect({ ...wood, valueText: null }).toEqual({ ...today, valueText: null });
    expect(wood.valueText(30)).toBe(today.valueText(30));
    const film = grainDialLabels(tr.grainDial, { direction: tr.direction.film });
    expect(film.label).toBe('Film oku açısı');
    expect(film.note).toContain('210° farklıdır');
    expect(tr.direction.surface.title).toBe('Yüzey yönü');
  });
});
