/**
 * Client-side WASM Decompressor (Native Version)
 * 
 * This script decompresses 'zeroperl.wasm.gz' in the browser using the native
 * DecompressionStream API and makes it available at '/wasm/zeroperl.wasm'.
 */

const WASM_PATH = '/wasm/zeroperl.wasm';
const GZ_PATH = '/wasm/zeroperl.wasm.gz';
const CACHE_NAME = 'wasm-cache-v1';

const originalFetch = self.fetch;
let decompressionPromise: Promise<Response> | null = null;

async function getDecompressedResponse(): Promise<Response> {
  console.log('[WASM-Decompressor] Starting native decompression process...');
  
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
  
  const response = await originalFetch(gzUrl);
  if (!response.ok) {
     throw new Error(`Failed to fetch ${gzUrl}: ${response.status} ${response.statusText}`);
  }

  // Check if it's already decompressed by the browser/server
  const contentEncoding = response.headers.get('Content-Encoding');
  const contentType = response.headers.get('Content-Type');
  
  let wasmResponse: Response;

  if (contentEncoding === 'gzip' || contentType === 'application/wasm') {
    console.log('[WASM-Decompressor] Data already decompressed by browser/server.');
    wasmResponse = new Response(response.body, {
      headers: { 'Content-Type': 'application/wasm' }
    });
  } else {
    console.log('[WASM-Decompressor] Manually decompressing using DecompressionStream...');
    try {
      const ds = new DecompressionStream('gzip');
      const decompressedStream = response.body!.pipeThrough(ds);
      wasmResponse = new Response(decompressedStream, {
        headers: { 'Content-Type': 'application/wasm' }
      });
    } catch (err) {
      console.error('[WASM-Decompressor] Native decompression failed:', err);
      throw err;
    }
  }

  // Save to cache for future use
  if (cache) {
    try {
      // Note: We must clone the response before caching if we also want to return it
      const clone = wasmResponse.clone();
      await cache.put(WASM_PATH, clone);
      console.log('[WASM-Decompressor] Saved to cache.');
    } catch (e) {
      console.warn('[WASM-Decompressor] Failed to save to cache:', e);
    }
  }
  
  return wasmResponse;
}

// Override fetch globally in this worker
self.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  let urlStr: string;
  if (typeof input === 'string') {
    urlStr = input;
  } else if (input instanceof URL) {
    urlStr = input.href;
  } else {
    urlStr = (input as Request).url;
  }

  try {
    const url = new URL(urlStr, self.location.origin);
    if (url.pathname === WASM_PATH) {
      if (!decompressionPromise) {
        decompressionPromise = getDecompressedResponse();
      }
      return (await decompressionPromise).clone();
    }
  } catch (e) {
    if (typeof urlStr === 'string' && urlStr.includes(WASM_PATH) && !urlStr.endsWith('.gz')) {
      if (!decompressionPromise) {
        decompressionPromise = getDecompressedResponse();
      }
      return (await decompressionPromise).clone();
    }
  }
  
  return originalFetch(input, init);
};
