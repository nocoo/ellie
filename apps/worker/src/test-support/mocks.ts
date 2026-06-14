/**
 * test-support/mocks — vitest-free in-memory KV / R2 mocks for L2-fast.
 *
 * The legacy `apps/worker/tests/helpers.ts` mocks wrap each method in
 * `vi.fn(...)` for vitest spies. L2-fast runs under `bun:test`, where
 * `vi` is unavailable. Tests under `tests/integration/fast/` import
 * these plain-function versions; everything spy-related stays inside
 * the vitest-flavored helpers.
 *
 * Storage shape and method semantics intentionally mirror the legacy
 * helpers so an L2-fast spec migrated from the L1 mock pool only loses
 * the `.mock.calls` introspection — the runtime behavior is identical.
 */

/** Minimal subset of KVNamespace used by Ellie handlers. */
export function createMockKV(initialData: Record<string, string> = {}): KVNamespace {
	const store = new Map<string, string>(Object.entries(initialData));

	const get = async (key: string, type?: "text" | "json" | "arrayBuffer" | "stream") => {
		const raw = store.get(key) ?? null;
		if (raw === null) return null;
		if (type === "json") {
			try {
				return JSON.parse(raw);
			} catch {
				return null;
			}
		}
		return raw;
	};

	const put = async (
		key: string,
		value: string,
		_options?: KVNamespacePutOptions,
	): Promise<void> => {
		store.set(key, typeof value === "string" ? value : String(value));
	};

	const del = async (key: string): Promise<void> => {
		store.delete(key);
	};

	const getWithMetadata = async (key: string) => ({
		value: store.get(key) ?? null,
		metadata: null,
		cacheStatus: null,
	});

	const list = async (opts: { prefix?: string; cursor?: string; limit?: number } = {}) => {
		const prefix = opts.prefix ?? "";
		const limit = opts.limit ?? 1000;
		const all = Array.from(store.keys())
			.filter((k) => k.startsWith(prefix))
			.sort();
		const startIdx = opts.cursor
			? Math.max(
					0,
					all.findIndex((k) => k > (opts.cursor as string)),
				)
			: 0;
		const slice = all.slice(startIdx, startIdx + limit);
		const list_complete = startIdx + slice.length >= all.length;
		return {
			keys: slice.map((name) => ({ name, expiration: undefined })),
			list_complete,
			cursor: list_complete ? "" : slice[slice.length - 1],
		};
	};

	return { get, put, delete: del, getWithMetadata, list } as unknown as KVNamespace;
}

/** Minimal subset of R2Bucket used by Ellie handlers (put/get/delete only). */
export function createMockR2(config?: {
	putError?: Error;
	objects?: Map<string, ArrayBuffer>;
}): R2Bucket & {
	_putCalls: Array<{
		key: string;
		body: ArrayBuffer;
		options?: { httpMetadata?: { contentType?: string } };
	}>;
} {
	const store = config?.objects ?? new Map<string, ArrayBuffer>();
	const metaStore = new Map<string, { httpMetadata?: { contentType?: string } }>();
	const putCalls: Array<{
		key: string;
		body: ArrayBuffer;
		options?: { httpMetadata?: { contentType?: string } };
	}> = [];

	const put = async (
		key: string,
		body: ArrayBuffer | ReadableStream | string,
		options?: { httpMetadata?: { contentType?: string } },
	) => {
		if (config?.putError) throw config.putError;
		const buffer =
			body instanceof ArrayBuffer ? body : new TextEncoder().encode(body as string).buffer;
		store.set(key, buffer as ArrayBuffer);
		if (options) metaStore.set(key, options);
		putCalls.push({ key, body: buffer as ArrayBuffer, options });
		return { key, size: (buffer as ArrayBuffer).byteLength };
	};

	const get = async (key: string) => {
		const data = store.get(key);
		if (!data) return null;
		const meta = metaStore.get(key);
		return {
			body: new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array(data));
					controller.close();
				},
			}),
			arrayBuffer: async () => data,
			httpMetadata: meta?.httpMetadata,
		};
	};

	const del = async (key: string): Promise<void> => {
		store.delete(key);
	};

	return {
		put,
		get,
		delete: del,
		_putCalls: putCalls,
	} as unknown as R2Bucket & { _putCalls: typeof putCalls };
}
