import type { CSSProperties } from 'react';
import type { LayoutThumb } from '../../lib/dashboard';
import { MATERIAL_TOKEN, materialLook } from '../../lib/preview3d/textures';

/** At most this many sheets are drawn behind the first one (plate count as a stack, T180). */
export const STACK_MAX = 2;

/**
 * Drawing of a project's first sheet (T106, T180). Pure SVG coloured with tokens so it follows the
 * theme: the sheet in its material tint (waste lighter, parts full tint with an outline), and the
 * further sheets of the layout as a stack behind it. Sheet coordinates are y-up (origin front-left).
 */
export function LayoutThumbnail({ thumb, label }: { thumb: LayoutThumb; label: string }) {
  const { width, height } = thumb.sheet;
  // Thin strokes stay visible whatever the sheet size.
  const stroke = Math.max(width, height) / 300;
  const behind = Math.min(STACK_MAX, Math.max(0, thumb.sheets - 1));
  const step = Math.max(width, height) * 0.03;
  const tint: CSSProperties = { fill: `var(${MATERIAL_TOKEN[materialLook(thumb.material)]})` };
  return (
    <svg
      role="img"
      aria-label={label}
      data-stack={behind}
      viewBox={`0 ${-behind * step} ${width + behind * step} ${height + behind * step}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
    >
      {Array.from({ length: behind }, (_, i) => behind - i).map((k) => (
        <rect
          key={`stack-${k}`}
          x={k * step}
          y={-k * step}
          width={width}
          height={height}
          style={tint}
          className="stroke-sheet-edge"
          fillOpacity={0.35}
          strokeWidth={stroke * 1.5}
        />
      ))}
      <rect x={0} y={0} width={width} height={height} className="fill-sheet" />
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        style={tint}
        className="stroke-sheet-edge"
        fillOpacity={0.45}
        strokeWidth={stroke * 1.5}
      />
      {thumb.parts.map((p, i) =>
        p.outline ? (
          <polygon
            key={i}
            points={outlinePoints(p.outline, p.x, height - p.y - p.h)}
            style={tint}
            className="stroke-part-stroke"
            strokeWidth={stroke}
          />
        ) : (
          <rect
            key={i}
            x={p.x}
            y={height - p.y - p.h}
            width={p.w}
            height={p.h}
            style={tint}
            className="stroke-part-stroke"
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
