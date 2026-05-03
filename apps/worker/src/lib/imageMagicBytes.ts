// Magic-byte sniffing for image uploads.
// Browsers/users can lie about Content-Type, so cross-check the first
// bytes of the file against the well-known signatures for the formats
// we accept. Pure function, no I/O — easy to unit-test.

export type SniffedImageType = "image/jpeg" | "image/png" | "image/webp" | "image/gif" | null;

/**
 * Sniff the leading bytes of an upload to determine the actual image type.
 * Returns the canonical MIME string when the signature matches a supported
 * image format, or `null` when the bytes do not match any whitelisted
 * format. The check is intentionally strict: we only return a type for
 * the formats we serve back via the post-image endpoint.
 *
 * Signatures used (per the image-format specs):
 *   JPEG:  FF D8 FF
 *   PNG:   89 50 4E 47 0D 0A 1A 0A
 *   GIF:   "GIF87a" or "GIF89a"
 *   WebP:  "RIFF" .... "WEBP"
 */
export function sniffImageType(buffer: ArrayBuffer): SniffedImageType {
	const view = new Uint8Array(buffer);

	// JPEG — at least 3 bytes
	if (view.length >= 3 && view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) {
		return "image/jpeg";
	}

	// PNG — 8-byte signature
	if (
		view.length >= 8 &&
		view[0] === 0x89 &&
		view[1] === 0x50 &&
		view[2] === 0x4e &&
		view[3] === 0x47 &&
		view[4] === 0x0d &&
		view[5] === 0x0a &&
		view[6] === 0x1a &&
		view[7] === 0x0a
	) {
		return "image/png";
	}

	// GIF — "GIF87a" or "GIF89a"
	if (
		view.length >= 6 &&
		view[0] === 0x47 &&
		view[1] === 0x49 &&
		view[2] === 0x46 &&
		view[3] === 0x38 &&
		(view[4] === 0x37 || view[4] === 0x39) &&
		view[5] === 0x61
	) {
		return "image/gif";
	}

	// WebP — "RIFF" + 4 size bytes + "WEBP"
	if (
		view.length >= 12 &&
		view[0] === 0x52 &&
		view[1] === 0x49 &&
		view[2] === 0x46 &&
		view[3] === 0x46 &&
		view[8] === 0x57 &&
		view[9] === 0x45 &&
		view[10] === 0x42 &&
		view[11] === 0x50
	) {
		return "image/webp";
	}

	return null;
}
