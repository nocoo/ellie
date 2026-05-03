/**
 * URL sanitization for the post-editor's link popover (and any future
 * caller that takes a user-supplied URL and writes it into HTML).
 *
 * Browsers will navigate to `javascript:` / `vbscript:` / `data:` URLs
 * inside an `<a href>`, which is an XSS sink. Our editor lets users
 * paste an arbitrary URL into the link popover, so we must reject these
 * schemes before handing the value to Tiptap's `setLink`.
 *
 * Rules:
 *   - Trim whitespace; reject empty.
 *   - Strip control characters that browsers tolerate but that can hide
 *     a dangerous scheme from a naive scheme check.
 *   - Lower-case the scheme prefix and reject the dangerous list.
 *   - Allow only `http:` / `https:` / `mailto:` / `tel:` plus
 *     protocol-relative `//host/...` and same-page anchor `#frag`.
 *   - For schemeless inputs that look like a host (e.g. `example.com`
 *     or `example.com/path`), prepend `https://`.
 *
 * Pure function: no DOM, no fetch, no React. Easy to unit-test.
 */

const DANGEROUS_SCHEMES = new Set(["javascript", "data", "vbscript", "file"]);
const ALLOWED_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

// Strip ASCII control characters. Browsers will happily ignore tab,
// newline, etc. inside a scheme prefix when matching `javascript:`,
// so we have to remove them before scheme detection.
function stripControl(input: string): string {
	let out = "";
	for (const ch of input) {
		const code = ch.charCodeAt(0);
		if (code >= 0x20 && code !== 0x7f) out += ch;
	}
	return out;
}

export interface SanitizeUrlResult {
	/** Cleaned URL safe to write into `<a href>`, or `null` if rejected. */
	url: string | null;
}

/**
 * Sanitize a user-supplied URL for use in an `<a href>`.
 *
 * Returns `{ url: null }` if the input is empty, control-character
 * spam, or uses a dangerous scheme. Otherwise returns the cleaned URL
 * (possibly with `https://` prepended for schemeless host-like input).
 */
export function sanitizeUrl(raw: unknown): SanitizeUrlResult {
	if (typeof raw !== "string") return { url: null };

	const trimmed = stripControl(raw).trim();
	if (trimmed.length === 0) return { url: null };

	// Same-page anchor — safe.
	if (trimmed.startsWith("#")) return { url: trimmed };

	// Protocol-relative — treat as same scheme as page; safe.
	if (trimmed.startsWith("//")) return { url: trimmed };

	// Look for a scheme prefix `name:` — case-insensitive.
	const colonIdx = trimmed.indexOf(":");
	if (colonIdx > 0) {
		const scheme = trimmed.slice(0, colonIdx).toLowerCase();
		// Schemes are ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ).
		// Only treat the prefix as a scheme if it matches that shape;
		// otherwise it's probably a path with a `:` in it (e.g.
		// `port:8080/foo`), which we'll route into the schemeless branch.
		if (/^[a-z][a-z0-9+\-.]*$/.test(scheme)) {
			if (DANGEROUS_SCHEMES.has(scheme)) return { url: null };
			if (!ALLOWED_SCHEMES.has(scheme)) return { url: null };
			return { url: `${scheme}:${trimmed.slice(colonIdx + 1)}` };
		}
	}

	// Schemeless. Reject obviously bad shapes; otherwise default to https.
	if (trimmed.includes(" ")) return { url: null };
	return { url: `https://${trimmed}` };
}
