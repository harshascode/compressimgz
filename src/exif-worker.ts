import { parseMetadata, writeMetadata } from '@uswriting/exiftool';

type WorkerRequest = 
  | { type: 'parse'; requestId: number; itemId: string; file: File }
  | { type: 'strip'; requestId: number; itemId: string; file: File };

type WorkerResponse = 
  | { type: 'parsed'; requestId: number; itemId: string; metadata: Record<string, string> }
  | { type: 'stripped'; requestId: number; itemId: string; buffer: ArrayBuffer }
  | { type: 'error'; requestId: number; itemId: string; message: string };

const workerScope = self as unknown as Worker;

workerScope.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  
  try {
    if (req.type === 'parse') {
      const result = await parseMetadata(req.file, {
        args: ['-json']
      });
      
      // Explicitly check for failure to force type narrowing
      if (result.success === false) {
        throw new Error(result.error || 'Failed to parse metadata');
      }
      
      const parsedData = JSON.parse(result.data as unknown as string);
      const metadataObj = Array.isArray(parsedData) ? parsedData[0] : parsedData;
      
      const response: WorkerResponse = {
        type: 'parsed',
        requestId: req.requestId,
        itemId: req.itemId,
        metadata: metadataObj as Record<string, string>
      };
      workerScope.postMessage(response);
      
    } else if (req.type === 'strip') {
      const result = await writeMetadata(req.file, {}, { args: ['-all='] });
      
      // Explicitly check for failure to force type narrowing
      if (result.success === false) {
        throw new Error(result.error || 'Failed to strip metadata');
      }
      
      const response: WorkerResponse = {
        type: 'stripped',
        requestId: req.requestId,
        itemId: req.itemId,
        buffer: result.data
      };
      
      workerScope.postMessage(response, [result.data]);
    }
  } catch (error) {
    const response: WorkerResponse = {
      type: 'error',
      requestId: req.requestId,
      itemId: req.itemId,
      message: error instanceof Error ? error.message : 'An error occurred processing the file.'
    };
    workerScope.postMessage(response);
  }
});