/**
 * Best-effort Web memory display invalidation for Admin-originated writes.
 *
 * After a successful relevant business mutation (see the domain path list in
 * `admin-api.ts`), Admin asks the configured Web process to clear its display
 * memory families through the existing authenticated management channel:
 * one GET for the current instance id, then ONE family-less
 * `POST {instanceId, action:"clear"}` which clears every display family and
 * never drains view/activity buffers (only `flush` does, and it is never used).
 *
 * Contract:
 *   - Best effort only: every failure is swallowed with a console.warn; a
 *     committed Worker write is never turned into an error.
 *   - INSTANCE_CONFLICT (409) is not success: one bounded retry with a fresh
 *     instance id, then warn and fall back to TTL convergence. No loops.
 *   - Reuses WEB_MEMORY_ADMIN_URL + MEMORY_CACHE_ADMIN_KEY — no new secrets.
 */

import "server-only";

import { MEMORY_CACHE_ADMIN_HEADER, MEMORY_CACHE_WEB_PATH } from "@ellie/types";

const REQUEST_TIMEOUT_MS = 2_000;
const MAX_BODY_BYTES = 131_072;
const INSTANCE_CONFLICT_STATUS = 409;

interface WebMemoryConfig {
	origin: string;
	key: string;
}

function resolveConfig(): WebMemoryConfig | null {
	const base = process.env.WEB_MEMORY_ADMIN_URL?.trim();
	const key = process.env.MEMORY_CACHE_ADMIN_KEY;
	if (!base || !key) return null;
	try {
		const url = new URL(base);
		if (
			(url.protocol !== "https:" && url.protocol !== "http:") ||
			url.username ||
			url.password ||
			url.pathname !== "/" ||
			url.search ||
			url.hash
		) {
			return null;
		}
		return { origin: url.origin, key };
	} catch {
		return null;
	}
}

async function readBoundedText(res: Response): Promise<string> {
	const reader = res.body?.getReader();
	if (!reader) return "";
	try {
		const decoder = new TextDecoder();
		let text = "";
		let received = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			received += value.byteLength;
			if (received > MAX_BODY_BYTES) throw new Error("Body exceeds size ceiling");
			text += decoder.decode(value, { stream: true });
		}
		return text + decoder.decode();
	} finally {
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}

async function fetchInstance(config: WebMemoryConfig): Promise<string> {
	const url = new URL(`${MEMORY_CACHE_WEB_PATH}?page=1&limit=1`, config.origin);
	const res = await fetch(url, {
		headers: { Accept: "application/json", [MEMORY_CACHE_ADMIN_HEADER]: config.key },
		cache: "no-store",
		redirect: "error",
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!res.ok) throw new Error(`overview responded ${res.status}`);
	const payload = (await readBoundedText(res).then((text) => JSON.parse(text))) as {
		data?: { instance?: { id?: unknown } };
	};
	const id = payload?.data?.instance?.id;
	if (typeof id !== "string" || id.length === 0) throw new Error("missing instance id");
	return id;
}

async function clearAllFamilies(config: WebMemoryConfig, instanceId: string): Promise<void> {
	const res = await fetch(new URL(MEMORY_CACHE_WEB_PATH, config.origin), {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			[MEMORY_CACHE_ADMIN_HEADER]: config.key,
		},
		body: JSON.stringify({ instanceId, action: "clear" }),
		cache: "no-store",
		redirect: "error",
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (res.status === INSTANCE_CONFLICT_STATUS) throw new InstanceConflict();
	if (!res.ok) throw new Error(`clear responded ${res.status}`);
	await res.body?.cancel().catch(() => undefined);
}

class InstanceConflict extends Error {
	constructor() {
		super("instance conflict");
	}
}

export async function notifyWebDisplayInvalidation(): Promise<void> {
	const config = resolveConfig();
	if (!config) return;
	try {
		for (let attempt = 0; attempt < 2; attempt++) {
			const instanceId = await fetchInstance(config);
			try {
				await clearAllFamilies(config, instanceId);
				return;
			} catch (error) {
				if (!(error instanceof InstanceConflict)) throw error;
			}
		}
		console.warn(
			"[web-memory-notify] instance conflict persisted; falling back to TTL convergence",
		);
	} catch (error) {
		console.warn(
			"[web-memory-notify] best-effort memory clear failed; falling back to TTL convergence",
			error,
		);
	}
}
