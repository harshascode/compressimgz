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

// Gifsicle operates directly on arrays of virtual files. 
// We track original file buffers here in case we need to re-compress.
const fileCache = new Map<string, ArrayBuffer>();
const workerScope: Worker = self as unknown as Worker;

async function compress({ requestId, itemId, buffer, quality }: CompressRequest): Promise<void> {
  try {
    // Cache the original array buffer if it isn't already stored
    let originalBuffer = fileCache.get(itemId);
    if (!originalBuffer) {
      originalBuffer = buffer;
      fileCache.set(itemId, originalBuffer);
    }

    // Convert quality slider value (e.g., 10-100) to Gifsicle lossy value (1-200).
    // Gifsicle lossy: higher means MORE loss/compression.
    // If quality is 80, lossy parameter will be: Math.round((100 - 80) * 2) = 40.
    const lossyValue = Math.max(1, Math.min(200, Math.round((100 - quality) * 2)));

    // Execute gifsicle processing using the documented API
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

    // Gifsicle returns a standard Web File array. Get the underlying ArrayBuffer.
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