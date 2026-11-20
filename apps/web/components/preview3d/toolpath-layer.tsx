'use client';

/**
 * Toolpath overlay (T156) and the tool model of the cutting playback (T157) in the 3D scene.
 * Sheet frame (Z up), placed at the sheet top. Two draw calls: cuts (vertex colours by depth)
 * and rapids (dashed). Drawn over the stock like the 2D simulation's path (no depth test), so
 * cuts inside the material stay readable from any angle.
 */
import { useThree } from '@react-three/fiber';
import type { SimSheet } from '@nittcam/core';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, Color, type LineSegments } from 'three';
import { buildToolpath3d, drawCounts, type Rgb } from '../../lib/preview3d/toolpath';

export interface ToolpathColors {
  depthTop: string;
  depthBottom: string;
  rapid: string;
  tool: string;
}

function rgb(css: string): Rgb {
  const c = new Color(css);
  return [c.r, c.g, c.b];
}

/** Above everything else in the scene (render order), the overlay reads like the 2D path. */
const ORDER = 10;

export function ToolpathLayer({
  sim,
  top,
  time,
  colors,
  tool,
  path = true,
}: {
  sim: SimSheet;
  /** Z of the material top in the scene (the stock thickness). */
  top: number;
  /** Playback time, s; null = the whole program. */
  time: number | null;
  colors: ToolpathColors;
  /** Tool model at the playhead (T157): position (Z 0 = material top) and diameter, mm. */
  tool?: { x: number; y: number; z: number; diameter: number } | null | undefined;
  /** Draw the path lines ("Takım yolu" toggle). */
  path?: boolean;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const buf = useMemo(
    () => buildToolpath3d(sim, rgb(colors.depthTop), rgb(colors.depthBottom)),
    [sim, colors.depthTop, colors.depthBottom],
  );
  const cutGeo = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(buf.cut, 3));
    g.setAttribute('color', new BufferAttribute(buf.cutColor, 3));
    return g;
  }, [buf]);
  const rapidGeo = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(buf.rapid, 3));
    return g;
  }, [buf]);
  useEffect(
    () => () => {
      cutGeo.dispose();
      rapidGeo.dispose();
    },
    [cutGeo, rapidGeo],
  );
  const rapidLine = useRef<LineSegments>(null);
  useLayoutEffect(() => {
    rapidLine.current?.computeLineDistances();
  }, [rapidGeo]);

  const counts = drawCounts(buf, sim, time);
  useEffect(() => {
    cutGeo.setDrawRange(0, counts.cut);
    rapidGeo.setDrawRange(0, counts.rapid);
    invalidate();
  }, [cutGeo, rapidGeo, counts.cut, counts.rapid, invalidate]);

  const bit = tool ? Math.max(1, tool.diameter / 2) : 0;
  const bitLength = Math.max(top + 10, 30);
  const spindle = Math.max(bit * 3, 24);
  return (
    <group position={[0, 0, top]}>
      <lineSegments visible={path} geometry={cutGeo} renderOrder={ORDER} frustumCulled={false}>
        <lineBasicMaterial vertexColors depthTest={false} transparent />
      </lineSegments>
      <lineSegments
        visible={path}
        ref={rapidLine}
        geometry={rapidGeo}
        renderOrder={ORDER}
        frustumCulled={false}
      >
        <lineDashedMaterial
          color={colors.rapid}
          dashSize={6}
          gapSize={4}
          depthTest={false}
          transparent
          opacity={0.85}
        />
      </lineSegments>
      {tool ? (
        <group position={[tool.x, tool.y, tool.z]}>
          {/* Cylinders run along Y; turned to the sheet frame's Z (tip at the tool point). */}
          <mesh position={[0, 0, bitLength / 2]} rotation={[Math.PI / 2, 0, 0]} renderOrder={ORDER}>
            <cylinderGeometry args={[bit, bit, bitLength, 20]} />
            <meshStandardMaterial color={colors.tool} metalness={0.6} roughness={0.35} />
          </mesh>
          <mesh
            position={[0, 0, bitLength + spindle * 1.5]}
            rotation={[Math.PI / 2, 0, 0]}
            renderOrder={ORDER}
          >
            <cylinderGeometry args={[spindle, spindle, spindle * 3, 32]} />
            <meshStandardMaterial
              color={colors.tool}
              metalness={0.3}
              roughness={0.5}
              transparent
              opacity={0.55}
            />
          </mesh>
        </group>
      ) : null}
    </group>
  );
}
