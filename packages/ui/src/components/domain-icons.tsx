import { forwardRef, type ReactNode, type SVGProps } from 'react';
import { cn } from '../lib/cn';

/**
 * Domain icons (T194a, review #1 finding 8): CNC words lucide does not have.
 * Same contract as lucide-react: 24 px grid, `currentColor` stroke, round caps and joins,
 * `size` / `strokeWidth` / `absoluteStrokeWidth` props, so they mix with lucide icons in
 * nav rows, buttons and lists. Default stroke 1.5 px (lucide uses 2; ours are denser).
 */
export interface DomainIconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  size?: number | string;
  strokeWidth?: number;
  absoluteStrokeWidth?: boolean;
}

export type DomainIcon = ReturnType<typeof domainIcon>;

function domainIcon(name: string, body: ReactNode) {
  const Icon = forwardRef<SVGSVGElement, DomainIconProps>(function Icon(
    { size = 24, strokeWidth = 1.5, absoluteStrokeWidth, className, children, ...rest },
    ref,
  ) {
    const width = absoluteStrokeWidth ? (strokeWidth * 24) / Number(size) : strokeWidth;
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden={rest['aria-label'] ? undefined : true}
        data-icon={name}
        className={cn('nc-icon', className)}
        {...rest}
      >
        {body}
        {children}
      </svg>
    );
  });
  Icon.displayName = name;
  return Icon;
}

/** CNC router: gantry rail, spindle, collet, bit over the table. Replaces the chip icon. */
export const RouterIcon = domainIcon(
  'RouterIcon',
  <>
    <path d="M3 4h18" />
    <rect x="9" y="4" width="6" height="8" rx="1" />
    <path d="M10 12h4l-1 3h-2z" />
    <path d="M12 15v3" />
    <path d="M3 21h18" />
  </>,
);

/** Plaka: a board with its thickness edge. */
export const SheetIcon = domainIcon(
  'SheetIcon',
  <>
    <rect x="3" y="4" width="15" height="13" rx="1" />
    <path d="M18 7h2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-3" />
  </>,
);

/** Damar: a board with wood grain lines. */
export const GrainIcon = domainIcon(
  'GrainIcon',
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M7 8c2-1.2 3.5 1.2 5.5 0S16 7 17 8" />
    <path d="M7 12c2-1.2 3.5 1.2 5.5 0S16 11 17 12" />
    <path d="M7 16c2-1.2 3.5 1.2 5.5 0S16 15 17 16" />
  </>,
);

/** Dizilim: parts nested on a sheet. */
export const NestingIcon = domainIcon(
  'NestingIcon',
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <rect x="6" y="6" width="5" height="7" rx="0.5" />
    <rect x="13" y="6" width="5" height="4" rx="0.5" />
    <rect x="13" y="12" width="5" height="6" rx="0.5" />
    <rect x="6" y="15" width="5" height="3" rx="0.5" />
  </>,
);

/** Takım yolu: lead-in, a rectangular contour and the tool at its end. */
export const ToolpathIcon = domainIcon(
  'ToolpathIcon',
  <>
    <path d="M3 21a3 3 0 0 1 3-3" />
    <path d="M6 18V6h12v12h-7" />
    <circle cx="9" cy="18" r="1.5" fill="currentColor" stroke="none" />
  </>,
);

/** Air cut: the tool runs the program above the board (dashed path, clear gap). */
export const AirCutIcon = domainIcon(
  'AirCutIcon',
  <>
    <path d="M12 3v4" />
    <path d="M10 7h4l-1 3h-2z" />
    <path d="M4 14h16" strokeDasharray="2 2.5" />
    <path d="M3 20h18" />
  </>,
);

export const DOMAIN_ICONS = {
  router: RouterIcon,
  sheet: SheetIcon,
  grain: GrainIcon,
  nesting: NestingIcon,
  toolpath: ToolpathIcon,
  airCut: AirCutIcon,
} as const;
