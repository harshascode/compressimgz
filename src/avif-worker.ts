import { decode, encode } from '@jsquash/avif';

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

async function compress({ requestId, itemId, buffer, quality }: CompressRequest): Promise<void> {
  try {
    let imageData = imageCache.get(itemId);
    if (!imageData) {
      // Decode the incoming AVIF or raw image buffer into ImageData
      imageData = await decode(buffer);
      imageCache.set(itemId, imageData);
    }

    // Encode the raw ImageData back into a compressed AVIF ArrayBuffer
    // Note: libavif commonly maps standard 0-100 scales directly, or uses specific ranges
    const encoded = await encode(imageData, {
      quality,
      // You can also fine-tune options here if needed, for instance speed or effort settings 
      // which libavif frequently exposes depending on the underlying encoder version.
    });

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
    imageCache.delete(message.itemId);
  } else {
    imageCache.clear();
  }
});