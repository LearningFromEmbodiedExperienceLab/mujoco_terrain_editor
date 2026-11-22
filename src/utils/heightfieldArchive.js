import { strToU8, zipSync } from 'fflate';
import { downloadBlob, exportHeightfieldScene } from './xmlExporter.js';

async function encodeHeightfieldPng({ columns, rows, pixels }) {
  const canvas = document.createElement('canvas');
  canvas.width = columns;
  canvas.height = rows;
  const context = canvas.getContext('2d');
  const image = context.createImageData(columns, rows);
  for (let i = 0; i < pixels.length; i += 1) {
    const offset = i * 4;
    const gray = pixels[i];
    image.data[offset] = gray;
    image.data[offset + 1] = gray;
    image.data[offset + 2] = gray;
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed');
  return new Uint8Array(await blob.arrayBuffer());
}

export async function downloadHeightfieldArchive(elements, filename) {
  const { xml, heightfields } = exportHeightfieldScene(elements);
  const files = { 'terrain.xml': strToU8(xml) };
  for (const field of heightfields) {
    files[field.file] = [await encodeHeightfieldPng(field), { level: 0 }];
  }
  const archive = zipSync(files);
  downloadBlob(new Blob([archive], { type: 'application/zip' }), filename);
}
