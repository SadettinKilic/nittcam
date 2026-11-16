'use client';

import { useState, type ReactNode } from 'react';

/** DOM id for a profile path like `tools[1].diameter`. */
export function fieldId(path: string): string {
  return `f-${path.replace(/[.[\]]+/g, '-').replace(/-$/, '')}`;
}

const inputClass =
  'w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent aria-[invalid=true]:border-danger';

interface FieldProps {
  path: string;
  label: string;
  error?: string | undefined;
  help?: string | undefined;
  /** Table cells: the label is for screen readers only. */
  compact?: boolean;
}

function Field({
  path,
  label,
  error,
  help,
  compact = false,
  children,
}: FieldProps & { children: ReactNode }) {
  const id = fieldId(path);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={compact ? 'sr-only' : 'text-sm font-medium text-fg'}>
        {label}
      </label>
      {children}
      {help && !compact ? (
        <p id={`${id}-help`} className="text-xs text-fg-muted">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(path: string, error?: string, help?: string): string | undefined {
  const id = fieldId(path);
  const ids = [error ? `${id}-error` : '', help ? `${id}-help` : ''].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

/** Shows a number with a Turkish decimal comma, without grouping (it is an input). */
function formatNumber(v: number): string {
  return Number.isFinite(v) ? String(v).replace('.', ',') : '';
}

/** Accepts `12,5` and `12.5`; anything else (or empty) is NaN, which the schema reports. */
export function parseNumber(text: string): number {
  const s = text.trim().replace(',', '.');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return Number.NaN;
  return Number(s);
}

export function NumberField(
  props: FieldProps & { value: number; onChange: (value: number) => void },
) {
  const { path, error, help, compact, value, onChange } = props;
  // The text the user typed is kept as is ("12," while typing); the profile gets the number.
  const [text, setText] = useState(() => formatNumber(value));
  return (
    <Field {...props}>
      <input
        id={fieldId(path)}
        name={path}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={`${inputClass} ${compact ? 'min-w-16' : ''}`}
        value={text}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(path, error, compact ? undefined : help)}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseNumber(e.target.value));
        }}
      />
    </Field>
  );
}

export function TextField(
  props: FieldProps & { value: string; onChange: (value: string) => void; multiline?: boolean },
) {
  const { path, error, help, value, onChange, multiline } = props;
  const common = {
    id: fieldId(path),
    name: path,
    className: inputClass,
    value,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy(path, error, help),
  } as const;
  return (
    <Field {...props}>
      {multiline ? (
        <textarea {...common} rows={2} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...common} type="text" onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}

export function SelectField<T extends string>(
  props: FieldProps & {
    value: T;
    options: Record<T, string>;
    onChange: (value: T) => void;
  },
) {
  const { path, error, help, value, options, onChange } = props;
  return (
    <Field {...props}>
      <select
        id={fieldId(path)}
        name={path}
        className={inputClass}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(path, error, help)}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {(Object.keys(options) as T[]).map((k) => (
          <option key={k} value={k}>
            {options[k]}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function CheckField(props: {
  path: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const { path, label, checked, onChange } = props;
  return (
    <label htmlFor={fieldId(path)} className="flex items-center gap-2 py-2 text-sm text-fg">
      <input
        id={fieldId(path)}
        name={path}
        type="checkbox"
        className="size-4 accent-accent focus-visible:outline-2 focus-visible:outline-accent"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
