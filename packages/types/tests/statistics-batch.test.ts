import {
	isStatisticsWriteStatus,
	observedAtInRange,
	parseStatisticsBatchRequest,
	parseStatisticsBatchResult,
	STATISTICS_BATCH_HTTP_STATUS,
	STATISTICS_BATCH_MAX_ACTIVITIES,
	STATISTICS_BATCH_MAX_VIEWS,
	STATISTICS_BATCH_MESSAGES,
	STATISTICS_BATCH_PATH,
	STATISTICS_OBSERVED_AT_FUTURE_SKEW_SECONDS,
	STATISTICS_OBSERVED_AT_MAX_AGE_SECONDS,
	STATISTICS_VIEW_INCREMENT_MAX,
	STATISTICS_WRITE_HEADER,
	statisticsBatchError,
	statisticsBatchErrorEnvelope,
} from "@ellie/types";
import { describe, expect, it } from "vitest";

const now = 1_700_000_000;

function request(overrides: Record<string, unknown> = {}) {
	return {
		views: [{ threadId: 4, increment: 1 }],
		activities: [{ userId: 9, observedAt: now }],
		...overrides,
	};
}

describe("statistics batch contract", () => {
	it("freezes the real-HTTP path, header, and statuses", () => {
		expect(STATISTICS_BATCH_PATH).toBe("/api/internal/statistics/batch");
		expect(STATISTICS_WRITE_HEADER).toBe("X-Ellie-Statistics-Key");
		expect(STATISTICS_BATCH_HTTP_STATUS).toEqual({
			BAD_REQUEST: 400,
			UNAUTHORIZED: 401,
			METHOD_NOT_ALLOWED: 405,
			NOT_CONFIGURED: 503,
		});
		expect(isStatisticsWriteStatus("confirmed")).toBe(true);
		expect(isStatisticsWriteStatus("rejected")).toBe(true);
		expect(isStatisticsWriteStatus("unconfirmed")).toBe(true);
		expect(isStatisticsWriteStatus("lost")).toBe(false);
		expect(statisticsBatchError("UNAUTHORIZED", STATISTICS_BATCH_MESSAGES.unauthorized)).toEqual({
			code: "UNAUTHORIZED",
			message: "Unauthorized",
		});
		expect(
			statisticsBatchErrorEnvelope("NOT_CONFIGURED", STATISTICS_BATCH_MESSAGES.notConfigured),
		).toEqual({
			error: { code: "NOT_CONFIGURED", message: STATISTICS_BATCH_MESSAGES.notConfigured },
		});
	});
});

