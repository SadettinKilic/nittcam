'use client';

import {
  CUT_LIST_FIELDS,
  LONG_SHORT_FIELDS,
  cutListToParts,
  parseCutList,
  type CutListCellError,
  type CutListDelimiter,
  type CutListField,
  type CutListPartInput,
  type DecimalSeparator,
  type LengthUnit,
  type LongShortField,
} from '@nittcam/core';
import { FileUp, Info } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from 'react';
import { readCutListFile, type CutListFileError } from '../../lib/cut-list-file';
import { fill, newPartId } from '../../lib/draft-project';
import type { Messages } from '../../lib/messages';
import {
  Button,
  Checkbox,
  cn,
  fieldBase,
  fieldFocus,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nittcam/ui';

type Text = Messages['cutList']['paste'];
type DelimiterChoice = 'auto' | 'tab' | 'semicolon' | 'comma';
type DecimalChoice = 'auto' | DecimalSeparator;

const DELIMITERS: Record<Exclude<DelimiterChoice, 'auto'>, CutListDelimiter> = {
  tab: '\t',
  semicolon: ';',
  comma: ',',
};

const numberFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 });

function errorText(t: Text, e: CutListCellError): string {
  return fill(t.errors[e.code], { field: t.fields[e.field] });
}

export interface PastePanelProps {
  t: Text;
  /** Executes importCutList; false when the command was rejected. */
  onApply: (parts: CutListPartInput[]) => boolean;
  onCancel: () => void;
  /** One line above the help text (the cut list's "how" sentence, T246). */
  intro?: string;
}

/**
 * Paste → preview → confirm (spec §4.1). The pasted text is parsed on every change; the user
 * checks the column mapping, sees invalid rows with Turkish messages and answers the unit question
 * when sizes may be centimetres. Nothing reaches the project until "Uygula".
 */
