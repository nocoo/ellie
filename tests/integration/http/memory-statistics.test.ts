import { describe, expect, test } from "bun:test";
import type {
	ForumSummaryGate,
	ForumSummaryTopic,
	StatisticsBatchDataEnvelope,
	StatisticsBatchRequest,
} from "@ellie/types";
import { UserRole } from "@ellie/types";
import { TEST_WORKER_VARS } from "../../../scripts/lib/test-worker-vars";
import {
	adminGet,
	adminPatch,
	createTestJwt,
	getApiKeyA,
	getApiKeyB,
	getWorkerUrl,
	workerAuthFetch,
	workerFetch,
} from "../setup";

const batchUrl = () => `${getWorkerUrl()}/api/internal/statistics/batch`;

function sendBatch(body: unknown): Promise<Response> {
	return fetch(`${getWorkerUrl()}/api/internal/statistics/batch`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Ellie-Statistics-Key": TEST_WORKER_VARS.WEB_STATISTICS_WRITE_KEY,
		},
		body: JSON.stringify(body),
	});
}

async function threadViews(id: number): Promise<number> {
	const response = await workerFetch(`/api/v1/threads/${id}`);
	expect(response.status).toBe(200);
	return ((await response.json()) as { data: { views: number } }).data.views;
}

describe("L2: Next.js statistics trust boundary", () => {
	for (const method of ["GET", "PUT", "DELETE", "OPTIONS"]) {
		test(`rejects ${method} statistics requests before credential checks`, async () => {
			const response = await fetch(batchUrl(), { method });
			expect(response.status).toBe(405);
			expect(await response.json()).toMatchObject({
				error: { code: "METHOD_NOT_ALLOWED", message: "POST required" },
			});
		});
	}
	for (const credential of ["none", "forum", "admin", "wrong-secret"] as const) {
		test(`rejects statistics writes with ${credential} credentials`, async () => {
			const headers: Record<string, string> = { "Content-Type": "application/json" };
			if (credential === "forum") headers["X-API-Key"] = getApiKeyA();
			if (credential === "admin") headers["X-API-Key"] = getApiKeyB();
			if (credential === "wrong-secret") headers["X-Ellie-Statistics-Key"] = "wrong-key";
			const response = await fetch(batchUrl(), {
				method: "POST",
				headers,
				body: "{}",
			});
			expect(response.status).toBe(401);
		});
	}

	test("validates the body after accepting the dedicated secret without Key A", async () => {
		const response = await fetch(batchUrl(), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Ellie-Statistics-Key": TEST_WORKER_VARS.WEB_STATISTICS_WRITE_KEY,
			},
			body: "{",
		});
		expect(response.status).toBe(400);
	});

	test("retired today-visits reporting is no longer dispatched", async () => {
		const retiredPath = "/api/admin/analytics/today/visits";
		const response = await adminGet(retiredPath);
		expect(response.status).toBe(404);
	});

	test("direct Worker reads do not increment thread views", async () => {
		const first = await workerFetch("/api/v1/threads/662174");
		expect(first.status).toBe(200);
		const before = (await first.json()) as { data: { views: number } };
		const second = await workerFetch("/api/v1/threads/662174");
		expect(second.status).toBe(200);
		const after = (await second.json()) as { data: { views: number } };
		expect(after.data.views).toBe(before.data.views);
	});

	test("adds views and records monotonic activity with explicit rejected IDs", async () => {
		const before = await threadViews(662175);
		const observedAt = Math.floor(Date.now() / 1000);
		const body: StatisticsBatchRequest = {
			views: [
				{ threadId: 662175, increment: 7 },
				{ threadId: 99999999, increment: 1 },
			],
			activities: [
				{ userId: 3, observedAt },
				{ userId: 99999999, observedAt },
			],
		};
		const response = await sendBatch(body);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toContain("no-store");
		const result = (await response.json()) as StatisticsBatchDataEnvelope;
		expect(result.data.views).toEqual([
			{ ...body.views[0], status: "confirmed" },
			{ ...body.views[1], status: "rejected" },
		]);
		expect(result.data.activities).toEqual([
			{ ...body.activities[0], status: "confirmed" },
			{ ...body.activities[1], status: "rejected" },
		]);
		expect(await threadViews(662175)).toBe(before + 7);
		const activity = async () => {
			expect((await adminPatch("/api/admin/users/3", { gender: 0 })).status).toBe(200);
			const user = await adminGet("/api/admin/users/3");
			expect(user.status).toBe(200);
			return ((await user.json()) as { data: { lastActivity: number } }).data.lastActivity;
		};
		const recorded = await activity();
		expect(recorded).toBeGreaterThanOrEqual(observedAt);
		const older = await sendBatch({
			views: [],
			activities: [{ userId: 3, observedAt: observedAt - 60 }],
		});
		expect(older.status).toBe(200);
		expect(await activity()).toBe(recorded);
	});

	test("processes a maximum-size batch across D1 statement limits", async () => {
		const before = await threadViews(662176);
		const views = Array.from({ length: 255 }, (_, index) => ({
			threadId: 90000000 + index,
			increment: 1,
		}));
		views.push({ threadId: 662176, increment: 2 });
		const response = await sendBatch({ views, activities: [] });
		expect(response.status).toBe(200);
		const result = (await response.json()) as StatisticsBatchDataEnvelope;
		expect(result.data.views).toHaveLength(256);
		expect(result.data.views.filter((item) => item.status === "rejected")).toHaveLength(255);
		expect(result.data.views.at(-1)).toEqual({
			threadId: 662176,
			increment: 2,
			status: "confirmed",
		});
		expect(await threadViews(662176)).toBe(before + 2);
	});

	test("rejects malformed ranges, duplicates and oversized bodies before writing", async () => {
		const before = await threadViews(662177);
		const bodies = [
			{ views: [{ threadId: 662177, increment: -1 }], activities: [] },
			{ views: [{ threadId: 662177, increment: 1001 }], activities: [] },
			{
				views: [
					{ threadId: 662177, increment: 1 },
					{ threadId: 662177, increment: 1 },
				],
				activities: [],
			},
			{
				views: [{ threadId: 662177, increment: 1 }],
				activities: [{ userId: 3, observedAt: Math.floor(Date.now() / 1000) + 3600 }],
			},
			{ views: [{ threadId: 662177, increment: 1 }], activities: [{ userId: 3, observedAt: 1 }] },
		];
		for (const body of bodies) expect((await sendBatch(body)).status).toBe(400);
		const oversized = await sendBatch({ views: [], activities: [], padding: "x".repeat(65536) });
		expect(oversized.status).toBe(400);
		expect((await oversized.json()).error.message).toBe("Request body is too large");
		expect(await threadViews(662177)).toBe(before);
	});
});

