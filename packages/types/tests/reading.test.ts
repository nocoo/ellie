import {
	FORUM_SUMMARIES_PATH,
	FORUM_SUMMARY_GATES_PATH,
	isReadingBucket,
	parseIncludeTotal,
	parseSummaryGateQuery,
	parseThreadCountQuery,
	READING_MESSAGES,
	READING_TOPIC_GATE_MAX,
	THREAD_COUNT_PATH,
} from "@ellie/types";
import { describe, expect, it } from "vitest";

describe("reading route contract", () => {
	it("freezes the real-HTTP paths and buckets", () => {
		expect(THREAD_COUNT_PATH).toBe("/api/v1/threads/count");
		expect(FORUM_SUMMARIES_PATH).toBe("/api/v1/forums/summaries");
		expect(FORUM_SUMMARY_GATES_PATH).toBe("/api/v1/forums/summary-gates");
		expect(isReadingBucket("anon")).toBe(true);
		expect(isReadingBucket("member")).toBe(true);
		expect(isReadingBucket("staff")).toBe(true);
		expect(isReadingBucket("admin")).toBe(true);
		expect(isReadingBucket("public")).toBe(false);
	});
});

describe("parseThreadCountQuery", () => {
	it("accepts forumId and optional typeId", () => {
		expect(parseThreadCountQuery(new URLSearchParams({ forumId: "3" }))).toEqual({
			ok: true,
			value: { forumId: 3 },
		});
		expect(parseThreadCountQuery(new URLSearchParams({ forumId: "3", typeId: "8" }))).toEqual({
			ok: true,
			value: { forumId: 3, typeId: 8 },
		});
	});

	it("rejects unknown, repeated, and invalid ids", () => {
		expect(parseThreadCountQuery(new URLSearchParams({ bucket: "admin" }))).toMatchObject({
			message: READING_MESSAGES.unknownQuery,
		});
		const repeated = new URLSearchParams();
		repeated.append("forumId", "1");
		repeated.append("forumId", "2");
		expect(parseThreadCountQuery(repeated)).toMatchObject({
			message: READING_MESSAGES.repeatedQuery,
		});
		expect(parseThreadCountQuery(new URLSearchParams())).toMatchObject({
			message: READING_MESSAGES.invalidForumId,
		});
		expect(parseThreadCountQuery(new URLSearchParams({ forumId: "0" }))).toMatchObject({
			message: READING_MESSAGES.invalidForumId,
		});
		expect(parseThreadCountQuery(new URLSearchParams({ forumId: "9".repeat(20) }))).toMatchObject({
			message: READING_MESSAGES.invalidForumId,
		});
		expect(parseThreadCountQuery(new URLSearchParams({ forumId: "1", typeId: "0" }))).toMatchObject(
			{ message: READING_MESSAGES.invalidTypeId },
		);
	});
});

describe("parseIncludeTotal", () => {
	it("treats omission and true as included, and only the exact false token as excluded", () => {
		expect(parseIncludeTotal(null)).toEqual({ ok: true, value: true });
		expect(parseIncludeTotal("true")).toEqual({ ok: true, value: true });
		expect(parseIncludeTotal("false")).toEqual({ ok: true, value: false });
		expect(parseIncludeTotal("0")).toMatchObject({ message: READING_MESSAGES.invalidIncludeTotal });
	});
});

describe("parseSummaryGateQuery", () => {
	it("accepts a bounded unique topic list", () => {
		expect(parseSummaryGateQuery(new URLSearchParams({ topics: "4,9" }))).toEqual({
			ok: true,
			value: { topicIds: [4, 9] },
		});
	});

	it("rejects malformed topic lists", () => {
		expect(parseSummaryGateQuery(new URLSearchParams({ forumId: "1" }))).toMatchObject({
			message: READING_MESSAGES.unknownQuery,
		});
		const repeated = new URLSearchParams();
		repeated.append("topics", "1");
		repeated.append("topics", "2");
		expect(parseSummaryGateQuery(repeated)).toMatchObject({
			message: READING_MESSAGES.repeatedQuery,
		});
		expect(parseSummaryGateQuery(new URLSearchParams())).toMatchObject({
			message: READING_MESSAGES.invalidTopics,
		});
		expect(parseSummaryGateQuery(new URLSearchParams({ topics: "1,0" }))).toMatchObject({
			message: READING_MESSAGES.invalidTopics,
		});
		expect(parseSummaryGateQuery(new URLSearchParams({ topics: "1,1" }))).toMatchObject({
			message: READING_MESSAGES.duplicateTopic,
		});
		expect(
			parseSummaryGateQuery(
				new URLSearchParams({
					topics: Array.from({ length: READING_TOPIC_GATE_MAX + 1 }, (_, i) => String(i + 1)).join(
						",",
					),
				}),
			),
		).toMatchObject({ message: READING_MESSAGES.invalidTopics });
		expect(parseSummaryGateQuery(new URLSearchParams({ topics: "9".repeat(20) }))).toMatchObject({
			message: READING_MESSAGES.invalidTopics,
		});
	});
});