describe("parseStatisticsBatchRequest", () => {
	it("accepts a mixed batch and either array alone", () => {
		expect(parseStatisticsBatchRequest(request())).toEqual({
			ok: true,
			value: {
				views: [{ threadId: 4, increment: 1 }],
				activities: [{ userId: 9, observedAt: now }],
			},
		});
		expect(parseStatisticsBatchRequest(request({ activities: [] })).ok).toBe(true);
		expect(parseStatisticsBatchRequest(request({ views: [] })).ok).toBe(true);
		expect(parseStatisticsBatchRequest(Object.assign(Object.create(null), request())).ok).toBe(
			true,
		);
	});

	it("rejects shape, duplicates, and bounds before any write", () => {
		expect(parseStatisticsBatchRequest(null)).toMatchObject({
			error: { message: STATISTICS_BATCH_MESSAGES.invalidBody },
		});
		expect(parseStatisticsBatchRequest([])).toMatchObject({
			error: { message: STATISTICS_BATCH_MESSAGES.invalidBody },
		});
		expect(parseStatisticsBatchRequest({ views: [] })).toMatchObject({
			error: { message: STATISTICS_BATCH_MESSAGES.unknownField },
		});
		expect(parseStatisticsBatchRequest(request({ extra: 1 }))).toMatchObject({
			error: { message: STATISTICS_BATCH_MESSAGES.unknownField },
		});
		expect(parseStatisticsBatchRequest(request({ views: {} }))).toMatchObject({
			error: { message: STATISTICS_BATCH_MESSAGES.invalidViews },
		});
		expect(parseStatisticsBatchRequest(request({ activities: {} }))).toMatchObject({
			error: { message: STATISTICS_BATCH_MESSAGES.invalidActivities },
		});
		expect(parseStatisticsBatchRequest({ views: [], activities: [] })).toMatchObject({
			error: { message: STATISTICS_BATCH_MESSAGES.emptyBatch },
		});
		expect(
			parseStatisticsBatchRequest({
				views: Array.from({ length: STATISTICS_BATCH_MAX_VIEWS + 1 }, (_, i) => ({
					threadId: i + 1,
					increment: 1,
				})),
				activities: [],
			}),
		).toMatchObject({ error: { message: STATISTICS_BATCH_MESSAGES.invalidViews } });
		expect(
			parseStatisticsBatchRequest({
				views: [],
				activities: Array.from({ length: STATISTICS_BATCH_MAX_ACTIVITIES + 1 }, (_, i) => ({
					userId: i + 1,
					observedAt: now,
				})),
			}),
		).toMatchObject({ error: { message: STATISTICS_BATCH_MESSAGES.invalidActivities } });
		expect(
			parseStatisticsBatchRequest(
				request({
					views: [
						{ threadId: 1, increment: 1 },
						{ threadId: 1, increment: 2 },
					],
				}),
			),
		).toMatchObject({ error: { message: STATISTICS_BATCH_MESSAGES.duplicateThread } });
		expect(
			parseStatisticsBatchRequest(
				request({
					activities: [
						{ userId: 3, observedAt: now },
						{ userId: 3, observedAt: now },
					],
				}),
			),
		).toMatchObject({ error: { message: STATISTICS_BATCH_MESSAGES.duplicateUser } });
		expect(parseStatisticsBatchRequest(request({ views: [{ increment: 1 }] }))).toMatchObject({
			error: { message: STATISTICS_BATCH_MESSAGES.invalidViews },
		});
		expect(
			parseStatisticsBatchRequest(request({ views: [{ threadId: "1", increment: 1 }] })),
		).toMatchObject({
			error: { message: STATISTICS_BATCH_MESSAGES.invalidThreadId },
		});
		expect(
			parseStatisticsBatchRequest(request({ views: [{ threadId: 0, increment: 1 }] })),
		).toMatchObject({
			error: { message: STATISTICS_BATCH_MESSAGES.invalidThreadId },
		});
		expect(
			parseStatisticsBatchRequest(request({ views: [{ threadId: 1, increment: 1, extra: true }] })),
		).toMatchObject({ error: { message: STATISTICS_BATCH_MESSAGES.invalidViews } });
		expect(
			parseStatisticsBatchRequest(request({ views: [{ threadId: 1.5, increment: 1 }] })),
		).toMatchObject({ error: { message: STATISTICS_BATCH_MESSAGES.invalidThreadId } });
		expect(
			parseStatisticsBatchRequest(request({ views: [{ threadId: 1, increment: "1" }] })),
		).toMatchObject({
			error: { message: STATISTICS_BATCH_MESSAGES.invalidIncrement },
		});
		expect(
			parseStatisticsBatchRequest(request({ views: [{ threadId: 1, increment: 0 }] })),
		).toMatchObject({
			error: { message: STATISTICS_BATCH_MESSAGES.invalidIncrement },
		});
		expect(
			parseStatisticsBatchRequest(
				request({ views: [{ threadId: 1, increment: STATISTICS_VIEW_INCREMENT_MAX + 1 }] }),
			),
		).toMatchObject({ error: { message: STATISTICS_BATCH_MESSAGES.invalidIncrement } });
		expect(
			parseStatisticsBatchRequest(request({ activities: [{ observedAt: now }] })),
		).toMatchObject({ error: { message: STATISTICS_BATCH_MESSAGES.invalidActivities } });
		expect(
			parseStatisticsBatchRequest(request({ activities: [{ userId: "2", observedAt: now }] })),
		).toMatchObject({ error: { message: STATISTICS_BATCH_MESSAGES.invalidUserId } });
		expect(
			parseStatisticsBatchRequest(request({ activities: [{ userId: 0, observedAt: now }] })),
		).toMatchObject({ error: { message: STATISTICS_BATCH_MESSAGES.invalidUserId } });
		expect(
			parseStatisticsBatchRequest(request({ activities: [{ userId: 2, observedAt: "1" }] })),
		).toMatchObject({ error: { message: STATISTICS_BATCH_MESSAGES.invalidObservedAt } });
		expect(
			parseStatisticsBatchRequest(
				request({ activities: [{ userId: 2, observedAt: now, extra: true }] }),
			),
		).toMatchObject({ error: { message: STATISTICS_BATCH_MESSAGES.invalidActivities } });
		expect(
			parseStatisticsBatchRequest(request({ activities: [{ userId: 2, observedAt: 1.2 }] })),
		).toMatchObject({ error: { message: STATISTICS_BATCH_MESSAGES.invalidObservedAt } });
	});
});

