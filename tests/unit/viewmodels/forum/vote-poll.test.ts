import { describe, expect, test } from "bun:test";
import {
	MOCK_POLLS,
	type PollData,
	applyVote,
	formatPollExpiry,
	formatVoterCount,
	isPollExpired,
	isValidSelection,
} from "@/viewmodels/forum/vote-poll";

const samplePoll: PollData = {
	question: "Test poll",
	options: [
		{ id: 1, text: "Option A", votes: 10, percentage: 50 },
		{ id: 2, text: "Option B", votes: 10, percentage: 50 },
	],
	maxChoices: 1,
	expiresAt: Math.floor(Date.now() / 1000) + 86400, // expires tomorrow
	voterCount: 20,
};

describe("vote-poll ViewModel", () => {
	describe("isPollExpired", () => {
		test("returns false for future expiry", () => {
			const future = Math.floor(Date.now() / 1000) + 86400;
			expect(isPollExpired(future)).toBe(false);
		});

		test("returns true for past expiry", () => {
			const past = Math.floor(Date.now() / 1000) - 86400;
			expect(isPollExpired(past)).toBe(true);
		});

		test("returns true when now equals expiresAt", () => {
			const now = 1000;
			expect(isPollExpired(1000, now)).toBe(true);
		});
	});

	describe("isValidSelection", () => {
		test("valid single selection", () => {
			expect(isValidSelection([1], 1)).toBe(true);
		});

		test("invalid empty selection", () => {
			expect(isValidSelection([], 1)).toBe(false);
		});

		test("invalid too many selections", () => {
			expect(isValidSelection([1, 2], 1)).toBe(false);
		});

		test("valid multiple selection", () => {
			expect(isValidSelection([1, 2], 3)).toBe(true);
		});
	});

	describe("applyVote", () => {
		test("increments selected option votes", () => {
			const updated = applyVote(samplePoll, [1]);
			const opt1 = updated.options.find((o) => o.id === 1);
			if (!opt1) throw new Error("Option 1 not found");
			expect(opt1.votes).toBe(11);
		});

		test("does not increment unselected options", () => {
			const updated = applyVote(samplePoll, [1]);
			const opt2 = updated.options.find((o) => o.id === 2);
			if (!opt2) throw new Error("Option 2 not found");
			expect(opt2.votes).toBe(10);
		});

		test("increments voter count", () => {
			const updated = applyVote(samplePoll, [1]);
			expect(updated.voterCount).toBe(21);
		});

		test("recalculates percentages", () => {
			const updated = applyVote(samplePoll, [1]);
			const totalVotes = updated.options.reduce((sum, o) => sum + o.votes, 0);
			expect(totalVotes).toBe(21);
			// Percentages should sum to ~100
			const percentSum = updated.options.reduce((sum, o) => sum + o.percentage, 0);
			expect(percentSum).toBeGreaterThanOrEqual(99);
			expect(percentSum).toBeLessThanOrEqual(101);
		});
	});

	describe("formatVoterCount", () => {
		test("zero votes", () => {
			expect(formatVoterCount(0)).toBe("No votes yet");
		});

		test("one vote", () => {
			expect(formatVoterCount(1)).toBe("1 person voted");
		});

		test("multiple votes", () => {
			expect(formatVoterCount(251)).toBe("251 people voted");
		});
	});

	describe("formatPollExpiry", () => {
		test("expired poll", () => {
			const past = 1000;
			expect(formatPollExpiry(past, 2000)).toBe("Poll ended");
		});

		test("days remaining", () => {
			const now = 1000;
			const future = now + 86400 * 3; // 3 days
			expect(formatPollExpiry(future, now)).toBe("3 days left");
		});

		test("1 day remaining", () => {
			const now = 1000;
			const future = now + 86400; // 1 day
			expect(formatPollExpiry(future, now)).toBe("1 day left");
		});

		test("hours remaining", () => {
			const now = 1000;
			const future = now + 3600 * 5; // 5 hours
			expect(formatPollExpiry(future, now)).toBe("5 hours left");
		});

		test("ending soon", () => {
			const now = 1000;
			const future = now + 1800; // 30 minutes
			expect(formatPollExpiry(future, now)).toBe("Ending soon");
		});
	});

	describe("MOCK_POLLS", () => {
		test("has mock poll data", () => {
			expect(MOCK_POLLS[1001]).toBeDefined();
		});

		test("mock poll has valid structure", () => {
			const poll = MOCK_POLLS[1001];
			if (!poll) throw new Error("Poll 1001 not found");
			expect(typeof poll.question).toBe("string");
			expect(Array.isArray(poll.options)).toBe(true);
			expect(poll.options.length).toBeGreaterThan(0);
			expect(typeof poll.maxChoices).toBe("number");
			expect(typeof poll.voterCount).toBe("number");
		});
	});
});