describe("L2: offset pages without exact totals", () => {
	test("serves daily estimates for offset callers", async () => {
		for (const suffix of ["", "&includeTotal=true"]) {
			const response = await workerFetch(`/api/v1/threads?forumId=114&page=1&limit=5${suffix}`);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.meta).toMatchObject({ total: 25, page: 1, limit: 5, pages: 5 });
			expect(body.meta).not.toHaveProperty("hasNext");
		}
	});

	for (const [page, size, hasNext] of [
		[1, 5, true],
		[5, 5, false],
		[6, 0, false],
	] as const) {
		test(`keeps page ${page} navigable without a total`, async () => {
			const response = await workerFetch(
				`/api/v1/threads?forumId=114&page=${page}&limit=5&includeTotal=false`,
			);
			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				data: { id: number }[];
				meta: { page: number; limit: number; hasNext: boolean; total?: number; pages?: number };
			};
			expect(body.data).toHaveLength(size);
			expect(body.meta.page).toBe(page);
			expect(body.meta.limit).toBe(5);
			expect(body.meta.hasNext).toBe(hasNext);
			expect(body.meta).not.toHaveProperty("total");
			expect(body.meta).not.toHaveProperty("pages");
		});
	}

	test("composes global pins before local pages and rechecks their forum visibility", async () => {
		try {
			expect((await adminPatch("/api/admin/threads/1", { sticky: 2 })).status).toBe(200);
			const pageOne = await workerFetch(
				"/api/v1/threads?forumId=114&page=1&limit=1&includeTotal=false",
			);
			expect(pageOne.status).toBe(200);
			const pinned = await pageOne.json();
			expect(pinned.data.map((thread: { id: number }) => thread.id)).toEqual([1]);
			expect(pinned.meta.hasNext).toBe(true);
			const count = await workerFetch("/api/v1/threads/count?forumId=114");
			expect(count.status).toBe(200);
			expect((await count.json()).data).toEqual({ total: 26 });
			const typed = await workerFetch(
				"/api/v1/threads?forumId=114&typeId=999999&page=1&limit=5&includeTotal=false",
			);
			expect(typed.status).toBe(200);
			const typedBody = await typed.json();
			expect(typedBody.data).toEqual([]);
			expect(typedBody.meta.hasNext).toBe(false);
			const typedCount = await workerFetch("/api/v1/threads/count?forumId=114&typeId=999999");
			expect(typedCount.status).toBe(200);
			expect((await typedCount.json()).data).toEqual({ total: 0 });
			const pageTwo = await workerFetch(
				"/api/v1/threads?forumId=114&page=2&limit=1&includeTotal=false",
			);
			expect(pageTwo.status).toBe(200);
			const local = await pageTwo.json();
			expect(local.data.map((thread: { id: number }) => thread.id)).toEqual([662198]);
			expect(local.meta.hasNext).toBe(true);

			expect((await adminPatch("/api/admin/forums/1", { visibility: "admin" })).status).toBe(200);
			const anonymous = await workerFetch(
				"/api/v1/threads?forumId=114&page=1&limit=1&includeTotal=false",
			);
			expect(anonymous.status).toBe(200);
			const anonymousPage = await anonymous.json();
			expect(anonymousPage.data.map((thread: { id: number }) => thread.id)).toEqual([662198]);
			expect(anonymousPage.meta.hasNext).toBe(true);
			const secondAnonymous = await workerFetch(
				"/api/v1/threads?forumId=114&page=2&limit=1&includeTotal=false",
			);
			expect(secondAnonymous.status).toBe(200);
			expect(
				(await secondAnonymous.json()).data.map((thread: { id: number }) => thread.id),
			).toEqual([662197]);
			const anonymousCount = await workerFetch("/api/v1/threads/count?forumId=114");
			expect(anonymousCount.status).toBe(200);
			expect((await anonymousCount.json()).data.total).toBe(25);
			expect((await adminPatch("/api/admin/users/1", { role: UserRole.Admin })).status).toBe(200);
			const privileged = await workerAuthFetch(
				"/api/v1/threads?forumId=114&page=1&limit=1&includeTotal=false",
				await createTestJwt(1, UserRole.Admin),
			);
			expect(privileged.status).toBe(200);
			expect((await privileged.json()).data.map((thread: { id: number }) => thread.id)).toEqual([
				1,
			]);
			const regular = await workerAuthFetch(
				"/api/v1/threads?forumId=114&page=1&limit=1&includeTotal=false",
				await createTestJwt(3, UserRole.User),
			);
			expect(regular.status).toBe(200);
			expect((await regular.json()).data.map((thread: { id: number }) => thread.id)).toEqual([
				662198,
			]);
		} finally {
			expect((await adminPatch("/api/admin/users/1", { role: UserRole.SuperMod })).status).toBe(
				200,
			);
			expect((await adminPatch("/api/admin/forums/1", { visibility: "public" })).status).toBe(200);
			expect((await adminPatch("/api/admin/threads/1", { sticky: 0 })).status).toBe(200);
		}
	});
});

