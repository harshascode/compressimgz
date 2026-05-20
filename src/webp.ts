import { initImageCompressor } from './image-compressor';

initImageCompressor({
  createWorker: () => new Worker(new URL('./webp-worker.ts', import.meta.url), { type: 'module' }),
  workerErrorLabel: 'WebP',
  mimeType: 'image/webp',
  filePattern: /\.webp$/i,
  outputName: (name) => name.replace(/\.(webp)$/i, '') + '-compressed.webp',
  formatLabel: 'WEBP',
  defaultQuality: 80,
});