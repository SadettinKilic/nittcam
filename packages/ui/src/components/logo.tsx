import type { SVGProps } from 'react';
import { BRAND_MARK } from '../brand';
import { cn } from '../lib/cn';

export { BRAND_MARK };

export type LogoSize = 20 | 24 | 32;

export interface LogoMarkProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: LogoSize | number;
  /**
   * `tile`: cobalt tile with the toolpath in accent-fg (default, the app icon look).
   * `plain`: toolpath only in `currentColor`, tool dot in the accent (on any surface).
   * `mono`: everything in `currentColor` (on accent or photo backgrounds, print).
   */
  variant?: 'tile' | 'plain' | 'mono';
  /** Accessible name; without it the mark is decorative (aria-hidden). */
  title?: string;
}

/** The "toolpath N" mark as inline SVG. Colours come from tokens only (no hex). */
export function LogoMark({
  size = 24,
  variant = 'tile',
  title,
  className,
  ...rest
}: LogoMarkProps) {
  const m = BRAND_MARK;
  const tile = variant === 'tile';
  const lineClass = tile ? 'stroke-accent-fg' : 'stroke-current';
  const dotClass = tile
    ? 'fill-accent-fg'
    : variant === 'plain'
      ? 'fill-accent-text'
      : 'fill-current';
  return (
    <svg
      viewBox={`0 0 ${m.viewBox} ${m.viewBox}`}
      width={size}
      height={size}
      fill="none"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      data-variant={variant}
      className={cn('shrink-0', className)}
      {...rest}
    >
      {tile ? (
        <rect width={m.viewBox} height={m.viewBox} rx={m.tileRadius} className="fill-accent" />
      ) : null}
      <path
        d={m.leadIn}
        strokeWidth={m.stroke}
        strokeLinecap="round"
        opacity={m.leadInOpacity}
        className={lineClass}
      />
      <path
        d={m.path}
        strokeWidth={m.stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={lineClass}
      />
      <circle cx={m.dot.cx} cy={m.dot.cy} r={m.dot.r} className={dotClass} />
    </svg>
  );
}

const WORD_SIZE: Record<LogoSize, string> = {
  20: 'text-sm',
  24: 'text-base',
  32: 'text-xl',
};

export interface LogoProps {
  /** Mark height in px (20 / 24 / 32); the wordmark scales with it. */
  size?: LogoSize;
  /** `full` = mark + wordmark, `mark` = mark only (collapsed sidebar, favicon-like spots). */
  variant?: 'full' | 'mark';
  /** Mark style, see `LogoMark`. `mono` also draws the wordmark in one colour. */
  tone?: 'tile' | 'plain' | 'mono';
  /** Brand name parts; text comes from the caller (default "Nitt" + "Cam"). */
  name?: readonly [string, string];
  className?: string;
}

/**
 * Mark + "NittCam" wordmark (Inter 600, tight tracking, "Cam" in `accent-text`).
 * Decorative by default: put the accessible name on the surrounding link.
 */
export function Logo({
  size = 24,
  variant = 'full',
  tone = 'tile',
  name = ['Nitt', 'Cam'],
  className,
}: LogoProps) {
  return (
    <span
      data-testid="brand-logo"
      className={cn('inline-flex items-center gap-2 select-none', className)}
    >
      <LogoMark size={size} variant={tone} />
      {variant === 'full' ? (
        <span
          aria-hidden="true"
          className={cn(
            'leading-none font-semibold tracking-[-0.03em] whitespace-nowrap',
            WORD_SIZE[size],
            tone === 'mono' ? 'text-current' : 'text-fg',
          )}
        >
          {name[0]}
          <span className={tone === 'mono' ? undefined : 'text-accent-text'}>{name[1]}</span>
        </span>
      ) : null}
    </span>
  );
}

const WORDMARK_SIZE: Record<LogoSize, string> = {
  20: 'text-base',
  24: 'text-lg',
  32: 'text-2xl',
};

export interface WordmarkProps {
  /** Cap height class step: 20 / 24 / 32 match the old mark sizes. */
  size?: LogoSize;
  /** `full` = "NittCAM", `short` = "NC" (collapsed rail, very narrow top bar). */
  variant?: 'full' | 'short';
  /** `brand`: "CAM" in `accent-text`; `mono`: one colour (`currentColor`). */
  tone?: 'brand' | 'mono';
  /** Text parts from the caller (default "Nitt" + "CAM"). */
  name?: readonly [string, string];
  className?: string;
}

/**
 * Text logo (T194b): "NittCAM" in the brand font (Inter 800), tight tracking and a subtle
 * italic skew, "CAM" in `accent-text`. Decorative: the accessible name sits on the link.
 */
export function Wordmark({
  size = 24,
  variant = 'full',
  tone = 'brand',
  name = ['Nitt', 'CAM'],
  className,
}: WordmarkProps) {
  const [a, b] = variant === 'short' ? [name[0].charAt(0), name[1].charAt(0)] : name;
  return (
    <span
      aria-hidden="true"
      data-testid="brand-wordmark"
      data-variant={variant}
      className={cn(
        'inline-block -skew-x-8 px-0.5 leading-none font-extrabold tracking-[-0.04em] whitespace-nowrap select-none',
        WORDMARK_SIZE[size],
        tone === 'mono' ? 'text-current' : 'text-fg',
        className,
      )}
    >
      {a}
      <span className={tone === 'mono' ? undefined : 'text-accent-text'}>{b}</span>
    </span>
  );
}
