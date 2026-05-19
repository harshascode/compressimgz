import { decode, encode } from '@jsquash/png';
import * as iq from 'image-q';

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

const imageCache = new Map<string, ImageData>();
const workerScope: Worker = self as unknown as Worker;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function qualityToColorCount(quality: number): number {
  const normalized = clamp(quality, 10, 100) / 100;

  // PNG compression here is lossy palette reduction before PNG re-encoding.
  // Keep enough colors at high quality, but make low settings aggressively small.
  return Math.round(16 + normalized * (256 - 16));
}

function cleanTransparentPixels(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
    }
  }
}

async function quantizePng(imageData: ImageData, quality: number): Promise<ImageData> {
  const width = imageData.width;
  const height = imageData.height;

  if (quality >= 100) {
    const data = new Uint8ClampedArray(imageData.data);
    cleanTransparentPixels(data);
    return new ImageData(data, width, height);
  }

  const source = iq.utils.PointContainer.fromImageData(imageData);
  const palette = await iq.buildPalette([source], {
    colors: qualityToColorCount(quality),
    colorDistanceFormula: 'pngquant',
    paletteQuantization: 'wuquant',
  });

  const quantized = await iq.applyPalette(source, palette, {
    colorDistanceFormula: 'pngquant',
    imageQuantization: 'nearest',
  });

  const data = new Uint8ClampedArray(quantized.toUint8Array());
  cleanTransparentPixels(data);
  return new ImageData(data, width, height);
}

async function compress({ requestId, itemId, buffer, quality }: CompressRequest): Promise<void> {
  try {
    let imageData = imageCache.get(itemId);
    if (!imageData) {
      imageData = await decode(buffer, { bitDepth: 8 });
      imageCache.set(itemId, imageData);
    }

    const optimized = await quantizePng(imageData, quality);
    const encoded = await encode(optimized, { bitDepth: 8 });

    const response: WorkerResponse = {
      type: 'compressed',
      requestId,
      itemId,
      buffer: encoded,
    };
    workerScope.postMessage(response, [encoded]);
  } catch (error) {
    const response: WorkerResponse = {
      type: 'error',
      requestId,
      itemId,
      message: error instanceof Error ? error.message : 'Could not compress this PNG file.',
    };
    workerScope.postMessage(response);
  }
}

workerScope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;

  if (message.type === 'compress') {
    void compress(message);
  } else if (message.type === 'release') {
    imageCache.delete(message.itemId);
  } else {
    imageCache.clear();
  }
});
