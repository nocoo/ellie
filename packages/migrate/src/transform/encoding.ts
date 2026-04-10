/**
 * Encoding detection and repair.
 *
 * Per docs/03-migration.md encoding section:
 * - Discuz X3.4 defaults to UTF-8, but historical data may contain GBK
 * - mysqldump declares SET NAMES utf8mb4, so most data should be valid UTF-8
 * - Detect invalid UTF-8 sequences and attempt GBK→UTF-8 re-decode
 */

/**
 * Check if a string contains likely mojibake (GBK bytes misread as UTF-8).
 * Returns true if the string appears to have encoding issues.
 */
export function hasEncodingIssue(text: string): boolean {
	if (!text) return false;

	// Check for common mojibake patterns:
	// GBK double-byte chars misread as Latin1/UTF-8 produce sequences like Ã©, Â®, etc.
	// Also check for replacement character U+FFFD
	if (text.includes("\uFFFD")) return true;

	// Check for invalid byte sequences that survived as weird characters
	// GBK bytes in 0x80-0xFF range, when misread as Latin1, produce chars in U+0080-U+00FF
	const suspiciousCount = countSuspiciousChars(text);
	const totalChars = text.length;

	// If >20% of characters are in the suspicious Latin1 range, likely encoding issue
	return totalChars > 0 && suspiciousCount / totalChars > 0.2;
}

/** Count characters in the Latin1 supplement range (U+0080–U+00FF), common mojibake indicator. */
function countSuspiciousChars(text: string): number {
	let count = 0;
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code >= 0x80 && code <= 0xff) count++;
	}
	return count;
}

/**
 * Attempt to repair GBK-encoded text that was incorrectly decoded as Latin1/ISO-8859-1.
 *
 * Strategy: re-encode as Latin1 bytes, then decode as GBK.
 * This only works if the original corruption was Latin1→UTF-8 misread of GBK bytes.
 */
export function tryRepairGbk(text: string): string | null {
	try {
		// Convert string back to Latin1 bytes
		const bytes = new Uint8Array(text.length);
		for (let i = 0; i < text.length; i++) {
			const code = text.charCodeAt(i);
			if (code > 0xff) return null; // Contains non-Latin1 chars, can't be GBK mojibake
			bytes[i] = code;
		}

		// Try to decode as GBK
		// biome-ignore lint/suspicious/noExplicitAny: TextDecoder accepts 'gbk' at runtime but TS types don't include it
		const decoder = new TextDecoder("gbk" as any, { fatal: true });
		const repaired = decoder.decode(bytes);

		// Verify the result looks like valid CJK text
		if (hasCjkChars(repaired)) {
			return repaired;
		}

		return null;
	} catch {
		return null;
	}
}

/** Check if text contains CJK unified ideographs (U+4E00–U+9FFF). */
export function hasCjkChars(text: string): boolean {
	return /[\u4e00-\u9fff]/.test(text);
}

/**
 * Validate and optionally repair text encoding.
 * Returns the text as-is if valid, or repaired text if fixable.
 *
 * @returns Object with cleaned text and whether repair was attempted
 */
export function validateEncoding(text: string): { text: string; repaired: boolean } {
	if (!text || !hasEncodingIssue(text)) {
		return { text, repaired: false };
	}

	const repaired = tryRepairGbk(text);
	if (repaired !== null) {
		return { text: repaired, repaired: true };
	}

	// Could not repair — return original
	return { text, repaired: false };
}
