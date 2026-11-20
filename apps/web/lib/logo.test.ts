import { describe, expect, it } from 'vitest';
import { LOGO_MAX_BYTES, logoKey, logoProblem, sniffLogo } from './logo';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');

describe('logo limits (T182)', () => {
  it('sniffs png, jpeg, webp from the bytes; refuses svg and others', () => {
    expect(sniffLogo(png)).toBe('png');
    expect(sniffLogo(jpeg)).toBe('jpeg');
    expect(sniffLogo(webp)).toBe('webp');
    expect(sniffLogo(svg)).toBeNull();
    expect(logoProblem(svg)).toBe('type');
  });

  it('refuses empty and too large files', () => {
    expect(logoProblem(new Uint8Array())).toBe('empty');
    const big = new Uint8Array(LOGO_MAX_BYTES + 1);
    big.set(png);
    expect(logoProblem(big)).toBe('size');
    expect(logoProblem(png)).toBeNull();
  });

  it('keys are fixed per type', () => {
    expect(logoKey('jpeg')).toBe('branding/logo.jpg');
    expect(logoKey('png')).toBe('branding/logo.png');
  });
});
