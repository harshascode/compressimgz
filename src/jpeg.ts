import { initImageCompressor } from './image-compressor';

initImageCompressor({
  createWorker: () => new Worker(new URL('./jpeg-worker.ts', import.meta.url), { type: 'module' }),
  workerErrorLabel: 'JPEG',
  mimeType: 'image/jpeg',
  filePattern: /\.jpe?g$/i,
  outputName: (name) => name.replace(/\.(jpe?g)$/i, '') + '-compressed.jpg',
  formatLabel: 'JPG',
  defaultQuality: 80,
});
