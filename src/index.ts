import { initImageCompressor } from './image-compressor';

initImageCompressor([
  {
    createWorker: () => new Worker(new URL('./jpeg-worker.ts', import.meta.url), { type: 'module' }),
    workerErrorLabel: 'JPEG',
    mimeType: 'image/jpeg',
    filePattern: /\.jpe?g$/i,
    outputName: (name) => name.replace(/\.(jpe?g)$/i, '') + '-compressed.jpg',
    formatLabel: 'JPG',
    defaultQuality: 80,
  },
  {
    createWorker: () => new Worker(new URL('./png-worker.ts', import.meta.url), { type: 'module' }),
    workerErrorLabel: 'PNG',
    mimeType: 'image/png',
    filePattern: /\.png$/i,
    outputName: (name) => name.replace(/\.png$/i, '') + '-compressed.png',
    formatLabel: 'PNG',
    defaultQuality: 80,
  },
  {
    createWorker: () => new Worker(new URL('./webp-worker.ts', import.meta.url), { type: 'module' }),
    workerErrorLabel: 'WebP',
    mimeType: 'image/webp',
    filePattern: /\.webp$/i,
    outputName: (name) => name.replace(/\.(webp)$/i, '') + '-compressed.webp',
    formatLabel: 'WEBP',
    defaultQuality: 80,
  },
  {
    createWorker: () => new Worker(new URL('./avif-worker.ts', import.meta.url), { type: 'module' }),
    workerErrorLabel: 'AVIF',
    mimeType: 'image/avif',
    filePattern: /\.avif$/i,
    outputName: (name) => name.replace(/\.(avif)$/i, '') + '-compressed.avif',
    formatLabel: 'AVIF',
    defaultQuality: 65,
  },
  {
    createWorker: () => new Worker(new URL('./gif-worker.ts', import.meta.url), { type: 'module' }),
    workerErrorLabel: 'GIF',
    mimeType: 'image/gif',
    filePattern: /\.gif$/i,
    outputName: (name) => name.replace(/\.gif$/i, '') + '-compressed.gif',
    formatLabel: 'GIF',
    defaultQuality: 80,
  }
]);
