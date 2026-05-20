import { writeMetadata } from '@uswriting/exiftool';

type StripRequest = {
  type: 'strip';
  requestId: number;
  itemId: string;
  buffer: ArrayBuffer;
  fileName: string;
};

type ReleaseRequest = {
  type: 'release';
  itemId: string;
};

type ClearRequest = {
  type: 'clear';
};

type WorkerRequest = StripRequest | ReleaseRequest | ClearRequest;

type WorkerResponse = {
  type: 'stripped';
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

async function stripMetadata({ requestId, itemId, buffer, fileName }: StripRequest): Promise<void> {
  try {
    // The documentation specifies the package expects a File object or a Binaryfile.
    // In a worker, we wrap the ArrayBuffer into a Blob with name context to fulfill this.
    const fileBlob = new Blob([buffer]);
    const mockFile = Object.assign(fileBlob, { name: fileName }) as unknown as File;

    // Passing an empty tag map doesn't always strip metadata on its own, 
    // so we pass the standard ExifTool argument `-all=` via options to strip all tags.
    const result = await writeMetadata(mockFile, {}, {
      args: ['-all=']
    });

    if (result.success && result.data) {
      const response: WorkerResponse = {
        type: 'compressed', // Mirroring your UI message type interface name if needed, or 'stripped'
        requestId,
        itemId,
        buffer: result.data,
      };
      workerScope.postMessage(response, [result.data]);
    } else {
      throw new Error(result.error || 'ExifTool processing failed.');
    }
  } catch (error) {
    const response: WorkerResponse = {
      type: 'error',
      requestId,
      itemId,
      message: error instanceof Error ? error.message : 'Could not remove EXIF data from this file.',
    };
    workerScope.postMessage(response);
  }
}

workerScope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;

  if (message.type === 'strip') {
    void stripMetadata(message);
  } else {
    // Left empty or for clearing caches if you store state down the line.
    // Unlike jpeg-worker, Exif operations are typically atomic, so no cache to clear here.
  }
});