describe("L2: approximate counts and authoritative visibility", () => {
	test("structural forum reads omit computed counters and topic content", async () => {
		const response = await workerFetch("/api/v1/forums?view=structure");
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.meta.bucket).toBe("anon");
		expect(body.data.find((forum: { id: number }) => forum.id === 114)).toMatchObject({
			id: 114,
			name: "同济闲话",
			threads: 0,
			posts: 0,
			todayThreads: 0,
			lastThreadId: 0,
			lastThreadSubject: "",
			lastPoster: "",
			lastPosterId: 0,
			lastPostAt: 0,
		});
	});

	test("count rejects ambiguous input and missing forums", async () => {
		for (const query of [
			"",
			"forumId=0",
			"forumId=114&forumId=1",
			"forumId=114&bucket=admin",
			"forumId=114&typeId=-1",
			"forumId=114&typeId=1&typeId=2",
		]) {
			expect((await workerFetch(`/api/v1/threads/count?${query}`)).status).toBe(400);
		}
		expect((await workerFetch("/api/v1/threads/count?forumId=99999999")).status).toBe(404);
	});

	test("summaries expose topic creation and author rather than latest reply", async () => {
		const response = await workerFetch("/api/v1/forums/summaries");
		expect(response.status).toBe(200);
		const body = (await response.json()) as { data: ForumSummaryTopic[]; meta: { bucket: string } };
		expect(body.meta.bucket).toBe("anon");
		expect(body.data.find((row) => row.forumId === 114)).toMatchObject({
			topicId: 662198,
			topicSubject: "L3 精华帖 digest level 1",
			topicCreatedAt: 1700024000,
			authorId: 100,
			authorName: "e2etest",
		});
		const member = await workerAuthFetch(
			"/api/v1/forums/summaries",
			await createTestJwt(3, UserRole.User),
		);
		expect(member.status).toBe(200);
		expect((await member.json()).meta.bucket).toBe("member");
	});

	test("gates carry only current authorization fields and omit missing IDs", async () => {
		const response = await workerFetch("/api/v1/forums/summary-gates?topics=662198,99999999");
		expect(response.status).toBe(200);
		const body = (await response.json()) as { data: ForumSummaryGate[] };
		expect(body.data).toEqual([
			{
				topicId: 662198,
				forumId: 114,
				forumStatus: 1,
				visibility: "public",
				sticky: 0,
				anonymousAuthor: 0,
				authorId: 100,
			},
		]);
		for (const query of [
			"",
			"topics=0",
			"topics=1,1",
			"topics=1,",
			"topics=1&topics=2",
			"topics=1&bucket=admin",
			`topics=${Array.from({ length: 257 }, (_, i) => i + 1).join(",")}`,
		]) {
			expect((await workerFetch(`/api/v1/forums/summary-gates?${query}`)).status).toBe(400);
		}
	});

	test("count, summaries and gates immediately honor a newly restricted forum", async () => {
		try {
			expect((await adminPatch("/api/admin/forums/114", { visibility: "admin" })).status).toBe(200);
			expect((await workerFetch("/api/v1/threads/count?forumId=114")).status).toBe(403);
			expect(
				(await workerFetch("/api/v1/threads?forumId=114&page=1&includeTotal=false")).status,
			).toBe(403);
			const summaries = await workerFetch("/api/v1/forums/summaries");
			expect(summaries.status).toBe(200);
			expect(
				(await summaries.json()).data.some((row: ForumSummaryTopic) => row.forumId === 114),
			).toBe(false);
			const gates = await workerFetch("/api/v1/forums/summary-gates?topics=662198");
			expect(gates.status).toBe(200);
			expect((await gates.json()).data).toEqual([]);
			const token = await createTestJwt(1, UserRole.Admin);
			expect((await workerAuthFetch("/api/v1/threads/count?forumId=114", token)).status).toBe(403);
			expect((await adminPatch("/api/admin/users/1", { role: UserRole.Admin })).status).toBe(200);
			const allowed = await workerAuthFetch("/api/v1/threads/count?forumId=114", token);
			expect(allowed.status).toBe(200);
			expect((await allowed.json()).data.total).toBe(25);
			expect((await adminPatch("/api/admin/users/1", { role: UserRole.Admin })).status).toBe(200);
			const privileged = await workerAuthFetch("/api/v1/forums/summaries", token);
			expect(privileged.status).toBe(200);
			const body = await privileged.json();
			expect(body.meta.bucket).toBe("admin");
			expect(body.data.find((row: ForumSummaryTopic) => row.forumId === 114)?.topicId).toBe(662198);
		} finally {
			expect((await adminPatch("/api/admin/forums/114", { visibility: "public" })).status).toBe(
				200,
			);
		}
	});
});

