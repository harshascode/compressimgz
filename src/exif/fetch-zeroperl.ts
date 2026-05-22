import { gunzipSync } from 'fflate';

const GZ_WASM_URL = `/wasm/zeroperl.wasm.gz`;

async function fetchZeroPerl(): Promise<ArrayBuffer> {
	let wasmBuffer: ArrayBuffer | null = null;

	// Try to get from OPFS cache first
	try {
		const root = await navigator.storage.getDirectory();
		const wasmFile = await root.getFileHandle('zeroperl.wasm', { create: false });
		const file = await wasmFile.getFile();
		const buffer = await file.arrayBuffer();

		// Validate the buffer has content (magic number for WASM is \0asm)
		if (buffer.byteLength >= 8 && new Uint32Array(buffer)[0] === 0x6d736100) {
			console.log('Found valid cached zeroperl.wasm in OPFS');
			wasmBuffer = buffer;
		} else {
			console.log('Cached zeroperl.wasm is invalid or not a WASM file');
		}
	} catch (error) {
		console.log('No cached zeroperl.wasm or error reading cache:', error);
	}

	// If no valid cached buffer, fetch from network and decompress
	if (!wasmBuffer) {
		console.log('Fetching zeroperl.wasm.gz from internet');
		const response = await fetch(GZ_WASM_URL);

		if (!response.ok) {
			throw new Error(`Failed to fetch zeroperl.wasm.gz: ${response.status}`);
		}

		const compressedBuffer = await response.arrayBuffer();
		
		try {
			// Some servers auto-decompress if they see .gz and send Content-Encoding: gzip
			// We check the magic number. If it's already WASM (\0asm), we don't need to gunzip.
			const magic = new Uint32Array(compressedBuffer.slice(0, 4))[0];
			if (magic === 0x6d736100) {
				console.log('Buffer was auto-decompressed by the browser/server');
				wasmBuffer = compressedBuffer;
			} else {
				console.log('Decompressing WASM with fflate...');
				const decompressed = gunzipSync(new Uint8Array(compressedBuffer));
				wasmBuffer = decompressed.buffer;
			}
		} catch (e) {
			console.error('Failed to decompress the WASM file:', e);
			throw new Error('Invalid gzip data received for WASM');
		}

		await cacheWasmFile(wasmBuffer);
	}

	return wasmBuffer;
}

// Helper function to cache wasm file
async function cacheWasmFile(wasmBuffer: ArrayBuffer) {
	try {
		const root = await navigator.storage.getDirectory();
		const wasmFile = await root.getFileHandle('zeroperl.wasm', { create: true });
		const writable = await wasmFile.createWritable();
		await writable.write(wasmBuffer);
		await writable.close();
		console.log('Cached decompressed zeroperl.wasm to OPFS');
	} catch (error) {
		console.error('Failed to cache zeroperl.wasm:', error);
	}
}

export { fetchZeroPerl };
