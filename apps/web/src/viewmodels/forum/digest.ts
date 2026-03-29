// viewmodels/forum/digest.ts — Digest page pure logic
// Ref: 04d §Digest — digest list helpers

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Digest levels mapping to display labels. */
export function digestLabel(digest: number): string {
	switch (digest) {
		case 1:
			return "精华";
		case 2:
			return "精华 II";
		case 3:
			return "精华 III";
		default:
			return "";
	}
}
