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

// Tags to prioritize, in order of importance
const IMPORTANT_TAGS = [
	'Make',
	'Model',
	'Software',
	'DateTimeOriginal',
	'CreateDate',
	'ModifyDate',
	'GPSLatitude',
	'GPSLongitude',
	'GPSAltitude',
	'GPSPosition',
	'Orientation',
	'FNumber',
	'ExposureTime',
	'ISO',
	'FocalLength',
	'Flash',
	'LensModel',
	'LensMake'
];

function getTagWeight(tag: string): number {
	const index = IMPORTANT_TAGS.indexOf(tag);
	return index === -1 ? IMPORTANT_TAGS.length : index;
}

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
		.filter((item) => !IGNORED_TAGS.has(item.label))
		.sort((a, b) => {
			const weightA = getTagWeight(a.label);
			const weightB = getTagWeight(b.label);
			
			if (weightA !== weightB) {
				return weightA - weightB; // Lower weight (more important) comes first
			}
			// If weights are equal (both not in the priority list, or same), sort alphabetically
			return a.label.localeCompare(b.label);
		});
}

export { parseExifOutput };