describe("observedAtInRange", () => {
	it("accepts the inclusive skew window and rejects outside it", () => {
		expect(observedAtInRange(now - STATISTICS_OBSERVED_AT_MAX_AGE_SECONDS, now)).toBe(true);
		expect(observedAtInRange(now + STATISTICS_OBSERVED_AT_FUTURE_SKEW_SECONDS, now)).toBe(true);
		expect(observedAtInRange(now - STATISTICS_OBSERVED_AT_MAX_AGE_SECONDS - 1, now)).toBe(false);
		expect(observedAtInRange(now + STATISTICS_OBSERVED_AT_FUTURE_SKEW_SECONDS + 1, now)).toBe(
			false,
		);
	});
});

describe("parseStatisticsBatchResult", () => {
	it("accepts explicit per-item accounting and rejects a partial envelope", () => {
		expect(
			parseStatisticsBatchResult({
				data: {
					views: [{ threadId: 4, increment: 1, status: "confirmed" }],
					activities: [{ userId: 9, observedAt: now, status: "rejected" }],
				},
			}),
		).toEqual({
			ok: true,
			value: {
				views: [{ threadId: 4, increment: 1, status: "confirmed" }],
				activities: [{ userId: 9, observedAt: now, status: "rejected" }],
			},
		});
		expect(parseStatisticsBatchResult(null)).toMatchObject({
			error: { message: STATISTICS_BATCH_MESSAGES.invalidResult },
		});
		expect(parseStatisticsBatchResult({ data: null })).toMatchObject({
			error: { message: STATISTICS_BATCH_MESSAGES.invalidResult },
		});
		expect(parseStatisticsBatchResult({ views: [] })).toMatchObject({
			error: { message: STATISTICS_BATCH_MESSAGES.invalidResult },
		});
		expect(parseStatisticsBatchResult({ data: { views: [] } })).toMatchObject({
			error: { message: STATISTICS_BATCH_MESSAGES.invalidResult },
		});
		expect(parseStatisticsBatchResult({ data: { views: {}, activities: [] } })).toMatchObject({
			error: { message: STATISTICS_BATCH_MESSAGES.invalidResult },
		});
		expect(
			parseStatisticsBatchResult({
				data: { views: [{ threadId: 1, increment: 1 }], activities: [] },
			}),
		).toMatchObject({ error: { message: STATISTICS_BATCH_MESSAGES.invalidResult } });
		expect(
			parseStatisticsBatchResult({
				data: {
					views: [{ threadId: 1, increment: 1, status: 1 }],
					activities: [],
				},
			}),
		).toMatchObject({ error: { message: STATISTICS_BATCH_MESSAGES.invalidResult } });
		expect(
			parseStatisticsBatchResult({
				data: {
					views: [{ threadId: 1, increment: 1, status: "lost" }],
					activities: [],
				},
			}),
		).toMatchObject({ error: { message: STATISTICS_BATCH_MESSAGES.invalidResult } });
		expect(
			parseStatisticsBatchResult({
				data: {
					views: [],
					activities: [{ userId: 1, observedAt: now }],
				},
			}),
		).toMatchObject({ error: { message: STATISTICS_BATCH_MESSAGES.invalidResult } });
		expect(
			parseStatisticsBatchResult({
				data: {
					views: [],
					activities: [{ userId: 1, observedAt: now, status: 1 }],
				},
			}),
		).toMatchObject({ error: { message: STATISTICS_BATCH_MESSAGES.invalidResult } });
		expect(
			parseStatisticsBatchResult({
				data: {
					views: [],
					activities: [{ userId: 1, observedAt: now, status: "maybe" }],
				},
			}),
		).toMatchObject({ error: { message: STATISTICS_BATCH_MESSAGES.invalidResult } });
		expect(
			parseStatisticsBatchResult({
				data: {
					views: [{ threadId: 1, increment: 0, status: "confirmed" }],
					activities: [],
				},
			}),
		).toMatchObject({ error: { message: STATISTICS_BATCH_MESSAGES.invalidResult } });
		expect(
			parseStatisticsBatchResult({
				data: {
					views: [{ threadId: 0, increment: 1, status: "confirmed" }],
					activities: [],
				},
			}),
		).toMatchObject({ error: { message: STATISTICS_BATCH_MESSAGES.invalidResult } });
		expect(
			parseStatisticsBatchResult({
				data: {
					views: [],
					activities: [{ userId: 1, observedAt: 1.5, status: "unconfirmed" }],
				},
			}),
		).toMatchObject({ error: { message: STATISTICS_BATCH_MESSAGES.invalidResult } });
		expect(
			parseStatisticsBatchResult({
				data: {
					views: [],
					activities: [{ userId: 0, observedAt: now, status: "confirmed" }],
				},
			}),
		).toMatchObject({ error: { message: STATISTICS_BATCH_MESSAGES.invalidResult } });
	});
});
