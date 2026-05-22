import { gunzipSync } from 'fflate';

/**
 * Client-side WASM Decompressor
 * 
 * This script decompresses 'zeroperl.wasm.gz' in the browser and 
 * makes it available at the path '/wasm/zeroperl.wasm' using the Cache API 
 * and Fetch interception.
 */

const WASM_URL = '/wasm/zeroperl.wasm';
const GZ_URL = '/wasm/zeroperl.wasm.gz';
const CACHE_NAME = 'wasm-cache-v1';

// Intercept fetch synchronously to ensure we catch all requests
const originalFetch = self.fetch;

let decompressionPromise: Promise<Response> | null = null;

async function getDecompressedResponse(): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  
  // 1. Check if we already have it in cache
  const cached = await cache.match(WASM_URL);
  if (cached) return cached;

  // 2. If not, fetch the compressed version
  console.log('[WASM-Decompressor] Fetching compressed WASM...');
  const response = await originalFetch(GZ_URL);
  if (!response.ok) throw new Error(`Failed to fetch ${GZ_URL}`);

  // 3. Decompress
  console.log('[WASM-Decompressor] Decompressing...');
  const buffer = await response.arrayBuffer();
  const decompressed = gunzipSync(new Uint8Array(buffer));
  
  const wasmResponse = new Response(decompressed, {
    headers: { 'Content-Type': 'application/wasm' }
  });

  // 4. "Save" it in the browser's virtual folder (Cache API)
  await cache.put(WASM_URL, wasmResponse.clone());
  console.log('[WASM-Decompressor] WASM ready and cached.');
  
  return wasmResponse;
}

// Override fetch globally in this worker
self.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : (input as Request | URL).toString();
  
  // Check if the request is for our target WASM file
  if (url.includes(WASM_URL) && !url.endsWith('.gz')) {
    if (!decompressionPromise) {
      decompressionPromise = getDecompressedResponse();
    }
    const response = await decompressionPromise;
    return response.clone();
  }
  
  return originalFetch(input, init);
};
