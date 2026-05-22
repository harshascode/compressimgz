import type { ParsedOutput } from './types/parsed-output';

// These tags are inherent to the file/image itself and cannot/should not be stripped by ExifTool.
// Filtering them out avoids confusing users who wonder why "Remove Exif" didn't clear them.
const IGNORED_TAGS = new Set([
	'Directory',
	'FileAccessDate',
	'FileInodeChangeDate',
	'FileModifyDate',
	'FileName',
	'FilePermissions',
	'FileSize',
	'FileType',
	'FileTypeExtension',
	'MIMEType',
	'ExifToolVersion',
	'ImageHeight',
	'ImageWidth',
	'ImageSize',
	'Megapixels',
	'BitsPerSample',
	'ColorComponents',
	'ColorSpace',
	'EncodingProcess',
	'YCbCrSubSampling'
]);

function parseExifOutput(text: string): ParsedOutput {
	return text
		.split('\n')
		.filter((line) => line.includes(':'))
		.map((line) => {
			const [label, ...valueParts] = line.split(':');
			return {
				label: label.trim(),
				value: valueParts.join(':').trim()
			};
		})
		.filter((item) => !IGNORED_TAGS.has(item.label));
}

export { parseExifOutput };
