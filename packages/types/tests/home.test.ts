import { describe, expect, it } from "vitest";
import {
	HOME_CONTEXT_MAX_BODY_BYTES,
	HOME_CONTEXT_PATH,
	HOME_DIGEST_LIMIT,
	HOME_DIGEST_TOPIC_MAX,
	HOME_MESSAGES,
	HOME_SUMMARY_TOPIC_MAX,
	homeDigestGatePasses,
	homeForumVisible,
	maskHomeDigestAuthor,
	parseHomeContextRequest,
} from "../src/home";

const request = {
	cachedBucket: null,
	includeDisplay: false,
	includeStats: false,
	summaryTopicIds: [],
	digestTopicIds: [],
};

describe("home context contract", () => {
	it("freezes the transport limits", () => {
		expect(HOME_CONTEXT_PATH).toBe("/api/v1/home/context");
		expect(HOME_CONTEXT_MAX_BODY_BYTES).toBe(32768);
		expect(HOME_SUMMARY_TOPIC_MAX).toBe(512);
		expect(HOME_DIGEST_TOPIC_MAX).toBe(5);
		expect(HOME_DIGEST_LIMIT).toBe(5);
	});

	it("parses a warm hint and rejects caller identity", () => {
		expect(parseHomeContextRequest({ ...request, cachedBucket: "member" })).toEqual({
			ok: true,
			value: { ...request, cachedBucket: "member" },
		});
		expect(parseHomeContextRequest({ ...request, userId: 1 })).toMatchObject({
			ok: false,
			message: HOME_MESSAGES.unknownField,
		});
		expect(parseHomeContextRequest({ ...request, cachedBucket: "public" })).toMatchObject({
			ok: false,
			message: HOME_MESSAGES.invalidBucket,
		});
		expect(parseHomeContextRequest({ ...request, includeDisplay: 1 })).toMatchObject({
			ok: false,
			message: HOME_MESSAGES.invalidFlag,
		});
	});

	it("rejects duplicate, invalid, and overflow candidate ids without truncating", () => {
		expect(parseHomeContextRequest({ ...request, summaryTopicIds: [2, 2] })).toMatchObject({
			ok: false,
			message: HOME_MESSAGES.duplicateTopic,
		});
		expect(parseHomeContextRequest({ ...request, digestTopicIds: ["1"] })).toMatchObject({
			ok: false,
			message: HOME_MESSAGES.invalidTopics,
		});
		expect(
			parseHomeContextRequest({
				...request,
				summaryTopicIds: Array.from({ length: 513 }, (_, index) => index + 1),
			}),
		).toMatchObject({ ok: false, message: HOME_MESSAGES.tooManyTopics });
		expect(
			parseHomeContextRequest({
				...request,
				digestTopicIds: [1, 2, 3, 4, 5, 6],
			}),
		).toMatchObject({ ok: false, message: HOME_MESSAGES.tooManyTopics });
	});

	it("masks every anonymous digest author and keeps named authors", () => {
		expect(maskHomeDigestAuthor(1, 42, "alice")).toEqual({
			anonymousAuthor: 1,
			authorId: 0,
			authorName: "匿名",
		});
		expect(maskHomeDigestAuthor(0, 42, "alice")).toEqual({
			anonymousAuthor: 0,
			authorId: 42,
			authorName: "alice",
		});
	});

	it("requires ancestor-allowed ids before a cached digest row passes", () => {
		const allowed = new Set([3]);
		expect(
			homeDigestGatePasses(
				{
					topicId: 9,
					forumId: 3,
					sticky: 0,
					digest: 2,
					anonymousAuthor: 1,
					authorId: 0,
				},
				{ id: 9, forumId: 3, authorId: 0, digest: 2, anonymousAuthor: 1 },
				allowed,
			),
		).toBe(true);
		expect(homeForumVisible("staff", "anon")).toBe(false);
		expect(homeForumVisible("staff", "staff")).toBe(true);
	});
});
