import type { DxfExportKind } from '@nittcam/core';
import { documentFileName } from './file-names';

/** `<name>-r<rev>-dizilim.dxf` or `<name>-r<rev>-parcalar.dxf` (T175). */
export function dxfFileName(name: string, revision: number, kind: DxfExportKind): string {
  return documentFileName(name, revision, kind === 'layout' ? 'dizilim' : 'parcalar', 'dxf');
}
