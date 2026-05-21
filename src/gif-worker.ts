// 1. FIX: Mock the DOM Element class so gifsicle-wasm-browser doesn't crash in the Worker thread
if (typeof (self as any).Element === 'undefined') {
  (self as any).Element = class {};
}

// @ts-ignore
import gifsicle from 'gifsicle-wasm-browser';

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

const fileCache = new Map<string, ArrayBuffer>();
const workerScope: Worker = self as unknown as Worker;

async function compress({ requestId, itemId, buffer, quality }: CompressRequest): Promise<void> {
  try {
    let originalBuffer = fileCache.get(itemId);
    if (!originalBuffer) {
      originalBuffer = buffer;
      fileCache.set(itemId, originalBuffer);
    }

    // Convert quality slider value (10-100) to Gifsicle lossy value (1-200)
    const lossyValue = Math.max(1, Math.min(200, Math.round((100 - quality) * 2)));

    // Execute gifsicle processing
    const outputFiles = await gifsicle.run({
      input: [{
        file: originalBuffer,
        name: 'input.gif',
      }],
      command: [
        `-O3 --lossy=${lossyValue} input.gif -o /out/output.gif`
      ],
    });

    if (!outputFiles || outputFiles.length === 0) {
      throw new Error('Gifsicle optimization did not produce any output files.');
    }

    const compressedFile = outputFiles[0];
    const encodedBuffer = await compressedFile.arrayBuffer();

    const response: WorkerResponse = {
      type: 'compressed',
      requestId,
      itemId,
      buffer: encodedBuffer,
    };
    workerScope.postMessage(response, [encodedBuffer]);
  } catch (error) {
    const response: WorkerResponse = {
      type: 'error',
      requestId,
      itemId,
      message: error instanceof Error ? error.message : 'Could not compress this GIF file.',
    };
    workerScope.postMessage(response);
  }
}

workerScope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;

  if (message.type === 'compress') {
    void compress(message);
  } else if (message.type === 'release') {
    fileCache.delete(message.itemId);
  } else {
    fileCache.clear();
  }
});