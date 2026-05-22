import { gunzipSync } from 'fflate';

/**
 * Client-side WASM Decompressor
 * 
 * This script decompresses 'zeroperl.wasm.gz' in the browser and 
 * makes it available at the path '/wasm/zeroperl.wasm' using the Cache API 
 * and Fetch interception.
 */

const WASM_PATH = '/wasm/zeroperl.wasm';
const GZ_PATH = '/wasm/zeroperl.wasm.gz';
const CACHE_NAME = 'wasm-cache-v1';

const originalFetch = self.fetch;
let decompressionPromise: Promise<Response> | null = null;

async function getDecompressedResponse(): Promise<Response> {
  console.log('[WASM-Decompressor] Starting decompression process...');
  
  let cache: Cache | null = null;
  if ('caches' in self) {
    try {
      cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(WASM_PATH);
      if (cached) {
        console.log('[WASM-Decompressor] Found in cache.');
        return cached;
      }
    } catch (e) {
      console.warn('[WASM-Decompressor] Cache API error:', e);
    }
  }

  const gzUrl = new URL(GZ_PATH, self.location.origin).href;
  console.log(`[WASM-Decompressor] Fetching: ${gzUrl}`);
  
  // Use originalFetch to avoid interception recursion
  const response = await originalFetch(gzUrl);
  if (!response.ok) {
     throw new Error(`Failed to fetch ${gzUrl}: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const uint8 = new Uint8Array(buffer);
  
  console.log(`[WASM-Decompressor] Received ${uint8.length} bytes.`);
  console.log(`[WASM-Decompressor] Header bytes: ${uint8[0].toString(16)}, ${uint8[1].toString(16)}, ${uint8[2].toString(16)}, ${uint8[3].toString(16)}`);

  // Check for GZIP signature: 1f 8b
  if (uint8[0] === 0x1f && uint8[1] === 0x8b) {
    console.log('[WASM-Decompressor] Valid GZIP signature found. Decompressing...');
    try {
      const decompressed = gunzipSync(uint8);
      console.log(`[WASM-Decompressor] Decompressed successfully to ${decompressed.length} bytes.`);
      
      const wasmResponse = new Response(decompressed, {
        headers: { 'Content-Type': 'application/wasm' }
      });

      if (cache) {
        try {
          await cache.put(WASM_PATH, wasmResponse.clone());
          console.log('[WASM-Decompressor] Saved to cache.');
        } catch (e) {
          console.warn('[WASM-Decompressor] Failed to save to cache:', e);
        }
      }
      
      return wasmResponse;
    } catch (err) {
      console.error('[WASM-Decompressor] gunzipSync failed. Data might be corrupted or in an unsupported gzip format.', err);
      throw err;
    }
  } 
  
  // If it's already WASM (starts with \0asm)
  if (uint8[0] === 0x00 && uint8[1] === 0x61 && uint8[2] === 0x73 && uint8[3] === 0x6d) {
    console.log('[WASM-Decompressor] Data is already WASM. Using as-is.');
    const wasmResponse = new Response(uint8, {
      headers: { 'Content-Type': 'application/wasm' }
    });
    if (cache) await cache.put(WASM_PATH, wasmResponse.clone());
    return wasmResponse;
  }

  const firstBytes = Array.from(uint8.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  throw new Error(`Invalid data format. Expected GZIP (1f 8b) or WASM (00 61 73 6d). Received header: ${firstBytes}`);
}

// Override fetch globally in this worker
self.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  let urlStr: string;
  if (typeof input === 'string') {
    urlStr = input;
  } else if (input instanceof URL) {
    urlStr = input.href;
  } else {
    // Request object
    urlStr = (input as Request).url;
  }

  try {
    const url = new URL(urlStr, self.location.origin);
    // Be very specific about matching the target path
    if (url.pathname === WASM_PATH) {
      if (!decompressionPromise) {
        decompressionPromise = getDecompressedResponse();
      }
      const response = await decompressionPromise;
      return response.clone();
    }
  } catch (e) {
    // Fallback for relative paths or invalid URLs
    if (typeof urlStr === 'string' && urlStr.includes(WASM_PATH) && !urlStr.endsWith('.gz')) {
      if (!decompressionPromise) {
        decompressionPromise = getDecompressedResponse();
      }
      const response = await decompressionPromise;
      return response.clone();
    }
  }
  
  return originalFetch(input, init);
};
