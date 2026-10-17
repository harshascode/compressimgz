// vite.config.ts
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        jpeg: fileURLToPath(new URL('jpeg-compressor.html', import.meta.url)),
        png: fileURLToPath(new URL('png-compressor.html', import.meta.url)),
        webp: fileURLToPath(new URL('webp-compressor.html', import.meta.url)),
        avif: fileURLToPath(new URL('avif-compressor.html', import.meta.url)),
        gif: fileURLToPath(new URL('gif-compressor.html', import.meta.url)),
        exifremover: fileURLToPath(new URL('exifremover.html', import.meta.url)),
      },
    },
  },
})
