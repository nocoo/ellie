export const DEFAULT_CAP_API_ENDPOINT = "/api/v1/cap/";

export function resolveCapApiEndpoint(envValue?: string): string {
	const raw = (envValue ?? process.env.NEXT_PUBLIC_CAP_API_ENDPOINT ?? "").trim();
	if (!raw) return DEFAULT_CAP_API_ENDPOINT;
	return raw.endsWith("/") ? raw : `${raw}/`;
}
