// admin-kv-fetch.ts — Tiny first-screen JSON loader used by the KV monitor page.
//
// The KV monitor page (`/admin/statistics/kv`) loads its overview / metrics
// payloads on mount. The original implementation wrapped the fetch in a bare
// try/finally, which silently turned 401/403/500/non-JSON responses into the
// "empty state" — and that "empty state" was indistinguishable from the
// legitimate case (Worker always returns the full registry, even on an empty
// KV). The page therefore looked blank with no clue why.
//
// This helper centralises the rules so overview + metrics behave identically:
//   1. fetch must succeed (network throw → propagate)
//   2. response must be 2xx (non-2xx → throw with the worker's error.code/
//      error.message envelope when present, otherwise "HTTP <status>")
//   3. body must parse as JSON (parse failure → throw "<status> 响应不是
//      合法 JSON")
//   4. body must contain a `data` field (the worker's standard envelope is
//      `{ ok: true, data: {...} }`); a missing `data` is treated as a
//      contract violation, not an empty payload
//
// Callers wrap the call in try/catch and route the thrown Error message
// through `extractErrorMessage` for display via AdminInlineMessage.

interface ErrorEnvelope {
	error?: {
		code?: string;
		message?: string;
	};
}

interface OkEnvelope<T> {
	data?: T;
}

/**
 * Fetch a JSON payload from an admin KV endpoint and return its `data` field.
 *
 * Throws an `Error` with a user-facing Chinese message when the request fails,
 * returns non-2xx, returns non-JSON, or omits the `data` envelope. Callers
 * are expected to surface the message via AdminInlineMessage / setNotice.
 */
export async function readAdminKvJson<T>(url: string): Promise<T> {
	const res = await fetch(url);

	if (!res.ok) {
		// Try to lift the worker's error envelope; fall back to the raw status.
		let detail = "";
		try {
			const body = (await res.json()) as ErrorEnvelope;
			const code = body.error?.code;
			const message = body.error?.message;
			if (code && message) detail = `${code}: ${message}`;
			else if (message) detail = message;
			else if (code) detail = code;
		} catch {
			// non-JSON error body — fall through to status-only message
		}
		const suffix = detail ? `（${detail}）` : "";
		throw new Error(`请求 ${url} 失败：HTTP ${res.status}${suffix}`);
	}

	let parsed: OkEnvelope<T>;
	try {
		parsed = (await res.json()) as OkEnvelope<T>;
	} catch {
		throw new Error(`${url} 响应不是合法 JSON`);
	}

	if (parsed.data === undefined) {
		throw new Error(`${url} 响应缺少 data 字段`);
	}

	return parsed.data;
}
