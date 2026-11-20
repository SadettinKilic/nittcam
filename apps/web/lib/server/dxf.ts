import type { DxfExportKind } from '@nittcam/core';

const TR: Readonly<Record<string, string>> = {
  ç: 'c',
  Ç: 'C',
  ğ: 'g',
  Ğ: 'G',
  ı: 'i',
  İ: 'I',
  ö: 'o',
  Ö: 'O',
  ş: 's',
  Ş: 'S',
  ü: 'u',
  Ü: 'U',
};

/** ASCII file-name stem of a project name (D-025): Turkish letters folded, others → "_". */
export function asciiStem(name: string): string {
  const folded = [...name].map((ch) => TR[ch] ?? ch).join('');
  const stem = folded
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return stem || 'proje';
}

/** `<name>_r<rev>_dizilim.dxf` or `<name>_r<rev>_parcalar.dxf`. */
export function dxfFileName(name: string, revision: number, kind: DxfExportKind): string {
  return `${asciiStem(name)}_r${revision}_${kind === 'layout' ? 'dizilim' : 'parcalar'}.dxf`;
}
