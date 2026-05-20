// vite.config.ts
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        jpeg: fileURLToPath(new URL('jpeg.html', import.meta.url)),
        png: fileURLToPath(new URL('png.html', import.meta.url)),
        webp: fileURLToPath(new URL('webp.html', import.meta.url)),
        avif: fileURLToPath(new URL('avif.html', import.meta.url)),
        gif: fileURLToPath(new URL('gif.html', import.meta.url)),
      },
    },
  },
})
