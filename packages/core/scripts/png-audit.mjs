/* Blind visual audit: decodes PNG screenshots in pure Node (zlib) and renders
 * an ASCII luminance map + sampled colors + stats, so the agent can "see"
 * layout/theme structure without image input. Run:
 *   node scripts/png-audit.mjs <file1.png> [file2.png ...]
 */
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";

function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (pos < buffer.length) {
    const len = buffer.readUInt32BE(pos);
    const type = buffer.toString("ascii", pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  const channels =
    colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (bitDepth !== 8 || channels === 0) {
    throw new Error(`unsupported PNG: bitDepth=${bitDepth} colorType=${colorType}`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * channels);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const rowStart = y * (stride + 1) + 1;
    const outStart = y * stride;
    const prevStart = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[outStart + x - channels] : 0;
      const b = y > 0 ? out[prevStart + x] : 0;
      const c = x >= channels && y > 0 ? out[prevStart + x - channels] : 0;
      const rawByte = raw[rowStart + x];
      let v = rawByte;
      if (filter === 1) v = (rawByte + a) & 0xff;
      else if (filter === 2) v = (rawByte + b) & 0xff;
      else if (filter === 3) v = (rawByte + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) v = (rawByte + paeth(a, b, c)) & 0xff;
      out[outStart + x] = v;
    }
  }
  return { width, height, channels, data: out };
}

const pixel = (png, x, y) => {
  const i = (y * png.width + x) * png.channels;
  const r = png.data[i];
  const g = png.data[i + 1];
  const b = png.data[i + 2];
  const a = png.channels === 4 ? png.data[i + 3] : 255;
  return { r, g, b, a };
};

const luminance = ({ r, g, b }) =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

const ramp = " .:-=+*#%@";

const renderAscii = (png, cols, rows) => {
  let out = "";
  for (let gy = 0; gy < rows; gy++) {
    let row = "";
    for (let gx = 0; gx < cols; gx++) {
      const x = Math.min(png.width - 1, Math.floor(((gx + 0.5) / cols) * png.width));
      const y = Math.min(png.height - 1, Math.floor(((gy + 0.5) / rows) * png.height));
      const lum = luminance(pixel(png, x, y));
      row += ramp[Math.min(ramp.length - 1, Math.floor((lum / 256) * ramp.length))];
    }
    out += row + "\n";
  }
  return out;
};

const topColors = (png, sample = 8000) => {
  const counts = new Map();
  const step = Math.max(1, Math.floor((png.width * png.height) / sample));
  for (let i = 0; i < png.width * png.height; i += step) {
    const x = i % png.width;
    const y = Math.floor(i / png.width);
    const { r, g, b } = pixel(png, x, y);
    const key = `${r >> 4},${g >> 4},${b >> 4}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([key, count]) => {
      const [r, g, b] = key.split(",").map((v) => Number(v) * 16 + 8);
      return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}(${count})`;
    });
};

const files = process.argv.slice(2);
for (const file of files) {
  const buffer = await readFile(file);
  const png = decodePng(buffer);
  const cols = 64;
  const rows = Math.max(12, Math.round((png.height / png.width) * cols * 0.6));
  console.log(`\n===== ${file} (${png.width}x${png.height}) =====`);
  console.log(renderAscii(png, cols, rows));
  console.log("top colors:", topColors(png).join(" "));
  const midX = Math.floor(png.width * 0.5);
  const top = pixel(png, midX, Math.floor(png.height * 0.08));
  const mid = pixel(png, midX, Math.floor(png.height * 0.5));
  const nav = pixel(png, Math.floor(png.width * 0.02), Math.floor(png.height * 0.4));
  const fmt = ({ r, g, b }) => `rgb(${r},${g},${b})`;
  console.log(
    `samples: top=${fmt(top)} mid=${fmt(mid)} leftNav=${fmt(nav)}`
  );
}
