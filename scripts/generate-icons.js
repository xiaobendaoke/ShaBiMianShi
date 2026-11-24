import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodeRgbaPng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: None
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

// 5x7 crisp bitmap font for "S" and "B"
const GLYPH_S = [
  0b01111,
  0b10000,
  0b10000,
  0b01110,
  0b00001,
  0b00001,
  0b11110
];
const GLYPH_B = [
  0b11110,
  0b10001,
  0b10001,
  0b11110,
  0b10001,
  0b10001,
  0b11110
];

function sampleGlyph(glyph, gx, gy) {
  if (gx < 0 || gx >= 5 || gy < 0 || gy >= 7) return false;
  const row = glyph[Math.floor(gy)];
  return ((row >> (4 - Math.floor(gx))) & 1) === 1;
}

function renderBrandIconRgba(size) {
  const buf = Buffer.alloc(size * size * 4);
  const pad = size * 0.06;
  const radius = size * 0.22;
  const minBound = pad;
  const maxBound = size - pad;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;

      // Signed distance to rounded rect for anti-aliased edge
      const qx = Math.max(minBound + radius - cx, 0, cx - (maxBound - radius));
      const qy = Math.max(minBound + radius - cy, 0, cy - (maxBound - radius));
      const dist = Math.hypot(qx, qy) - radius;
      if (cx < minBound || cx > maxBound || cy < minBound || cy > maxBound) {
        if (dist > 0.8) continue;
      }
      const edgeAlpha = Math.max(0, Math.min(1, 0.5 - dist));
      if (edgeAlpha <= 0) continue;

      // Diagonal gradient matching Sidebar brand badge: #0894ff -> #c959dd -> #ff9004
      const t = Math.max(0, Math.min(1, ((cx - minBound) + (cy - minBound)) / (2 * (maxBound - minBound))));
      let r, g, b;
      if (t < 0.5) {
        const k = t * 2;
        r = 8 + (201 - 8) * k;
        g = 148 + (89 - 148) * k;
        b = 255 + (221 - 255) * k;
      } else {
        const k = (t - 0.5) * 2;
        r = 201 + (255 - 201) * k;
        g = 89 + (144 - 89) * k;
        b = 221 + (4 - 221) * k;
      }

      // Subtle top inner highlight
      const highlight = Math.max(0, 1 - (cy - minBound) / ((maxBound - minBound) * 0.35)) * 0.16;
      r = r + (255 - r) * highlight;
      g = g + (255 - g) * highlight;
      b = b + (255 - b) * highlight;

      // Draw crisp centered "SB" glyph
      const nx = (cx - size * 0.5) / (size * 0.56) + 0.5; // 0..1 across text box (11 cols wide: 5 + 1 + 5)
      const ny = (cy - size * 0.5) / (size * 0.38) + 0.5; // 0..1 across text box (7 rows tall)
      let inText = false;
      if (nx >= 0 && nx < 1 && ny >= 0 && ny < 1) {
        const col = nx * 11;
        const row = ny * 7;
        if (col < 5) inText = sampleGlyph(GLYPH_S, col, row);
        else if (col >= 6) inText = sampleGlyph(GLYPH_B, col - 6, row);
      }

      if (inText) {
        r = 255;
        g = 255;
        b = 255;
      }

      const idx = (y * size + x) * 4;
      buf[idx] = Math.round(r);
      buf[idx + 1] = Math.round(g);
      buf[idx + 2] = Math.round(b);
      buf[idx + 3] = Math.round(edgeAlpha * 255);
    }
  }
  return buf;
}

function buildIco(pngEntries) {
  const count = pngEntries.length;
  const header = Buffer.alloc(6 + count * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // ICO type
  header.writeUInt16LE(count, 4);

  let dataOffset = header.length;
  const payloads = [header];

  pngEntries.forEach(({ size, png }, idx) => {
    const entryOffset = 6 + idx * 16;
    header[entryOffset] = size >= 256 ? 0 : size;
    header[entryOffset + 1] = size >= 256 ? 0 : size;
    header[entryOffset + 2] = 0;
    header[entryOffset + 3] = 0;
    header.writeUInt16LE(1, entryOffset + 4); // color planes
    header.writeUInt16LE(32, entryOffset + 6); // bits per pixel
    header.writeUInt32LE(png.length, entryOffset + 8);
    header.writeUInt32LE(dataOffset, entryOffset + 12);
    dataOffset += png.length;
    payloads.push(png);
  });

  return Buffer.concat(payloads);
}

export function ensureIcons({ force = false } = {}) {
  const resourcesDir = path.join(root, 'resources');
  fs.mkdirSync(resourcesDir, { recursive: true });
  const pngPath = path.join(resourcesDir, 'icon.png');
  const icoPath = path.join(resourcesDir, 'icon.ico');

  if (!force && fs.existsSync(pngPath) && fs.existsSync(icoPath) && fs.statSync(icoPath).size > 100) {
    return { pngPath, icoPath };
  }

  const sizes = [16, 32, 48, 64, 128, 256];
  const rendered = sizes.map(size => ({
    size,
    png: encodeRgbaPng(size, size, renderBrandIconRgba(size))
  }));

  const png512 = encodeRgbaPng(512, 512, renderBrandIconRgba(512));
  fs.writeFileSync(pngPath, png512);
  fs.writeFileSync(icoPath, buildIco(rendered));
  return { pngPath, icoPath };
}

export function generateMacIcns(outputIcnsPath) {
  if (process.platform !== 'darwin') return false;
  const { pngPath } = ensureIcons();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'interviewdog-iconset-'));
  const iconsetDir = path.join(tempRoot, 'AppIcon.iconset');
  fs.mkdirSync(iconsetDir, { recursive: true });
  try {
    const specs = [
      [16, 'icon_16x16.png'],
      [32, 'icon_16x16@2x.png'],
      [32, 'icon_32x32.png'],
      [64, 'icon_32x32@2x.png'],
      [128, 'icon_128x128.png'],
      [256, 'icon_128x128@2x.png'],
      [256, 'icon_256x256.png'],
      [512, 'icon_256x256@2x.png'],
      [512, 'icon_512x512.png']
    ];
    for (const [sz, name] of specs) {
      execFileSync('sips', ['-z', String(sz), String(sz), pngPath, '--out', path.join(iconsetDir, name)], { stdio: 'ignore' });
    }
    fs.copyFileSync(pngPath, path.join(iconsetDir, 'icon_512x512@2x.png'));
    fs.mkdirSync(path.dirname(outputIcnsPath), { recursive: true });
    execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', outputIcnsPath], { stdio: 'ignore' });
    return fs.existsSync(outputIcnsPath);
  } catch {
    return false;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const force = process.argv.includes('--force');
  const { pngPath, icoPath } = ensureIcons({ force });
  console.log('Application icons ready:', pngPath, icoPath);
}
