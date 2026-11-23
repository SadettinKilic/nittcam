import { afterEach, describe, expect, it } from 'vitest';
import { cornerLabels, forgetCornerLabels, relabel } from './corner-labels';

const p = (x: number, y: number) => ({ x, y });
const RECT = [p(0, 0), p(600, 0), p(600, 400), p(0, 400)];

afterEach(forgetCornerLabels);

describe('relabel (B52, D-096)', () => {
  it('numbers 1…n the first time', () => {
    expect(relabel(null, RECT)).toEqual(['1', '2', '3', '4']);
  });
  it('a moved corner keeps every number', () => {
    const moved = [p(0, 0), p(500, 0), p(600, 400), p(0, 400)];
    expect(relabel({ outline: RECT, labels: ['1', '2', '3', '4'] }, moved)).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
  });
  it('a split edge gives the new corner a letter; later corners keep their numbers', () => {
    const split = [p(0, 0), p(300, 0), p(600, 0), p(600, 400), p(0, 400)];
    expect(relabel({ outline: RECT, labels: ['1', '2', '3', '4'] }, split)).toEqual([
      '1',
      '1a',
      '2',
      '3',
      '4',
    ]);
  });
  it('a filleted corner (one corner → two) and a removed corner', () => {
    const fillet = [p(0, 0), p(590, 0), p(600, 10), p(600, 400), p(0, 400)];
    expect(relabel({ outline: RECT, labels: ['1', '2', '3', '4'] }, fillet)).toEqual([
      '1',
      '1a',
      '1b',
      '3',
      '4',
    ]);
    const tri = [p(0, 0), p(600, 0), p(0, 400)];
    expect(relabel({ outline: RECT, labels: ['1', '2', '3', '4'] }, tri)).toEqual(['1', '2', '4']);
  });
  it('a new corner before the first kept one wraps to the last label', () => {
    const at0 = [p(-1, -1), p(600, 0), p(600, 400), p(0, 400)].slice(0, 3);
    expect(
      relabel({ outline: RECT, labels: ['1', '2', '3', '4'] }, [...at0, p(0, 400), p(0, 200)]),
    ).toEqual(['4b', '2', '3', '4', '4a']);
  });
});

describe('cornerLabels memory', () => {
  it('remembers labels per part across outlines', () => {
    expect(cornerLabels('a', RECT)).toEqual(['1', '2', '3', '4']);
    const split = [p(0, 0), p(600, 0), p(600, 200), p(600, 400), p(0, 400)];
    expect(cornerLabels('a', split)).toEqual(['1', '2', '2a', '3', '4']);
    expect(cornerLabels('b', split)).toEqual(['1', '2', '3', '4', '5']);
  });
});

describe('undo gives corners their numbers back (B52)', () => {
  it('fillet then undo: corner 2 is "2" again', () => {
    const fillet = [p(0, 0), p(590, 0), p(600, 10), p(600, 400), p(0, 400)];
    cornerLabels('u', RECT);
    expect(cornerLabels('u', fillet)).toEqual(['1', '1a', '1b', '3', '4']);
    expect(cornerLabels('u', [...RECT])).toEqual(['1', '2', '3', '4']);
  });
});
