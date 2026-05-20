import { initImageCompressor } from './image-compressor';

initImageCompressor({
  // Spawns the custom Gifsicle WebAssembly worker wrapper
  createWorker: () => new Worker(new URL('./gif-worker.ts', import.meta.url), { type: 'module' }),
  workerErrorLabel: 'GIF',
  mimeType: 'image/gif',
  filePattern: /\.gif$/i,
  // Automatically attaches '-compressed.gif' to the base name when saving
  outputName: (name) => name.replace(/\.gif$/i, '') + '-compressed.gif',
  formatLabel: 'GIF',
  // Sets the baseline entry point for the quality slider component
  defaultQuality: 80,
});