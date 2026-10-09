import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

// Synthetic in-memory pixels only: no user uploads, files or network requests.
test('installed native image engine resizes PNG to lossless WebP with dimensions and pixels preserved', async () => {
	const input = await sharp({ create: { width: 8, height: 6, channels: 4,
		background: { r: 21, g: 32, b: 200, alpha: 1 } } }).png().toBuffer();
	const output = await sharp(input).resize(4, 3).webp({ lossless: true }).toBuffer();
	const metadata = await sharp(output).metadata();
	assert.equal(metadata.format, 'webp'); assert.equal(metadata.width, 4); assert.equal(metadata.height, 3);
	const pixels = await sharp(output).ensureAlpha().raw().toBuffer();
	assert.equal(pixels.length, 4 * 3 * 4);
	for (let offset = 0; offset < pixels.length; offset += 4)
		assert.deepEqual([...pixels.subarray(offset, offset + 4)], [21, 32, 200, 255]);
});

test('installed native image engine encodes JPEG and rejects invalid image input', async () => {
	const output = await sharp({ create: { width: 16, height: 12, channels: 3,
		background: { r: 180, g: 80, b: 40 } } }).resize(8, 6).jpeg().toBuffer();
	const metadata = await sharp(output).metadata();
	assert.equal(metadata.format, 'jpeg'); assert.equal(metadata.width, 8); assert.equal(metadata.height, 6);
	await assert.rejects(sharp(Buffer.from('synthetic-not-an-image')).metadata());
});
