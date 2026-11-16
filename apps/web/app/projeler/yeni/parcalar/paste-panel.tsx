'use client';

import {
  CUT_LIST_FIELDS,
  cutListToParts,
  parseCutList,
  type CutListCellError,
  type CutListDelimiter,
  type CutListField,
  type CutListPartInput,
  type DecimalSeparator,
  type LengthUnit,
} from '@nittcam/core';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { fill, newPartId } from '../../../../lib/draft-project';
import type { Messages } from '../../../../lib/messages';
import { buttonClass } from './ui';

type Text = Messages['cutList']['paste'];
type DelimiterChoice = 'auto' | 'tab' | 'semicolon' | 'comma';
type DecimalChoice = 'auto' | DecimalSeparator;

const DELIMITERS: Record<Exclude<DelimiterChoice, 'auto'>, CutListDelimiter> = {
  tab: '\t',
  semicolon: ';',
  comma: ',',
};

const selectClass =
  'w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent';

const numberFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 });

function errorText(t: Text, e: CutListCellError): string {
  return fill(t.errors[e.code], { field: t.fields[e.field] });
}

export interface PastePanelProps {
  t: Text;
  /** Executes importCutList; false when the command was rejected. */
  onApply: (parts: CutListPartInput[]) => boolean;
  onCancel: () => void;
}

/**
 * Paste → preview → confirm (spec §4.1). The pasted text is parsed on every change; the user
 * checks the column mapping, sees invalid rows with Turkish messages and answers the unit question
 * when sizes may be centimetres. Nothing reaches the project until "Uygula".
 */
export function PastePanel({ t, onApply, onCancel }: PastePanelProps) {
  const uid = useId();
  const [text, setText] = useState('');
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

  return (
    <section
      id="paste-panel"
      aria-labelledby={`${uid}-title`}
      className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-bg p-4 shadow-sm"
    >
      <div className="flex flex-col gap-1">
        <h2 id={`${uid}-title`} className="text-xl font-semibold">
          {t.title}
        </h2>
        <p id={`${uid}-help`} className="text-sm text-fg-muted">
          {t.help}
        </p>
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
          className="w-full rounded-lg border border-border bg-bg p-2 font-mono text-sm text-fg [tab-size:12] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
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
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t.delimiter}
              <select
                className={selectClass}
                value={delimiter}
                onChange={(e) => {
                  setDelimiter(e.target.value as DelimiterChoice);
                  setHeader(null);
                  resetDerived();
                }}
              >
                {(Object.keys(t.delimiterOptions) as DelimiterChoice[]).map((k) => (
                  <option key={k} value={k}>
                    {t.delimiterOptions[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t.decimal}
              <select
                className={selectClass}
                value={decimal}
                onChange={(e) => {
                  setDecimal(e.target.value as DecimalChoice);
                  resetDerived();
                }}
              >
                {(Object.keys(t.decimalOptions) as DecimalChoice[]).map((k) => (
                  <option key={k} value={k}>
                    {t.decimalOptions[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 py-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-accent focus-visible:outline-2 focus-visible:outline-accent"
                checked={result.hasHeader}
                onChange={(e) => {
                  setHeader(e.target.checked);
                  resetDerived();
                }}
              />
              {t.header}
            </label>
          </fieldset>

          {result.warnings.length > 0 ? (
            <ul className="flex flex-col gap-1 rounded-lg bg-warn-bg p-3 text-sm text-warn">
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
            <div className="relative max-h-96 max-w-full overflow-auto rounded-card border border-border">
              <table className="w-full text-left text-sm" aria-label={t.preview}>
                <thead className="sticky top-0 bg-sidebar text-fg-muted">
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
                          <select
                            id={selectId}
                            data-testid={`map-${i}`}
                            className={selectClass}
                            value={field}
                            onChange={(e) => setField(i, e.target.value as CutListField)}
                          >
                            {CUT_LIST_FIELDS.map((f) => (
                              <option key={f} value={f}>
                                {t.fields[f]}
                              </option>
                            ))}
                          </select>
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
                        className={bad ? 'bg-danger-bg' : undefined}
                      >
                        <td className="px-2 py-1.5 text-fg-muted tabular-nums">{row.line}</td>
                        {row.cells.map((cell, i) => {
                          const ignored = result.columns.fields[i] === 'ignore';
                          return (
                            <td
                              key={i}
                              className={`px-2 py-1.5 whitespace-pre-wrap ${
                                badCols.has(i)
                                  ? 'font-semibold text-danger'
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
                            <ul className="text-danger">
                              {row.errors.map((e, k) => (
                                <li key={k}>{errorText(t, e)}</li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-ok">
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
              className="flex min-w-0 flex-col gap-2 rounded-lg border border-warn bg-warn-bg p-3"
              aria-describedby={`${uid}-unit-help`}
            >
              <legend className="px-1 text-sm font-semibold text-warn">{t.unit.question}</legend>
              <p id={`${uid}-unit-help`} className="text-sm text-warn">
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
                      className="size-4 accent-accent focus-visible:outline-2 focus-visible:outline-accent"
                      onChange={() => {
                        setUnit(u);
                      }}
                    />
                    {t.unit[u]}
                  </label>
                ))}
              </div>
              {needsUnit ? (
                <p id={`${uid}-unit-required`} className="text-sm font-medium text-danger">
                  {t.unit.required}
                </p>
              ) : null}
            </fieldset>
          ) : null}

          <p className="text-sm" aria-live="polite">
            {validCount === 0
              ? t.nothing
              : invalidCount > 0
                ? fill(t.summary, { valid: validCount, invalid: invalidCount })
                : fill(t.summaryAllValid, { valid: validCount })}
          </p>
          {applyError ? (
            <p role="alert" className="rounded-lg bg-danger-bg p-3 text-sm text-danger">
              {t.applyError}
            </p>
          ) : null}
        </>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={apply}
          disabled={!canApply}
          aria-describedby={needsUnit && validCount > 0 ? `${uid}-unit-required` : undefined}
          className={`${buttonClass} bg-accent text-accent-fg hover:brightness-110`}
        >
          {validCount > 0 ? fill(t.applyCount, { count: validCount }) : t.apply}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={`${buttonClass} border border-border bg-bg hover:bg-sidebar`}
        >
          {t.cancel}
        </button>
      </div>
    </section>
  );
}
