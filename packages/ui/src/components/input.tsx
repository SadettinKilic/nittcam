'use client';

import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { fieldBase, fieldFocus } from '../lib/styles';
import { useFieldControlProps } from './form-field';

export interface InputProps extends ComponentProps<'input'> {
  inputSize?: 'sm' | 'md' | 'lg';
}

const inputHeights = { sm: 'h-control-sm', md: 'h-control-md', lg: 'h-control-lg text-base' };

export function Input({ className, inputSize = 'md', type = 'text', ...props }: InputProps) {
  const field = useFieldControlProps(props);
  return (
    <input
      type={type}
      className={cn(fieldBase, fieldFocus, 'px-3', inputHeights[inputSize], className)}
      {...props}
      {...field}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  const field = useFieldControlProps(props);
  return (
    <textarea
      className={cn(fieldBase, fieldFocus, 'min-h-20 resize-y px-3 py-2 leading-5', className)}
      {...props}
      {...field}
    />
  );
}
