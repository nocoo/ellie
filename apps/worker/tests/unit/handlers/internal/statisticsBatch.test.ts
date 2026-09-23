import { STATISTICS_BATCH_MESSAGES, STATISTICS_WRITE_HEADER } from "@ellie/types";
import { describe, expect, it, vi } from "vitest";
import { statisticsBatchHandler } from "../../../../src/handlers/internal/statisticsBatch";
import { makeEnv } from "../../../helpers";

const KEY = "stats-write-key";
const now = Math.floor(Date.now() / 1000);

function db(changes: number | "throw" = 1) {
	const batch = vi.fn(async (statements: Array<{ sql: string; bindings: unknown[] }>) => {
		if (changes === "throw") throw new Error("d1 failed");
		return statements.map(() => ({ success: true, meta: { changes } }));
	});
	return {
		batch,
		prepare: (sql: string) => ({
			bind: (...bindings: unknown[]) => ({ sql, bindings }),
		}),
	};
}

function post(body: unknown, headers: Record<string, string> = {}, method = "POST") {
	return new Request("https://worker.test/api/internal/statistics/batch", {
		method,
		headers: {
			"content-type": "application/json",
			[STATISTICS_WRITE_HEADER]: KEY,
			...headers,
		},
		body: method === "GET" ? undefined : JSON.stringify(body),
	});
}

describe("statisticsBatchHandler", () => {
	it("fails closed before parsing when the key is missing or wrong", async () => {
		const missing = db();
		const unconfigured = await statisticsBatchHandler(
			post({ views: [{ threadId: 1, increment: 1 }], activities: [] }),
			makeEnv({ DB: missing as never, WEB_STATISTICS_WRITE_KEY: undefined }),
		);
		expect(unconfigured.status).toBe(503);
		expect(await unconfigured.json()).toEqual({
			error: { code: "NOT_CONFIGURED", message: STATISTICS_BATCH_MESSAGES.notConfigured },
		});

		const wrong = db();
		const denied = await statisticsBatchHandler(
			post(
				{ views: [{ threadId: 1, increment: 1 }], activities: [] },
				{ [STATISTICS_WRITE_HEADER]: "nope", "X-API-Key": "forum-key" },
			),
			makeEnv({ DB: wrong as never, WEB_STATISTICS_WRITE_KEY: KEY, API_KEY: "forum-key" }),
		);
		expect(denied.status).toBe(401);
		expect(await denied.json()).toEqual({
			error: { code: "UNAUTHORIZED", message: STATISTICS_BATCH_MESSAGES.unauthorized },
		});
		expect(wrong.batch).not.toHaveBeenCalled();
	});

	it("rejects invalid method, content type, oversized and out-of-range bodies before writes", async () => {
		const store = db();
		const env = makeEnv({ DB: store as never, WEB_STATISTICS_WRITE_KEY: KEY });
		expect((await statisticsBatchHandler(post({}, {}, "GET"), env)).status).toBe(405);
		expect(
			(
				await statisticsBatchHandler(
					post(
						{ views: [], activities: [{ userId: 1, observedAt: now }] },
						{
							"content-type": "text/plain",
						},
					),
					env,
				)
			).status,
		).toBe(400);
		expect(
			(
				await statisticsBatchHandler(
					post(
						{ views: [{ threadId: 1, increment: 1 }], activities: [] },
						{ "content-length": "999999" },
					),
					env,
				)
			).status,
		).toBe(400);
		const future = await statisticsBatchHandler(
			post({
				views: [],
				activities: [{ userId: 1, observedAt: now + 10_000 }],
			}),
			env,
		);
		expect(future.status).toBe(400);
		expect(await future.json()).toEqual({
			error: { code: "BAD_REQUEST", message: STATISTICS_BATCH_MESSAGES.observedAtOutOfRange },
		});
		expect(store.batch).not.toHaveBeenCalled();
	});

	it("cancels a streamed body that exceeds the byte ceiling without a trustworthy length", async () => {
		let cancelled = false;
		let pulls = 0;
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulls += 1;
				controller.enqueue(new Uint8Array(4096));
			},
			cancel() {
				cancelled = true;
			},
		});
		const request = new Request("https://worker.test/api/internal/statistics/batch", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				[STATISTICS_WRITE_HEADER]: KEY,
				"content-length": "16",
			},
			body: stream,
			duplex: "half",
		} as RequestInit);
		const store = db();
		const response = await statisticsBatchHandler(
			request,
			makeEnv({ DB: store as never, WEB_STATISTICS_WRITE_KEY: KEY }),
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: { code: "BAD_REQUEST", message: STATISTICS_BATCH_MESSAGES.bodyTooLarge },
		});
		expect(cancelled).toBe(true);
		expect(pulls).toBeLessThan(64);
		expect(store.batch).not.toHaveBeenCalled();
	});

	it("returns per-item confirmed, rejected, and unconfirmed results", async () => {
		const confirmed = db(1);
		const env = makeEnv({ DB: confirmed as never, WEB_STATISTICS_WRITE_KEY: KEY });
		const ok = await statisticsBatchHandler(
			post({
				views: [{ threadId: 4, increment: 2 }],
				activities: [{ userId: 9, observedAt: now }],
			}),
			env,
		);
		expect(ok.status).toBe(200);
		expect(ok.headers.get("cache-control")).toBe("no-store");
		expect(await ok.json()).toEqual({
			data: {
				views: [{ threadId: 4, increment: 2, status: "confirmed" }],
				activities: [{ userId: 9, observedAt: now, status: "confirmed" }],
			},
		});
		expect(confirmed.batch).toHaveBeenCalledTimes(2);

		const rejected = db(0);
		const missed = await statisticsBatchHandler(
			post({ views: [{ threadId: 8, increment: 1 }], activities: [] }),
			makeEnv({ DB: rejected as never, WEB_STATISTICS_WRITE_KEY: KEY }),
		);
		expect(await missed.json()).toEqual({
			data: {
				views: [{ threadId: 8, increment: 1, status: "rejected" }],
				activities: [],
			},
		});

		const uncertain = db("throw");
		const dropped = await statisticsBatchHandler(
			post({ views: [{ threadId: 3, increment: 1 }], activities: [] }),
			makeEnv({ DB: uncertain as never, WEB_STATISTICS_WRITE_KEY: KEY }),
		);
		expect(await dropped.json()).toEqual({
			data: {
				views: [{ threadId: 3, increment: 1, status: "unconfirmed" }],
				activities: [],
			},
		});
	});
});
