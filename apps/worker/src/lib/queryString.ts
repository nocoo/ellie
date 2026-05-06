/**
 * Tiny query-string reader used on hot list paths to avoid
 * `new URL(request.url).searchParams.get(key)` (which constructs a full URL +
 * URLSearchParams just to read a couple of values).
 *
 * Behaviour matches `URLSearchParams.get` for the inputs our list endpoints
 * actually receive (single-occurrence keys with `=value`, percent-encoded
 * values). Diverges from URLSearchParams only for malformed shapes:
 *   - `?key` (no `=` and no value) returns `null` here, `""` from
 *     URLSearchParams. Not a shape any of our public endpoints accept.
 *   - Repeated keys: returns the FIRST occurrence (matches URLSearchParams.get).
 *
 * Validated by the unit test in `apps/worker/tests/unit/lib/queryString.test.ts`.
 */
export function getQueryParam(url: string, key: string): string | null {
	const qIdx = url.indexOf("?");
	if (qIdx < 0) return null;

	const len = url.length;
	const keyLen = key.length;
	let i = qIdx + 1;

	while (i < len) {
		// Match `key=` exactly at position i.
		if (i + keyLen < len && url.charCodeAt(i + keyLen) === 61 /* '=' */ && url.startsWith(key, i)) {
			const start = i + keyLen + 1;
			let end = url.indexOf("&", start);
			if (end < 0) end = len;
			const slice = url.slice(start, end);
			// Skip decodeURIComponent for the common no-percent path.
			return slice.indexOf("%") < 0 && slice.indexOf("+") < 0
				? slice
				: decodeURIComponent(slice.replace(/\+/g, " "));
		}
		const next = url.indexOf("&", i);
		if (next < 0) return null;
		i = next + 1;
	}
	return null;
}
