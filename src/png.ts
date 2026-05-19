import { initImageCompressor } from './image-compressor';

initImageCompressor({
  createWorker: () => new Worker(new URL('./png-worker.ts', import.meta.url), { type: 'module' }),
  workerErrorLabel: 'PNG',
  mimeType: 'image/png',
  filePattern: /\.png$/i,
  outputName: (name) => name.replace(/\.png$/i, '') + '-compressed.png',
  formatLabel: 'PNG',
  defaultQuality: 80,
});
