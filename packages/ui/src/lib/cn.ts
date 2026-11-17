import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// tailwind-merge must know our custom type scale (text-2xs) and `numeric`, so that e.g.
// cn('text-2xs', 'text-fg') keeps both (size vs colour) instead of dropping one.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['2xs'] }],
      'fvn-spacing': ['numeric'],
    },
  },
});

/** Joins class names and resolves Tailwind conflicts (last one wins). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export { cva, type VariantProps } from 'class-variance-authority';
