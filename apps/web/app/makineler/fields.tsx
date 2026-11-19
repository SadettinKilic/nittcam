'use client';

import {
  Checkbox,
  FormField,
  Input,
  Label,
  NumberInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  type NumberParseError,
} from '@nittcam/ui';
import type { ReactNode } from 'react';

/** DOM id for a profile path like `tools[1].diameter`. */
export function fieldId(path: string): string {
  return `f-${path.replace(/[.[\]]+/g, '-').replace(/-$/, '')}`;
}

interface FieldProps {
  path: string;
  label: string;
  error?: string | undefined;
  help?: string | undefined;
  /** Table cells: the label is for screen readers only and there is no help line. */
  compact?: boolean;
  /** Dense table cells (T265, materials table): a narrower minimum width. */
  narrow?: boolean;
}

/** A table cell control: aria-label instead of a visible label, the error under it. */
function Compact({
  path,
  error,
  children,
}: {
  path: string;
  error: string | undefined;
  children: (aria: { 'aria-describedby'?: string }) => ReactNode;
}) {
  const errorId = `${fieldId(path)}-error`;
  return (
    <div className="flex flex-col gap-1">
      {children(error ? { 'aria-describedby': errorId } : {})}
      {error ? (
        <p id={errorId} className="text-xs leading-4 font-medium text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function NumberField(
  props: FieldProps & {
    value: number;
    onChange: (value: number) => void;
    /** Typed text that is not a number yet (shown as the field's error by the form). */
    onParseError: (path: string, error: NumberParseError | null) => void;
    unit?: string | undefined;
    maxDecimals?: number;
  },
) {
  const { path, label, error, help, compact, narrow, value, onChange, onParseError, unit } = props;
  const control = (extra: { 'aria-describedby'?: string; 'aria-label'?: string }) => (
    <NumberInput
      {...extra}
      id={fieldId(path)}
      name={path}
      required
      value={Number.isFinite(value) ? value : null}
      {...(unit ? { unit } : {})}
      maxDecimals={props.maxDecimals ?? 3}
      invalid={!!error}
      inputSize={compact ? 'sm' : 'md'}
      {...(compact
        ? { className: narrow ? 'min-w-20' : unit && unit.length > 2 ? 'min-w-36' : 'min-w-24' }
        : {})}
      onValueChange={(v) => {
        if (v !== null) onChange(v);
      }}
      onValidityChange={(e) => onParseError(path, e)}
    />
  );
  if (compact) {
    return (
      <Compact path={path} error={error}>
        {(aria) => control({ ...aria, 'aria-label': label })}
      </Compact>
    );
  }
  return (
    <FormField id={fieldId(path)} label={label} hint={help} error={error}>
      {control({})}
    </FormField>
  );
}

export function TextField(
  props: FieldProps & { value: string; onChange: (value: string) => void; multiline?: boolean },
) {
  const { path, label, error, help, value, onChange, multiline } = props;
  return (
    <FormField
      id={fieldId(path)}
      label={label}
      hint={help}
      error={error}
      {...(multiline ? { className: 'sm:col-span-2' } : {})}
    >
      {multiline ? (
        <Textarea name={path} rows={2} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input name={path} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </FormField>
  );
}

export function SelectField<T extends string>(
  props: FieldProps & {
    value: T;
    options: Record<T, string>;
    onChange: (value: T) => void;
  },
) {
  const { path, label, error, help, compact, narrow, value, options, onChange } = props;
  const control = (extra: { 'aria-describedby'?: string; 'aria-label'?: string }) => (
    <Select value={value} onValueChange={(v) => onChange(v as T)} name={path}>
      <SelectTrigger
        {...extra}
        id={fieldId(path)}
        size={compact ? 'sm' : 'md'}
        {...(compact ? { className: narrow ? 'min-w-32' : 'min-w-36' } : {})}
        aria-invalid={error ? true : undefined}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(options) as T[]).map((k) => (
          <SelectItem key={k} value={k}>
            {options[k]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  if (compact) {
    return (
      <Compact path={path} error={error}>
        {(aria) => control({ ...aria, 'aria-label': label })}
      </Compact>
    );
  }
  return (
    <FormField id={fieldId(path)} label={label} hint={help} error={error}>
      {control({})}
    </FormField>
  );
}

export function CheckField(props: {
  path: string;
  label: string;
  help?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const { path, label, help, checked, onChange } = props;
  const id = fieldId(path);
  return (
    <div className="flex items-start gap-3 py-1">
      <Checkbox
        id={id}
        name={path}
        className="mt-0.5"
        checked={checked}
        aria-describedby={help ? `${id}-hint` : undefined}
        onCheckedChange={(v) => onChange(v === true)}
      />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
        {help ? (
          <p id={`${id}-hint`} className="text-xs text-fg-muted">
            {help}
          </p>
        ) : null}
      </div>
    </div>
  );
}