export function PastePanel({ t, onApply, onCancel, intro }: PastePanelProps) {
  const uid = useId();
  const [text, setText] = useState('');
  const [file, setFile] = useState<{ name: string; state: 'reading' | 'loaded' } | null>(null);
  const [fileError, setFileError] = useState<CutListFileError | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [delimiter, setDelimiter] = useState<DelimiterChoice>('auto');
  const [decimal, setDecimal] = useState<DecimalChoice>('auto');
  const [header, setHeader] = useState<boolean | null>(null);
  const [columns, setColumns] = useState<CutListField[] | null>(null);
  const [unit, setUnit] = useState<LengthUnit | null>(null);
  const [applyError, setApplyError] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Opening the panel puts the cursor where the user pastes.
  useEffect(() => {
    textRef.current?.focus();
  }, []);

  const result = useMemo(
    () =>
      parseCutList(text, {
        delimiter: delimiter === 'auto' ? undefined : DELIMITERS[delimiter],
        decimal: decimal === 'auto' ? undefined : decimal,
        hasHeader: header ?? undefined,
        columns: columns ?? undefined,
      }),
    [text, delimiter, decimal, header, columns],
  );

  const validCount = result.rows.filter((r) => r.errors.length === 0).length;
  const invalidCount = result.rows.length - validCount;
  const hasText = text.trim() !== '';
  /** Ambiguous unit: "Uygula" stays disabled until the user picks mm or cm (spec §5.4). */
  const needsUnit = result.unitAmbiguous && unit === null;
  const canApply = validCount > 0 && !needsUnit;

  function resetDerived() {
    setColumns(null);
    setUnit(null);
    setApplyError(false);
  }

  function setField(index: number, field: CutListField) {
    const next = result.columns.fields.map((f) =>
      field !== 'ignore' && f === field ? 'ignore' : f,
    );
    next[index] = field;
    setColumns(next);
    setApplyError(false);
  }

  function apply() {
    if (!canApply) return;
    const chosen: LengthUnit = result.unitAmbiguous ? (unit ?? 'mm') : (result.headerUnit ?? 'mm');
    const ids = Array.from({ length: validCount }, () => newPartId());
    const ok = onApply(cutListToParts(result.rows, ids, chosen));
    setApplyError(!ok);
  }

  const textId = `${uid}-text`;
  const sourceText = t.source[result.columns.source];

  /** Reads a chosen or dropped file into the text box (T120); the preview below does the rest. */
  async function loadFile(f: File) {
    setFileError(null);
    setFile({ name: f.name, state: 'reading' });
    const result = await readCutListFile(f);
    if (!result.ok) {
      setFile(null);
      setFileError(result.error);
      return;
    }
    setText(result.text);
    setHeader(null);
    resetDerived();
    setFile({ name: f.name, state: 'loaded' });
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) void loadFile(f);
  }

  return (
    <section
      id="paste-panel"
      aria-labelledby={`${uid}-title`}
      className="flex min-w-0 flex-col gap-5 rounded-xl border border-border bg-surface p-4 shadow-sm sm:p-5"
    >
      {/* T250 (T248 import bullet): a one-sentence intro; the how-to sits in an info popover. */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <h2 id={`${uid}-title`} className="text-base font-semibold tracking-tight text-fg">
            {t.title}
          </h2>
          <Popover>
            <PopoverTrigger asChild>
              <IconButton size="sm" variant="ghost" aria-label={t.about}>
                <Info aria-hidden />
              </IconButton>
            </PopoverTrigger>
            <PopoverContent align="end" className="flex w-80 flex-col gap-2 text-sm">
              {intro ? <p className="text-fg">{intro}</p> : null}
              <p className="text-fg-muted">{t.help}</p>
            </PopoverContent>
          </Popover>
        </div>
        <p id={`${uid}-help`} className="text-sm text-fg-muted">
          {t.intro}
        </p>
      </div>

      <div
        data-testid="import-drop"
        data-dragging={dragging || undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border-strong bg-surface-subtle px-4 py-3 transition-colors duration-(--duration-fast)',
          dragging && 'border-accent-border bg-accent-subtle',
        )}
      >
        <FileUp aria-hidden className="size-5 shrink-0 text-fg-muted" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-sm text-fg">{t.file.drop}</p>
          <p className="text-xs text-fg-muted">{t.file.limits}</p>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.txt,.tsv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          data-testid="import-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void loadFile(f);
          }}
        />
        <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
          {t.file.choose}
        </Button>
        <div aria-live="polite" className="w-full empty:hidden">
          {fileError ? (
            <p
              role="alert"
              className="text-sm font-medium text-danger-text"
              data-testid="import-error"
            >
              {t.file.errors[fileError]}
            </p>
          ) : file ? (
            <p
              className="text-sm text-fg-muted"
              data-testid="import-file-state"
              data-state={file.state}
            >
              {fill(file.state === 'loaded' ? t.file.loaded : t.file.reading, { name: file.name })}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={textId} className="text-sm font-medium">
          {t.textLabel}
        </label>
        <textarea
          id={textId}
          ref={textRef}
          rows={6}
          wrap="off"
          spellCheck={false}
          aria-describedby={`${uid}-help`}
          placeholder={t.placeholder}
          className={`${fieldBase} ${fieldFocus} p-3 font-mono text-sm [tab-size:12]`}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setHeader(null);
            resetDerived();
          }}
        />
      </div>

      {hasText ? (
        <>
          <fieldset className="flex min-w-0 flex-wrap items-end gap-4">
            <legend className="sr-only">{t.options}</legend>
            <div className="flex flex-col gap-1 text-sm font-medium">
              <label htmlFor={`${uid}-delimiter`}>{t.delimiter}</label>
              <Select
                value={delimiter}
                onValueChange={(v) => {
                  setDelimiter(v as DelimiterChoice);
                  setHeader(null);
                  resetDerived();
                }}
              >
                <SelectTrigger id={`${uid}-delimiter`} className="min-w-40 font-normal">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(t.delimiterOptions) as DelimiterChoice[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {t.delimiterOptions[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1 text-sm font-medium">
              <label htmlFor={`${uid}-decimal`}>{t.decimal}</label>
              <Select
                value={decimal}
                onValueChange={(v) => {
                  setDecimal(v as DecimalChoice);
                  resetDerived();
                }}
              >
                <SelectTrigger id={`${uid}-decimal`} className="min-w-40 font-normal">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(t.decimalOptions) as DecimalChoice[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {t.decimalOptions[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex min-h-10 items-center gap-2 text-sm">
              <Checkbox
                id={`${uid}-header`}
                checked={result.hasHeader}
                onCheckedChange={(v) => {
                  setHeader(v === true);
                  resetDerived();
                }}
              />
              <label htmlFor={`${uid}-header`} className="cursor-pointer">
                {t.header}
              </label>
            </div>
          </fieldset>

          {result.warnings.length > 0 ? (
            <ul className="flex flex-col gap-1 rounded-lg border border-warning-border bg-warning-subtle px-3 py-2.5 text-sm text-warning-text">
              {result.warnings.map((w) => (
                <li key={w.code}>{t.warnings[w.code]}</li>
              ))}
            </ul>
          ) : null}

          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="text-base font-semibold">{t.preview}</h3>
            <p className="text-sm text-fg-muted">
              {sourceText}
              {result.columns.confidence === 'low' ? ` ${t.confidenceLow}` : ''}
            </p>
            {result.columns.fields.some((f) => LONG_SHORT_FIELDS.includes(f as LongShortField)) ? (
              <p className="text-sm text-fg-muted" data-testid="edge-help">
                {t.edgeHelp}
              </p>
            ) : null}
            <div className="relative max-h-96 max-w-full overflow-auto rounded-lg border border-border">
              <table className="w-full text-left text-sm" aria-label={t.preview}>
                <thead className="sticky top-0 bg-surface-subtle text-xs text-fg-muted">
                  <tr>
                    <th scope="col" className="px-2 py-2 align-bottom font-medium">
                      {t.line}
                    </th>
                    {result.columns.fields.map((field, i) => {
                      const selectId = `${uid}-col-${i}`;
                      return (
                        <th key={i} scope="col" className="min-w-36 px-2 py-2 align-bottom">
                          {result.header ? (
                            <span className="block pb-1 font-normal">{result.header[i]}</span>
                          ) : null}
                          <label htmlFor={selectId} className="sr-only">
                            {fill(t.columnSelect, { n: i + 1 })}
                          </label>
                          <Select
                            value={field}
                            onValueChange={(v) => setField(i, v as CutListField)}
                          >
                            <SelectTrigger
                              id={selectId}
                              data-testid={`map-${i}`}
                              data-value={field}
                              size="sm"
                              className="font-normal"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CUT_LIST_FIELDS.map((f) => (
                                <SelectItem key={f} value={f}>
                                  {t.fields[f]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </th>
                      );
                    })}
                    <th scope="col" className="min-w-48 px-2 py-2 align-bottom font-medium">
                      {t.status}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {result.rows.map((row) => {
                    const bad = row.errors.length > 0;
                    const badCols = new Set(row.errors.map((e) => e.col));
                    return (
                      <tr
                        key={row.line}
                        data-invalid={bad ? 'true' : undefined}
                        className={bad ? 'bg-danger-subtle' : undefined}
                      >
                        <td className="px-2 py-1.5 text-fg-muted tabular-nums">{row.line}</td>
                        {row.cells.map((cell, i) => {
                          const ignored = result.columns.fields[i] === 'ignore';
                          return (
                            <td
                              key={i}
                              className={`px-2 py-1.5 whitespace-pre-wrap ${
                                badCols.has(i)
                                  ? 'font-semibold text-danger-text'
                                  : ignored
                                    ? 'text-fg-muted'
                                    : ''
                              }`}
                            >
                              {cell}
                            </td>
                          );
                        })}
                        <td className="px-2 py-1.5">
                          {bad ? (
                            <ul className="text-danger-text">
                              {row.errors.map((e, k) => (
                                <li key={k}>{errorText(t, e)}</li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-success-text">
                              {t.ok}
                              {row.values.w !== null && row.values.h !== null
                                ? ` · ${numberFormat.format(row.values.w)} × ${numberFormat.format(row.values.h)} × ${row.values.qty ?? 1}`
                                : ''}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {result.unitAmbiguous ? (
            <fieldset
              className="flex min-w-0 flex-col gap-2 rounded-lg border border-warning-border bg-warning-subtle p-3"
              aria-describedby={`${uid}-unit-help`}
            >
              <legend className="px-1 text-sm font-semibold text-warning-text">
                {t.unit.question}
              </legend>
              <p id={`${uid}-unit-help`} className="text-sm text-warning-text">
                {result.headerUnit === 'cm' ? t.unit.helpHeader : t.unit.help} {t.unit.convert}
              </p>
              <div className="flex flex-wrap gap-4">
                {(['mm', 'cm'] as const).map((u) => (
                  <label key={u} className="flex items-center gap-2 text-sm text-fg">
                    <input
                      type="radio"
                      name={`${uid}-unit`}
                      value={u}
                      checked={unit === u}
                      className="size-4 accent-(--color-accent) focus-visible:outline-2 focus-visible:outline-focus"
                      onChange={() => {
                        setUnit(u);
                      }}
                    />
                    {t.unit[u]}
                  </label>
                ))}
              </div>
              {needsUnit ? (
                <p id={`${uid}-unit-required`} className="text-sm font-medium text-danger-text">
                  {t.unit.required}
                </p>
              ) : null}
            </fieldset>
          ) : null}

          <p className="text-sm" aria-live="polite">
            {validCount === 0
              ? t.nothing
              : invalidCount > 0
                ? fill(t.summary, {
                    valid: validCount,
                    invalid: invalidCount,
                    // P3 (CTO #10): the skipped rows are named; each one's reason is in Durum.
                    lines: result.rows
                      .filter((r) => r.errors.length > 0)
                      .map((r) => r.line)
                      .join(', '),
                  })
                : fill(t.summaryAllValid, { valid: validCount })}
          </p>
          {applyError ? (
            <p
              role="alert"
              className="rounded-lg border border-danger-border bg-danger-subtle px-3 py-2.5 text-sm text-danger-text"
            >
              {t.applyError}
            </p>
          ) : null}
        </>
      ) : null}

      {/* T250 (T248 import bullet): the apply / cancel row sticks to the bottom of the panel, just
          above the wizard footer, so "N satır ekle" is visible without scrolling. */}
      <div
        data-testid="import-actions"
        className="sticky bottom-[var(--wizard-footer-h,0px)] z-10 -mx-4 -mb-4 flex flex-wrap gap-2 rounded-b-xl border-t border-border-subtle bg-surface/95 px-4 py-3 backdrop-blur-sm sm:-mx-5 sm:-mb-5 sm:px-5"
      >
        <Button
          onClick={apply}
          disabled={!canApply}
          aria-describedby={needsUnit && validCount > 0 ? `${uid}-unit-required` : undefined}
        >
          {validCount > 0 ? fill(t.applyCount, { count: validCount }) : t.apply}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t.cancel}
        </Button>
      </div>
    </section>
  );
}
