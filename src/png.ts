import { initImageCompressor } from './image-compressor';

initImageCompressor({
  workerUrl: new URL('./png-worker.ts', import.meta.url),
  workerErrorLabel: 'PNG',
  mimeType: 'image/png',
  filePattern: /\.png$/i,
  outputName: (name) => name.replace(/\.png$/i, '') + '-compressed.png',
  formatLabel: 'PNG',
  defaultQuality: 80,
});
