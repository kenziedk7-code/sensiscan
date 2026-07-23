// Generate PWA icons: indigo (#4f46e5) background with a white "S" letter
import { deflateSync } from "node:zlib";

const INDIGO = { r: 0x4f, g: 0x46, b: 0xe5, a: 0xff };
const WHITE = { r: 0xff, g: 0xff, b: 0xff, a: 0xff };

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crcVal = crc32(typeData);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal, 0);
  return Buffer.concat([len, typeData, crcBuf]);
}

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function makeIHDR(width: number, height: number): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8; // bit depth
  data[9] = 6; // color type: RGBA
  data[10] = 0; // compression
  data[11] = 0; // filter
  data[12] = 0; // interlace
  return pngChunk("IHDR", data);
}

function makeIEND(): Buffer {
  return pngChunk("IEND", Buffer.alloc(0));
}

function drawLetterS(
  pixels: Uint8Array,
  size: number,
  bg: typeof INDIGO,
  fg: typeof WHITE
) {
  // Draw a stylized "S" using simple geometry
  const cx = size / 2;
  const cy = size / 2;
  const scale = size * 0.28; // how big the S is
  const thick = size * 0.09; // stroke thickness

  // S shape: top curve, diagonal, bottom curve
  // We'll use a simplified S path
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      // Normalized coordinates relative to center, scaled
      const nx = (x - cx) / scale;
      const ny = (y - cy) / scale;

      // S shape function: check if point is near the S path
      const inS = isInSShape(nx, ny, thick / scale);
      
      if (inS) {
        pixels[idx] = fg.r;
        pixels[idx + 1] = fg.g;
        pixels[idx + 2] = fg.b;
        pixels[idx + 3] = fg.a;
      } else {
        pixels[idx] = bg.r;
        pixels[idx + 1] = bg.g;
        pixels[idx + 2] = bg.b;
        pixels[idx + 3] = bg.a;
      }
    }
  }
}

function isInSShape(x: number, y: number, halfThick: number): boolean {
  // A simplified "S" shape using bezier-like path distance
  // S goes from top-right-ish down to bottom-left-ish
  
  // The S midline: a cubic curve that goes:
  // Start: (0.35, -0.7) — top right
  // End: (-0.35, 0.7) — bottom left
  
  // We'll approximate by checking distance to the S path at several sample points
  const samples = 80;
  let minDist = Infinity;
  
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    // Cubic bezier control points for S shape
    const px = cubicBez(0.38, 0.55, -0.55, -0.38, t);
    const py = cubicBez(-0.7, -0.2, 0.2, 0.7, t);
    const dx = x - px;
    const dy = y - py;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < minDist) minDist = dist;
  }
  
  return minDist <= halfThick;
}

function cubicBez(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function makeIDAT(pixels: Uint8Array, width: number, height: number): Buffer {
  // Raw image data: filter byte (0 = None) before each row
  const rawSize = height * (1 + width * 4);
  const raw = Buffer.alloc(rawSize);
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: None
    const srcStart = y * width * 4;
    const dstStart = y * (1 + width * 4) + 1;
    for (let i = 0; i < width * 4; i++) {
      raw[dstStart + i] = pixels[srcStart + i];
    }
  }
  const compressed = deflateSync(raw, { level: 9 });
  return pngChunk("IDAT", compressed);
}

function generatePng(size: number): Buffer {
  const pixels = new Uint8Array(size * size * 4);
  drawLetterS(pixels, size, INDIGO, WHITE);
  
  return Buffer.concat([
    PNG_SIG,
    makeIHDR(size, size),
    makeIDAT(pixels, size, size),
    makeIEND(),
  ]);
}

// Generate both icon sizes
import { writeFileSync, mkdirSync } from "node:fs";

mkdirSync("public/icons", { recursive: true });

console.log("Generating 192x192 icon...");
const icon192 = generatePng(192);
writeFileSync("public/icons/icon-192.png", icon192);
console.log(`  Wrote ${icon192.length} bytes`);

console.log("Generating 512x512 icon...");
const icon512 = generatePng(512);
writeFileSync("public/icons/icon-512.png", icon512);
console.log(`  Wrote ${icon512.length} bytes`);

console.log("Done!");