describe("L2: daily statistics snapshot", () => {
	test("GET and POST require the dedicated server credential", async () => {
		for (const method of ["GET", "POST"]) {
			for (const headers of [
				{},
				{ "X-API-Key": getApiKeyA() },
				{ "X-API-Key": getApiKeyB() },
				{ "X-Ellie-Statistics-Key": "wrong" },
			]) {
				const result = await fetch(`${getWorkerUrl()}/api/internal/statistics/snapshot`, {
					method,
					headers,
				});
				expect(result.status).toBe(401);
			}
		}
		expect(
			(await fetch(`${getWorkerUrl()}/api/internal/statistics/snapshot`, { method: "OPTIONS" }))
				.status,
		).toBe(405);
	});
	test("explicitly refreshes, then restores a bounded snapshot without cacheable responses", async () => {
		const headers = { "X-Ellie-Statistics-Key": TEST_WORKER_VARS.WEB_STATISTICS_WRITE_KEY };
		const rebuilt = await fetch(`${getWorkerUrl()}/api/internal/statistics/snapshot`, {
			method: "POST",
			headers,
		});
		expect(rebuilt.status).toBe(200);
		const base = (await rebuilt.json()).data;
		const read = await fetch(`${getWorkerUrl()}/api/internal/statistics/snapshot`, { headers });
		expect(read.status).toBe(200);
		expect(read.headers.get("cache-control")).toBe("no-store");
		expect((await read.json()).data.version).toBe(base.version);
		expect(base.forums[114].threads).toBe(25);
	});
});
