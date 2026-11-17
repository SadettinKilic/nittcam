import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('joins conditional classes', () => {
    const off = Math.random() > 2;
    expect(cn('a', off && 'b', undefined, ['c', { d: true, e: false }])).toBe('a c d');
  });
  it('lets the later Tailwind class win', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
    expect(cn('bg-accent', 'bg-danger')).toBe('bg-danger');
  });
  it('keeps size and colour of text apart, including the custom 2xs size', () => {
    expect(cn('text-2xs', 'text-fg-muted')).toBe('text-2xs text-fg-muted');
    expect(cn('text-sm', 'text-2xs')).toBe('text-2xs');
  });
});
