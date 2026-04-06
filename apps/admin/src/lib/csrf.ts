/**
 * CSRF protection utilities.
 *
 * Validates Origin/Referer headers against allowed origins.
 */

// ---------------------------------------------------------------------------
// Origin validation
// ---------------------------------------------------------------------------

/**
 * Get the list of allowed origins for CSRF validation.
 * Includes production site and localhost development.
 */
export function getAllowedOrigins(): string[] {
	return [process.env.AUTH_URL, "http://localhost:7032", "http://localhost:3000"].filter(
		Boolean,
	) as string[];
}

/**
 * Extract the origin tuple (scheme + host + port) from a URL string.
 * Returns null if the URL is invalid.
 */
function extractOrigin(urlStr: string): string | null {
	try {
		const url = new URL(urlStr);
		return url.origin;
	} catch {
		return null;
	}
}

/**
 * Validate that the request Origin/Referer matches an allowed origin.
 * Uses exact origin tuple comparison (scheme + host + port) to prevent
 * prefix-based attacks (e.g. "https://ellie.nocoo.cloud.evil.com").
 *
 * @param request - Incoming request (Next.js Request or standard Request)
 * @returns true if origin is allowed, false otherwise
 */
export function validateOrigin(request: Request): boolean {
	const raw = request.headers.get("Origin") || request.headers.get("Referer");
	if (!raw) return false;
	const origin = extractOrigin(raw);
	if (!origin) return false;
	return getAllowedOrigins().some((allowed) => {
		const allowedOrigin = extractOrigin(allowed);
		return allowedOrigin !== null && origin === allowedOrigin;
	});
}

/**
 * Check if CSRF validation should be applied to this request method.
 * GET and HEAD are safe methods that don't need CSRF protection.
 */
export function isMutatingMethod(method: string): boolean {
	return method !== "GET" && method !== "HEAD";
}
