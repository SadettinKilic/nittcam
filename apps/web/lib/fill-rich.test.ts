import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { fillRich } from './fill-rich';

describe('fillRich', () => {
  it('puts nodes into a sentence and keeps unknown placeholders', () => {
    const nodes = fillRich('Tabla {size} · post {post} {x}', {
      size: createElement('b', null, '3.050 × 2.150'),
      post: 'mach3',
    });
    expect(renderToStaticMarkup(createElement('p', null, ...nodes))).toBe(
      '<p>Tabla <b>3.050 × 2.150</b> · post mach3 {x}</p>',
    );
  });

  it('returns the text unchanged without placeholders', () => {
    expect(fillRich('Sabit metin', {})).toEqual(['Sabit metin']);
  });
});
