/**
 * "Görüntü kaydet" (T160): the 3D canvas is transparent (the panel gradient shows through), so the
 * frame is laid over the canvas colour of the current theme before it is downloaded as a PNG.
 */

/** Background colour of a saved image: the theme's canvas token, white without one. */
export function pngBackground(style: Pick<CSSStyleDeclaration, 'getPropertyValue'>): string {
  return style.getPropertyValue('--color-canvas').trim() || '#ffffff';
}

/** Draws `dataUrl` over the theme background and downloads it as `name`. */
export async function exportPng(dataUrl: string, name: string): Promise<void> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  let href = dataUrl;
  if (ctx) {
    ctx.fillStyle = pngBackground(getComputedStyle(document.documentElement));
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    href = canvas.toDataURL('image/png');
  }
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
}
