import { optimise } from '@jsquash/oxipng';

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

function qualityToOptimiseLevel(quality: number): number {
  const clampedQuality = Math.min(100, Math.max(10, quality));
  return Math.round(1 + ((100 - clampedQuality) / 90) * 5);
}

async function compress({ requestId, itemId, buffer, quality }: CompressRequest): Promise<void> {
  try {
    const optimised = await optimise(buffer, {
      interlace: false,
      level: qualityToOptimiseLevel(quality),
      optimiseAlpha: true,
    });

    const response: WorkerResponse = {
      type: 'compressed',
      requestId,
      itemId,
      buffer: optimised,
    };
    workerScope.postMessage(response, [optimised]);
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
    // No cached image data to clear.
  }
});
