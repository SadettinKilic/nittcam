'use client';

import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';

/** Grabs the current frame as a PNG data URL (null when the scene is gone). */
export type CaptureFn = () => string | null;

/**
 * "Görüntü kaydet" (T160): registers a capture function for the host. The canvas keeps no drawing
 * buffer (cheaper), so the frame is rendered again right before it is read.
 */
export function Capture({
  onCapture,
}: {
  onCapture: ((fn: CaptureFn | null) => void) | undefined;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (!onCapture) return;
    onCapture(() => {
      gl.render(scene, camera);
      return gl.domElement.toDataURL('image/png');
    });
    return () => onCapture(null);
  }, [gl, scene, camera, onCapture]);
  return null;
}
