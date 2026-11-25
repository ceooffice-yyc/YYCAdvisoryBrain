// Builds the icon files from public/favicon.svg:  npm run icons
//   favicon-32.png, favicon.ico (16+32+48), apple-touch-icon.png (180), icon-192.png, icon-512.png, icon-maskable-512.png
// It uses the Chrome that is already installed (no download), like the browser tests do.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const svg = fs.readFileSync('public/favicon.svg', 'utf8');
// the "maskable" icon fills the whole square (the phone cuts its own shape) and keeps the drawing inside the middle 80%
const maskable = svg.replace('<rect width="64" height="64" rx="15" fill="url(#bg)"/>', '<rect width="64" height="64" fill="url(#bg)"/>').replace('<g transform="translate(0 5)">', '<g transform="translate(6.4 11.4) scale(0.8)">');
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
const png = async (markup, size) => {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`);
  return page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
};
const out = {
  'public/favicon-32.png': await png(svg, 32),
  'public/apple-touch-icon.png': await png(maskable.replace(/rx="15"/, ''), 180), // iOS rounds the corners itself, so it gets the full square
  'public/icon-192.png': await png(svg, 192),
  'public/icon-512.png': await png(svg, 512),
  'public/icon-maskable-512.png': await png(maskable, 512),
};
for (const [file, buf] of Object.entries(out)) { fs.writeFileSync(file, buf); console.log(file, buf.length, 'bytes'); }

// favicon.ico: a small container that holds PNG pictures (16, 32, 48)
const sizes = [16, 32, 48];
const pics = [];
for (const s of sizes) pics.push(await png(svg, s));
const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const dir = Buffer.concat(sizes.map((s, i) => { const e = Buffer.alloc(16); e[0] = s; e[1] = s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(pics[i].length, 8); e.writeUInt32LE(offset, 12); offset += pics[i].length; return e; }));
fs.writeFileSync('public/favicon.ico', Buffer.concat([head, dir, ...pics]));
console.log('public/favicon.ico', 6 + dir.length + pics.reduce((n, p) => n + p.length, 0), 'bytes');
await browser.close();
