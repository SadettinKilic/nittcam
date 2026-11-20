import type { DxfExportKind } from '@nittcam/core';
import { exportFileName } from '../file-names';

/** `<name>_r<rev>_dizilim.dxf` or `<name>_r<rev>_parcalar.dxf` (T175, T295). */
export function dxfFileName(name: string, revision: number, kind: DxfExportKind): string {
  return exportFileName(name, revision, kind === 'layout' ? 'dizilim' : 'parcalar', 'dxf');
}
