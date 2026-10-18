import { createHash, randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

function crc32(value) {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBytes.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, 8 + data.length)), 8 + data.length);
  return result;
}

function image(width, height, exactBytes, pixel) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1); pixels[row] = 0;
    for (let x = 0; x < width; x++) pixel(pixels, row + 1 + x * 4, x, y);
  }
  const baseChunks = [chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))];
  const baseLength = signature.length + baseChunks.reduce((sum, value) => sum + value.length, 0);
  const metadataHeader = Buffer.from('Description\0', 'ascii');
  const textLength = exactBytes - baseLength - 12 - metadataHeader.length;
  if (textLength < 0) throw new Error(`Image content exceeds target size (${baseLength} > ${exactBytes}).`);
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const random = randomBytes(textLength);
  const text = Buffer.allocUnsafe(textLength);
  for (let index = 0; index < textLength; index++) text[index] = alphabet.charCodeAt(random[index] & 31);
  const metadata = chunk('tEXt', Buffer.concat([metadataHeader, text]));
  const result = Buffer.concat([signature, baseChunks[0], baseChunks[1], metadata, baseChunks[2]]);
  if (result.length !== exactBytes) throw new Error('Generated PNG does not match its target byte count.');
  return result;
}

const logo = image(320, 200, 500_000, (pixels, index, x, y) => {
  const wave = Math.sin(x / 23) * 18 + Math.cos(y / 31) * 16;
  const noise = (x * 17 + y * 29 + (x * y) % 31) % 17;
  pixels[index] = Math.max(0, Math.min(255, 24 + x * 0.11 + wave + noise));
  pixels[index + 1] = Math.max(0, Math.min(255, 68 + y * 0.17 + wave / 2 + noise));
  pixels[index + 2] = Math.max(0, Math.min(255, 112 + (x + y) * 0.08 + noise));
  pixels[index + 3] = 255;
});
const qr = image(120, 120, 12_000, (pixels, index, x, y) => {
  const module = (x >> 2) + ((y >> 2) * 45);
  const marker = (x < 28 && y < 28) || (x >= 92 && y < 28) || (x < 28 && y >= 92);
  const dark = marker ? ((x >> 2) % 7 < 2 || (y >> 2) % 7 < 2) : ((module * 1103515245 + 12345) >>> 29) % 2 === 0;
  const value = dark ? 18 : 250;
  pixels[index] = value; pixels[index + 1] = value; pixels[index + 2] = value; pixels[index + 3] = 255;
});

const pngUrl = bytes => `data:image/png;base64,${bytes.toString('base64')}`;
const legacyPayload = {
  configuration: {
    business: {
      id: 'a773ae90-9727-4976-8b5c-b9a574ceca93', name: 'Mazao Production-Shaped Performance Fixture', currency: 'KES', timeZone: 'Africa/Nairobi', version: 17,
      legalName: 'Performance Fixture Hospitality Limited', registrationNumber: 'PERF-2026-001', taxRegistrationNumber: 'P051234567X',
      address: 'Westlands, Nairobi, Kenya', phone: '+254700000001', email: 'accounts@mazao-perf.invalid', website: 'https://mazao-perf.invalid',
      logoUrl: pngUrl(logo), receiptQrImage: pngUrl(qr), showQrOnReceipt: true,
      receiptHeader: 'Thank you for your business', receiptFooter: 'Performance fixture',
      taxPolicy: { calculation: 'exclusive', defaultRateBps: 0, label: 'VAT', reviewed: true },
    },
    outlet: { id: 'e8df4d95-a47d-4fc2-85f1-8ee3eaf689b8', name: 'Performance Fixture Main Outlet', timeZone: 'Africa/Nairobi', version: 1, address: 'Westlands, Nairobi, Kenya', phone: '+254700000001', email: 'outlet@mazao-perf.invalid', receiptHeader: '', receiptFooter: '' },
    capabilities: ['commerce', 'hospitality', 'inventory', 'retail'],
    supportedCapabilities: ['commerce', 'inventory', 'hospitality', 'retail'],
    currencyLocked: true,
    readiness: { readyForFirstSale: true, checks: [] },
  },
};
const body = Buffer.from(JSON.stringify(legacyPayload));
const output = resolve(dirname(fileURLToPath(import.meta.url)), '../../infra/performance/legacy-configuration.json');
await writeFile(output, body);
process.stdout.write(JSON.stringify({ output, responseBytes: body.length, logoBytes: logo.length, qrBytes: qr.length, sha256: createHash('sha256').update(body).digest('hex') }) + '\n');
