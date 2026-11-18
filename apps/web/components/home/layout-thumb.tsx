import type { LayoutThumb } from '../../lib/dashboard';

/**
 * Small drawing of a project's first sheet (T106). Pure SVG coloured with the canvas tokens (tinted
 * sheet with a clear edge, parts in the accent tint with an outline), so it follows the theme. Sheet coordinates are y-up (origin front-left).
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
        className="fill-sheet stroke-sheet-edge"
        strokeWidth={stroke * 1.5}
      />
      {thumb.parts.map((p, i) =>
        p.outline ? (
          <polygon
            key={i}
            points={outlinePoints(p.outline, p.x, height - p.y - p.h)}
            className="fill-part stroke-part-stroke"
            strokeWidth={stroke}
          />
        ) : (
          <rect
            key={i}
            x={p.x}
            y={height - p.y - p.h}
            width={p.w}
            height={p.h}
            className="fill-part stroke-part-stroke"
            strokeWidth={stroke}
          />
        ),
      )}
    </svg>
  );
}

/** SVG points of an outline given relative to the footprint's top-left (Y down). */
function outlinePoints(flat: readonly number[], x: number, top: number): string {
  const out: string[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    out.push(`${(flat[i] ?? 0) + x},${(flat[i + 1] ?? 0) + top}`);
  }
  return out.join(' ');
}
