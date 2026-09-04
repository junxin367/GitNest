import { deflateSync } from "node:zlib";
import {
  mkdir,
  writeFile
} from "node:fs/promises";
import {
  dirname,
  join,
  resolve
} from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const outputPath = join(
  projectRoot,
  "apps",
  "desktop",
  "build",
  "icon.png"
);
const width = 512;
const height = 512;
const pixels = Buffer.alloc((width * 4 + 1) * height);
const layers = [
  [
    [256, 142],
    [372, 206],
    [256, 270],
    [140, 206],
    [256, 142]
  ],
  [
    [140, 260],
    [256, 324],
    [372, 260]
  ],
  [
    [140, 316],
    [256, 380],
    [372, 316]
  ]
];

for (let y = 0; y < height; y += 1) {
  const rowOffset = y * (width * 4 + 1);
  pixels[rowOffset] = 0;
  for (let x = 0; x < width; x += 1) {
    const offset = rowOffset + 1 + x * 4;
    const outer = roundedRectangleCoverage(
      x,
      y,
      18,
      18,
      494,
      494,
      104
    );
    if (outer === 0) {
      continue;
    }
    const inner = roundedRectangleCoverage(
      x,
      y,
      74,
      74,
      438,
      438,
      92
    );
    let red = 8;
    let green = 15;
    let blue = 22;
    if (inner > 0) {
      const vertical = (y - 74) / 364;
      red = Math.round(64 - vertical * 12);
      green = Math.round(216 - vertical * 24);
      blue = Math.round(200 - vertical * 20);
    }
    const onLayer = layers.some((points) =>
      points.some((point, index) => {
        const next = points[index + 1];
        return next
          ? distanceToSegment(
              x,
              y,
              point[0],
              point[1],
              next[0],
              next[1]
            ) <= 9
          : false;
      })
    );
    if (inner > 0 && onLayer) {
      red = 7;
      green = 42;
      blue = 40;
    }
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = Math.round(outer * 255);
  }
}

const png = Buffer.concat([
  Buffer.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a
  ]),
  pngChunk(
    "IHDR",
    Buffer.concat([
      uint32(width),
      uint32(height),
      Buffer.from([8, 6, 0, 0, 0])
    ])
  ),
  pngChunk("IDAT", deflateSync(pixels, { level: 9 })),
  pngChunk("IEND", Buffer.alloc(0))
]);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, png);
console.log(outputPath);

function roundedRectangleCoverage(
  x,
  y,
  left,
  top,
  right,
  bottom,
  radius
) {
  let inside = 0;
  for (const offsetY of [0.25, 0.75]) {
    for (const offsetX of [0.25, 0.75]) {
      if (
        insideRoundedRectangle(
          x + offsetX,
          y + offsetY,
          left,
          top,
          right,
          bottom,
          radius
        )
      ) {
        inside += 1;
      }
    }
  }
  return inside / 4;
}

function insideRoundedRectangle(
  x,
  y,
  left,
  top,
  right,
  bottom,
  radius
) {
  const nearestX = Math.max(
    left + radius,
    Math.min(x, right - radius)
  );
  const nearestY = Math.max(
    top + radius,
    Math.min(y, bottom - radius)
  );
  const deltaX = x - nearestX;
  const deltaY = y - nearestY;
  return (
    x >= left &&
    x <= right &&
    y >= top &&
    y <= bottom &&
    deltaX * deltaX + deltaY * deltaY <= radius * radius
  );
}

function distanceToSegment(
  x,
  y,
  startX,
  startY,
  endX,
  endY
) {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const projection =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((x - startX) * deltaX +
              (y - startY) * deltaY) /
              lengthSquared
          )
        );
  const projectedX = startX + projection * deltaX;
  const projectedY = startY + projection * deltaY;
  return Math.hypot(x - projectedX, y - projectedY);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const payload = Buffer.concat([typeBuffer, data]);
  return Buffer.concat([
    uint32(data.length),
    payload,
    uint32(crc32(payload))
  ]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc =
        (crc >>> 1) ^
        (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
