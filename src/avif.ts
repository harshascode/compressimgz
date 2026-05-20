import { initImageCompressor } from './image-compressor';

initImageCompressor({
  createWorker: () => new Worker(new URL('./avif-worker.ts', import.meta.url), { type: 'module' }),
  workerErrorLabel: 'AVIF',
  mimeType: 'image/avif',
  filePattern: /\.avif$/i,
  outputName: (name) => name.replace(/\.(avif)$/i, '') + '-compressed.avif',
  formatLabel: 'AVIF',
  defaultQuality: 65, // AVIF typically achieves excellent clarity at lower numerical baselines than JPEG!
});