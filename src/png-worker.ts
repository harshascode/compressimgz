// 1. Import the WASM initializer and bindings from your local vendor folder
import init, { Imagequant, ImagequantImage } from './vendor/imagequant';

// 2. Import the raw .wasm binary file path natively using Vite's URL suffix
import wasmUrl from './vendor/imagequant/imagequant_bg.wasm?url';

// Keep track of the initialization state so we only boot the WASM instance once
let wasmReadyPromise: Promise<any> | null = null;

function ensureWasmInitialized(): Promise<any> {
  if (!wasmReadyPromise) {
    // Vite resolves 'wasmUrl' to a standard asset path string, which we feed to init()
    wasmReadyPromise = init(wasmUrl);
  }
  return wasmReadyPromise;
}

// Communication interfaces matching your image-compressor.ts setup
type WorkerRequest = 
  | { type: 'compress'; requestId: number; itemId: string; buffer: ArrayBuffer; quality: number; }
  | { type: 'release'; itemId: string; }
  | { type: 'clear'; };

type WorkerResponse = 
  | { type: 'compressed'; requestId: number; itemId: string; buffer: ArrayBuffer; }
  | { type: 'error'; requestId: number; itemId: string; message: string; };

const ctx: Worker = self as any;

ctx.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;

  if (message.type === 'compress') {
    const { requestId, itemId, buffer, quality } = message;

    try {
      // Step A: Make sure the WebAssembly binary is compiled and ready
      await ensureWasmInitialized();

      // Step B: Decode the incoming file ArrayBuffer into raw image pixels
      const blob = new Blob([buffer]);
      const bitmap = await createImageBitmap(blob);
      const { width, height } = bitmap;

      // Extract pixel data using an OffscreenCanvas
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Failed to acquire 2D context from OffscreenCanvas.');
      }
      
      context.drawImage(bitmap, 0, 0, width, height);
      const imageData = context.getImageData(0, 0, width, height);
      
      // Free the ImageBitmap memory immediately
      bitmap.close();

      // Step C: Initialize Imagequant structures
      const pixels = new Uint8Array(imageData.data.buffer);
      const imagequantImage = new ImagequantImage(pixels, width, height, 0);
      const quantizer = new Imagequant();

      // --- OPTIMIZATION SETTINGS FOR SMALLER FILE SIZE ---
      // 1. Force the engine to use speed 1 (slowest/deepest compression search)
      quantizer.set_speed(1);

      // 2. Map your UI slider quality to Imagequant's internal bounds
      quantizer.set_quality(0, quality);

      // Step D: Run the quantization logic 
      const outputPngBytes = quantizer.process(imagequantImage);

      // Step E: Safely extract and slice the underlying buffer 
      const outputBuffer = outputPngBytes.buffer.slice(
        outputPngBytes.byteOffset,
        outputPngBytes.byteOffset + outputPngBytes.byteLength
      ) as ArrayBuffer;

      // Step F: Respond back to the main UI orchestrator with zero-copy memory transfers
      const response: WorkerResponse = {
        type: 'compressed',
        requestId,
        itemId,
        buffer: outputBuffer
      };
      
      ctx.postMessage(response, [outputBuffer]);

    } catch (error: any) {
      // Send any execution failures back up to your UI layer
      const errorResponse: WorkerResponse = {
        type: 'error',
        requestId,
        itemId,
        message: error?.message || 'An error occurred during PNG compression.'
      };
      
      ctx.postMessage(errorResponse);
    }
  }

  if (message.type === 'release' || message.type === 'clear') {
    // Memory sweeps clean automatically via V8 garbage collection
  }
});