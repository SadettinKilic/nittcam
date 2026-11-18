import { NestingIcon, RouterIcon, ToolpathIcon, cn } from '@nittcam/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { focusRing } from '../page/page-header';

export interface StartStep {
  title: string;
  text: string;
  href: string;
  /** Step already satisfied (e.g. a machine exists): shown as done, still a link. */
  done?: boolean;
}

/**
 * Line illustrations of the three steps, drawn with canvas tokens on a dot grid
 * (review #1 §4.1 motif: measurement lines, dot grid, thin line art). Decorative.
 */
function Art({ step }: { step: 0 | 1 | 2 }) {
  const line = 'stroke-sheet-edge';
  return (
    <svg viewBox="0 0 160 64" className="h-16 w-full" aria-hidden="true" fill="none">
      {step === 0 ? (
        <>
          {/* Router table with the gantry and the spindle. */}
          <rect x="34" y="40" width="92" height="12" rx="2" className={cn(line, 'fill-sheet')} />
          <path d="M28 14h104" className={line} strokeWidth="1.5" strokeLinecap="round" />
          <rect x="72" y="14" width="16" height="16" rx="2" className={cn(line, 'fill-canvas')} />
          <path d="M77 30h6l-1.5 5h-3z" className={line} strokeLinejoin="round" />
          <path d="M80 35v4" className="stroke-sim-tool" strokeWidth="1.5" strokeLinecap="round" />
        </>
      ) : step === 1 ? (
        <>
          {/* A sheet with parts and one dimension line. */}
          <rect x="30" y="10" width="100" height="44" rx="1.5" className={cn(line, 'fill-sheet')} />
          <rect
            x="36"
            y="16"
            width="34"
            height="32"
            rx="1"
            className="fill-part stroke-part-stroke"
          />
          <rect
            x="74"
            y="16"
            width="26"
            height="18"
            rx="1"
            className="fill-part stroke-part-stroke"
          />
          <rect
            x="74"
            y="38"
            width="26"
            height="10"
            rx="1"
            className="fill-part stroke-part-stroke"
          />
          <path d="M30 60h100M30 57v6M130 57v6" className={line} strokeLinecap="round" />
        </>
      ) : (
        <>
          {/* A contour toolpath with lead-in and the tool dot, like the brand mark. */}
          <rect x="30" y="10" width="100" height="44" rx="1.5" className={cn(line, 'fill-sheet')} />
          <path
            d="M40 50a6 6 0 0 1 6-6V18h50v26H58"
            className="stroke-sim-tool"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M104 18h18M104 26h14M104 34h18M104 42h10"
            className="stroke-grid"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <circle cx="58" cy="44" r="3" className="fill-sim-tool" />
        </>
      )}
    </svg>
  );
}

const ICONS = [RouterIcon, NestingIcon, ToolpathIcon] as const;

/**
 * Zero-project start strip (T194a): replaces the KPI row until the first project exists.
 * "1 Makine · 2 Kesim listesi · 3 G-code", each a link into the flow.
 */
export function StartStrip({
  label,
  steps,
  doneLabel,
}: {
  label: string;
  steps: readonly [StartStep, StartStep, StartStep];
  doneLabel: string;
}): ReactNode {
  return (
    <section aria-label={label} data-testid="home-start">
      <ol className="grid gap-3 md:grid-cols-3 lg:gap-4">
        {steps.map((s, i) => {
          const Icon = ICONS[i as 0 | 1 | 2];
          return (
            <li key={s.href} className="min-w-0">
              <Link
                href={s.href}
                className={cn(
                  'group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xs',
                  'transition-colors duration-(--duration-fast) hover:border-border-strong',
                  focusRing,
                )}
              >
                <div
                  className="border-b border-border-subtle bg-canvas px-3 py-2"
                  style={{
                    backgroundImage: 'radial-gradient(var(--color-grid) 1px, transparent 1px)',
                    backgroundSize: '12px 12px',
                  }}
                >
                  <Art step={i as 0 | 1 | 2} />
                </div>
                <div className="flex items-start gap-3 p-4">
                  <span
                    aria-hidden
                    className={cn(
                      'numeric flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                      s.done
                        ? 'border-accent-border bg-accent-subtle text-accent-text'
                        : 'border-border-strong bg-surface text-fg-muted',
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-2 text-sm font-semibold text-fg">
                      <Icon className="size-4 shrink-0 text-fg-subtle group-hover:text-accent-text" />
                      {s.title}
                      {s.done ? <span className="sr-only">{` (${doneLabel})`}</span> : null}
                    </span>
                    <span className="text-xs text-fg-muted">{s.text}</span>
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
