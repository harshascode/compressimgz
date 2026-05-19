import { optimise } from '@jsquash/oxipng';
import LibImageQuant, { type QuantizationOptions } from 'libimagequant-wasm';

type CompressRequest = {
  type: 'compress';
  requestId: number;
  itemId: string;
  buffer: ArrayBuffer;
  quality: number;
};

type ReleaseRequest = {
  type: 'release';
  itemId: string;
};

type ClearRequest = {
  type: 'clear';
};

type WorkerRequest = CompressRequest | ReleaseRequest | ClearRequest;

type WorkerResponse = {
  type: 'compressed';
  requestId: number;
  itemId: string;
  buffer: ArrayBuffer;
} | {
  type: 'error';
  requestId: number;
  itemId: string;
  message: string;
};

const workerScope: Worker = self as unknown as Worker;
let quantizer: LibImageQuant | null = null;

function getQuantizer(): LibImageQuant {
  quantizer ??= new LibImageQuant({
    workerUrl: new URL('../libimagequant-wasm/worker.mjs', self.location.href).href,
    wasmUrl: new URL('../libimagequant-wasm/wasm/libimagequant_wasm_bg.wasm', self.location.href).href,
    operationTimeout: 60000,
  });
  return quantizer;
}

function clampQuality(quality: number): number {
  return Math.min(100, Math.max(10, quality));
}

function qualityToOptimiseLevel(quality: number): number {
  const clampedQuality = clampQuality(quality);
  return Math.round(1 + ((100 - clampedQuality) / 90) * 5);
}

function qualityToQuantizationOptions(quality: number): QuantizationOptions {
  const clampedQuality = clampQuality(quality);
  const maxColors = clampedQuality >= 80
    ? 256
    : Math.round(16 + ((clampedQuality - 10) / 70) * 240);

  return {
    maxColors: Math.min(256, Math.max(2, maxColors)),
    quality: {
      min: Math.max(0, clampedQuality - 20),
      target: clampedQuality,
    },
    speed: clampedQuality >= 85 ? 2 : clampedQuality >= 60 ? 3 : 5,
    dithering: clampedQuality >= 70 ? 0.85 : 0.65,
    posterization: clampedQuality <= 35 ? 1 : 0,
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function smallerBuffer(first: ArrayBuffer, second: ArrayBuffer): ArrayBuffer {
  return first.byteLength <= second.byteLength ? first : second;
}

async function optimisePng(buffer: ArrayBuffer, quality: number): Promise<ArrayBuffer> {
  return optimise(buffer, {
    interlace: false,
    level: qualityToOptimiseLevel(quality),
    optimiseAlpha: true,
  });
}

async function compress({ requestId, itemId, buffer, quality }: CompressRequest): Promise<void> {
  try {
    let best = await optimisePng(buffer, quality);

    try {
      const quantized = await getQuantizer().quantizePng(buffer, qualityToQuantizationOptions(quality));
      const quantizedBuffer = toArrayBuffer(quantized.pngBytes);
      best = smallerBuffer(best, quantizedBuffer);

      try {
        const optimisedQuantized = await optimisePng(quantizedBuffer, quality);
        best = smallerBuffer(best, optimisedQuantized);
      } catch {
        // Quantized PNG is still a valid candidate if oxipng cannot process it.
      }
    } catch {
      // Some PNGs may not be accepted by libimagequant. Keep the oxipng result.
    }

    const response: WorkerResponse = {
      type: 'compressed',
      requestId,
      itemId,
      buffer: best,
    };
    workerScope.postMessage(response, [best]);
  } catch (error) {
    const response: WorkerResponse = {
      type: 'error',
      requestId,
      itemId,
      message: error instanceof Error ? error.message : 'Could not compress this file.',
    };
    workerScope.postMessage(response);
  }
}

workerScope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;

  if (message.type === 'compress') {
    void compress(message);
  } else if (message.type === 'release') {
    // No per-file decoded cache is kept when using oxipng.
    void message.itemId;
  } else {
    quantizer?.dispose();
    quantizer = null;
  }
});
