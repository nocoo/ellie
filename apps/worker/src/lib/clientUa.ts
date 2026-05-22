import { isServerToWorkerRequest } from "./clientIp";
import type { Env } from "./env";

/**
 * Extract the real client User-Agent from the request.
 *
 * When a request arrives via the BFF (Next.js proxy with Key A/B), the
 * actual browser UA is forwarded as `X-Real-User-Agent` because Bun's
 * fetch overwrites the standard `User-Agent` header with `Bun/<version>`.
 *
 * Priority:
 *   1. `X-Real-User-Agent` — trusted only for server-to-Worker calls.
 *   2. `User-Agent` — direct client requests (Cloudflare edge, Rust CLI).
 */
export function extractTrustedUserAgent(request: Request, env: Env): string {
	if (isServerToWorkerRequest(request, env)) {
		const realUA = request.headers.get("X-Real-User-Agent");
		if (realUA) return realUA;
	}
	return request.headers.get("User-Agent") ?? "";
}
