import type { LayoutThumb } from '../../lib/dashboard';

/**
 * Small drawing of a project's first sheet (T106). Pure SVG coloured with tokens, so it follows the
 * theme and costs nothing on the server. Sheet coordinates are y-up (origin front-left).
 */
export function LayoutThumbnail({ thumb, label }: { thumb: LayoutThumb; label: string }) {
  const { width, height } = thumb.sheet;
  // Thin strokes stay visible whatever the sheet size.
  const stroke = Math.max(width, height) / 300;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
    >
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        className="fill-surface stroke-border-strong"
        strokeWidth={stroke}
      />
      {thumb.parts.map((p, i) => (
        <rect
          key={i}
          x={p.x}
          y={height - p.y - p.h}
          width={p.w}
          height={p.h}
          className="fill-accent-subtle stroke-accent-border"
          strokeWidth={stroke}
        />
      ))}
    </svg>
  );
}
