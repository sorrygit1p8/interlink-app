import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// The native ChainMark and web Brand use this same geometry. Raster files are
// generated only for platform launch/icon assets; UI marks remain vector.
const assetDirectory = new URL('../apps/mobile/assets/', import.meta.url);
const mark = await readFile(new URL('brand-mark.svg', assetDirectory), 'utf8');
const inner = mark.replace(/<svg[^>]*>/, '').replace('</svg>', '');
const canvas = (size, markWidth, opaque) => {
  const scale = markWidth / 56;
  const x = (size - markWidth) / 2;
  const y = (size - 36 * scale) / 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${opaque ? `<rect width="${size}" height="${size}" fill="#070807"/>` : ''}<g transform="translate(${x} ${y}) scale(${scale})">${inner}</g></svg>`);
};
for (const [name, size, markWidth, opaque] of [
  ['icon.png', 1024, 650, true],
  ['adaptive-icon.png', 1024, 560, false],
  ['splash.png', 512, 440, false],
]) {
  const output = new URL(name, assetDirectory);
  await sharp(canvas(size, markWidth, opaque)).png().toFile(fileURLToPath(output));
  console.log(`Generated ${name}: ${size}×${size}`);
}
await writeFile(new URL('../apps/web/app/icon.svg', import.meta.url), canvas(128, 88, true));
console.log('Generated web favicon from the same mark.');
