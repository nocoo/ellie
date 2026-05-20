/**
 * Resolve a user-supplied `redirect` parameter to a safe same-origin path.
 *
 * Login/register pages read `?redirect=...` from the URL and navigate to it
 * after success. Without validation, an attacker can craft
 * `/login?redirect=https://evil.example` and phish users by redirecting them
 * off-site after a real login.
 *
 * A value is considered safe when ALL of the following hold:
 *   - It is a non-empty string.
 *   - It starts with a single `/` (relative same-origin path).
 *   - It does NOT start with `//` or `/\` (protocol-relative URL — the
 *     browser would resolve those to a different host).
 *   - It contains no control characters (\x00–\x1F, \x7F) that could trip
 *     header smuggling or hidden navigations.
 *
 * Anything else (absolute URL, scheme, whitespace prefix, control chars)
 * falls back to the supplied default, which itself defaults to `/`.
 */
export function safeRedirect(raw: string | null | undefined, fallback = "/"): string {
	if (!raw || typeof raw !== "string") return fallback;
	if (raw.length === 0) return fallback;

	if (raw[0] !== "/") return fallback;
	if (raw.length >= 2 && (raw[1] === "/" || raw[1] === "\\")) return fallback;

	for (let i = 0; i < raw.length; i++) {
		const code = raw.charCodeAt(i);
		if (code < 0x20 || code === 0x7f) return fallback;
	}

	return raw;
}
