import { runExifTools } from './exif/run-exif-tools';

type ParseExifRequest = {
	type: 'parse';
	requestId: number;
	itemId: string;
	file: File;
};

type RemoveExifRequest = {
	type: 'remove';
	requestId: number;
	itemId: string;
	file: File;
};

type WorkerRequest = ParseExifRequest | RemoveExifRequest;

type ParseExifResponse = {
	type: 'parsed';
	requestId: number;
	itemId: string;
	metadata: Record<string, string>;
};

type RemoveExifResponse = {
	type: 'removed';
	requestId: number;
	itemId: string;
	buffer: ArrayBuffer;
};

type WorkerErrorResponse = {
	type: 'error';
	requestId: number;
	itemId: string;
	message: string;
};

export type WorkerResponse = ParseExifResponse | RemoveExifResponse | WorkerErrorResponse;

const workerScope: Worker = self as unknown as Worker;

workerScope.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
	const req = event.data;

	if (req.type === 'parse') {
		try {
			const output = await runExifTools(req.file);
            const metadata: Record<string, string> = {};
            for (const item of output) {
                metadata[item.label] = item.value;
            }
			const response: ParseExifResponse = {
				type: 'parsed',
				requestId: req.requestId,
				itemId: req.itemId,
				metadata,
			};
			workerScope.postMessage(response);
		} catch (error) {
			const errorResponse: WorkerErrorResponse = {
				type: 'error',
				requestId: req.requestId,
				itemId: req.itemId,
				message: error instanceof Error ? error.message : 'Failed to parse EXIF data',
			};
			workerScope.postMessage(errorResponse);
		}
	} else if (req.type === 'remove') {
        // For now, implement just throwing error as we don't have remove function yet
        const errorResponse: WorkerErrorResponse = {
            type: 'error',
            requestId: req.requestId,
            itemId: req.itemId,
            message: 'Remove EXIF is not yet implemented in the worker',
        };
        workerScope.postMessage(errorResponse);
    }
});
