import { writeFile } from 'node:fs/promises';

// Sparse, almost-black squares on a 30 px grid. The hash keeps the pattern deterministic so renders stay reproducible.
let texture = '';
for (let row = 0; row < 36; row++) {
  for (let col = 0; col < 64; col++) {
    const hash = ((col * 1619 + row * 31337 + 8388) ^ (col * row * 173)) >>> 0;
    if (hash % 11 < 3) {
      const tint = ['#05120d', '#101105', '#061315'][hash % 3];
      texture += `<rect x="${col * 30}" y="${row * 30}" width="28" height="28" fill="${tint}" opacity="${0.2 + (hash % 6) * 0.055}"/>`;
    }
  }
}
await writeFile(new URL('../themes/dark/texture.svg', import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080">${texture}</svg>\n`);
