// exif-worker.ts

import './wasm-decompressor';

let exiftoolPromise: Promise<any> | null = null;

// Dynamically load the ExifTool WASM wrapper
async function loadExiftool() {
  if (exiftoolPromise) return exiftoolPromise;

  exiftoolPromise = (async () => {
    
    // By creating a full "http://localhost:5173/js/exiftool.js" URL, 
    // Vite treats it as an external network request and stops interfering.
    const scriptUrl = new URL('/js/exiftool.js', self.location.origin).href;
    
    // @ts-ignore - TypeScript cannot resolve network URLs at compile time
    const module = await import(/* @vite-ignore */ scriptUrl) as any;
    
    // Warm up the WASM instance
    try {
      const dummyFile = { name: 'warmup.txt', data: new Uint8Array([]) };
      await module.parseMetadata(dummyFile, { args: ['-ver'] });
    } catch (e) {
      // Ignore warmup errors
    }

    return module;
  })();

  return exiftoolPromise;
}

// Helper: Converts ExifTool's textual output into a key-value object
function parseExifToolText(text: string): Record<string, string> {
  const metadata: Record<string, string> = {};
  if (!text) return metadata;

  const lines = text.split('\n');
  const excludeGroups = ['Composite', 'ExifTool', 'System', 'File'];

  for (const line of lines) {
    const groupMatch = line.match(/^\[([^\]]+)\]\s+/);
    if (!groupMatch) continue;

    const group = groupMatch[1];
    if (excludeGroups.includes(group)) continue;

    const rest = line.substring(groupMatch[0].length);
    const colonIndex = rest.indexOf(':');
    if (colonIndex === -1) continue;

    const key = rest.substring(0, colonIndex).trim();
    const value = rest.substring(colonIndex + 1).trim();

    if (key && value && !value.startsWith('(Binary data')) {
      metadata[key] = value;
    }
  }

  return metadata;
}

self.onmessage = async (e: MessageEvent) => {
  const { type, requestId, itemId, file } = e.data;
  
  // FIX 2: Cast self to 'any' so TS stops treating it like a Window object
  const ctx = self as any;

  try {
    const { parseMetadata, writeMetadata } = await loadExiftool();
    
    const arrayBuffer = await file.arrayBuffer();
    const virtualFile = { name: file.name, data: new Uint8Array(arrayBuffer) };

    if (type === 'parse') {
      const result = await parseMetadata(virtualFile, { args: ['-G'] });

      if (result.success && result.data) {
        const metadata = parseExifToolText(result.data);
        ctx.postMessage({ requestId, itemId, metadata });
      } else {
        throw new Error(result.error || 'Failed to read metadata');
      }
    } 
    
    else if (type === 'strip') {
      const result = await writeMetadata(virtualFile, {}, {
        args: ['-all=', '--icc_profile:all']
      });

      // The original code uses a fallback: result.data || virtualFile.data
      if (result.success) {
        const buffer = result.data || virtualFile.data;
        
        // Just send the buffer directly without the transfer array
        ctx.postMessage({ requestId, itemId, buffer }); 
      } else {
        throw new Error(result.error || 'Failed to strip metadata');
      }
    }

  } catch (error: any) {
    console.error(`Worker Error [${type}]:`, error);
    ctx.postMessage({ 
      type: 'error', 
      requestId, 
      itemId, 
      message: error.message || 'Worker crashed' 
    });
  }
};